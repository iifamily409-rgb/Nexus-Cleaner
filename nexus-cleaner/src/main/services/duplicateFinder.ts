import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { CancellationToken, LRU, TaskPool, isCancellation } from '../core/concurrency'
import { collectFilesBySize, samePathKey } from '../core/walker'
import { hasProtectedExtension, isCriticalSystemPath, isPersonalPath, normalize, validateScanRoot } from '../core/pathSafety'
import type { DuplicateGroup, DuplicateScanResult, DeleteResult } from '@shared/types'

/**
 * DUPLICATE FINDER
 * Real content verification: size bucket -> 4 KiB fingerprint -> full SHA-256.
 * Hashing is streamed and bounded. Deletion is never automatic: the caller
 * passes an explicit list, and at least one copy per group is always preserved
 * because we re-verify group membership server-side.
 */

const MAX_FILES_TO_HASH = 20_000
const HASH_CONCURRENCY = 4
const FP_BYTES = 4096

export class DuplicateFinder {
  private tokens = new Map<string, CancellationToken>()
  private hashCache = new LRU<string, { hash: string; size: number; mtimeMs: number }>(5000)
  private lastResults = new Map<string, DuplicateScanResult>()

  cancel(opId: string): boolean {
    const token = this.tokens.get(opId)
    if (!token) return false
    token.cancel()
    return true
  }

  cancelAll(): void {
    for (const token of this.tokens.values()) token.cancel()
  }

  private async hashFile(filePath: string, full: boolean, token: CancellationToken): Promise<string> {
    const st = await fsp.lstat(filePath)
    const cacheKey = `${full ? 'f' : 'q'}:${filePath}`
    const cached = this.hashCache.get(cacheKey)
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.hash

    const hash = crypto.createHash('sha256')
    if (!full) {
      // Quick fingerprint of the first 4 KiB.
      const handle = await fsp.open(filePath, 'r')
      try {
        const buffer = Buffer.alloc(Math.min(FP_BYTES, st.size))
        await handle.read(buffer, 0, buffer.length, 0)
        hash.update(buffer)
      } finally {
        await handle.close()
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
        stream.on('data', (chunk) => {
          if (token.isCancelled) {
            stream.destroy()
            reject(new Error('cancelled'))
            return
          }
          hash.update(chunk)
        })
        stream.on('error', reject)
        stream.on('end', () => resolve())
      })
    }
    const digest = hash.digest('hex')
    this.hashCache.set(cacheKey, { hash: digest, size: st.size, mtimeMs: st.mtimeMs })
    return digest
  }

  async scan(roots: string[], minSizeBytes: number, opId: string): Promise<DuplicateScanResult> {
    const startedAt = Date.now()
    const token = new CancellationToken()
    this.tokens.set(opId, token)
    const errors: string[] = []
    let protectedSkipped = 0

    const validRoots: string[] = []
    for (const root of roots) {
      const verdict = validateScanRoot(root)
      if (!verdict.ok) {
        errors.push(`Refused ${root}: ${verdict.reason}`)
        continue
      }
      const normalized = normalize(root)
      validRoots.push(normalized)
    }
    if (validRoots.length === 0) throw new Error('No valid folders to scan.')

    try {
      const { bySize, stats } = await collectFilesBySize(validRoots, minSizeBytes, {
        token,
        concurrency: 8,
        maxDepth: 32,
        onError: (dir, err) => {
          if (err.code !== 'ENOENT' && errors.length < 40) errors.push(`Cannot read ${dir}: ${err.code ?? 'ERR'}`)
        }
      })

      const filesConsidered = stats.reduce((acc, s) => acc + s.files, 0)

      // Only size buckets with 2+ members can contain duplicates.
      const candidateGroups = [...bySize.entries()].filter(([, files]) => files.length > 1)
      let candidates: { path: string; size: number; mtimeMs: number }[] = []
      for (const [, files] of candidateGroups) {
        for (const f of files) {
          if (isCriticalSystemPath(f.path)) {
            protectedSkipped++
            continue
          }
          candidates.push({ path: f.path, size: f.size, mtimeMs: f.mtimeMs })
        }
      }
      // Bound the work: biggest files first (they matter most).
      candidates.sort((a, b) => b.size - a.size)
      if (candidates.length > MAX_FILES_TO_HASH) {
        errors.push(
          `Hash limit reached: ${candidates.length - MAX_FILES_TO_HASH} smaller candidate files were not hashed. Narrow the folders for complete results.`
        )
        candidates = candidates.slice(0, MAX_FILES_TO_HASH)
      }

      const pool = new TaskPool(HASH_CONCURRENCY)
      let hashed = 0

      // Stage 1: quick fingerprint within each size bucket.
      const quickByKey = new Map<string, typeof candidates>()
      await Promise.all(
        candidates.map((file) =>
          pool.run(async () => {
            if (token.isCancelled) return
            try {
              const fp = await this.hashFile(file.path, false, token)
              const key = `${file.size}:${fp}`
              const bucket = quickByKey.get(key)
              if (bucket) bucket.push(file)
              else quickByKey.set(key, [file])
              hashed++
            } catch (err) {
              if (!isCancellation(err) && errors.length < 40) {
                errors.push(`Cannot read ${file.path}: ${(err as NodeJS.ErrnoException).code ?? 'ERR'}`)
              }
            }
          })
        )
      )
      await pool.drain()

      // Stage 2: full SHA-256 only for fingerprint matches.
      const fullByHash = new Map<string, typeof candidates>()
      const stage2 = [...quickByKey.values()].filter((group) => group.length > 1).flat()
      await Promise.all(
        stage2.map((file) =>
          pool.run(async () => {
            if (token.isCancelled) return
            try {
              const digest = await this.hashFile(file.path, true, token)
              const bucket = fullByHash.get(digest)
              if (bucket) bucket.push(file)
              else fullByHash.set(digest, [file])
            } catch (err) {
              if (!isCancellation(err) && errors.length < 40) {
                errors.push(`Cannot hash ${file.path}: ${(err as NodeJS.ErrnoException).code ?? 'ERR'}`)
              }
            }
          })
        )
      )
      await pool.drain()

      const groups: DuplicateGroup[] = []
      for (const [hash, files] of fullByHash) {
        if (files.length < 2) continue
        // Deduplicate identical paths (hardlink-style repeats).
        const seen = new Set<string>()
        const unique = files.filter((f) => {
          const key = samePathKey(f.path)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (unique.length < 2) continue
        groups.push({
          hash,
          size: unique[0]?.size ?? 0,
          files: unique.map((f) => ({ path: f.path, mtimeMs: f.mtimeMs })),
          wastedBytes: (unique[0]?.size ?? 0) * (unique.length - 1)
        })
      }
      groups.sort((a, b) => b.wastedBytes - a.wastedBytes)

      const result: DuplicateScanResult = {
        roots: validRoots,
        startedAt,
        endedAt: Date.now(),
        filesConsidered,
        filesHashed: hashed,
        groups,
        totalWastedBytes: groups.reduce((acc, g) => acc + g.wastedBytes, 0),
        cancelled: token.isCancelled,
        errors,
        protectedSkipped
      }
      this.lastResults.set(opId, result)
      return result
    } finally {
      this.tokens.delete(opId)
    }
  }

  /**
   * Counts the copies of `group` that still exist on disk, excluding `excludePath`.
   * Verification is by size + content hash, not just existence, so a file that
   * was replaced with different content does not count as a survivor.
   */
  private async countLiveCopies(group: DuplicateGroup, excludePath: string): Promise<number> {
    let live = 0
    for (const file of group.files) {
      if (samePathKey(file.path) === samePathKey(excludePath)) continue
      try {
        const st = await fsp.lstat(file.path)
        if (!st.isFile() || st.isSymbolicLink()) continue
        if (st.size !== group.size) continue
        // Verified by full SHA-256, not just by path: a file replaced with
        // different content must not be counted as a surviving copy.
        const hash = await this.hashFile(file.path, true, new CancellationToken())
        if (hash !== group.hash) continue
        live++
        if (live >= 1000) break
      } catch {
        // Missing or unreadable: not a survivor.
      }
    }
    return live
  }

  /**
   * Deletes an explicit list of duplicate paths after re-verifying that each
   * path still belongs to a duplicate group that retains another copy.
   */
  async delete(paths: string[], keepPerGroup: number): Promise<DeleteResult> {
    const startedAt = Date.now()
    const result: DeleteResult = {
      category: 'user-temp',
      attempted: 0,
      deleted: 0,
      bytesDeleted: 0,
      skipped: 0,
      failed: 0,
      skipReasons: {},
      errors: [],
      durationMs: 0
    }
    const noteSkip = (reason: string): void => {
      result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1
    }

    // Re-verify against the most recent scan when available.
    const latest = [...this.lastResults.values()].sort((a, b) => b.endedAt - a.endedAt)[0]
    const groupByPath = new Map<string, DuplicateGroup>()
    if (latest) {
      for (const group of latest.groups) {
        for (const file of group.files) groupByPath.set(samePathKey(file.path), group)
      }
    }

    const remainingPerGroup = new Map<string, number>()
    if (latest) {
      for (const group of latest.groups) remainingPerGroup.set(group.hash, group.files.length)
    }

    // Fail closed. Without a scan result there is no evidence that any of these
    // paths is a duplicate, so nothing may be deleted. Silently deleting them
    // would turn a duplicate cleanup into an arbitrary file deletion.
    if (!latest) {
      for (const rawPath of paths) {
        result.attempted++
        result.skipped++
        noteSkip('no verified duplicate scan — run Duplicate Finder first')
      }
      result.durationMs = Date.now() - startedAt
      return result
    }

    for (const rawPath of paths) {
      if (result.attempted > 5000) {
        result.errors.push('Deletion batch limit reached (5000 paths).')
        break
      }
      const target = normalize(rawPath)
      result.attempted++

      if (isCriticalSystemPath(target)) {
        result.skipped++
        noteSkip('inside a critical system location')
        if (result.errors.length < 25) result.errors.push(`Skipped critical path: ${target}`)
        continue
      }
      if (hasProtectedExtension(path.basename(target)) && groupByPath.size === 0) {
        result.skipped++
        noteSkip('protected file type outside a verified duplicate group')
        if (result.errors.length < 25) result.errors.push(`Skipped unverified file type: ${target}`)
        continue
      }

      const group = groupByPath.get(samePathKey(target))
      if (group) {
        // The scan-time count is not trustworthy on its own: a copy may have
        // been moved, deleted or renamed between the scan and this deletion.
        // Recount what is actually still on disk before removing anything, so a
        // duplicate cleanup can never delete the last surviving copy.
        const liveSurvivors = await this.countLiveCopies(group, target)
        if (liveSurvivors < keepPerGroup) {
          result.skipped++
          noteSkip('no verified surviving copy — refusing to delete the last copy')
          if (result.errors.length < 25) {
            result.errors.push(`Preserved ${target}: only ${liveSurvivors} cop(ies) would remain, ${keepPerGroup} required`)
          }
          continue
        }
      } else if (groupByPath.size > 0) {
        result.skipped++
        noteSkip('not part of a verified duplicate group')
        if (result.errors.length < 25) result.errors.push(`Skipped ${target}: not part of a verified duplicate group`)
        continue
      }

      let st: Awaited<ReturnType<typeof fsp.lstat>>
      try {
        st = await fsp.lstat(target)
      } catch {
        result.skipped++
        noteSkip('file disappeared before deletion')
        continue
      }
      if (!st.isFile() || st.isSymbolicLink()) {
        result.skipped++
        noteSkip('symbolic link or non-regular file')
        if (result.errors.length < 25) result.errors.push(`Skipped non-regular file: ${target}`)
        continue
      }
      if (isPersonalPath(path.dirname(target)) && group && group.files.length <= keepPerGroup + 1) {
        // Extra guard: inside Documents/Photos etc. we require a real surviving copy.
        const survivors = group.files.filter((f) => samePathKey(f.path) !== samePathKey(target)).length
        if (survivors < keepPerGroup) {
          result.skipped++
          noteSkip('no verified surviving copy in a personal folder')
          continue
        }
      }

      try {
        await fsp.unlink(target)
        result.deleted++
        result.bytesDeleted += st.size
        if (group) remainingPerGroup.set(group.hash, (remainingPerGroup.get(group.hash) ?? 1) - 1)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
          result.skipped++
          noteSkip('locked or in use by another program')
          if (result.errors.length < 25) result.errors.push(`Locked: ${target}`)
        } else {
          result.failed++
          if (result.errors.length < 25) result.errors.push(`${code ?? 'ERR'}: ${target}`)
        }
      }
    }
    result.durationMs = Date.now() - startedAt
    return result
  }
}

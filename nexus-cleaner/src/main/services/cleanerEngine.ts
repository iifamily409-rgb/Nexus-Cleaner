import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { CancellationToken, TaskPool, hoursToMs, isCancellation } from '../core/concurrency'
import { walkDirectory, type FileEntry } from '../core/walker'
import {
  deletionRootsFor,
  hasProtectedExtension,
  isInside,
  normalize,
  platformKind,
  validateDeletionCandidate
} from '../core/pathSafety'
import { createRecipes, describeCategories, type CleanupRecipe, type RecipeRoot } from '../core/recipes'
import { getDiskUsage } from './diskUsage'
import type {
  CategoryId,
  CategoryScanResult,
  CleanReport,
  CleanupCategory,
  DeleteResult,
  LiveProgress,
  OperationEvent,
  ScanItem,
  ScanOptions,
  ScanReport
} from '@shared/types'

export interface CleanerDeps {
  emitProgress: (p: LiveProgress) => void
  emitEvent: (e: OperationEvent) => void
  now?: () => number
  /**
   * Injectable recipe factory. Production always uses `createRecipes()`;
   * tests substitute a temporary-directory recipe so that the real scan,
   * validation and deletion pipeline can be exercised without ever pointing
   * at a user's actual folders.
   */
  recipes?: () => CleanupRecipe[]
}

interface Candidate {
  path: string
  size: number
  mtimeMs: number
  category: CategoryId
}

interface ScanState {
  report: ScanReport
  options: ScanOptions
  candidates: Candidate[]
  allowlist: string[]
  token: CancellationToken
  categoryRoots: Map<CategoryId, string[]>
  truncated: boolean
}

const MAX_CANDIDATES = 500_000
const MAX_SAMPLE = 40
const MAX_ERROR_MESSAGES = 60
const CATEGORY_CONCURRENCY = 3
const WALK_CONCURRENCY = 8
const DELETE_CONCURRENCY = 12
const PROGRESS_INTERVAL_MS = 90

const uid = (): string => crypto.randomUUID()

/** Keeps a rolling window of error strings without unbounded growth. */
class ErrorBag {
  private items: string[] = []
  private count = 0
  push(message: string): void {
    this.count++
    if (this.items.length < MAX_ERROR_MESSAGES) this.items.push(message)
  }
  get all(): string[] {
    return this.items
  }
  get total(): number {
    return this.count
  }
  get omitted(): number {
    return Math.max(0, this.count - this.items.length)
  }
}

export class CleanerEngine {
  private states = new Map<string, ScanState>()
  private tokens = new Map<string, CancellationToken>()
  private progressByOp = new Map<string, LiveProgress>()
  private lastEmit = new Map<string, number>()

  constructor(private readonly deps: CleanerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private recipeList(): CleanupRecipe[] {
    return this.deps.recipes ? this.deps.recipes() : createRecipes()
  }

  async categories(): Promise<CleanupCategory[]> {
    return describeCategories(this.recipeList())
  }

  private recipesForCategories(ids: CategoryId[]): CleanupRecipe[] {
    const recipes = this.recipeList()
    const wanted = new Set(ids)
    return recipes.filter((r) => wanted.has(r.id))
  }

  private emitEvent(opId: string, type: OperationEvent['type'], message: string, level: OperationEvent['level'] = 'info', category?: CategoryId, data?: OperationEvent['data']): void {
    this.deps.emitEvent({
      opId,
      at: this.now(),
      type,
      message,
      level,
      ...(category ? { category } : {}),
      ...(data ? { data } : {})
    })
  }

  private emitProgress(opId: string, patch: Partial<LiveProgress>, force = false): LiveProgress {
    const base: LiveProgress =
      this.progressByOp.get(opId) ??
      ({
        opId,
        phase: 'idle',
        currentTask: '',
        currentCategory: null,
        itemsScanned: 0,
        itemsEligible: 0,
        bytesEligible: 0,
        filesDeleted: 0,
        bytesDeleted: 0,
        itemsSkipped: 0,
        errors: 0,
        elapsedMs: 0,
        estimatedRemainingMs: null,
        categoriesDone: [],
        categoriesTotal: []
      } satisfies LiveProgress)
    const next: LiveProgress = { ...base, ...patch, opId }
    this.progressByOp.set(opId, next)
    const last = this.lastEmit.get(opId) ?? 0
    const now = this.now()
    if (force || now - last >= PROGRESS_INTERVAL_MS) {
      this.lastEmit.set(opId, now)
      this.deps.emitProgress(next)
    }
    return next
  }

  cancel(opId: string): boolean {
    const token = this.tokens.get(opId)
    if (!token) return false
    token.cancel()
    return true
  }

  cancelAll(): void {
    for (const token of this.tokens.values()) token.cancel()
  }

  /** Resolve which categories a mode covers. */
  private resolveCategories(options: ScanOptions): CategoryId[] {
    const recipes = this.recipeList()
    if (options.mode === 'custom') {
      const requested = options.categories ?? []
      return requested.filter((id) => recipes.some((r) => r.id === id))
    }
    const key = options.mode === 'quick' ? 'quick' : options.mode === 'smart' ? 'smart' : 'deep'
    const selected = recipes.filter((r) => r[key]).map((r) => r.id)
    if (options.categories && options.categories.length > 0) {
      const wanted = new Set(options.categories)
      return selected.filter((id) => wanted.has(id))
    }
    return selected
  }

  async scan(options: ScanOptions): Promise<ScanReport> {
    const opId = uid()
    const token = new CancellationToken()
    this.tokens.set(opId, token)
    const startedAt = this.now()
    const minAgeMs = hoursToMs(options.minAgeHours)
    const categoryIds = this.resolveCategories(options)
    const recipes = this.recipesForCategories(categoryIds)
    const exclusions = options.exclusions.map((e) => normalize(e))

    const categoryRoots = new Map<CategoryId, string[]>()
    for (const recipe of recipes) {
      try {
        const roots: RecipeRoot[] = await recipe.roots()
        categoryRoots.set(recipe.id, roots.map((r) => r.root))
      } catch {
        categoryRoots.set(recipe.id, [])
      }
    }

    const allowlist = deletionRootsFor([...categoryRoots.values()].flat().map((p) => path.resolve(p)))

    const diskBefore = await getDiskUsage()

    this.emitProgress(opId, {
      phase: 'scan',
      currentTask: 'Preparing scan',
      itemsScanned: 0,
      itemsEligible: 0,
      bytesEligible: 0,
      itemsSkipped: 0,
      errors: 0,
      elapsedMs: 0,
      estimatedRemainingMs: null,
      categoriesDone: [],
      categoriesTotal: categoryIds
    }, true)
    this.emitEvent(opId, 'start', `Scan started (${options.mode} mode) — ${categoryIds.length} categories`, 'info', undefined, {
      mode: options.mode,
      minAgeHours: options.minAgeHours
    })

    const candidates: Candidate[] = []
    const seen = new Set<string>()
    /** Paths already counted as eligible, so overlapping roots count once. */
    const seenEligible = new Set<string>()
    const kind = platformKind()
    const errors = new ErrorBag()
    let totalEligibleBytes = 0
    let totalEligibleFiles = 0
    let totalScanned = 0
    let totalSkipped = 0
    const categoryResults: CategoryScanResult[] = []
    let truncated = false

    const pushCandidate = (entry: FileEntry, category: CategoryId): void => {
      if (candidates.length >= MAX_CANDIDATES) {
        truncated = true
        return
      }
      const key = kind === 'win32' ? entry.path.toLowerCase() : entry.path
      if (seen.has(key)) return
      seen.add(key)
      candidates.push({ path: entry.path, size: entry.size, mtimeMs: entry.mtimeMs, category })
    }

    const scanCategory = async (recipe: CleanupRecipe): Promise<CategoryScanResult> => {
      const catStart = this.now()
      const roots = categoryRoots.get(recipe.id) ?? []
      const result: CategoryScanResult = {
        category: recipe.id,
        eligibleFiles: 0,
        eligibleBytes: 0,
        scannedFiles: 0,
        skippedFiles: 0,
        errorCount: 0,
        roots,
        sample: [],
        skipReasons: {},
        durationMs: 0,
        truncated: false
      }
      const catErrors = new ErrorBag()
      const noteSkip = (reason: string): void => {
        result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1
      }

      this.emitEvent(opId, 'category-start', `Analyzing ${recipe.name}`, 'info', recipe.id)
      this.emitProgress(opId, { currentTask: `Scanning ${recipe.name}`, currentCategory: recipe.id }, true)

      if (roots.length === 0) {
        result.durationMs = this.now() - catStart
        this.emitEvent(opId, 'category-end', `${recipe.name}: nothing to scan`, 'info', recipe.id, { eligibleBytes: 0 })
        return result
      }

      // Drop roots that are nested inside another root of the same category: the
      // outer walk already reaches every file below them.
      const orderedRoots = [...roots].sort((a, b) => path.resolve(a).length - path.resolve(b).length)
      const effectiveRoots = orderedRoots.filter(
        (root, index) =>
          !orderedRoots.some((other, otherIndex) => {
            if (otherIndex >= index) return false
            const rel = path.relative(path.resolve(other), path.resolve(root))
            return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
          })
      )

      for (const root of effectiveRoots) {
        if (token.isCancelled) break
        const walkStats = await walkDirectory(path.resolve(root), {
          token,
          concurrency: WALK_CONCURRENCY,
          maxDepth: 24,
          skipDirNames: [],
          onFile: (entry) => {
            result.scannedFiles++
            totalScanned++
            const name = path.basename(entry.path)
            const ext = path.extname(name).toLowerCase()

            if (recipe.skipFileNames?.some((s) => s.toLowerCase() === name.toLowerCase())) {
              result.skippedFiles++
              totalSkipped++
              noteSkip('excluded file name')
              return
            }
            if (recipe.eligible && !recipe.eligible(name, ext)) {
              result.skippedFiles++
              totalSkipped++
              noteSkip('not a cache/temp file type')
              return
            }
            if (hasProtectedExtension(name)) {
              result.skippedFiles++
              totalSkipped++
              noteSkip('protected file type')
              return
            }
            const verdict = validateDeletionCandidate(entry.path, {
              allowedRoots: allowlist,
              exclusions,
              minAgeMs,
              nowMs: this.now(),
              mtimeMs: entry.mtimeMs
            })
            if (!verdict.ok) {
              result.skippedFiles++
              totalSkipped++
              noteSkip(verdict.reason)
              return
            }
            // A file reachable from two overlapping roots (e.g. %TEMP% nested
            // inside %LOCALAPPDATA%\Temp, or /tmp plus a TMPDIR under it) must be
            // counted exactly once. Counting it twice would inflate the estimate
            // the user is asked to approve.
            const dedupeKey = kind === 'win32' ? entry.path.toLowerCase() : entry.path
            if (seenEligible.has(dedupeKey)) return
            seenEligible.add(dedupeKey)
            result.eligibleFiles++
            result.eligibleBytes += entry.size
            totalEligibleFiles++
            totalEligibleBytes += entry.size
            if (result.sample.length < MAX_SAMPLE) {
              result.sample.push({
                path: entry.path,
                size: entry.size,
                mtimeMs: entry.mtimeMs,
                category: recipe.id,
                source: root
              })
            }
            pushCandidate(entry, recipe.id)
          },
          onError: (dir, err) => {
            result.errorCount++
            if (err.code === 'EACCES' || err.code === 'EPERM') {
              catErrors.push(`Access denied: ${dir}`)
            } else if (err.code !== 'ENOENT') {
              catErrors.push(`${err.code ?? 'ERR'}: ${dir}`)
            }
          },
          onSkipLink: () => {
            result.skippedFiles++
            totalSkipped++
            noteSkip('symbolic link or reparse point (never followed)')
          }
        })
        if (walkStats.truncated) result.truncated = true
        result.errorCount += 0
      }

      result.durationMs = this.now() - catStart
      this.emitEvent(
        opId,
        'category-end',
        `${recipe.name}: ${result.eligibleFiles} files, ${result.eligibleBytes} bytes eligible`,
        result.errorCount > 0 ? 'warn' : 'info',
        recipe.id,
        { eligibleBytes: result.eligibleBytes, eligibleFiles: result.eligibleFiles, errors: result.errorCount }
      )
      this.emitProgress(
        opId,
        {
          itemsScanned: totalScanned,
          itemsEligible: totalEligibleFiles,
          bytesEligible: totalEligibleBytes,
          itemsSkipped: totalSkipped,
          errors: errors.total + catErrors.total,
          categoriesDone: [...(this.progressByOp.get(opId)?.categoriesDone ?? []), recipe.id],
          elapsedMs: this.now() - startedAt
        },
        true
      )
      for (const msg of catErrors.all) errors.push(msg)
      return result
    }

    const pool = new TaskPool(CATEGORY_CONCURRENCY)
    const settled = await Promise.all(
      recipes.map((recipe) =>
        pool.run(async () => {
          try {
            return await scanCategory(recipe)
          } catch (err) {
            if (isCancellation(err)) return null
            errors.push(`${recipe.name}: ${(err as Error).message}`)
            return null
          }
        })
      )
    )
    for (const res of settled) if (res) categoryResults.push(res)

    const endedAt = this.now()
    const report: ScanReport = {
      id: opId,
      mode: options.mode,
      startedAt,
      endedAt,
      categories: categoryResults,
      totalEligibleFiles,
      totalEligibleBytes,
      totalScannedFiles: totalScanned,
      totalSkippedFiles: totalSkipped,
      skipReasons: aggregateSkipReasons(categoryResults),
      errors: errors.all,
      cancelled: token.isCancelled,
      diskBefore,
      options,
      platform: process.platform
    }

    this.states.set(opId, { report, options, candidates, allowlist, token, categoryRoots, truncated })
    this.tokens.delete(opId)

    this.emitProgress(opId, {
      phase: 'idle',
      currentTask: token.isCancelled ? 'Scan cancelled' : 'Scan complete',
      elapsedMs: endedAt - startedAt,
      itemsScanned: totalScanned,
      itemsEligible: totalEligibleFiles,
      bytesEligible: totalEligibleBytes,
      itemsSkipped: totalSkipped,
      errors: errors.total,
      categoriesDone: categoryResults.map((c) => c.category),
      estimatedRemainingMs: null
    }, true)
    this.emitEvent(
      opId,
      token.isCancelled ? 'cancelled' : 'complete',
      token.isCancelled
        ? `Scan cancelled after ${((endedAt - startedAt) / 1000).toFixed(1)}s`
        : `Scan complete: ${totalEligibleFiles} eligible files, ${(totalEligibleBytes / 1048576).toFixed(1)} MB`,
      token.isCancelled ? 'warn' : 'success',
      undefined,
      { elapsedMs: endedAt - startedAt, eligibleFiles: totalEligibleFiles, eligibleBytes: totalEligibleBytes }
    )
    return report
  }

  /**
   * Executes a previously analysed scan.
   * Every candidate is re-validated here — the scan result is a proposal, not a
   * permission slip. Files that changed, moved, or became links are skipped.
   */
  async run(scanId: string): Promise<CleanReport> {
    const state = this.states.get(scanId)
    if (!state) throw new Error('Unknown or expired scan id. Run a new scan first.')
    if (state.token.isCancelled) throw new Error('This scan was cancelled; run a new scan.')

    const opId = uid()
    const token = new CancellationToken()
    this.tokens.set(opId, token)
    // The UI may cancel using either the scan id it already holds or the live
    // operation id from progress events. Both must stop the same operation.
    this.tokens.set(scanId, token)
    state.token = token

    const startedAt = this.now()
    const minAgeMs = hoursToMs(state.options.minAgeHours)
    const exclusions = state.options.exclusions.map((e) => normalize(e))
    const diskBefore = await getDiskUsage()
    const warnings: string[] = []

    this.emitProgress(opId, {
      phase: 'delete',
      currentTask: 'Removing files',
      currentCategory: null,
      itemsScanned: state.report.totalScannedFiles,
      itemsEligible: state.report.totalEligibleFiles,
      bytesEligible: state.report.totalEligibleBytes,
      filesDeleted: 0,
      bytesDeleted: 0,
      itemsSkipped: 0,
      errors: 0,
      elapsedMs: 0,
      estimatedRemainingMs: null,
      categoriesDone: [],
      categoriesTotal: state.report.categories.map((c) => c.category)
    }, true)
    const byCategory = new Map<CategoryId, Candidate[]>()
    for (const candidate of state.candidates) {
      const list = byCategory.get(candidate.category)
      if (list) list.push(candidate)
      else byCategory.set(candidate.category, [candidate])
    }

    // Count what will actually be attempted, grouped exactly as the deletion
    // loop will group it. Reporting `state.candidates.length` here would be
    // wrong: that array is drained per category during the run, so the number
    // shrank as cleanup progressed and under-reported the queue to the user.
    const queued = [...byCategory.values()].reduce((total, list) => total + list.length, 0)
    this.emitEvent(opId, 'start', `Cleanup started: ${queued} files queued`, 'info', undefined, {
      candidates: queued
    })

    const results: DeleteResult[] = []
    const pool = new TaskPool(DELETE_CONCURRENCY)
    let filesDeleted = 0
    let bytesDeleted = 0
    let attemptedTotal = 0
    let skippedTotal = 0
    let failedTotal = 0
    const allErrors = new ErrorBag()
    const deletedPaths: { path: string; size: number }[] = []
    const emptyDirCandidates = new Set<string>()

    for (const [category, list] of byCategory) {
      const catStart = this.now()
      const result: DeleteResult = {
        category,
        attempted: 0,
        deleted: 0,
        bytesDeleted: 0,
        skipped: 0,
        failed: 0,
        skipReasons: {},
        errors: [],
        durationMs: 0
      }
      const noteDeleteSkip = (reason: string): void => {
        result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1
      }

      this.emitProgress(opId, { currentCategory: category, currentTask: `Removing ${category} files` }, true)

      // Recycle bin needs an OS-level empty; it is never deleted path-by-path.
      if (category === 'recycle-bin' && process.platform === 'win32') {
        const emptied = await this.emptyRecycleBin()
        result.durationMs = this.now() - catStart
        if (!emptied.ok) {
          result.errors.push(emptied.error)
          warnings.push(`Recycle Bin could not be emptied: ${emptied.error}`)
          failedTotal++
        }
        this.emitEvent(opId, 'category-end', emptied.ok ? 'Recycle Bin emptied' : 'Recycle Bin could not be emptied', emptied.ok ? 'success' : 'error', category)
        results.push(result)
        continue
      }

      await Promise.all(
        list.map((candidate) =>
          pool.run(async () => {
            if (token.isCancelled) return
            attemptedTotal++
            result.attempted++

            const verdict = validateDeletionCandidate(candidate.path, {
              allowedRoots: state.allowlist,
              exclusions,
              minAgeMs,
              nowMs: this.now(),
              mtimeMs: candidate.mtimeMs
            })
            if (!verdict.ok) {
              result.skipped++
              skippedTotal++
              noteDeleteSkip(verdict.reason)
              if (result.errors.length < 20) result.errors.push(`Skipped ${candidate.path}: ${verdict.reason}`)
              return
            }

            let st: Awaited<ReturnType<typeof fs.lstat>>
            try {
              st = await fs.lstat(candidate.path)
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code
              if (code === 'ENOENT') {
                // Already gone — not an error, not a deletion we performed.
                result.skipped++
                skippedTotal++
                noteDeleteSkip('file disappeared before deletion')
              } else {
                result.failed++
                failedTotal++
                const msg = `${code ?? 'ERR'} ${candidate.path}`
                if (result.errors.length < 20) result.errors.push(msg)
                allErrors.push(msg)
              }
              return
            }

            // Refuse to delete anything that became a link, directory or device.
            if (st.isSymbolicLink() || !st.isFile()) {
              result.skipped++
              skippedTotal++
              noteDeleteSkip('became a symbolic link or non-regular file after the scan')
              if (result.errors.length < 20) result.errors.push(`Skipped non-regular file: ${candidate.path}`)
              return
            }
            // Refuse if the file grew/changed age rules since the scan.
            if (minAgeMs > 0 && this.now() - st.mtimeMs < minAgeMs) {
              result.skipped++
              skippedTotal++
              noteDeleteSkip('timestamps changed — file is now newer than the minimum-age filter')
              return
            }

            try {
              await fs.unlink(candidate.path)
              result.deleted++
              filesDeleted++
              result.bytesDeleted += st.size
              bytesDeleted += st.size
              deletedPaths.push({ path: candidate.path, size: st.size })
              emptyDirCandidates.add(path.dirname(candidate.path))
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code
              if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY') {
                result.skipped++
                skippedTotal++
                noteDeleteSkip('locked or in use by another program')
                if (result.errors.length < 20) result.errors.push(`Locked or in use: ${candidate.path}`)
              } else {
                result.failed++
                failedTotal++
                const msg = `${code ?? 'ERR'} ${candidate.path}`
                if (result.errors.length < 20) result.errors.push(msg)
                allErrors.push(msg)
              }
            }

            this.emitProgress(opId, {
              filesDeleted,
              bytesDeleted,
              itemsSkipped: skippedTotal,
              errors: failedTotal,
              elapsedMs: this.now() - startedAt,
              estimatedRemainingMs: null
            })
          })
        )
      )
      await pool.drain()
      result.durationMs = this.now() - catStart
      this.emitEvent(
        opId,
        'category-end',
        `${category}: removed ${result.deleted} files (${result.bytesDeleted} bytes), ${result.skipped} skipped, ${result.failed} failed`,
        result.failed > 0 ? 'warn' : 'success',
        category,
        {
          deleted: result.deleted,
          bytesDeleted: result.bytesDeleted,
          skipped: result.skipped,
          failed: result.failed,
          skippedReasons: Object.entries(result.skipReasons)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `${count}× ${reason}`)
            .join('; ') || 'none'
        }
      )
      results.push(result)
      this.emitProgress(
        opId,
        {
          categoriesDone: [...(this.progressByOp.get(opId)?.categoriesDone ?? []), category],
          categoriesTotal: [...byCategory.keys()]
        },
        true
      )
    }

    const deleteMs = this.now() - startedAt

    // Prune directories that our deletions emptied (never the roots themselves).
    const removedDirs = token.isCancelled ? 0 : await this.pruneEmptyDirs(state.allowlist, emptyDirCandidates)

    // Independent verification: the paths must be gone, and disk free space should
    // have moved. Both are reported separately, never conflated.
    const verifyStart = this.now()
    this.emitProgress(opId, { phase: 'verify', currentTask: 'Verifying results', elapsedMs: this.now() - startedAt }, true)
    let verified = 0
    const verifySample = deletedPaths.slice(0, 2000)
    for (const item of verifySample) {
      try {
        await fs.lstat(item.path)
      } catch {
        verified++
      }
    }
    const diskAfter = await getDiskUsage()
    const verifyMs = this.now() - verifyStart
    const verifiedBytesFreed =
      diskBefore && diskAfter ? Math.max(0, diskAfter.freeBytes - diskBefore.freeBytes) : null

    const endedAt = this.now()
    const report: CleanReport = {
      id: opId,
      scanId,
      mode: state.report.mode,
      startedAt,
      endedAt,
      results,
      totalDeleted: filesDeleted,
      totalBytesDeleted: bytesDeleted,
      totalAttempted: attemptedTotal,
      totalSkipped: skippedTotal,
      totalFailed: failedTotal,
      diskBefore,
      diskAfter,
      verifiedBytesFreed,
      cancelled: token.isCancelled,
      timings: {
        scanMs: state.report.endedAt - state.report.startedAt,
        deleteMs,
        verifyMs
      },
      warnings: [
        ...warnings,
        ...(verified < verifySample.length
          ? [`Verification could not confirm ${verifySample.length - verified} of ${verifySample.length} sampled paths`]
          : []),
        ...(removedDirs > 0 ? [`${removedDirs} emptied folder(s) were pruned`] : []),
        ...(allErrors.omitted > 0 ? [`${allErrors.omitted} additional errors omitted from the list`] : [])
      ]
    }

    this.emitProgress(opId, {
      phase: 'idle',
      currentTask: token.isCancelled ? 'Cleanup cancelled' : 'Cleanup verified',
      filesDeleted,
      bytesDeleted,
      itemsSkipped: skippedTotal,
      errors: failedTotal,
      elapsedMs: endedAt - startedAt,
      estimatedRemainingMs: null
    }, true)
    this.emitEvent(
      opId,
      token.isCancelled ? 'cancelled' : 'complete',
      `${token.isCancelled ? 'Cancelled' : 'Complete'}: ${filesDeleted} files removed, ${(bytesDeleted / 1048576).toFixed(2)} MB. Verified samples: ${verified}/${verifySample.length}`,
      token.isCancelled ? 'warn' : 'success',
      undefined,
      { filesDeleted, bytesDeleted, verified, verifySample: verifySample.length }
    )

    this.states.delete(scanId)
    this.tokens.delete(opId)
    this.tokens.delete(scanId)
    return report
  }

  /**
   * Dry run: performs the full analysis and reports exactly what would be
   * attempted, but never calls unlink. This is the default preview path.
   */
  async dryRun(options: ScanOptions): Promise<CleanReport> {
    const scan = await this.scan({ ...options, dryRun: true })
    const state = this.states.get(scan.id)
    const startedAt = this.now()
    const results: DeleteResult[] = scan.categories.map((c) => ({
      category: c.category,
      attempted: 0,
      deleted: 0,
      bytesDeleted: 0,
      skipped: 0,
      failed: 0,
      skipReasons: {},
      errors: [],
      durationMs: c.durationMs
    }))
    const report: CleanReport = {
      id: uid(),
      scanId: scan.id,
      mode: scan.mode,
      startedAt,
      endedAt: this.now(),
      results,
      totalDeleted: 0,
      totalBytesDeleted: 0,
      totalAttempted: 0,
      totalSkipped: 0,
      totalFailed: 0,
      diskBefore: scan.diskBefore,
      diskAfter: scan.diskBefore,
      verifiedBytesFreed: null,
      cancelled: scan.cancelled,
      timings: { scanMs: scan.endedAt - scan.startedAt, deleteMs: 0, verifyMs: 0 },
      warnings: [
        'Dry run: no files were deleted. The numbers above are what a real cleanup would attempt.',
        `${scan.totalEligibleFiles} files would be attempted (${scan.totalEligibleBytes} bytes).`
      ]
    }
    if (state) this.states.delete(scan.id)
    return report
  }

  private async pruneEmptyDirs(allowlist: string[], starts: Set<string>): Promise<number> {
    let removed = 0
    const kind = platformKind()
    const visited = new Set<string>()
    const queue = [...starts]
    while (queue.length > 0 && removed < 5000) {
      const dir = queue.shift() as string
      const key = kind === 'win32' ? dir.toLowerCase() : dir
      if (visited.has(key)) continue
      visited.add(key)

      // Never remove a root or anything outside the allowlist.
      const insideRoot = allowlist.some((root) => isInside(root, dir, process.platform, false))
      if (!insideRoot) continue
      try {
        const entries = await fs.readdir(dir)
        if (entries.length > 0) continue
        await fs.rmdir(dir)
        removed++
        queue.push(path.dirname(dir))
      } catch {
        /* directory not empty, in use, or already gone */
      }
    }
    return removed
  }

  private async emptyRecycleBin(): Promise<{ ok: boolean; error: string }> {
    if (process.platform !== 'win32') return { ok: false, error: 'Recycle Bin emptying is implemented for Windows only' }
    const { execFile } = await import('node:child_process')
    return new Promise((resolve) => {
      // A targeted OS API call, not a broad delete. User confirmation is required
      // in the renderer before this path is reached.
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction Stop'],
        { timeout: 60_000, windowsHide: true },
        (err, _stdout, stderr) => {
          if (err) resolve({ ok: false, error: (stderr || err.message).trim().slice(0, 400) })
          else resolve({ ok: true, error: '' })
        }
      )
    })
  }

  /** Bounded preview of the candidates a scan produced (for the review table). */
  previewCandidates(scanId: string, limit = 500): Candidate[] {
    const state = this.states.get(scanId)
    if (!state) return []
    return [...state.candidates].sort((a, b) => b.size - a.size).slice(0, limit)
  }

  discard(scanId: string): void {
    this.states.delete(scanId)
  }
}

/**
 * Sums per-category skip reasons into one report-level map.
 *
 * The scan and cleanup phases both record a reason for *every* skipped file, so
 * `totalSkippedFiles` always equals the sum of these counts. Consumers can show
 * "why files were skipped" without re-walking the categories.
 */
export function aggregateSkipReasons(results: { skipReasons?: Record<string, number> }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const result of results) {
    for (const [reason, count] of Object.entries(result.skipReasons ?? {})) {
      out[reason] = (out[reason] ?? 0) + count
    }
  }
  return out
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { CancellationToken, TaskPool, isCancellation } from './concurrency'
import { normalize, platformKind } from './pathSafety'

/**
 * STREAMING FILESYSTEM WALKER
 * ------------------------------------------------------------------
 * Design goals: constant memory, bounded concurrency, no symlink/reparse
 * traversal, cancellable at any moment, and never throw on a single bad file.
 *
 * Memory stays flat because callers receive files through a callback and we
 * never accumulate the tree here.
 */

export interface FileEntry {
  path: string
  size: number
  mtimeMs: number
  depth: number
  /** Directory the file was found in (for grouping). */
  dir: string
}

export interface DirEntrySummary {
  path: string
  size: number
  fileCount: number
  dirCount: number
  depth: number
  denied: boolean
  children: DirEntrySummary[]
}

export interface WalkOptions {
  token?: CancellationToken
  concurrency?: number
  maxDepth?: number
  maxFiles?: number
  /** Do not descend into folders whose name matches. */
  skipDirNames?: string[]
  /** Called for every regular file. Must be cheap; it runs on hot path. */
  onFile: (entry: FileEntry) => void
  /** Called when a directory cannot be read. */
  onError?: (dirPath: string, error: NodeJS.ErrnoException) => void
  /** Called when a symlink / reparse point is intentionally skipped. */
  onSkipLink?: (entryPath: string) => void
  /** Called once per directory, after its direct children are known. */
  onDir?: (dirPath: string, fileCount: number, dirCount: number, bytes: number) => void
}

export interface WalkStats {
  files: number
  dirs: number
  bytes: number
  skippedLinks: number
  errors: number
  truncated: boolean
  cancelled: boolean
  durationMs: number
}

const SKIP_DIR_NAMES_DEFAULT = new Set(['$recycle.bin', 'system volume information', '$winreagent', 'config.msi'])

const isPermissionError = (code?: string): boolean =>
  code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'ELOOP' || code === 'ENOTDIR'

/**
 * True when a dirent should not be descended into as a directory.
 * Node reports Windows junctions / symlinks as symbolic links via lstat, and
 * cloud/offline reparse points can look like directories with unknown contents.
 */
export function isLinkLike(stats: { isSymbolicLink: () => boolean }): boolean {
  try {
    return stats.isSymbolicLink()
  } catch {
    return true
  }
}

/**
 * Walks a directory tree and reports files through `onFile`.
 * The root itself is never reported as a file (only its contents).
 */
export async function walkDirectory(root: string, options: WalkOptions): Promise<WalkStats> {
  const started = Date.now()
  const token = options.token ?? new CancellationToken()
  const concurrency = clampConcurrency(options.concurrency ?? 8)
  const maxDepth = options.maxDepth ?? 32
  const maxFiles = options.maxFiles ?? Number.MAX_SAFE_INTEGER
  const skipNames = new Set([...SKIP_DIR_NAMES_DEFAULT, ...(options.skipDirNames ?? []).map((s) => s.toLowerCase())])

  const stats: WalkStats = {
    files: 0,
    dirs: 0,
    bytes: 0,
    skippedLinks: 0,
    errors: 0,
    truncated: false,
    cancelled: false,
    durationMs: 0
  }

  const pool = new TaskPool(concurrency)
  const queue: { dir: string; depth: number }[] = [{ dir: normalize(root), depth: 0 }]
  let active = 0
  let finished = false

  const processDir = async (dir: string, depth: number): Promise<void> => {
    if (token.isCancelled || stats.truncated) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (!isPermissionError(e.code)) {
        stats.errors++
        options.onError?.(dir, e)
      } else {
        stats.errors++
        options.onError?.(dir, e)
      }
      return
    }
    if (token.isCancelled) return

    stats.dirs++
    let directFiles = 0
    let directDirs = 0
    let directBytes = 0

    for (const dirent of entries) {
      if (token.isCancelled || stats.truncated) break
      const full = path.join(dir, dirent.name)

      if (dirent.isSymbolicLink()) {
        // NEVER follow symlinks or reparse points.
        stats.skippedLinks++
        options.onSkipLink?.(full)
        continue
      }

      if (dirent.isDirectory()) {
        const lower = dirent.name.toLowerCase()
        if (skipNames.has(lower)) continue
        if (depth + 1 > maxDepth) {
          stats.truncated = true
          continue
        }
        directDirs++
        queue.push({ dir: full, depth: depth + 1 })
        continue
      }

      if (!dirent.isFile()) {
        // Sockets, FIFOs, devices, or unknown reparse points: skip.
        stats.skippedLinks++
        options.onSkipLink?.(full)
        continue
      }

      let st: Awaited<ReturnType<typeof fs.lstat>>
      try {
        st = await fs.lstat(full)
      } catch (err) {
        stats.errors++
        options.onError?.(full, err as NodeJS.ErrnoException)
        continue
      }
      // Re-check after lstat: the entry may have been swapped to a link.
      if (isLinkLike(st) || !st.isFile()) {
        stats.skippedLinks++
        options.onSkipLink?.(full)
        continue
      }

      stats.files++
      stats.bytes += st.size
      directFiles++
      directBytes += st.size

      if (stats.files >= maxFiles) {
        stats.truncated = true
        break
      }

      options.onFile({ path: full, size: st.size, mtimeMs: st.mtimeMs, depth, dir })
    }

    options.onDir?.(dir, directFiles, directDirs, directBytes)
  }

  const pump = async (): Promise<void> => {
    for (;;) {
      if (token.isCancelled || stats.truncated) return
      const next = queue.shift()
      if (!next) {
        if (active === 0) return
        // Wait until another pump finishes and possibly enqueues more work.
        await new Promise((r) => setTimeout(r, 2))
        continue
      }
      active++
      await pool.run(async () => {
        try {
          await processDir(next.dir, next.depth)
        } catch (err) {
          if (!isCancellation(err)) {
            stats.errors++
            options.onError?.(next.dir, err as NodeJS.ErrnoException)
          }
        }
      })
      active--
    }
  }

  const pumpCount = Math.max(2, Math.min(concurrency, 6))
  await Promise.all(Array.from({ length: pumpCount }, () => pump()))
  await pool.drain()
  finished = true
  stats.cancelled = token.isCancelled
  stats.durationMs = Date.now() - started
  void finished
  return stats
}

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 8
  return Math.max(1, Math.min(32, Math.floor(value)))
}

/**
 * Builds a bounded-depth directory size tree, streaming: sizes are accumulated
 * bottom-up as directories complete. Used by the Storage Analyzer.
 */
export interface TreeBuildOptions {
  token?: CancellationToken
  maxDepth: number
  concurrency?: number
  /** Keep only the N largest children per node to bound memory. */
  maxChildrenPerNode?: number
  onProgress?: (dirs: number, files: number, bytes: number) => void
}

export async function buildDirectoryTree(root: string, options: TreeBuildOptions): Promise<DirEntrySummary & WalkStats> {
  const started = Date.now()
  const token = options.token ?? new CancellationToken()
  const concurrency = clampConcurrency(options.concurrency ?? 8)
  const maxChildren = options.maxChildrenPerNode ?? 200
  const totals = { files: 0, dirs: 1, bytes: 0, skippedLinks: 0, errors: 0 }

  const build = async (dir: string, depth: number): Promise<DirEntrySummary> => {
    const node: DirEntrySummary = {
      path: dir,
      size: 0,
      fileCount: 0,
      dirCount: 0,
      depth,
      denied: false,
      children: []
    }
    if (token.isCancelled) return node

    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      node.denied = true
      totals.errors++
      return node
    }

    const subdirs: string[] = []
    for (const dirent of entries) {
      if (token.isCancelled) break
      const full = path.join(dir, dirent.name)
      if (dirent.isSymbolicLink()) {
        totals.skippedLinks++
        continue
      }
      if (dirent.isDirectory()) {
        if (depth + 1 <= options.maxDepth) subdirs.push(full)
        else node.dirCount++
        continue
      }
      if (!dirent.isFile()) continue
      try {
        const st = await fs.lstat(full)
        if (isLinkLike(st) || !st.isFile()) {
          totals.skippedLinks++
          continue
        }
        node.size += st.size
        node.fileCount++
        totals.files++
        totals.bytes += st.size
        node.children.push({
          path: full,
          size: st.size,
          fileCount: 1,
          dirCount: 0,
          depth: depth + 1,
          denied: false,
          children: []
        })
      } catch {
        totals.errors++
      }
    }

    const pool = new TaskPool(concurrency)
    const subResults = await Promise.all(subdirs.map((sub) => pool.run(() => build(sub, depth + 1))))
    for (const sub of subResults) {
      node.size += sub.size
      node.fileCount += sub.fileCount
      node.dirCount += sub.dirCount + 1
      node.children.push(sub)
    }

    node.children.sort((a, b) => b.size - a.size)
    if (node.children.length > maxChildren) {
      const kept = node.children.slice(0, maxChildren)
      const dropped = node.children.slice(maxChildren)
      let droppedBytes = 0
      let droppedFiles = 0
      for (const d of dropped) {
        droppedBytes += d.size
        droppedFiles += d.fileCount
      }
      if (droppedBytes > 0) {
        kept.push({
          path: path.join(dir, `(${dropped.length} smaller items)`),
          size: droppedBytes,
          fileCount: droppedFiles,
          dirCount: 0,
          depth: depth + 1,
          denied: false,
          children: []
        })
      }
      node.children = kept
    }
    options.onProgress?.(totals.dirs, totals.files, totals.bytes)
    return node
  }

  const tree = await build(normalize(root), 0)
  totals.dirs = tree.dirCount + 1
  return {
    ...tree,
    size: tree.size,
    files: totals.files,
    dirs: totals.dirs,
    bytes: tree.size,
    skippedLinks: totals.skippedLinks,
    errors: totals.errors,
    truncated: false,
    cancelled: token.isCancelled,
    durationMs: Date.now() - started
  }
}

/**
 * Flat streaming walk used for duplicate detection: only reports files at or
 * above a size threshold, grouped by size so hashing is minimal.
 */
export async function collectFilesBySize(
  roots: string[],
  minSizeBytes: number,
  options: Omit<WalkOptions, 'onFile'> & { token?: CancellationToken }
): Promise<{ bySize: Map<number, FileEntry[]>; stats: WalkStats[] }> {
  const bySize = new Map<number, FileEntry[]>()
  const statsList: WalkStats[] = []
  for (const root of roots) {
    const stats = await walkDirectory(root, {
      ...options,
      onFile: (entry) => {
        if (entry.size < minSizeBytes || entry.size === 0) return
        const bucket = bySize.get(entry.size)
        if (bucket) bucket.push(entry)
        else bySize.set(entry.size, [entry])
      }
    })
    statsList.push(stats)
  }
  return { bySize, stats: statsList }
}

export const samePathKey = (p: string): string => {
  const kind = platformKind()
  const n = normalize(p)
  return kind === 'win32' ? n.toLowerCase() : n
}

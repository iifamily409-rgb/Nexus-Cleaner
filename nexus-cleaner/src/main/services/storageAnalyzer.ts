import { CancellationToken } from '../core/concurrency'
import { buildDirectoryTree, type DirEntrySummary } from '../core/walker'
import { validateScanRoot } from '../core/pathSafety'
import type { StorageNode, StorageScanResult } from '@shared/types'

/**
 * STORAGE ANALYZER
 * Read-only treemap data. Never deletes. Symbolic links and reparse points are
 * counted as skipped, never traversed, so a junction loop cannot explode.
 */

const MAX_LARGEST = 100

export class StorageAnalyzer {
  private tokens = new Map<string, CancellationToken>()

  cancel(opId: string): boolean {
    const token = this.tokens.get(opId)
    if (!token) return false
    token.cancel()
    return true
  }

  cancelAll(): void {
    for (const token of this.tokens.values()) token.cancel()
  }

  async scan(root: string, maxDepth: number, opId: string): Promise<StorageScanResult> {
    const verdict = validateScanRoot(root)
    if (!verdict.ok) throw new Error(`Refused to scan: ${verdict.reason}`)

    const token = new CancellationToken()
    this.tokens.set(opId, token)
    const startedAt = Date.now()

    try {
      const tree = await buildDirectoryTree(root, {
        token,
        maxDepth,
        concurrency: 8,
        maxChildrenPerNode: 120
      })

      const largest = collectLargest(tree, MAX_LARGEST)
      const categories = categorize(root, tree)

      return {
        root,
        startedAt,
        endedAt: Date.now(),
        totalBytes: tree.size,
        totalFiles: tree.fileCount,
        totalDirs: tree.dirCount,
        tree: toStorageNode(tree, true),
        largestFiles: largest.map((n) => toStorageNode(n, false)),
        categories,
        cancelled: token.isCancelled,
        errors: tree.errors > 0 ? [`${tree.errors} folders could not be read (permission denied)`] : []
      }
    } finally {
      this.tokens.delete(opId)
    }
  }

  exportReport(result: StorageScanResult, destination: string): Promise<string> {
    const lines: string[] = [
      `NEXUS Cleaner — Storage report`,
      `Root: ${result.root}`,
      `Generated: ${new Date(result.endedAt).toISOString()}`,
      `Total size: ${result.totalBytes} bytes (${(result.totalBytes / 1024 ** 3).toFixed(2)} GB)`,
      `Files: ${result.totalFiles}`,
      `Folders: ${result.totalDirs}`,
      '',
      'Top-level children:',
      ...(result.tree.children ?? []).map(
        (c) => `  ${c.name}\t${c.size} bytes\t${c.fileCount} files`
      ),
      '',
      'Largest files:',
      ...result.largestFiles.filter((f) => f.isDir === false).map((f) => `  ${f.size} bytes\t${f.path}`),
      '',
      'Categories:',
      ...result.categories.map((c) => `  ${c.label}\t${c.bytes} bytes\t${c.fileCount} files`)
    ]
    // JSON sidecar for tooling, plus a human readable text report.
    const payload = { generatedAt: new Date().toISOString(), report: result, text: lines.join('\n') }
    return import('node:fs/promises').then((fs) => fs.writeFile(destination, JSON.stringify(payload, null, 2), 'utf8')).then(() => destination)
  }
}

function toStorageNode(node: DirEntrySummary, isDir: boolean): StorageNode {
  const base = node.path.split(/[\\/]/).pop() ?? node.path
  const storage: StorageNode = {
    name: base || node.path,
    path: node.path,
    size: node.size,
    fileCount: node.fileCount,
    dirCount: node.dirCount,
    depth: node.depth,
    isDir,
    ...(node.denied ? { denied: true } : {})
  }
  const childDirs = node.children.filter((c) => c.children.length > 0 || c.dirCount > 0)
  const childFiles = node.children.filter((c) => c.children.length === 0 && c.dirCount === 0)
  if (node.children.length > 0) {
    storage.children = [...childDirs.map((c) => toStorageNode(c, true)), ...childFiles.map((c) => toStorageNode(c, false))]
  }
  return storage
}

function collectLargest(root: DirEntrySummary, limit: number): DirEntrySummary[] {
  const all: DirEntrySummary[] = []
  const stack: DirEntrySummary[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as DirEntrySummary
    for (const child of node.children) {
      if (child.dirCount === 0 && child.children.length === 0) all.push(child)
      else stack.push(child)
    }
  }
  return all.sort((a, b) => b.size - a.size).slice(0, limit)
}

function categorize(root: string, tree: DirEntrySummary): StorageScanResult['categories'] {
  const buckets = new Map<string, { bytes: number; fileCount: number }>()
  const add = (label: string, size: number, files: number): void => {
    const cur = buckets.get(label) ?? { bytes: 0, fileCount: 0 }
    cur.bytes += size
    cur.fileCount += files
    buckets.set(label, cur)
  }

  const extCategory = (name: string): string => {
    const lower = name.toLowerCase()
    const dot = lower.lastIndexOf('.')
    const ext = dot >= 0 ? lower.slice(dot) : ''
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff', '.svg', '.raw', '.cr2', '.nef'].includes(ext)) return 'Images'
    if (['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.flv', '.m4v'].includes(ext)) return 'Video'
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'].includes(ext)) return 'Audio'
    if (['.zip', '.7z', '.rar', '.tar', '.gz', '.xz', '.bz2', '.iso'].includes(ext)) return 'Archives'
    if (['.dll', '.exe', '.sys', '.so', '.node', '.msi'].includes(ext)) return 'Programs & libraries'
    if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.txt', '.md', '.odt', '.csv'].includes(ext)) return 'Documents'
    if (['.js', '.ts', '.py', '.java', '.cs', '.cpp', '.h', '.go', '.rs', '.json', '.xml', '.html', '.css'].includes(ext)) return 'Code & config'
    if (['.log', '.etl', '.tmp', '.temp', '.cache', '.dmp'].includes(ext)) return 'Temporary & logs'
    return 'Other'
  }

  const stack: DirEntrySummary[] = [tree]
  while (stack.length > 0) {
    const node = stack.pop() as DirEntrySummary
    for (const child of node.children) {
      if (child.dirCount === 0 && child.children.length === 0) {
        add(extCategory(child.path), child.size, child.fileCount)
      } else {
        stack.push(child)
      }
    }
  }
  void root
  return [...buckets.entries()]
    .map(([label, v]) => ({ label, bytes: v.bytes, fileCount: v.fileCount }))
    .sort((a, b) => b.bytes - a.bytes)
}

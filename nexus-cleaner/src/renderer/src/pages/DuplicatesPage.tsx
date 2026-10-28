import { useMemo, useState } from 'react'
import { Copy, FolderOpen, ShieldAlert, Trash2, Check } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Field, Panel, PanelHeader, Select } from '../components/ui'
import { api, formatBytes, formatDuration } from '../lib/api'
import type { DuplicateScanResult } from '@shared/types'

export function DuplicatesPage(): React.JSX.Element {
  const app = useApp()
  const [roots, setRoots] = useState<string[]>([])
  const [minSizeMb, setMinSizeMb] = useState(1)
  const [result, setResult] = useState<DuplicateScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keepMap, setKeepMap] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState(false)
  const [lastDelete, setLastDelete] = useState<string | null>(null)

  const pick = async (): Promise<void> => {
    const folders = await api().dialog.pickFolders()
    if (folders.length > 0) setRoots((prev) => [...new Set([...prev, ...folders])].slice(0, 12))
  }

  const run = async (): Promise<void> => {
    if (roots.length === 0) {
      app.notify('Choose at least one folder to scan.', 'warn')
      return
    }
    setBusy(true)
    setError(null)
    setLastDelete(null)
    try {
      const scan = await api().duplicates.scan(roots, Math.max(1, Math.round(minSizeMb * 1024 * 1024)))
      setResult(scan)
      // Default: keep the oldest copy in each group (the user can change this).
      const defaults: Record<string, string> = {}
      for (const group of scan.groups) {
        const oldest = [...group.files].sort((a, b) => a.mtimeMs - b.mtimeMs)[0]
        if (oldest) defaults[group.hash] = oldest.path
      }
      setKeepMap(defaults)
      app.notify(
        `Found ${scan.groups.length} duplicate group(s), ${formatBytes(scan.totalWastedBytes)} of redundant data. Nothing has been deleted.`,
        scan.groups.length > 0 ? 'success' : 'info'
      )
    } catch (err) {
      setError((err as Error).message)
      app.notify(`Duplicate scan failed: ${(err as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const selectedForDeletion = useMemo(() => {
    if (!result) return [] as string[]
    const list: string[] = []
    for (const group of result.groups) {
      const keep = keepMap[group.hash]
      for (const file of group.files) {
        if (file.path !== keep) list.push(file.path)
      }
    }
    return list
  }, [result, keepMap])

  const selectedBytes = useMemo(() => {
    if (!result) return 0
    let total = 0
    for (const group of result.groups) {
      const remaining = group.files.filter((f) => f.path !== keepMap[group.hash]).length
      total += remaining * group.size
    }
    return total
  }, [result, keepMap])

  const doDelete = async (): Promise<void> => {
    if (!result || selectedForDeletion.length === 0) return
    const confirmed = await app.confirmDestructive(
      'Delete duplicate copies',
      `Permanently delete ${selectedForDeletion.length} file(s) (${formatBytes(selectedBytes)})?`,
      `One copy per group is preserved (the row marked “keep”). The main process re-verifies every path against the last scan before unlinking, and refuses anything outside a verified duplicate group.\n\nDeletion is permanent.`,
      'Delete duplicates'
    )
    if (!confirmed) return
    setDeleting(true)
    try {
      const report = await api().duplicates.delete(selectedForDeletion, 1)
      setLastDelete(
        `${report.deleted} file(s) removed (${formatBytes(report.bytesDeleted)}). ${report.skipped} skipped, ${report.failed} failed.` +
          (report.errors.length > 0 ? ` First reason: ${report.errors[0]}` : '')
      )
      app.notify(`Removed ${report.deleted} duplicate file(s)`, report.failed > 0 ? 'warn' : 'success')
      await run()
    } catch (err) {
      app.notify(`Deletion failed: ${(err as Error).message}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel glow>
        <PanelHeader
          title="Duplicate Finder"
          subtitle="Genuine content verification: equal size → first-4 KiB fingerprint → full SHA-256 of matching candidates. One copy per group is always preserved."
          icon={<Copy size={15} />}
          right={<Badge tone="warn">review required</Badge>}
        />
        <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
          <Field label="Folders to scan" hint="Protected system directories are refused. Hashing is bounded to keep the machine responsive.">
            <div className="flex flex-wrap gap-1.5">
              {roots.length === 0 && <span className="text-[11px] text-[color:var(--nx-text-dim)]">No folders selected.</span>}
              {roots.map((root) => (
                <span key={root} className="nx-chip max-w-[320px] normal-case">
                  <span className="truncate">{root}</span>
                  <button aria-label={`Remove ${root}`} onClick={() => setRoots((prev) => prev.filter((r) => r !== root))} className="ml-1 text-[color:var(--nx-text-dim)] hover:text-red-300">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </Field>
          <Field label="Minimum size" hint="Smaller files are ignored — they rarely matter and cost a lot of I/O.">
            <Select
              value={String(minSizeMb)}
              onChange={(v) => setMinSizeMb(Number(v))}
              options={[
                { value: '0.1', label: '100 KB' },
                { value: '1', label: '1 MB' },
                { value: '5', label: '5 MB' },
                { value: '25', label: '25 MB' },
                { value: '100', label: '100 MB' }
              ]}
            />
          </Field>
          <div className="flex items-end gap-2 pb-1">
            <Button onClick={pick}>
              <FolderOpen size={14} /> Add folder
            </Button>
            <Button variant="primary" onClick={run} disabled={busy}>
              {busy ? 'Hashing…' : 'Find duplicates'}
            </Button>
          </div>
        </div>
        {error && <div className="mx-4 mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </Panel>

      {!result ? (
        <Panel>
          <EmptyState
            title="No duplicate scan yet"
            hint="Pick folders you own. NEXUS hashes candidate files with SHA-256 and never deletes anything automatically — you review and confirm every group."
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Groups', value: String(result.groups.length) },
              { label: 'Redundant data', value: formatBytes(result.totalWastedBytes) },
              { label: 'Files considered', value: result.filesConsidered.toLocaleString() },
              { label: 'Files hashed', value: result.filesHashed.toLocaleString() },
              { label: 'Duration', value: formatDuration(result.endedAt - result.startedAt) }
            ].map((item) => (
              <div key={item.label} className="nx-panel px-4 py-2.5">
                <div className="nx-label">{item.label}</div>
                <div className="nx-mono mt-1 text-base font-semibold">{item.value}</div>
              </div>
            ))}
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-200/90">
              {result.errors.slice(0, 3).map((e) => (
                <div key={e}>• {e}</div>
              ))}
              {result.errors.length > 3 && <div>…and {result.errors.length - 3} more.</div>}
            </div>
          )}

          <Panel>
            <PanelHeader
              title="Review groups"
              subtitle="Select which copy to keep in each group. Only the unselected copies would be deleted."
              right={
                <div className="flex items-center gap-2">
                  <span className="nx-mono text-[11px] text-[color:var(--nx-text-dim)]">
                    {selectedForDeletion.length} to remove · {formatBytes(selectedBytes)}
                  </span>
                  <Button variant="danger" onClick={doDelete} disabled={deleting || selectedForDeletion.length === 0}>
                    <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete selected copies'}
                  </Button>
                </div>
              }
            />
            {lastDelete && (
              <div className="border-b border-[color:var(--nx-border)] px-4 py-2 text-[11px] text-emerald-300">{lastDelete}</div>
            )}
            <div className="max-h-[560px] divide-y divide-[color:var(--nx-border)]/60 overflow-auto">
              {result.groups.length === 0 && <EmptyState title="No duplicates found" hint="No files with identical content were found in the selected folders." />}
              {result.groups.map((group, index) => (
                <div key={group.hash} className="px-4 py-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone="accent">Group {index + 1}</Badge>
                    <span className="nx-mono text-[11px] text-[color:var(--nx-text-dim)]">
                      {formatBytes(group.size)} each · {group.files.length} copies · wasted {formatBytes(group.wastedBytes)}
                    </span>
                    <span className="nx-mono truncate text-[10px] text-[color:var(--nx-text-dim)]" title={group.hash}>
                      sha256 {group.hash.slice(0, 16)}…
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {group.files.map((file) => {
                      const keeping = keepMap[group.hash] === file.path
                      return (
                        <label
                          key={file.path}
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] ${keeping ? 'bg-emerald-500/8' : ''}`}
                        >
                          <input
                            type="radio"
                            name={`keep-${group.hash}`}
                            className="h-3 w-3 accent-[color:var(--nx-accent)]"
                            checked={keeping}
                            onChange={() => setKeepMap((prev) => ({ ...prev, [group.hash]: file.path }))}
                          />
                          {keeping ? <Check size={11} className="text-emerald-400" /> : <span className="w-[11px]" />}
                          <span className="nx-mono truncate text-[10.5px]" title={file.path}>
                            {file.path}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] text-[color:var(--nx-text-dim)]">
                            {new Date(file.mtimeMs).toLocaleDateString()}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              void api().app.showItemInFolder(file.path)
                            }}
                            className="shrink-0 text-[10px] nx-text-accent hover:underline"
                          >
                            reveal
                          </button>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="flex items-start gap-2 rounded-lg border border-[color:var(--nx-border)] px-3 py-2 text-[11px] text-[color:var(--nx-text-dim)]">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              Hard links are counted as separate paths by the OS but share storage; if a group contains links inside the same volume, freeing space may be less than the
              reported “wasted” figure. NEXUS reports what it measured, not what it hopes.
            </span>
          </div>
        </>
      )}
    </div>
  )
}

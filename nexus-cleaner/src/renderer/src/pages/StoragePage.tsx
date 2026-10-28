import { useState } from 'react'
import { FolderSearch, FolderOpen, Download, X } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Field, Panel, PanelHeader, Select } from '../components/ui'
import { Treemap, CategoryBar } from '../components/Treemap'
import { api, formatBytes, formatDuration, formatDateTime } from '../lib/api'
import type { StorageNode, StorageScanResult } from '@shared/types'

export function StoragePage(): React.JSX.Element {
  const app = useApp()
  const [root, setRoot] = useState('')
  const [depth, setDepth] = useState(5)
  const [result, setResult] = useState<StorageScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'size' | 'name'>('size')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<StorageNode | null>(null)

  const pick = async (): Promise<void> => {
    const folders = await api().dialog.pickFolders()
    if (folders[0]) setRoot(folders[0])
  }

  const run = async (): Promise<void> => {
    if (!root) {
      app.notify('Choose a folder to analyse first.', 'warn')
      return
    }
    setBusy(true)
    setError(null)
    setSelected(null)
    try {
      const scan = await api().storage.scan(root, depth)
      setResult(scan)
      app.notify(`Analysed ${scan.totalFiles.toLocaleString()} files (${formatBytes(scan.totalBytes)}) in ${formatDuration(scan.endedAt - scan.startedAt)}`, 'success')
    } catch (err) {
      setError((err as Error).message)
      app.notify(`Storage scan failed: ${(err as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const largest = (result?.largestFiles ?? [])
    .filter((node) => node.path.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name)))
    .slice(0, 60)

  return (
    <div className="flex flex-col gap-3">
      <Panel glow>
        <PanelHeader
          title="Storage Analyzer"
          subtitle="Read-only analysis of any folder you choose. Symbolic links and reparse points are counted as skipped, never traversed. Nothing here deletes files."
          icon={<FolderSearch size={15} />}
          right={<Badge tone="ok">read-only</Badge>}
        />
        <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_150px_auto]">
          <Field label="Folder" hint="Only absolute, existing folders outside protected system locations are accepted.">
            <div className="flex gap-2">
              <input className="nx-input nx-mono" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\\Users\\you\\Downloads" aria-label="Folder path" />
              <Button onClick={pick} ariaLabel="Browse for a folder">
                <FolderOpen size={14} />
              </Button>
            </div>
          </Field>
          <Field label="Depth" hint="Deeper levels show more structure but take longer.">
            <Select
              value={String(depth)}
              onChange={(v) => setDepth(Number(v))}
              options={[
                { value: '2', label: '2 levels' },
                { value: '3', label: '3 levels' },
                { value: '4', label: '4 levels' },
                { value: '5', label: '5 levels' },
                { value: '7', label: '7 levels' },
                { value: '9', label: '9 levels' }
              ]}
            />
          </Field>
          <div className="flex items-end gap-2 pb-1">
            <Button variant="primary" onClick={run} disabled={busy}>
              {busy ? 'Analysing…' : 'Analyse folder'}
            </Button>
            {busy && (
              <Button variant="danger" onClick={() => api().storage.cancel('')} ariaLabel="Cancel">
                <X size={14} />
              </Button>
            )}
          </div>
        </div>
        {error && <div className="mx-4 mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </Panel>

      {!result ? (
        <Panel>
          <EmptyState
            title="No folder analysed yet"
            hint="Pick a folder you own (Downloads, a projects folder, a media drive) and NEXUS will map its real on-disk sizes. It never deletes anything from here."
            action={
              <Button variant="primary" onClick={pick}>
                <FolderOpen size={14} /> Choose folder
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Total size', value: formatBytes(result.totalBytes) },
              { label: 'Files', value: result.totalFiles.toLocaleString() },
              { label: 'Folders', value: result.totalDirs.toLocaleString() },
              { label: 'Scan time', value: formatDuration(result.endedAt - result.startedAt) }
            ].map((item) => (
              <div key={item.label} className="nx-panel px-4 py-2.5">
                <div className="nx-label">{item.label}</div>
                <div className="nx-mono mt-1 text-base font-semibold">{item.value}</div>
              </div>
            ))}
          </div>

          <Panel>
            <PanelHeader
              title="Disk usage map"
              subtitle="Click any folder rectangle to drill down. Hover for exact sizes."
              right={
                <Button className="!px-2 !py-1 !text-[11px]" onClick={() => void api().storage.exportReport(result)}>
                  <Download size={12} /> Export report
                </Button>
              }
            />
            <div className="px-4 py-3">
              <Treemap root={result.tree} onOpen={(node) => setSelected(node)} />
            </div>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel>
              <PanelHeader title="Category breakdown" subtitle="Grouped by file extension family." />
              <div className="px-4 py-3">
                <CategoryBar items={result.categories} />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Largest files"
                subtitle="Nothing is deleted from this list — open the location and review it yourself."
              />
              <div className="flex items-center gap-2 border-b border-[color:var(--nx-border)] px-4 py-2">
                <input className="nx-input" placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter largest files" />
                <Select
                  value={sortBy}
                  onChange={setSortBy}
                  options={[
                    { value: 'size', label: 'Sort: size' },
                    { value: 'name', label: 'Sort: name' }
                  ]}
                />
              </div>
              <div className="max-h-[320px] overflow-auto">
                <table className="nx-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th className="w-24">Size</th>
                      <th className="w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {largest.map((node) => (
                      <tr key={node.path}>
                        <td className="max-w-[320px] truncate nx-mono text-[10.5px]" title={node.path}>
                          {node.name}
                        </td>
                        <td className="nx-mono text-[10.5px]">{formatBytes(node.size)}</td>
                        <td>
                          <button
                            className="text-[10.5px] nx-text-accent hover:underline"
                            onClick={() => void api().app.showItemInFolder(node.path)}
                          >
                            Reveal
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {selected && (
            <Panel>
              <PanelHeader
                title={selected.name}
                subtitle={selected.path}
                right={
                  <div className="flex gap-2">
                    <Button className="!px-2 !py-1 !text-[11px]" onClick={() => void api().app.showItemInFolder(selected.path)}>
                      Reveal in folder
                    </Button>
                    <Button variant="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => setSelected(null)}>
                      Close
                    </Button>
                  </div>
                }
              />
              <div className="px-4 py-3 text-[11.5px] text-[color:var(--nx-text-dim)]">
                {formatBytes(selected.size)} · {selected.fileCount.toLocaleString()} files · {selected.dirCount.toLocaleString()} folders
                {selected.denied && <span className="ml-2 text-amber-300">permission denied</span>}
              </div>
            </Panel>
          )}

          <p className="px-1 text-[10.5px] text-[color:var(--nx-text-dim)]">
            Report generated {formatDateTime(result.endedAt)}. Directories that could not be read are shown as denied rather than as zero bytes.
          </p>
        </>
      )}
    </div>
  )
}

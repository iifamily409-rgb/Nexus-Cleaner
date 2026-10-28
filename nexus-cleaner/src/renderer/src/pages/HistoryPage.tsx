import { useEffect, useMemo, useState } from 'react'
import { History, Download, Trash2, ShieldCheck } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Panel, PanelHeader, Select } from '../components/ui'
import { api, formatBytes, formatDateTime, formatDuration } from '../lib/api'
import type { HistoryRecord } from '@shared/types'

export function HistoryPage(): React.JSX.Element {
  const app = useApp()
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [kind, setKind] = useState<'all' | HistoryRecord['kind']>('all')
  const [selected, setSelected] = useState<HistoryRecord | null>(null)

  const load = async (): Promise<void> => {
    setRecords(await api().history.list())
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => (kind === 'all' ? records : records.filter((r) => r.kind === kind)), [records, kind])

  const exportAll = async (): Promise<void> => {
    const result = await api().history.export()
    if (result.ok) app.notify(`History exported to ${result.path}`, 'success')
    else if (result.error && result.error !== 'Cancelled') app.notify(result.error, 'error')
  }

  const clearAll = async (): Promise<void> => {
    const confirmed = await app.confirmDestructive(
      'Clear activity history',
      'Delete all locally stored history records?',
      'History is stored only on this machine and is used to show past scans and cleanups. Clearing it cannot be undone. No files on disk are affected.',
      'Clear history'
    )
    if (!confirmed) return
    await api().history.clear()
    await load()
    await app.refreshHistory()
    app.notify('History cleared', 'success')
  }

  const totals = useMemo(
    () => ({
      cleanups: records.filter((r) => r.kind === 'clean').length,
      bytes: records.filter((r) => r.kind === 'clean').reduce((acc, r) => acc + r.actualBytes, 0),
      files: records.filter((r) => r.kind === 'clean').reduce((acc, r) => acc + r.deletedFiles, 0)
    }),
    [records]
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: 'Recorded cleanups', value: String(totals.cleanups) },
          { label: 'Files removed (actual)', value: totals.files.toLocaleString() },
          { label: 'Bytes removed (actual)', value: formatBytes(totals.bytes) }
        ].map((item) => (
          <div key={item.label} className="nx-panel px-4 py-2.5">
            <div className="nx-label">{item.label}</div>
            <div className="nx-mono mt-1 text-base font-semibold nx-text-accent">{item.value}</div>
          </div>
        ))}
      </div>

      <Panel glow>
        <PanelHeader
          title="Activity History"
          subtitle="Stored locally in your user data folder. Only real operations are recorded — no synthetic entries are ever created."
          icon={<History size={15} />}
          right={
            <div className="flex items-center gap-2">
              <Select
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'all', label: 'All kinds' },
                  { value: 'scan', label: 'Scans' },
                  { value: 'clean', label: 'Cleanups' },
                  { value: 'duplicate', label: 'Duplicates' },
                  { value: 'storage', label: 'Storage' }
                ]}
              />
              <Button onClick={exportAll} disabled={records.length === 0}>
                <Download size={13} /> Export
              </Button>
              <Button variant="danger" onClick={clearAll} disabled={records.length === 0}>
                <Trash2 size={13} /> Clear
              </Button>
            </div>
          }
        />
        {filtered.length === 0 ? (
          <EmptyState title="No history yet" hint="Scans and cleanups you run are recorded here with real durations, estimates and results." />
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="nx-table">
              <thead>
                <tr>
                  <th className="w-44">When</th>
                  <th className="w-24">Kind</th>
                  <th className="w-20">Mode</th>
                  <th>Summary</th>
                  <th className="w-28">Removed</th>
                  <th className="w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id} className="cursor-pointer" onClick={() => setSelected(record)}>
                    <td className="nx-mono text-[10.5px]">{formatDateTime(record.at)}</td>
                    <td>
                      <Badge tone={record.kind === 'clean' ? 'ok' : 'neutral'}>{record.kind}</Badge>
                    </td>
                    <td className="text-[10.5px]">{record.mode ?? '—'}</td>
                    <td className="max-w-[420px] truncate text-[11px]" title={record.summary}>
                      {record.summary}
                    </td>
                    <td className="nx-mono text-[10.5px]">{record.actualBytes > 0 ? formatBytes(record.actualBytes) : '—'}</td>
                    <td>{record.cancelled ? <Badge tone="warn">cancelled</Badge> : <Badge tone="ok">complete</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <Panel>
          <PanelHeader
            title="Record detail"
            subtitle={`id ${selected.id}`}
            right={
              <Button variant="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => setSelected(null)}>
                Close
              </Button>
            }
          />
          <div className="grid gap-x-8 gap-y-1 px-4 py-3 text-[11.5px] sm:grid-cols-2">
            {[
              ['Kind', selected.kind],
              ['Mode', selected.mode ?? '—'],
              ['Started', formatDateTime(selected.at)],
              ['Duration', formatDuration(selected.durationMs)],
              ['Categories', selected.categories.join(', ') || '—'],
              ['Estimated eligible bytes', selected.estimatedBytes ? formatBytes(selected.estimatedBytes) : '—'],
              ['Actual bytes removed', formatBytes(selected.actualBytes)],
              ['Independently verified freed', selected.verifiedBytesFreed === null ? 'not available' : formatBytes(selected.verifiedBytesFreed)],
              ['Files scanned', selected.scannedFiles.toLocaleString()],
              ['Files deleted', selected.deletedFiles.toLocaleString()],
              ['Files skipped', selected.skippedFiles.toLocaleString()],
              ['Disk before', selected.diskBefore ? `${formatBytes(selected.diskBefore.freeBytes)} free` : '—'],
              ['Disk after', selected.diskAfter ? `${formatBytes(selected.diskAfter.freeBytes)} free` : '—'],
              ['Cancelled', String(selected.cancelled)]
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-[color:var(--nx-border)]/50 py-1">
                <span className="text-[color:var(--nx-text-dim)]">{label}</span>
                <span className="nx-mono max-w-[60%] truncate text-right">{value}</span>
              </div>
            ))}
          </div>
          {selected.errors.length > 0 && (
            <div className="border-t border-[color:var(--nx-border)] px-4 py-2">
              <div className="nx-label mb-1">Recorded errors / skips</div>
              <ul className="nx-mono max-h-32 space-y-0.5 overflow-auto text-[10px] text-amber-200/80">
                {selected.errors.map((error, i) => (
                  <li key={`${error}-${i}`}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-[color:var(--nx-border)] px-4 py-2 text-[10.5px] text-[color:var(--nx-text-dim)]">
            <ShieldCheck size={12} className="text-emerald-400" />
            Stored locally only. Nothing is transmitted anywhere.
          </div>
        </Panel>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Package, RefreshCw, HardDriveDownload, ShieldCheck, Search, Download } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Panel, PanelHeader } from '../components/ui'
import { api, formatBytes, formatDurationLong } from '../lib/api'
import type { SystemInfoReport } from '@shared/types'

export function SoftwarePage(): React.JSX.Element {
  const app = useApp()
  const [info, setInfo] = useState<SystemInfoReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [updateResult, setUpdateResult] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [integrity, setIntegrity] = useState<{ ok: boolean; message: string; stdout: string } | null>(null)
  const [integrityBusy, setIntegrityBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setInfo(await api().system.info())
    } catch (err) {
      app.notify(`Inventory failed: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apps = useMemo(() => {
    const list = info?.apps ?? []
    return list.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())).slice(0, 500)
  }, [info?.apps, query])

  const totalEstimated = useMemo(() => (info?.apps ?? []).reduce((acc, a) => acc + (a.estimatedSizeBytes ?? 0), 0), [info?.apps])

  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await api().system.updateCheck()
      setUpdateResult(result.message)
    } finally {
      setChecking(false)
    }
  }

  const runIntegrity = async (): Promise<void> => {
    const confirmed = await app.confirmDestructive(
      'Verify Windows system files',
      'Run a read-only System File Checker verification?',
      'This runs "sfc /verifyonly", which only inspects system file integrity. It does not repair, replace or modify anything.\n\nIt can take several minutes and usually needs an elevated console. If elevation is required, the check will report that instead of attempting to elevate.',
      'Run verification'
    )
    if (!confirmed) return
    setIntegrityBusy(true)
    try {
      setIntegrity(await api().system.integrityCheck())
    } finally {
      setIntegrityBusy(false)
    }
  }

  const exportReport = (): void => {
    if (!info) return
    const blob = new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nexus-system-report-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
    app.notify('System report exported to your downloads folder.', 'success')
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel glow>
        <PanelHeader
          title="Software & Disk Health"
          subtitle="Read-only inventory. NEXUS never uninstalls applications, alters partitions, modifies the registry or runs repairs."
          icon={<Package size={15} />}
          right={
            <div className="flex gap-2">
              <Button onClick={load} disabled={loading}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Rescan
              </Button>
              <Button onClick={exportReport} disabled={!info}>
                <Download size={13} /> Export JSON
              </Button>
            </div>
          }
        />
        {info && (
          <div className="grid gap-x-6 gap-y-1 px-4 py-3 text-[11.5px] sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Host', info.hostname],
              ['OS', `${info.osVersion} (${info.release})`],
              ['Architecture', info.arch],
              ['CPU', info.cpuModel],
              ['Cores', String(info.cpuCores)],
              ['Memory', formatBytes(info.totalMemBytes)],
              ['Uptime', formatDurationLong(info.uptimeSec)],
              ['Applications', `${info.apps.length} detected`],
              ['Estimated app footprint', totalEstimated > 0 ? formatBytes(totalEstimated) : 'not reported by installer metadata']
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-[color:var(--nx-border)]/50 py-1">
                <span className="text-[color:var(--nx-text-dim)]">{label}</span>
                <span className="max-w-[60%] truncate text-right nx-mono" title={value}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
        {info?.notes.map((note) => (
          <div key={note} className="mx-4 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-200/90">
            {note}
          </div>
        ))}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Disks & volumes" subtitle="Free space measured with the OS filesystem stats API." icon={<HardDriveDownload size={14} />} />
          <div className="divide-y divide-[color:var(--nx-border)]/60">
            {(info?.disks ?? []).length === 0 ? (
              <EmptyState title="No volumes reported" hint="Volume information could not be read on this host." />
            ) : (
              info?.disks.map((disk) => (
                <div key={disk.mount} className="px-4 py-2">
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="nx-mono font-medium">{disk.mount}</span>
                    <span className="nx-mono text-[color:var(--nx-text-dim)]">
                      {formatBytes(disk.freeBytes)} free / {formatBytes(disk.totalBytes)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--nx-border)]">
                    <div className="h-full rounded-full" style={{ width: `${disk.usedPercent}%`, background: 'linear-gradient(90deg, var(--nx-accent), var(--nx-accent-dim))' }} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-[color:var(--nx-text-dim)]">{disk.usedPercent.toFixed(1)}% used</div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Disk health" subtitle="Only what the OS exposes without extra privileges. Unknown is reported as unknown." />
          <div className="divide-y divide-[color:var(--nx-border)]/60">
            {(info?.health ?? []).length === 0 ? (
              <EmptyState title="Health data unavailable" hint="This platform does not expose disk health to unprivileged processes." />
            ) : (
              info?.health.map((disk) => (
                <div key={disk.device} className="px-4 py-2 text-[11.5px]">
                  <div className="flex items-center justify-between">
                    <span className="nx-mono font-medium">{disk.device}</span>
                    <Badge tone={disk.health.toLowerCase().includes('healthy') ? 'ok' : 'warn'}>{disk.health}</Badge>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-[color:var(--nx-text-dim)]">
                    {disk.model ?? 'model unavailable'} · {disk.sizeBytes ? formatBytes(disk.sizeBytes) : 'size unknown'} · {disk.status}
                  </div>
                  <div className="text-[10px] text-[color:var(--nx-text-dim)]">source: {disk.source}</div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Installed applications"
          subtitle="From the Windows uninstall registry keys (or the package manager on Linux). Size is whatever the installer recorded — often approximate."
          right={
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--nx-text-dim)]" />
              <input className="nx-input pl-7" placeholder="Filter apps…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter applications" />
            </div>
          }
        />
        <div className="max-h-[420px] overflow-auto">
          <table className="nx-table">
            <thead>
              <tr>
                <th>Application</th>
                <th className="w-28">Version</th>
                <th className="w-40">Publisher</th>
                <th className="w-28">Size</th>
                <th className="w-28">Source</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app2) => (
                <tr key={`${app2.name}-${app2.version}-${app2.location}`}>
                  <td className="max-w-[320px] truncate" title={app2.location ?? app2.name}>
                    {app2.name}
                  </td>
                  <td className="nx-mono text-[10.5px]">{app2.version ?? '—'}</td>
                  <td className="max-w-[180px] truncate text-[10.5px] text-[color:var(--nx-text-dim)]">{app2.publisher ?? '—'}</td>
                  <td className="nx-mono text-[10.5px]">{app2.estimatedSizeBytes ? formatBytes(app2.estimatedSizeBytes) : '—'}</td>
                  <td className="text-[10px] text-[color:var(--nx-text-dim)]">{app2.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {apps.length === 0 && !loading && <EmptyState title="No applications listed" hint="The installer inventory could not be read." />}
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Windows updates" subtitle="Checks for available updates. Never downloads or installs anything." />
          <div className="px-4 py-3">
            <Button onClick={checkUpdates} disabled={checking}>
              {checking ? 'Querying…' : 'Check for available updates'}
            </Button>
            {updateResult && <p className="mt-4 text-[11.5px] leading-relaxed text-[color:var(--nx-text)]">{updateResult}</p>}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="System file integrity (read-only)" subtitle="Runs sfc /verifyonly. No repairs, no replacements." icon={<ShieldCheck size={14} />} />
          <div className="px-4 py-3">
            <Button onClick={runIntegrity} disabled={integrityBusy}>
              {integrityBusy ? 'Verifying (this can take minutes)…' : 'Run verification'}
            </Button>
            {integrity && (
              <div className="mt-3 space-y-2">
                <Badge tone={integrity.ok ? 'ok' : 'warn'}>{integrity.ok ? 'completed' : 'not completed'}</Badge>
                <p className="text-[11.5px] leading-relaxed">{integrity.message}</p>
                {integrity.stdout && (
                  <pre className="nx-mono max-h-40 overflow-auto rounded bg-black/30 p-2 text-[10px] text-[color:var(--nx-text-dim)]">{integrity.stdout}</pre>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

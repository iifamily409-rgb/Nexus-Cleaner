import { useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw, Search } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Panel, PanelHeader, StatCard } from '../components/ui'
import { api, formatBytes, formatDurationLong, formatRate } from '../lib/api'
import type { ProcessInfo, StartupEntry } from '@shared/types'

export function MonitorPage(): React.JSX.Element {
  const app = useApp()
  const { metrics, metricsHistory } = app
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [startup, setStartup] = useState<StartupEntry[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'cpu' | 'mem' | 'name'>('cpu')
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const [procs, entries] = await Promise.all([api().monitor.processes(), api().monitor.startup()])
      setProcesses(procs)
      setStartup(entries)
    } catch (err) {
      app.notify(`Could not read process table: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), Math.max(3000, app.settings?.refreshIntervalMs ?? 2000) * 2)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const list = processes.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    if (sort === 'cpu') return [...list].sort((a, b) => b.cpuPercent - a.cpuPercent)
    if (sort === 'mem') return [...list].sort((a, b) => b.memBytes - a.memBytes)
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [processes, query, sort])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="CPU" value={metrics ? `${metrics.cpuPercent.toFixed(1)}%` : '—'} percent={metrics?.cpuPercent ?? null} sub={metrics ? `load avg ${metrics.loadAvg.map((l) => l.toFixed(2)).join(' / ')}` : undefined} />
        <StatCard label="Memory" value={metrics ? formatBytes(metrics.memUsedBytes) : '—'} percent={metrics?.memPercent ?? null} sub={metrics ? `${formatBytes(metrics.memTotalBytes)} total` : undefined} />
        <StatCard label="Disk I/O" value={metrics ? formatRate(metrics.diskReadBytesPerSec) : '—'} sub={metrics ? `write ${formatRate(metrics.diskWriteBytesPerSec)}` : 'Unavailable on this platform'} />
        <StatCard label="Uptime" value={metrics ? formatDurationLong(metrics.uptimeSec) : '—'} sub={metrics?.battery?.hasBattery ? `battery ${metrics.battery.percent ?? '—'}%` : 'No battery detected'} />
      </div>

      <Panel>
        <PanelHeader
          title="Process viewer"
          subtitle="Read-only. NEXUS Cleaner never terminates processes — not even non-critical ones. Use Task Manager if you decide to end a task."
          icon={<Activity size={15} />}
          right={
            <Button onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--nx-border)] px-4 py-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--nx-text-dim)]" />
            <input className="nx-input pl-7" placeholder="Filter processes…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter processes" />
          </div>
          <div className="flex gap-1">
            {(['cpu', 'mem', 'name'] as const).map((key) => (
              <Button key={key} className={`!px-2 !py-1 !text-[11px] ${sort === key ? 'nx-text-accent' : ''}`} onClick={() => setSort(key)}>
                {key === 'cpu' ? 'CPU' : key === 'mem' ? 'Memory' : 'Name'}
              </Button>
            ))}
          </div>
          <span className="ml-auto nx-mono text-[10.5px] text-[color:var(--nx-text-dim)]">{filtered.length} / {processes.length} processes</span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No processes listed" hint="The process table could not be read, or the filter matched nothing." />
        ) : (
          <div className="max-h-[540px] overflow-auto">
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Process</th>
                  <th className="w-20">PID</th>
                  <th className="w-20">CPU</th>
                  <th className="w-24">Memory</th>
                  <th className="w-28">User</th>
                  <th className="w-24">State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 400).map((proc) => (
                  <tr key={proc.pid}>
                    <td className="max-w-[340px] truncate font-medium" title={proc.command || proc.name}>
                      {proc.name}
                    </td>
                    <td className="nx-mono text-[11px]">{proc.pid}</td>
                    <td className="nx-mono text-[11px]">{proc.cpuPercent.toFixed(1)}%</td>
                    <td className="nx-mono text-[11px]">{formatBytes(proc.memBytes)}</td>
                    <td className="max-w-[110px] truncate text-[10.5px] text-[color:var(--nx-text-dim)]">{proc.user}</td>
                    <td>{proc.protected ? <Badge tone="warn">protected</Badge> : <Badge>normal</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="CPU / RAM history" subtitle={`${metricsHistory.length} live samples at ${app.settings?.refreshIntervalMs ?? 2000} ms interval`} />
          <div className="px-4 py-3">
            {metricsHistory.length < 2 ? (
              <p className="text-[11px] text-[color:var(--nx-text-dim)]">Collecting samples…</p>
            ) : (
              <svg viewBox="0 0 360 110" className="w-full" style={{ height: 110 }} preserveAspectRatio="none">
                {[25, 50, 75].map((v) => (
                  <line key={v} x1={0} x2={360} y1={110 - (v / 100) * 110} y2={110 - (v / 100) * 110} stroke="var(--nx-border)" strokeWidth={0.5} strokeDasharray="2 4" />
                ))}
                <path
                  d={metricsHistory
                    .map((s, i) => `${i === 0 ? 'M' : 'L'}${(i / (metricsHistory.length - 1)) * 360},${110 - (Math.min(100, s.memPercent) / 100) * 110}`)
                    .join(' ')}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth={1.3}
                />
                <path
                  d={metricsHistory
                    .map((s, i) => `${i === 0 ? 'M' : 'L'}${(i / (metricsHistory.length - 1)) * 360},${110 - (Math.min(100, s.cpuPercent) / 100) * 110}`)
                    .join(' ')}
                  fill="none"
                  stroke="var(--nx-accent)"
                  strokeWidth={1.5}
                />
              </svg>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Startup impact summary" subtitle="Entries that start with Windows. Manage them on the Startup Manager page." />
          <div className="divide-y divide-[color:var(--nx-border)]/60">
            {startup.length === 0 ? (
              <EmptyState title="No startup entries" hint="Nothing was found in the user or machine Run keys." />
            ) : (
              startup.slice(0, 10).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2 px-4 py-1.5 text-[11px]">
                  <span className="truncate">{entry.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={entry.enabled ? 'ok' : 'neutral'}>{entry.enabled ? 'enabled' : 'disabled'}</Badge>
                    {entry.risk !== 'safe' && <Badge tone={entry.risk === 'critical' ? 'danger' : 'warn'}>{entry.risk}</Badge>}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-[color:var(--nx-border)] px-4 py-2 text-[10.5px] leading-relaxed text-[color:var(--nx-text-dim)]">
            Windows does not expose a per-entry boot-time impact through a supported user-level API. NEXUS shows the entry list, publisher and command instead of inventing
            “impact scores”.
          </div>
        </Panel>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Zap,
  Radar,
  ScanSearch,
  HardDrive,
  Cpu,
  MemoryStick,
  BatteryCharging,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  CircleAlert,
  Activity
} from 'lucide-react'
import { useApp, type PageId } from '../hooks/useAppState'
import { Badge, Button, InfoHint, Panel, PanelHeader, StatCard, Tooltip, EmptyState } from '../components/ui'
import { HolographicScanner } from '../components/HolographicScanner'
import { api, formatBytes, formatDateTime, formatDurationLong, formatRate } from '../lib/api'
import type { HistoryRecord, ProcessInfo } from '@shared/types'

const QUICK_ACTIONS: { page: PageId; label: string; hint: string; icon: React.ComponentType<{ size?: number }>; mode?: string }[] = [
  { page: 'quick', label: 'Quick Clean', hint: 'Lowest-risk categories, tuned for speed', icon: Zap },
  { page: 'smart', label: 'Smart Scan', hint: 'Balanced analysis across safe categories', icon: Radar },
  { page: 'deep', label: 'Deep Analysis', hint: 'Broader inspection with the same safety rules', icon: ScanSearch },
  { page: 'storage', label: 'Storage Analyzer', hint: 'Treemap, largest files, category breakdown', icon: HardDrive }
]

export function Dashboard(): React.JSX.Element {
  const app = useApp()
  const { metrics, metricsHistory, history, settings, meta, progress } = app
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [lastScan, setLastScan] = useState<HistoryRecord | null>(null)

  useEffect(() => {
    let alive = true
    void api()
      .monitor.processes()
      .then((list) => {
        if (alive) setProcesses(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const latest = history.find((h) => h.kind === 'scan')
    if (latest) setLastScan(latest)
  }, [history])

  const disk = metrics?.disk ?? null
  const totalRemoved = useMemo(
    () => history.filter((h) => h.kind === 'clean').reduce((acc, h) => acc + h.actualBytes, 0),
    [history]
  )
  const heatProcesses = useMemo(() => processes.slice(0, 5), [processes])

  const recommendations = useMemo(() => {
    const list: { title: string; detail: string; tone: 'warn' | 'ok' | 'info' }[] = []
    if (disk && disk.usedPercent > 90) {
      list.push({
        title: 'Disk is almost full',
        detail: `Only ${formatBytes(disk.freeBytes)} free on ${disk.mount}. Run a Smart Scan, then review the Storage Analyzer for large folders.`,
        tone: 'warn'
      })
    } else if (disk && disk.usedPercent > 75) {
      list.push({ title: 'Disk usage is high', detail: `${disk.usedPercent.toFixed(1)}% used. Reviewing the Storage Analyzer is usually worthwhile.`, tone: 'info' })
    }
    if (metrics && metrics.cpuPercent > 80) {
      list.push({
        title: 'High CPU usage',
        detail: `Measured ${metrics.cpuPercent.toFixed(1)}% CPU. Check the System Monitor page to identify the process responsible before closing anything.`,
        tone: 'warn'
      })
    }
    if (metrics && metrics.memPercent > 85) {
      list.push({
        title: 'Memory pressure',
        detail: `${metrics.memPercent.toFixed(1)}% of RAM in use. Stopping unused applications frees memory; NEXUS never terminates processes for you.`,
        tone: 'warn'
      })
    }
    if (history.length === 0) {
      list.push({ title: 'No recorded operations yet', detail: 'Run a Quick Clean to establish a real baseline. History only records genuine operations.', tone: 'info' })
    }
    if (list.length === 0) {
      list.push({ title: 'No pressing issues measured', detail: 'Current CPU, memory and disk readings are within normal ranges.', tone: 'ok' })
    }
    return list
  }, [disk, metrics, history.length])

  const accentHex =
    settings?.accent === 'blue' ? '#3b82f6' : settings?.accent === 'green' ? '#2ee6a8' : settings?.accent === 'violet' ? '#a78bfa' : '#22e6ff'

  return (
    <div className="flex flex-col gap-3">
      {/* top stats */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Disk free"
          value={disk ? formatBytes(disk.freeBytes) : '—'}
          sub={disk ? `${disk.usedPercent.toFixed(1)}% used of ${formatBytes(disk.totalBytes)}` : 'Disk metrics unavailable'}
          percent={disk?.usedPercent ?? null}
          accent
          icon={<HardDrive size={14} />}
        />
        <StatCard label="CPU load" value={metrics ? `${metrics.cpuPercent.toFixed(1)}%` : '—'} sub={metrics ? `${metrics.processCount} processes running` : 'Waiting for first sample'} percent={metrics?.cpuPercent ?? null} icon={<Cpu size={14} />} />
        <StatCard
          label="Memory"
          value={metrics ? formatBytes(metrics.memUsedBytes) : '—'}
          sub={metrics ? `${metrics.memPercent.toFixed(1)}% of ${formatBytes(metrics.memTotalBytes)}` : 'Waiting for first sample'}
          percent={metrics?.memPercent ?? null}
          icon={<MemoryStick size={14} />}
        />
        <StatCard
          label="Network"
          value={metrics ? formatRate(metrics.netRxBytesPerSec) : '—'}
          sub={metrics && metrics.netTxBytesPerSec !== null ? `up ${formatRate(metrics.netTxBytesPerSec)}` : 'Traffic counters unavailable'}
          icon={<Activity size={14} />}
        />
        <StatCard
          label="Battery"
          value={metrics?.battery?.hasBattery ? `${metrics.battery.percent ?? '—'}%` : 'No battery'}
          sub={metrics?.battery?.charging ? 'Charging' : metrics?.battery?.hasBattery ? 'On battery' : 'Desktop / unsupported'}
          icon={<BatteryCharging size={14} />}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="flex flex-col gap-3">
          {/* hero */}
          <Panel glow className="nx-grid-bg nx-scanlines relative overflow-hidden">
            <div className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="flex flex-col justify-center">
                <div className="mb-1 flex items-center gap-2">
                  <ShieldCheck size={15} className="nx-text-accent" />
                  <span className="nx-label">System readiness</span>
                </div>
                <h2 className="text-lg font-semibold leading-tight text-[color:var(--nx-text)]">
                  {disk ? `${formatBytes(disk.freeBytes)} free` : 'Reading system state…'}
                </h2>
                <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-[color:var(--nx-text-dim)]">
                  Every figure on this dashboard is measured from your machine. NEXUS Cleaner never estimates a “boost” percentage, never guarantees FPS, and never
                  deletes anything without a review step.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => app.setPage('quick')} disabled={app.busy}>
                    <Zap size={14} /> Quick Clean
                  </Button>
                  <Button onClick={() => app.setPage('smart')} disabled={app.busy}>
                    <Radar size={14} /> Smart Scan
                  </Button>
                  <Button onClick={() => app.setPage('deep')} disabled={app.busy}>
                    <ScanSearch size={14} /> Deep Analysis
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-[color:var(--nx-text-dim)]">
                  <Badge tone="ok">contextIsolation on</Badge>
                  <Badge tone="ok">nodeIntegration off</Badge>
                  <Badge tone="ok">validated IPC</Badge>
                  <Badge>{meta?.elevated ? 'elevated' : 'user level'}</Badge>
                  {meta?.isWindows ? <Badge tone="accent">Windows host</Badge> : <Badge tone="warn">{meta?.platform}</Badge>}
                </div>
              </div>
              <div className="h-[220px]">
                <HolographicScanner
                  progress={progress}
                  reducedMotion={app.reducedMotion}
                  intensity={app.animationIntensity}
                  active={progress?.phase !== 'idle' && progress !== null}
                  diskFree={disk?.freeBytes ?? null}
                  diskTotal={disk?.totalBytes ?? null}
                  accent={accentHex}
                />
              </div>
            </div>
          </Panel>

          {/* quick actions */}
          <div className="grid gap-2 sm:grid-cols-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon
              return (
                <motion.button
                  key={action.page}
                  whileHover={app.reducedMotion ? undefined : { y: -2 }}
                  onClick={() => app.setPage(action.page)}
                  className="nx-panel group flex items-start gap-3 px-4 py-3 text-left transition-colors hover:border-[color:var(--nx-accent-dim)]"
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--nx-border)] text-[color:var(--nx-accent)] group-hover:border-[color:var(--nx-accent-dim)]">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[color:var(--nx-text)]">
                      {action.label}
                      <ArrowUpRight size={12} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[color:var(--nx-text-dim)]">{action.hint}</span>
                  </span>
                </motion.button>
              )
            })}
          </div>

          {/* recommendations */}
          <Panel>
            <PanelHeader
              title="Measured recommendations"
              subtitle="Generated from real CPU, memory and disk samples — not from marketing rules."
              icon={<CircleAlert size={15} />}
            />
            <div className="divide-y divide-[color:var(--nx-border)]/60">
              {recommendations.map((rec) => (
                <div key={rec.title} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                      rec.tone === 'warn' ? 'bg-amber-400' : rec.tone === 'ok' ? 'bg-emerald-400' : 'bg-sky-400'
                    }`}
                  />
                  <div>
                    <div className="text-[12.5px] font-medium text-[color:var(--nx-text)]">{rec.title}</div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--nx-text-dim)]">{rec.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* top processes */}
          <Panel>
            <PanelHeader
              title="Highest resource consumers"
              subtitle="Live snapshot. Read-only — NEXUS never terminates processes for you."
              right={
                <Button variant="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => app.setPage('monitor')}>
                  Open monitor
                </Button>
              }
            />
            {heatProcesses.length === 0 ? (
              <EmptyState title="Process list unavailable" hint="The OS process table could not be read on this host." />
            ) : (
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th className="w-20">PID</th>
                    <th className="w-24">CPU</th>
                    <th className="w-28">Memory</th>
                    <th className="w-28">State</th>
                  </tr>
                </thead>
                <tbody>
                  {heatProcesses.map((proc) => (
                    <tr key={proc.pid}>
                      <td className="max-w-[260px] truncate font-medium" title={proc.command || proc.name}>
                        {proc.name}
                      </td>
                      <td className="nx-mono text-[11px]">{proc.pid}</td>
                      <td className="nx-mono text-[11px]">{proc.cpuPercent.toFixed(1)}%</td>
                      <td className="nx-mono text-[11px]">{formatBytes(proc.memBytes)}</td>
                      <td>{proc.protected ? <Badge tone="warn">protected</Badge> : <Badge>user app</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* right column */}
        <div className="flex flex-col gap-3">
          <Panel>
            <PanelHeader title="Last analysis" subtitle="From local activity history." icon={<Clock size={15} />} />
            {lastScan ? (
              <div className="space-y-2 px-4 py-3 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-[color:var(--nx-text-dim)]">When</span>
                  <span className="nx-mono">{formatDateTime(lastScan.at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[color:var(--nx-text-dim)]">Mode</span>
                  <Badge tone="accent">{lastScan.mode ?? '—'}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[color:var(--nx-text-dim)]">Eligible</span>
                  <span className="nx-mono">
                    {lastScan.estimatedBytes ? formatBytes(lastScan.estimatedBytes) : `${lastScan.scannedFiles} files`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[color:var(--nx-text-dim)]">Duration</span>
                  <span className="nx-mono">{formatDurationLong(lastScan.durationMs / 1000)}</span>
                </div>
                {lastScan.cancelled && <Badge tone="warn">cancelled</Badge>}
              </div>
            ) : (
              <EmptyState title="No analysis recorded" hint="Run a Quick Clean or Smart Scan — history is only written for real operations." />
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Reclaimed over recorded history" subtitle="Sum of actual bytes removed by completed cleanups." />
            <div className="px-4 py-3">
              <div className="nx-mono text-2xl font-semibold nx-text-accent">{formatBytes(totalRemoved)}</div>
              <p className="mt-1 text-[11px] text-[color:var(--nx-text-dim)]">
                {history.filter((h) => h.kind === 'clean').length} cleanup run(s) recorded. Values are the bytes reported as successfully deleted, not estimates.
              </p>
              <div className="mt-3 space-y-1">
                {history
                  .filter((h) => h.kind === 'clean')
                  .slice(0, 4)
                  .map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-[11px]">
                      <span className="truncate text-[color:var(--nx-text-dim)]">{formatDateTime(h.at)}</span>
                      <span className="nx-mono">{formatBytes(h.actualBytes)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="CPU / RAM trend"
              right={
                <Tooltip text="Samples are pushed from the main process at your configured refresh interval. No smoothing or interpolation is applied.">
                  <span className="text-[color:var(--nx-text-dim)]">
                    <InfoHint text="Raw samples at your refresh interval." />
                  </span>
                </Tooltip>
              }
            />
            <div className="px-4 py-3">
              {metricsHistory.length < 2 ? (
                <p className="text-[11px] text-[color:var(--nx-text-dim)]">Collecting samples…</p>
              ) : (
                <TrendChart samples={metricsHistory} />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function TrendChart({ samples }: { samples: { cpuPercent: number; memPercent: number }[] }): React.JSX.Element {
  const w = 340
  const h = 90
  const path = (key: 'cpuPercent' | 'memPercent'): string =>
    samples
      .map((s, i) => {
        const x = (i / Math.max(1, samples.length - 1)) * w
        const y = h - (Math.min(100, s[key]) / 100) * h
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 90 }} preserveAspectRatio="none">
        {[25, 50, 75].map((v) => (
          <line key={v} x1={0} x2={w} y1={h - (v / 100) * h} y2={h - (v / 100) * h} stroke="var(--nx-border)" strokeWidth={0.5} strokeDasharray="2 4" />
        ))}
        <path d={path('memPercent')} fill="none" stroke="#34d399" strokeWidth={1.3} opacity={0.8} />
        <path d={path('cpuPercent')} fill="none" stroke="var(--nx-accent)" strokeWidth={1.5} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[color:var(--nx-text-dim)]">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded" style={{ background: 'var(--nx-accent)' }} /> CPU
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded bg-emerald-400" /> RAM
        </span>
        <span className="nx-mono">0–100%</span>
      </div>
    </div>
  )
}

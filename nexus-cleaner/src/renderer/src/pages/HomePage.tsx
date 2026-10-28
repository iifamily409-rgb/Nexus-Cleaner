import { useMemo, useState } from 'react'
import {
  Zap,
  Sparkles,
  Layers,
  Cpu,
  MemoryStick,
  HardDrive,
  ArrowRight,
  FileWarning
} from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { ScanAction } from '../components/ScanAction'
import { CleanPanel } from '../components/CleanPanel'
import { Badge } from '../components/ui'
import { formatBytes, formatRate } from '../lib/api'
import type { CleanupMode } from '@shared/types'

const MODES: { mode: CleanupMode; title: string; subtitle: string; detail: string; icon: typeof Zap }[] = [
  {
    mode: 'quick',
    title: 'Quick Scan',
    subtitle: 'Lowest-risk caches · fastest pass',
    detail: 'User temp, Windows temp, browser caches and thumbnails. Nothing is deleted without a review step.',
    icon: Zap
  },
  {
    mode: 'smart',
    title: 'Smart Scan',
    subtitle: 'Every safe category, balanced',
    detail: 'Adds application caches, crash dumps and error-reporting queues to the Quick Scan set.',
    icon: Sparkles
  },
  {
    mode: 'deep',
    title: 'Full Scan',
    subtitle: 'Broader analysis · same safety rules',
    detail: 'Widens inspection to Delivery Optimization, font caches and rotated logs. Broader analysis, never less-safe.',
    icon: Layers
  }
]

export function HomePage(): React.JSX.Element {
  const app = useApp()
  const { session, metrics, meta, settings } = app
  const [selection, setSelection] = useState<{ mode: CleanupMode; request: number }>({ mode: 'quick', request: 0 })
  const mode = selection.mode

  const busy = session.phase === 'scanning' || session.phase === 'cleaning' || session.phase === 'verifying'
  const disk = metrics?.disk ?? null

  // Compact metrics — rendered only from real snapshot values, hidden otherwise.
  const liveMetrics = useMemo(
    () =>
      [
        { key: 'cpu', label: 'CPU', icon: Cpu, value: metrics ? `${metrics.cpuPercent.toFixed(0)}%` : null, percent: metrics?.cpuPercent ?? null },
        {
          key: 'mem',
          label: 'Memory',
          icon: MemoryStick,
          value: metrics
            ? `${formatBytes(metrics.memUsedBytes)} / ${formatBytes(metrics.memTotalBytes)}`
            : null,
          percent: metrics?.memPercent ?? null
        },
        {
          key: 'disk',
          label: 'Disk free',
          icon: HardDrive,
          value: disk ? `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}` : null,
          percent: disk?.usedPercent ?? null
        },
        {
          key: 'net',
          label: 'Network',
          icon: ArrowRight,
          value: metrics ? `↓ ${formatRate(metrics.netRxBytesPerSec)} · ↑ ${formatRate(metrics.netTxBytesPerSec)}` : null,
          percent: null
        }
      ].filter((item) => item.value !== null),
    [metrics, disk]
  )

  const lastReport = session.report
  const scan = session.scan
  const ageHours = settings?.maxAgeHours ?? 24

  /** Every scan button opens its panel *and* runs the real scan. */
  const startMode = (next: CleanupMode): void => {
    setSelection((prev) => ({ mode: next, request: prev.request + 1 }))
    requestAnimationFrame(() => {
      document.getElementById('nx-scan-panel')?.scrollIntoView({ block: 'start', behavior: app.reducedMotion ? 'auto' : 'smooth' })
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
      {/* ---------------------------------------------------------- header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[color:var(--nx-text)]">NEXUS Cleaner</h1>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--nx-text-dim)]">
            Pick a scan depth. Candidates are re-validated with path, exclusion and age checks — nothing is deleted before you confirm the review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session.phase !== 'idle' && <Badge tone="accent">{session.phase}</Badge>}
        </div>
      </header>

      {/* ---------------------------------------------------- scan actions */}
      <section aria-label="Scan actions" className="grid gap-2 lg:grid-cols-3">
        {MODES.map((item) => {
          const running = session.phase === 'scanning' && session.mode === item.mode
          const active = (session.mode === item.mode && session.phase !== 'idle') || mode === item.mode
          return (
            <ScanAction
              key={item.mode}
              mode={item.mode}
              title={item.title}
              subtitle={item.subtitle}
              detail={item.detail}
              icon={item.icon}
              active={active}
              running={running}
              disabled={busy}
              onStart={() => startMode(item.mode)}
            />
          )
        })}
      </section>

      {/* -------------------------------------------------- live metrics */}
      {liveMetrics.length > 0 && (
        <section aria-label="System metrics" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {liveMetrics.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.key} className="nx-panel px-3 py-2" data-metric={item.key}>
                <div className="flex items-center justify-between">
                  <span className="nx-label">{item.label}</span>
                  <Icon size={12} className="text-[color:var(--nx-text-dim)]" />
                </div>
                <div className="nx-mono mt-1 text-[13px] font-semibold text-[color:var(--nx-text)]">{item.value}</div>
                {typeof item.percent === 'number' && (
                  <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[color:var(--nx-border)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, item.percent))}%`, background: 'var(--nx-accent)' }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* ------------------------------------------------- status + panel */}
      <div id="nx-scan-panel" className="scroll-mt-2">
        {scan && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--nx-border)] bg-[color:var(--nx-surface-2)] px-3 py-2 text-[11.5px]">
            <Badge tone="accent">{MODES.find((m) => m.mode === session.mode)?.title ?? 'Scan'}</Badge>
            <span className="text-[color:var(--nx-text-dim)]">
              {scan.cancelled ? 'previous scan was cancelled —' : 'analysis complete —'} scanned{' '}
              <strong className="nx-mono text-[color:var(--nx-text)]">{scan.totalScannedFiles.toLocaleString()}</strong> files, found{' '}
              <strong className="nx-mono text-[color:var(--nx-accent)]">{scan.totalEligibleFiles.toLocaleString()}</strong> eligible (
              {formatBytes(scan.totalEligibleBytes)}) at {new Date(scan.startedAt).toLocaleTimeString()} · age filter ≥ {ageHours}h
            </span>
          </div>
        )}
        {session.report && (
          <div className="mb-2 rounded-xl border border-[color:var(--nx-border)] bg-[color:var(--nx-surface-2)] px-3 py-2 text-[11.5px] text-[color:var(--nx-text-dim)]">
            Last cleanup: <strong className="nx-mono text-[color:var(--nx-text)]">{lastReport?.totalDeleted.toLocaleString()}</strong> files removed ·{' '}
            <strong className="nx-mono text-[color:var(--nx-text)]">{formatBytes(lastReport?.totalBytesDeleted ?? 0)}</strong> reported · measured disk
            delta <strong className="nx-mono text-[color:var(--nx-text)]">{lastReport?.verifiedBytesFreed === null ? 'not measurable' : formatBytes(lastReport?.verifiedBytesFreed ?? 0)}</strong>
          </div>
        )}
        <CleanPanel key={mode} mode={mode} autoStart={selection.request} />
      </div>

      {!meta?.isWindows && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          <FileWarning size={14} className="mt-0.5 shrink-0" />
          <span>
            Running on <strong>{meta?.platform ?? 'an unknown platform'}</strong>. Windows-only categories (Windows temp, Delivery Optimization, Recycle Bin
            API) report as unavailable rather than inventing results.
          </span>
        </div>
      )}
    </div>
  )
}

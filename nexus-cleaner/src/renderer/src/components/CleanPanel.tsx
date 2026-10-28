import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, X, ShieldAlert, ChevronDown, ChevronRight, ArrowRight, FileWarning, CheckCircle2 } from 'lucide-react'
import { useApp, useCategoriesById } from '../hooks/useAppState'
import { HolographicScanner } from './HolographicScanner'
import { OperationConsole, LiveMetricsStrip } from './Console'
import { Badge, Button, EmptyState, InfoHint, Panel, PanelHeader, ProgressBar, Toggle, Tooltip } from './ui'
import { api, formatBytes, formatDuration, formatRate } from '../lib/api'
import type { CategoryId, CleanupMode } from '@shared/types'

const MODE_COPY: Record<
  CleanupMode,
  { title: string; blurb: string; detail: string; action: string }
> = {
  quick: {
    title: 'Quick Clean',
    blurb: 'Lowest-risk categories only, tuned for speed.',
    detail:
      'Quick Clean analyses user temp, Windows temp, browser caches and thumbnail caches. Every candidate is re-validated before deletion, and locked files are skipped rather than forced.',
    action: 'Run Quick Clean'
  },
  smart: {
    title: 'Smart Scan',
    blurb: 'Balanced analysis across all safe categories.',
    detail:
      'Smart Scan adds application caches, crash dumps and error-reporting queues. It still never touches documents, downloads, photos, saved passwords or cookies.',
    action: 'Run Smart Scan'
  },
  deep: {
    title: 'Deep Analysis',
    blurb: 'Broader inspection — deeper checks, same safety rules.',
    detail:
      'Deep Analysis widens the inspection to Delivery Optimization caches, font caches and rotated diagnostic logs. “Deep” means more thorough analysis, never more reckless deletion.',
    action: 'Run Deep Analysis'
  },
  custom: {
    title: 'Custom Clean',
    blurb: 'You pick exactly which categories are analysed.',
    detail:
      'Custom Clean uses only the categories you tick below. Exclusions and the file-age filter from Settings still apply.',
    action: 'Run Custom Clean'
  }
}

export function CleanPanel({ mode }: { mode: CleanupMode }): React.JSX.Element {
  const app = useApp()
  const byId = useCategoriesById()
  const copy = MODE_COPY[mode]
  const { settings, categories, session, progress, events, metrics, metricsHistory, meta } = app

  const [selected, setSelected] = useState<CategoryId[]>([])
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [showSample, setShowSample] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<string | null>(null)
  const [runningDryRun, setRunningDryRun] = useState(false)

  const effectiveCategories = useMemo<CategoryId[]>(() => {
    if (mode === 'custom') {
      return selected.length > 0 ? selected : categories.filter((c) => c.available).map((c) => c.id)
    }
    const flag = mode === 'quick' ? 'quick' : mode === 'smart' ? 'smart' : 'deep'
    return categories.filter((c) => c[flag] && c.available).map((c) => c.id)
  }, [mode, selected, categories])

  const exclusions = settings?.exclusions ?? []
  const maxAgeHours = settings?.maxAgeHours ?? 24

  const startScan = async (): Promise<void> => {
    setDryRunResult(null)
    await app.scan({
      mode,
      categories: effectiveCategories,
      minAgeHours: maxAgeHours,
      exclusions,
      dryRun: false
    })
  }

  const runDryRun = async (): Promise<void> => {
    setRunningDryRun(true)
    try {
      const report = await api().cleaner.dryRun({
        mode,
        categories: effectiveCategories,
        minAgeHours: maxAgeHours,
        exclusions,
        dryRun: true
      })
      setDryRunResult(
        `Dry run preview — ${report.warnings[0] ?? ''} Nothing was deleted.`
      )
      app.notify('Dry-run preview finished. No files were deleted.', 'info')
    } catch (err) {
      app.notify(`Dry run failed: ${(err as Error).message}`, 'error')
    } finally {
      setRunningDryRun(false)
    }
  }

  const doClean = async (): Promise<void> => {
    if (!session.scan) return
    const bytes = session.scan.totalEligibleBytes
    const files = session.scan.totalEligibleFiles
    const confirmed = await app.confirmDestructive(
      'Confirm cleanup',
      `Delete up to ${files.toLocaleString()} files (${formatBytes(bytes)})?`,
      `Categories: ${session.scan.categories.map((c) => byId.get(c.category)?.name ?? c.category).join(', ')}\n\n` +
        `Every file is re-validated immediately before deletion. Locked files are skipped. Permanent deletion — files removed by this operation are not recoverable from the Recycle Bin unless the Recycle Bin category is used.\n\n` +
        `This analysis ran at ${new Date(session.scan.startedAt).toLocaleTimeString()}.`,
      'Delete files'
    )
    if (!confirmed) return
    await app.clean()
  }

  const scanning = session.phase === 'scanning'
  const cleaning = session.phase === 'cleaning' || session.phase === 'verifying'
  const busy = scanning || cleaning
  const active = busy || (progress?.phase !== 'idle' && progress !== null)

  const disk = metrics?.disk ?? null

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      {/* ------------------------------------------------- left: controls */}
      <div className="flex flex-col gap-3">
        <Panel glow className="overflow-hidden">
          <PanelHeader
            title={copy.title}
            subtitle={copy.detail}
            icon={<ShieldAlert size={15} />}
            right={
              <div className="flex items-center gap-2">
                <Badge tone="accent">{effectiveCategories.length} categories</Badge>
                <Badge>age ≥ {maxAgeHours}h</Badge>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Button variant="primary" onClick={startScan} disabled={busy} title={copy.blurb}>
              {scanning ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/40 border-t-black" /> Analysing…
                </>
              ) : (
                <>
                  <Play size={14} /> {copy.action}
                </>
              )}
            </Button>
            <Button onClick={doClean} disabled={!session.scan || busy || session.scan.cancelled}>
              <ArrowRight size={14} /> Clean now
            </Button>
            <Button onClick={runDryRun} disabled={busy || runningDryRun} title="Analyse and show what would happen, without deleting anything">
              {runningDryRun ? 'Previewing…' : 'Dry run preview'}
            </Button>
            <Button variant="danger" onClick={() => void app.cancel()} disabled={!busy}>
              <X size={14} /> Cancel
            </Button>
            {(session.report || session.scan) && (
              <Button variant="ghost" onClick={app.resetSession} disabled={busy} className="ml-auto text-[11px]">
                Reset
              </Button>
            )}
          </div>
          {dryRunResult && (
            <div className="mx-4 mb-3 rounded-lg border border-[color:var(--nx-accent)]/30 bg-[color:var(--nx-accent)]/8 px-3 py-2 text-[11px] text-[color:var(--nx-text)]">
              {dryRunResult}
            </div>
          )}
          {session.error && (
            <div className="mx-4 mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{session.error}</div>
          )}
        </Panel>

        {/* Live progress */}
        <AnimatePresence>
          {(busy || progress?.phase !== 'idle') && progress && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Panel>
                <PanelHeader
                  title="Live operation status"
                  subtitle={`${progress.currentTask || 'Working'}${progress.currentCategory ? ` · ${byId.get(progress.currentCategory)?.name ?? progress.currentCategory}` : ''}`}
                  right={<Badge tone={progress.phase === 'delete' ? 'warn' : 'accent'}>{progress.phase}</Badge>}
                />
                <div className="space-y-3 px-4 py-3">
                  <ProgressBar
                    value={progress.categoriesTotal.length > 0 ? (progress.categoriesDone.length / progress.categoriesTotal.length) * 100 : 0}
                    indeterminate={progress.categoriesTotal.length === 0}
                    label={`Categories ${progress.categoriesDone.length}/${progress.categoriesTotal.length || '?'} · elapsed ${formatDuration(progress.elapsedMs)}`}
                  />
                  <LiveMetricsStrip
                    items={[
                      { label: 'Scanned', value: progress.itemsScanned.toLocaleString() },
                      { label: 'Eligible', value: `${progress.itemsEligible.toLocaleString()} · ${formatBytes(progress.bytesEligible)}` },
                      { label: 'Removed', value: `${progress.filesDeleted.toLocaleString()} · ${formatBytes(progress.bytesDeleted)}` },
                      { label: 'Skipped / errors', value: `${progress.itemsSkipped.toLocaleString()} / ${progress.errors}` }
                    ]}
                  />
                  <div className="text-[10.5px] text-[color:var(--nx-text-dim)]">
                    Remaining work: {progress.estimatedRemainingMs === null ? 'not reliably estimable — showing indeterminate progress' : formatDuration(progress.estimatedRemainingMs)}
                  </div>
                </div>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Category selection / results */}
        <Panel>
          <PanelHeader
            title={mode === 'custom' ? 'Select categories' : 'Category analysis'}
            subtitle={
              mode === 'custom'
                ? 'Only ticked categories are analysed. Exclusions and the age filter always apply.'
                : 'Categories included in this mode. Expand a row to see exactly what it removes.'
            }
            right={
              mode === 'custom' ? (
                <div className="flex gap-1">
                  <Button className="!px-2 !py-1 !text-[11px]" onClick={() => setSelected(categories.filter((c) => c.available).map((c) => c.id))}>
                    All
                  </Button>
                  <Button className="!px-2 !py-1 !text-[11px]" onClick={() => setSelected([])}>
                    None
                  </Button>
                </div>
              ) : undefined
            }
          />
          <div className="divide-y divide-[color:var(--nx-border)]/60">
            {categories.length === 0 && (
              <EmptyState title="No categories resolved" hint="The cleaner could not resolve any cleanup locations on this system." />
            )}
            {categories.map((category) => {
              const result = session.scan?.categories.find((c) => c.category === category.id)
              const included = effectiveCategories.includes(category.id)
              const expanded = Boolean(expandedCats[category.id])
              const inMode = mode === 'custom' ? true : Boolean((mode === 'quick' ? category.quick : mode === 'smart' ? category.smart : category.deep))
              if (mode !== 'custom' && !inMode) return null
              return (
                <div key={category.id} className={`px-4 py-2.5 ${!category.available ? 'opacity-55' : ''}`}>
                  <div className="flex items-start gap-3">
                    {mode === 'custom' && (
                      <input
                        type="checkbox"
                        className="mt-1 h-3.5 w-3.5 accent-[color:var(--nx-accent)]"
                        checked={selected.includes(category.id)}
                        disabled={!category.available}
                        onChange={(e) =>
                          setSelected((prev) => (e.target.checked ? [...prev, category.id] : prev.filter((c) => c !== category.id)))
                        }
                        aria-label={`Include ${category.name}`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="flex items-center gap-1 text-left text-[13px] font-medium text-[color:var(--nx-text)] hover:text-[color:var(--nx-accent)]"
                          onClick={() => setExpandedCats((prev) => ({ ...prev, [category.id]: !prev[category.id] }))}
                          aria-expanded={expanded}
                        >
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          {category.name}
                        </button>
                        {category.risk === 'caution' && <Badge tone="warn">caution</Badge>}
                        {!category.available && <Badge>unavailable</Badge>}
                        {result && (
                          <span className="nx-mono text-[11px] text-[color:var(--nx-accent)]">
                            {result.eligibleFiles.toLocaleString()} files · {formatBytes(result.eligibleBytes)}
                          </span>
                        )}
                        {included && !result && <Badge tone="accent">included</Badge>}
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-[color:var(--nx-text-dim)]">{category.description}</p>
                      {!category.available && category.unavailableReason && (
                        <p className="mt-0.5 text-[11px] text-amber-300/80">{category.unavailableReason}</p>
                      )}
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 space-y-1.5 rounded-lg border border-[color:var(--nx-border)] bg-black/20 px-3 py-2 text-[11px]">
                              <div>
                                <span className="nx-label">What it removes</span>
                                <p className="mt-0.5 leading-relaxed text-[color:var(--nx-text)]">{category.removes}</p>
                              </div>
                              <div>
                                <span className="nx-label">Locations checked</span>
                                <ul className="nx-mono mt-0.5 space-y-0.5 text-[10.5px] text-[color:var(--nx-text-dim)]">
                                  {category.roots.length === 0 ? <li>None present</li> : category.roots.map((root) => <li key={root} className="truncate">{root}</li>)}
                                </ul>
                              </div>
                              {result && (
                                <div className="space-y-1 text-[10.5px] text-[color:var(--nx-text-dim)]">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                                    <span>scanned {result.scannedFiles.toLocaleString()}</span>
                                    <span>skipped {result.skippedFiles.toLocaleString()}</span>
                                    <span>errors {result.errorCount}</span>
                                    <span>took {formatDuration(result.durationMs)}</span>
                                  </div>
                                  {Object.keys(result.skipReasons ?? {}).length > 0 && (
                                    <div>
                                      <span className="nx-label">Why files were skipped</span>
                                      <ul className="mt-0.5 space-y-0.5">
                                        {Object.entries(result.skipReasons)
                                          .sort((a, b) => b[1] - a[1])
                                          .map(([reason, count]) => (
                                            <li key={reason}>
                                              {count.toLocaleString()} × {reason}
                                            </li>
                                          ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* Results */}
        {session.report && (
          <Panel glow>
            <PanelHeader
              title={session.report.cancelled ? 'Cleanup cancelled — partial results' : 'Cleanup results'}
              subtitle="Attempted, completed and independently verified values are reported separately."
              right={<Badge tone={session.report.totalFailed > 0 ? 'warn' : 'ok'}>{session.report.totalFailed > 0 ? 'completed with issues' : 'verified'}</Badge>}
            />
            <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-[color:var(--nx-border)] bg-[color:var(--nx-border)] sm:grid-cols-4">
              {[
                { label: 'Files removed', value: session.report.totalDeleted.toLocaleString() },
                { label: 'Bytes removed (actual)', value: formatBytes(session.report.totalBytesDeleted) },
                { label: 'Disk freed (measured)', value: session.report.verifiedBytesFreed === null ? '—' : formatBytes(session.report.verifiedBytesFreed) },
                { label: 'Skipped / failed', value: `${session.report.totalSkipped} / ${session.report.totalFailed}` }
              ].map((item) => (
                <div key={item.label} className="bg-[color:var(--nx-surface-2)] px-4 py-3">
                  <div className="nx-label">{item.label}</div>
                  <div className="nx-mono mt-1 text-sm font-semibold nx-text-accent">{item.value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 px-4 py-3 text-[11px] sm:grid-cols-3">
              <div>
                <span className="nx-label">Timings (measured separately)</span>
                <div className="nx-mono mt-1 space-y-0.5 text-[color:var(--nx-text-dim)]">
                  <div>scan {formatDuration(session.report.timings.scanMs)}</div>
                  <div>delete {formatDuration(session.report.timings.deleteMs)}</div>
                  <div>verify {formatDuration(session.report.timings.verifyMs)}</div>
                </div>
              </div>
              <div>
                <span className="nx-label">Disk before / after</span>
                <div className="nx-mono mt-1 space-y-0.5 text-[color:var(--nx-text-dim)]">
                  <div>before {session.report.diskBefore ? formatBytes(session.report.diskBefore.freeBytes) : '—'}</div>
                  <div>after {session.report.diskAfter ? formatBytes(session.report.diskAfter.freeBytes) : '—'}</div>
                </div>
              </div>
              <div>
                <span className="nx-label">Notes</span>
                <ul className="mt-1 space-y-0.5 text-[color:var(--nx-text-dim)]">
                  {session.report.warnings.length === 0 ? <li>No warnings recorded.</li> : session.report.warnings.map((w) => <li key={w}>• {w}</li>)}
                </ul>
              </div>
            </div>
            <div className="divide-y divide-[color:var(--nx-border)]/60 border-t border-[color:var(--nx-border)]">
              {session.report.results.map((r) => (
                <div key={r.category} className="flex flex-wrap items-center gap-3 px-4 py-1.5 text-[11px]">
                  <CheckCircle2 size={12} className={r.failed > 0 ? 'text-amber-400' : 'text-emerald-400'} />
                  <span className="w-40 shrink-0 font-medium">{byId.get(r.category)?.name ?? r.category}</span>
                  <span className="nx-mono text-[color:var(--nx-text-dim)]">
                    {r.deleted} removed · {formatBytes(r.bytesDeleted)} · {r.skipped} skipped · {r.failed} failed · {formatDuration(r.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {session.scan && !session.report && (
          <Panel>
            <PanelHeader
              title="Analysis results"
              subtitle="Nothing has been deleted yet. Review, then choose “Clean now”."
              right={
                <Button variant="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => setShowSample((v) => !v)}>
                  {showSample ? 'Hide' : 'Show'} sample files
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-px overflow-hidden bg-[color:var(--nx-border)] sm:grid-cols-4">
              {[
                { label: 'Eligible files', value: session.scan.totalEligibleFiles.toLocaleString() },
                { label: 'Eligible size (estimate)', value: formatBytes(session.scan.totalEligibleBytes) },
                { label: 'Files scanned', value: session.scan.totalScannedFiles.toLocaleString() },
                { label: 'Skipped by safety rules', value: session.scan.totalSkippedFiles.toLocaleString() }
              ].map((item) => (
                <div key={item.label} className="bg-[color:var(--nx-surface-2)] px-4 py-3">
                  <div className="nx-label">{item.label}</div>
                  <div className="nx-mono mt-1 text-sm font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
            {showSample && (
              <div className="max-h-64 overflow-auto px-4 py-2">
                <table className="nx-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th className="w-24">Size</th>
                      <th className="w-32">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.scan.categories
                      .flatMap((c) => c.sample)
                      .sort((a, b) => b.size - a.size)
                      .slice(0, 120)
                      .map((item) => (
                        <tr key={item.path}>
                          <td className="nx-mono max-w-[420px] truncate text-[10.5px]" title={item.path}>
                            {item.path}
                          </td>
                          <td className="nx-mono text-[10.5px]">{formatBytes(item.size)}</td>
                          <td className="text-[10.5px] text-[color:var(--nx-text-dim)]">{byId.get(item.category)?.name ?? item.category}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="py-2 text-[10.5px] text-[color:var(--nx-text-dim)]">
                  Showing a bounded sample. Sizes are exact per-file metadata; the total is an estimate until deletion completes.
                </p>
                <div className="pb-2 text-[10.5px] text-[color:var(--nx-text-dim)]">
                  <span className="nx-label">Skip reasons</span>{' '}
                  {Object.entries(
                    session.scan.categories.reduce<Record<string, number>>((acc, category) => {
                      for (const [reason, count] of Object.entries(category.skipReasons ?? {})) {
                        acc[reason] = (acc[reason] ?? 0) + count
                      }
                      return acc
                    }, {})
                  )
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => `${count} × ${reason}`)
                    .join(' · ') || 'none recorded'}
                </div>
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* ------------------------------------------------ right: holo + konsole */}
      <div className="flex flex-col gap-3">
        <Panel className="nx-scanlines nx-grid-bg relative overflow-hidden">
          <div className="h-[320px] w-full">
            <HolographicScanner
              progress={progress}
              reducedMotion={app.reducedMotion}
              intensity={app.animationIntensity}
              active={active}
              diskFree={disk?.freeBytes ?? null}
              diskTotal={disk?.totalBytes ?? null}
              accent={app.settings?.accent === 'blue' ? '#3b82f6' : app.settings?.accent === 'green' ? '#2ee6a8' : app.settings?.accent === 'violet' ? '#a78bfa' : '#22e6ff'}
            />
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'CPU', value: metrics ? `${metrics.cpuPercent.toFixed(1)}%` : '—', percent: metrics?.cpuPercent ?? 0 },
            { label: 'RAM', value: metrics ? `${metrics.memPercent.toFixed(1)}%` : '—', percent: metrics?.memPercent ?? 0 },
            { label: 'Disk used', value: disk ? `${disk.usedPercent.toFixed(1)}%` : '—', percent: disk?.usedPercent ?? 0 },
            { label: 'Net rx', value: metrics ? formatRate(metrics.netRxBytesPerSec) : '—', percent: null }
          ].map((item) => (
            <div key={item.label} className="nx-panel px-3 py-2">
              <div className="nx-label">{item.label}</div>
              <div className="nx-mono text-[13px] font-semibold">{item.value}</div>
              {item.percent !== null && (
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[color:var(--nx-border)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.percent)}%`, background: 'var(--nx-accent)' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        <Panel className="min-h-[240px] overflow-hidden">
          <OperationConsole events={events} onClear={app.clearEvents} height="h-52" />
        </Panel>

        {metricsHistory.length > 6 && <MiniSpark metrics={metricsHistory} />}

        {!meta?.isWindows && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
            <FileWarning size={14} className="mt-0.5 shrink-0" />
            <span>
              NEXUS Cleaner is running on <strong>{meta?.platform ?? 'an unknown platform'}</strong>. Windows-only categories (Windows temp, Delivery Optimization,
              Recycle Bin API) report as unavailable instead of inventing results.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniSpark({ metrics }: { metrics: { at: number; cpuPercent: number; memPercent: number }[] }): React.JSX.Element {
  const width = 320
  const height = 48
  const toPath = (key: 'cpuPercent' | 'memPercent'): string => {
    if (metrics.length < 2) return ''
    return metrics
      .map((m, i) => {
        const x = (i / (metrics.length - 1)) * width
        const y = height - (Math.min(100, m[key]) / 100) * height
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }
  return (
    <Panel className="px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="nx-label">CPU / RAM (last {metrics.length} samples)</span>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1 nx-text-accent">
            <span className="h-1.5 w-3 rounded" style={{ background: 'var(--nx-accent)' }} /> CPU
          </span>
          <span className="flex items-center gap-1 text-emerald-300">
            <span className="h-1.5 w-3 rounded bg-emerald-400" /> RAM
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height: 48 }}>
        <path d={toPath('cpuPercent')} fill="none" stroke="var(--nx-accent)" strokeWidth={1.4} />
        <path d={toPath('memPercent')} fill="none" stroke="#34d399" strokeWidth={1.4} opacity={0.85} />
      </svg>
    </Panel>
  )
}

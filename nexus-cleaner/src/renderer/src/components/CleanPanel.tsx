import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, X, ShieldAlert, ChevronDown, ChevronRight, ArrowRight, FileWarning, CheckCircle2 } from 'lucide-react'
import { useApp, useCategoriesById } from '../hooks/useAppState'
import { OperationConsole, LiveMetricsStrip } from './Console'
import { Badge, Button, EmptyState, InfoHint, Panel, PanelHeader, ProgressBar, Toggle, Tooltip } from './ui'
import { api, formatBytes, formatDuration } from '../lib/api'
import type { CategoryId, CleanReport, CleanupMode } from '@shared/types'

const MODE_COPY: Record<
  CleanupMode,
  { title: string; blurb: string; detail: string; action: string }
> = {
  quick: {
    title: 'Quick Scan',
    blurb: 'Lowest-risk categories only, tuned for speed.',
    detail:
      'Quick Scan analyses user temp, Windows temp, browser caches and thumbnail caches. Every candidate is re-validated before deletion, and locked files are skipped rather than forced.',
    action: 'Run Quick Scan'
  },
  smart: {
    title: 'Smart Scan',
    blurb: 'Balanced analysis across all safe categories.',
    detail:
      'Smart Scan adds application caches, crash dumps and error-reporting queues. It still never touches documents, downloads, photos, saved passwords or cookies.',
    action: 'Run Smart Scan'
  },
  deep: {
    title: 'Full Scan',
    blurb: 'Broader analysis — deeper checks, same safety rules.',
    detail:
      'Full Scan widens the inspection to Delivery Optimization caches, font caches and rotated diagnostic logs. “Full” means broader analysis, never more reckless deletion.',
    action: 'Run Full Scan'
  },
  custom: {
    title: 'Custom Scan',
    blurb: 'You pick exactly which categories are analysed.',
    detail:
      'Custom Clean uses only the categories you tick below. Exclusions and the file-age filter from Settings still apply.',
    action: 'Run Custom Scan'
  }
}

export function CleanPanel({
  mode,
  autoStart = 0
}: {
  mode: CleanupMode
  /** Monotonic token from a home-screen scan button; each new value starts one scan. */
  autoStart?: number
}): React.JSX.Element {
  const app = useApp()
  const byId = useCategoriesById()
  const copy = MODE_COPY[mode]
  const { settings, categories, session, progress, events, meta } = app

  const [selected, setSelected] = useState<CategoryId[]>([])
  // Keep the home screen quiet: the long category list is collapsed until a
  // scan actually produced results, or until the user asks for it.
  const [showCategories, setShowCategories] = useState(false)
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

  const startedRef = useRef(0)

  // A scan button on the home screen is a real trigger, not decoration.
  useEffect(() => {
    if (autoStart <= 0 || startedRef.current === autoStart) return
    startedRef.current = autoStart
    void startScan()
    // startScan is recreated per render; the token is the only trigger we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

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

  const zeroEligible = Boolean(session.scan && !session.scan.cancelled && session.scan.totalEligibleFiles === 0)
  const busyNow = session.phase === 'scanning' || session.phase === 'cleaning' || session.phase === 'verifying'
  const cleanDisabledReason = !session.scan
    ? 'Run a scan first'
    : session.scan.cancelled
      ? 'The last scan was cancelled'
      : zeroEligible
        ? 'Nothing qualified for deletion under the current rules'
        : busyNow
          ? 'An operation is already running'
          : undefined

  const scanning = session.phase === 'scanning'
  const cleaning = session.phase === 'cleaning' || session.phase === 'verifying'
  const busy = scanning || cleaning
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
                <Badge tone="accent">
                  {effectiveCategories.length} {effectiveCategories.length === 1 ? 'category' : 'categories'}
                </Badge>
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
            <Button
              onClick={doClean}
              disabled={!session.scan || busy || session.scan.cancelled || zeroEligible}
              title={cleanDisabledReason}
            >
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
          {zeroEligible && (
            <div className="mx-4 mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-[11px] leading-relaxed text-emerald-200/90">
              No file passed the safety checks: every location was empty of files older than {maxAgeHours}h, or candidates were rejected by path,
              exclusion or lock checks. Cleanup is disabled because there is genuinely nothing to delete.
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
              <div className="flex gap-1">
                {mode === 'custom' && (
                  <>
                    <Button className="!px-2 !py-1 !text-[11px]" onClick={() => setSelected(categories.filter((c) => c.available).map((c) => c.id))}>
                      All
                    </Button>
                    <Button className="!px-2 !py-1 !text-[11px]" onClick={() => setSelected([])}>
                      None
                    </Button>
                  </>
                )}
                <Button
                  className="!px-2 !py-1 !text-[11px]"
                  onClick={() => setShowCategories((v) => !v)}
                  aria-expanded={showCategories || Boolean(session.scan) || mode === 'custom'}
                >
                  {showCategories ? 'Hide' : 'Show'} categories
                </Button>
              </div>
            }
          />
          {!(showCategories || session.scan || mode === 'custom') && (
            <p className="px-4 py-3 text-[11px] leading-relaxed text-[color:var(--nx-text-dim)]">
              {effectiveCategories.length} {effectiveCategories.length === 1 ? 'category is' : 'categories are'} included in this scan. Expand the list to see
              what each one removes and which locations are checked.
            </p>
          )}
          <div className={`divide-y divide-[color:var(--nx-border)]/60 ${showCategories || session.scan || mode === 'custom' ? '' : 'hidden'}`}>
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
            <div className="border-b border-[color:var(--nx-border)] px-4 py-3 text-[11px]">
              <span className="nx-label">Why files were skipped during cleanup</span>
              {(() => {
                const reasons = aggregateReportSkips(session.report!)
                return Object.keys(reasons).length === 0 ? (
                  <p className="mt-1 text-[color:var(--nx-text-dim)]">
                    {session.report!.totalSkipped === 0
                      ? 'No file was skipped — every attempted file was removed and independently verified.'
                      : 'Reasons were not recorded for this operation (older history record).'}
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-[color:var(--nx-text-dim)]">
                    {Object.entries(reasons)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count]) => (
                        <li key={reason}>
                          <span className="nx-mono text-[color:var(--nx-text)]">{count.toLocaleString()}</span> × {reason}
                        </li>
                      ))}
                  </ul>
                )
              })()}
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

      {/* --------------------------------------------------- right: live data */}
      <div className="flex flex-col gap-3">
        <Panel>
          <PanelHeader
            title="This scan"
            subtitle="Counters below are pushed by the cleaner while it works. They are never simulated."
            right={
              progress && progress.phase !== 'idle' ? (
                <Badge tone={progress.phase === 'delete' ? 'warn' : 'accent'}>{progress.phase}</Badge>
              ) : (
                <Badge>idle</Badge>
              )
            }
          />
          <div className="grid grid-cols-2 gap-px overflow-hidden bg-[color:var(--nx-border)]">
            {[
              { label: 'Files seen', value: progress ? progress.itemsScanned.toLocaleString() : '—' },
              { label: 'Eligible', value: progress ? progress.itemsEligible.toLocaleString() : '—' },
              { label: 'Eligible size', value: progress ? formatBytes(progress.bytesEligible) : '—' },
              { label: 'Removed', value: progress ? `${progress.filesDeleted.toLocaleString()} · ${formatBytes(progress.bytesDeleted)}` : '—' }
            ].map((item) => (
              <div key={item.label} className="bg-[color:var(--nx-surface-2)] px-3 py-2">
                <div className="nx-label">{item.label}</div>
                <div className="nx-mono mt-0.5 text-[13px] font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
          {!progress && (
            <p className="px-3 py-2 text-[10.5px] leading-relaxed text-[color:var(--nx-text-dim)]">
              No operation is running. Start one of the three scans on the home screen.
            </p>
          )}
        </Panel>

        <Panel className="min-h-[240px] overflow-hidden">
          <OperationConsole events={events} onClear={app.clearEvents} height="h-52" />
        </Panel>

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

/**
 * Sums skip reasons across every category of a cleanup report. The engine
 * records one reason per skipped file, so the total here always equals
 * `report.totalSkipped`.
 */
export function aggregateReportSkips(report: CleanReport): Record<string, number> {
  const out: Record<string, number> = {}
  for (const result of report.results) {
    for (const [reason, count] of Object.entries(result.skipReasons ?? {})) {
      out[reason] = (out[reason] ?? 0) + count
    }
  }
  return out
}

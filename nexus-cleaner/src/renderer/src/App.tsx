import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, LayoutGrid, ShieldCheck } from 'lucide-react'
import { useApp, type PageId } from './hooks/useAppState'
import { Toast } from './components/ui'
import { AllFeatures } from './components/AllFeatures'
import { FEATURE_BY_ID, FEATURES } from './lib/navigation'
import { HomePage } from './pages/HomePage'
import { StoragePage } from './pages/StoragePage'
import { DuplicatesPage } from './pages/DuplicatesPage'
import { StartupPage } from './pages/StartupPage'
import { BrowserPage } from './pages/BrowserPage'
import { MonitorPage } from './pages/MonitorPage'
import { NetworkPage } from './pages/NetworkPage'
import { SoftwarePage } from './pages/SoftwarePage'
import { SchedulerPage } from './pages/SchedulerPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'

/** Every non-home page is still its original component with its original IPC. */
const PAGE_COMPONENTS: Record<Exclude<PageId, 'home'>, React.ComponentType> = {
  browser: BrowserPage,
  storage: StoragePage,
  duplicates: DuplicatesPage,
  monitor: MonitorPage,
  network: NetworkPage,
  startup: StartupPage,
  software: SoftwarePage,
  scheduler: SchedulerPage,
  history: HistoryPage,
  settings: SettingsPage
}

export default function App(): React.JSX.Element {
  const app = useApp()
  const { page, setPage, meta, toast, ready, reducedMotion, session } = app
  const [featuresOpen, setFeaturesOpen] = useState(false)

  const current = page === 'home' ? null : FEATURE_BY_ID.get(page) ?? null

  const scanState = useMemo(() => {
    if (session.phase === 'idle') return null
    const label =
      session.phase === 'scanning'
        ? 'Analysing'
        : session.phase === 'cleaning'
          ? 'Deleting'
          : session.phase === 'verifying'
            ? 'Verifying'
            : session.phase === 'done'
              ? 'Completed'
              : session.phase === 'ready'
                ? 'Review ready'
                : 'Error'
    return { label, phase: session.phase }
  }, [session.phase])

  // Ctrl/Cmd+K opens the feature drawer; Ctrl/Cmd+H (or Esc from a page) goes home.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setFeaturesOpen((v) => !v)
        return
      }
      if (key === 'h') {
        e.preventDefault()
        setPage('home')
        setFeaturesOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPage])

  const openPage = (target: PageId): void => {
    setPage(target)
    setFeaturesOpen(false)
  }

  const PageComponent = page === 'home' ? null : PAGE_COMPONENTS[page]

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[color:var(--nx-surface)]">
      {/* ----------------------------------------------------------- top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[color:var(--nx-border)] px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => openPage('home')}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors duration-150 hover:bg-[color:var(--nx-surface-2)]"
          aria-label="NEXUS Cleaner home"
          data-testid="home-button"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--nx-accent)]/40 text-[color:var(--nx-accent)]">
            <ShieldCheck size={15} />
          </span>
          <span className="leading-tight">
            <span className="block text-[12.5px] font-semibold tracking-wide text-[color:var(--nx-text)]">NEXUS Cleaner</span>
            <span className="block text-[10px] text-[color:var(--nx-text-dim)]">v{meta?.version ?? '1.0.0'}</span>
          </span>
        </button>

        {page !== 'home' && (
          <>
            <span className="h-5 w-px bg-[color:var(--nx-border)]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => openPage('home')}
              className="flex items-center gap-1.5 rounded-lg border border-[color:var(--nx-border)] px-2 py-1 text-[11px] text-[color:var(--nx-text-dim)] transition-colors duration-150 hover:border-[color:var(--nx-accent)]/45 hover:text-[color:var(--nx-accent)]"
              data-testid="back-home-button"
            >
              <ArrowLeft size={12} /> Home
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[12.5px] font-semibold text-[color:var(--nx-text)]">{current?.label ?? 'Feature'}</h1>
              <p className="truncate text-[10px] text-[color:var(--nx-text-dim)]">{current?.description}</p>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {scanState && (
            <span className="nx-chip border-[color:var(--nx-accent)]/40 nx-text-accent" title="Real operation state, not a decorative animation">
              {scanState.label}
            </span>
          )}
          <span
            className="nx-chip hidden sm:inline-flex"
            title="Operations run at normal user rights; elevation is never requested automatically"
          >
            user level
          </span>
          <span
            className="nx-chip hidden md:inline-flex"
            title={`Electron ${meta?.electron ?? '—'} · Chromium ${meta?.chrome ?? '—'}`}
          >
            Electron {meta?.electron ?? '—'}
          </span>
          <button
            type="button"
            onClick={() => setFeaturesOpen(true)}
            className="nx-btn !px-2.5 !py-1.5 !text-[11.5px]"
            aria-haspopup="dialog"
            aria-expanded={featuresOpen}
            data-testid="all-features-button"
          >
            <LayoutGrid size={13} /> All features
            <span className="nx-chip !px-1.5 !py-0 !text-[9.5px]">{FEATURES.length}</span>
          </button>
        </div>
      </header>

      {/* -------------------------------------------------------------- body */}
      <main className="relative min-h-0 flex-1 overflow-auto p-3">
        {!ready ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div
                className={`h-8 w-8 rounded-full border-2 border-[color:var(--nx-border)] border-t-[color:var(--nx-accent)] ${reducedMotion ? '' : 'animate-spin'}`}
              />
              <p className="text-xs text-[color:var(--nx-text-dim)]">Starting NEXUS services…</p>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={page}
              initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
              transition={{ duration: reducedMotion ? 0 : 0.15, ease: 'easeOut' }}
            >
              {page === 'home' || !PageComponent ? <HomePage /> : <PageComponent />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      <AllFeatures open={featuresOpen} onClose={() => setFeaturesOpen(false)} onSelect={openPage} current={page} />
      <Toast toast={toast} onClose={() => app.notify('', 'info')} />
    </div>
  )
}

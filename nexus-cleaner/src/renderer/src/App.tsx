import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar, NAV_ITEMS } from './components/Sidebar'
import { useApp, type PageId } from './hooks/useAppState'
import { Toast } from './components/ui'
import { Dashboard } from './pages/Dashboard'
import { CleanPage } from './pages/CleanPage'
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

const PAGE_COMPONENTS: Record<PageId, React.ComponentType> = {
  dashboard: Dashboard,
  quick: () => <CleanPage mode="quick" />,
  smart: () => <CleanPage mode="smart" />,
  deep: () => <CleanPage mode="deep" />,
  storage: StoragePage,
  duplicates: DuplicatesPage,
  startup: StartupPage,
  browser: BrowserPage,
  monitor: MonitorPage,
  network: NetworkPage,
  software: SoftwarePage,
  scheduler: SchedulerPage,
  history: HistoryPage,
  settings: SettingsPage
}

export default function App(): React.JSX.Element {
  const app = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const { page, setPage, meta, toast, ready } = app
  const current = NAV_ITEMS.find((item) => item.id === page)
  const PageComponent = PAGE_COMPONENTS[page]

  // Ctrl/Cmd + 1..9 quick navigation, Ctrl+K jumps to Quick Clean
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPage('quick')
        return
      }
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        e.preventDefault()
        const target = NAV_ITEMS[n - 1]
        if (target) setPage(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPage])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[color:var(--nx-surface)]">
      <Sidebar
        page={page}
        setPage={setPage}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        version={meta?.version ?? '1.0.0'}
        isWindows={Boolean(meta?.isWindows)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[color:var(--nx-border)] px-4 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-semibold tracking-wide text-[color:var(--nx-text)]">{current?.label ?? 'Dashboard'}</h1>
            <p className="truncate text-[11px] text-[color:var(--nx-text-dim)]">{current?.hint}</p>
          </div>
          <div className="flex items-center gap-2 text-[10.5px] text-[color:var(--nx-text-dim)]">
            {app.session.phase !== 'idle' && (
              <span className="nx-chip border-[color:var(--nx-accent)]/40 nx-text-accent">{app.session.phase}</span>
            )}
            <span className="nx-chip" title="Operations run at normal user rights; elevation is never requested automatically">
              user level
            </span>
            <span className="nx-chip" title={`Electron ${meta?.electron ?? '—'} · Chromium ${meta?.chrome ?? '—'}`}>
              v{meta?.version ?? '1.0.0'}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-3">
          {!ready ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--nx-border)] border-t-[color:var(--nx-accent)]" />
                <p className="text-xs text-[color:var(--nx-text-dim)]">Starting NEXUS services…</p>
              </div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: app.reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
              >
                <PageComponent />
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </main>
      <Toast toast={toast} onClose={() => app.notify('', 'info')} />
    </div>
  )
}

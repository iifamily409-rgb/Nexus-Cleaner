import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppMeta,
  AppSettings,
  CategoryId,
  CleanReport,
  CleanupCategory,
  HistoryRecord,
  LiveProgress,
  MetricsSnapshot,
  OperationEvent,
  ScanOptions,
  ScanReport
} from '@shared/types'
import { api, isDesktop } from '../lib/api'

export type PageId =
  | 'dashboard'
  | 'quick'
  | 'smart'
  | 'deep'
  | 'storage'
  | 'duplicates'
  | 'startup'
  | 'browser'
  | 'monitor'
  | 'network'
  | 'software'
  | 'scheduler'
  | 'history'
  | 'settings'

export interface ClearSession {
  phase: 'idle' | 'scanning' | 'ready' | 'cleaning' | 'verifying' | 'done' | 'error'
  scan: ScanReport | null
  report: CleanReport | null
  error: string | null
}

interface AppContextValue {
  ready: boolean
  meta: AppMeta | null
  settings: AppSettings | null
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  resetSettings: () => Promise<void>
  categories: CleanupCategory[]
  metrics: MetricsSnapshot | null
  metricsHistory: MetricsSnapshot[]
  progress: LiveProgress | null
  events: OperationEvent[]
  clearEvents: () => void
  page: PageId
  setPage: (page: PageId) => void
  reducedMotion: boolean
  animationIntensity: AppSettings['animationIntensity']
  // cleaning orchestration
  scan: (options: ScanOptions) => Promise<ScanReport | null>
  clean: () => Promise<CleanReport | null>
  cancel: () => Promise<void>
  resetSession: () => void
  session: ClearSession
  busy: boolean
  history: HistoryRecord[]
  refreshHistory: () => Promise<void>
  toast: { id: number; message: string; level: 'info' | 'success' | 'error' | 'warn' } | null
  notify: (message: string, level?: 'info' | 'success' | 'error' | 'warn') => void
  confirmDestructive: (title: string, message: string, detail: string, confirmLabel: string) => Promise<boolean>
}

const AppContext = createContext<AppContextValue | null>(null)

export const useApp = (): AppContextValue => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [meta, setMeta] = useState<AppMeta | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [categories, setCategories] = useState<CleanupCategory[]>([])
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([])
  const [progress, setProgress] = useState<LiveProgress | null>(null)
  const [events, setEvents] = useState<OperationEvent[]>([])
  const [page, setPage] = useState<PageId>('dashboard')
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [session, setSession] = useState<ClearSession>({ phase: 'idle', scan: null, report: null, error: null })
  const [toast, setToast] = useState<AppContextValue['toast']>(null)
  const toastTimer = useRef<number | null>(null)

  const notify = useCallback((message: string, level: 'info' | 'success' | 'error' | 'warn' = 'info') => {
    setToast({ id: Date.now(), message, level })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 6000)
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      const client = api()
      try {
        const [info, loadedSettings, cats, metricsNow, records] = await Promise.all([
          client.app.info(),
          client.settings.get(),
          client.cleaner.categories(),
          client.monitor.metrics(),
          client.history.list()
        ])
        if (cancelled) return
        setMeta(info)
        setSettings(loadedSettings)
        setCategories(cats)
        setMetrics(metricsNow)
        setHistory(records)
      } catch (err) {
        if (!cancelled) notify(`Startup error: ${(err as Error).message}`, 'error')
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [notify])

  // live streams from the main process
  useEffect(() => {
    const client = api()
    const offMetrics = client.events.onMetrics((snapshot) => {
      setMetrics(snapshot)
      setMetricsHistory((prev) => {
        const next = [...prev, snapshot]
        return next.length > 90 ? next.slice(next.length - 90) : next
      })
    })
    const offProgress = client.events.onProgress((p) => setProgress(p))
    const offNavigate = client.events.onNavigate((target) => {
      const known: PageId[] = [
        'dashboard',
        'quick',
        'smart',
        'deep',
        'storage',
        'duplicates',
        'startup',
        'browser',
        'monitor',
        'network',
        'software',
        'scheduler',
        'history',
        'settings'
      ]
      if (known.includes(target as PageId)) setPage(target as PageId)
    })
    const offEvent = client.events.onEvent((e) =>
      setEvents((prev) => {
        const next = [...prev, e]
        return next.length > 400 ? next.slice(next.length - 400) : next
      })
    )
    return () => {
      offMetrics()
      offProgress()
      offEvent()
      offNavigate()
    }
  }, [])

  // theme + accent + motion application
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.classList.toggle('dark', settings.theme === 'dark')
    root.classList.toggle('light', settings.theme === 'light')
    root.dataset.accent = settings.accent
    const motionOff = settings.reducedMotion || settings.animationIntensity === 'off'
    root.classList.toggle('nx-no-motion', motionOff)
    root.dataset.motion = settings.reducedMotion ? 'reduced' : settings.animationIntensity
  }, [settings])

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const client = api()
      try {
        const next = await client.settings.set(patch)
        setSettings(next)
      } catch (err) {
        notify(`Could not save settings: ${(err as Error).message}`, 'error')
      }
    },
    [notify]
  )

  const resetSettings = useCallback(async () => {
    const next = await api().settings.reset()
    setSettings(next)
    notify('Settings restored to defaults', 'success')
  }, [notify])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api().history.list())
    } catch {
      /* non fatal */
    }
  }, [])

  const confirmDestructive = useCallback(
    async (title: string, message: string, detail: string, confirmLabel: string): Promise<boolean> => {
      if (settings?.confirmDestructive === false && isDesktop()) {
        return window.confirm(`${title}\n\n${message}`)
      }
      return api().dialog.confirm({ title, message, detail, confirmLabel })
    },
    [settings?.confirmDestructive]
  )

  const scan = useCallback(
    async (options: ScanOptions): Promise<ScanReport | null> => {
      setSession({ phase: 'scanning', scan: null, report: null, error: null })
      setEvents([])
      try {
        const report = await api().cleaner.scan(options)
        setSession({ phase: report.cancelled ? 'idle' : 'ready', scan: report, report: null, error: null })
        await refreshHistory()
        return report
      } catch (err) {
        setSession({ phase: 'error', scan: null, report: null, error: (err as Error).message })
        notify(`Scan failed: ${(err as Error).message}`, 'error')
        return null
      }
    },
    [notify, refreshHistory]
  )

  const clean = useCallback(async (): Promise<CleanReport | null> => {
    const current = session.scan
    if (!current) {
      notify('Run a scan first — nothing to clean.', 'warn')
      return null
    }
    setSession((prev) => ({ ...prev, phase: 'cleaning' }))
    try {
      const report = await api().cleaner.clean(current.id)
      setSession((prev) => ({ ...prev, phase: report.cancelled ? 'ready' : 'done', report }))
      await refreshHistory()
      if (report.cancelled) notify('Cleanup cancelled. Partial results recorded in Activity History.', 'warn')
      else notify(`Removed ${report.totalDeleted} files (${(report.totalBytesDeleted / 1048576).toFixed(1)} MB)`, 'success')
      return report
    } catch (err) {
      setSession((prev) => ({ ...prev, phase: 'ready', error: (err as Error).message }))
      notify(`Cleanup failed: ${(err as Error).message}`, 'error')
      return null
    }
  }, [session.scan, notify, refreshHistory])

  const cancel = useCallback(async () => {
    const opId = progress?.opId ?? session.scan?.id
    if (!opId) return
    await api().cleaner.cancel(opId)
    notify('Cancellation requested…', 'warn')
  }, [progress?.opId, session.scan?.id, notify])

  const resetSession = useCallback(() => {
    setSession({ phase: 'idle', scan: null, report: null, error: null })
  }, [])

  const busy = session.phase === 'scanning' || session.phase === 'cleaning' || session.phase === 'verifying'
  const reducedMotion = Boolean(settings?.reducedMotion)
  const animationIntensity = settings?.animationIntensity ?? 'full'

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      meta,
      settings,
      updateSettings,
      resetSettings,
      categories,
      metrics,
      metricsHistory,
      progress,
      events,
      clearEvents: () => setEvents([]),
      page,
      setPage,
      reducedMotion,
      animationIntensity,
      scan,
      clean,
      cancel,
      resetSession,
      session,
      busy,
      history,
      refreshHistory,
      toast,
      notify,
      confirmDestructive
    }),
    [
      ready,
      meta,
      settings,
      updateSettings,
      resetSettings,
      categories,
      metrics,
      metricsHistory,
      progress,
      events,
      page,
      reducedMotion,
      animationIntensity,
      scan,
      clean,
      cancel,
      resetSession,
      session,
      busy,
      history,
      refreshHistory,
      toast,
      notify,
      confirmDestructive
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useCategoriesById = (): Map<CategoryId, CleanupCategory> => {
  const { categories } = useApp()
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
}

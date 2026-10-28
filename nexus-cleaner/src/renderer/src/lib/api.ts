import type { ElectronAPI } from '@shared/types'

/**
 * Renderer-side access to the preload bridge.
 * When the renderer is opened outside Electron (design preview / browser),
 * we fall back to a clearly-labelled demo stub so the UI can still be
 * inspected. The stub never reports fake cleanup successes: every mutating
 * call rejects with "Unavailable outside the desktop app".
 */

export const isDesktop = (): boolean => typeof window !== 'undefined' && typeof window.nexus !== 'undefined'

const UNAVAILABLE = 'Unavailable: NEXUS Cleaner must run inside the desktop app (Electron) to touch the filesystem.'

function createStub(): ElectronAPI {
  const emptySettings = {
    theme: 'dark' as const,
    accent: 'cyan' as const,
    animationIntensity: 'full' as const,
    reducedMotion: false,
    refreshIntervalMs: 2000,
    defaultMode: 'smart' as const,
    enabledCategories: ['user-temp', 'windows-temp', 'app-caches', 'browser-cache', 'thumbnails'] as never,
    exclusions: [],
    maxAgeHours: 24,
    historyRetentionDays: 90,
    confirmDestructive: true,
    schedule: {
      enabled: false,
      mode: 'quick' as const,
      categories: ['user-temp'] as never,
      frequency: 'weekly' as const,
      hour: 3,
      minute: 0,
      notify: true,
      maxAgeHours: 24
    }
  }
  const metrics = () => ({
    at: Date.now(),
    cpuPercent: 0,
    memTotalBytes: 0,
    memUsedBytes: 0,
    memPercent: 0,
    disk: null,
    diskReadBytesPerSec: null,
    diskWriteBytesPerSec: null,
    uptimeSec: 0,
    loadAvg: [0, 0, 0] as [number, number, number],
    battery: null,
    netRxBytesPerSec: null,
    netTxBytesPerSec: null,
    processCount: 0
  })
  return {
    app: {
      info: async () => ({
        version: '1.0.0',
        electron: '—',
        chrome: '—',
        node: '—',
        platform: 'browser',
        isWindows: false,
        elevated: false,
        userDataPath: '—'
      }),
      openPath: async () => ({ ok: false, error: UNAVAILABLE }),
      showItemInFolder: async () => ({ ok: false, error: UNAVAILABLE })
    },
    settings: {
      get: async () => emptySettings,
      set: async (patch) => ({ ...emptySettings, ...patch }),
      reset: async () => emptySettings
    },
    cleaner: {
      categories: async () => [],
      scan: async () => {
        throw new Error(UNAVAILABLE)
      },
      clean: async () => {
        throw new Error(UNAVAILABLE)
      },
      dryRun: async () => {
        throw new Error(UNAVAILABLE)
      },
      cancel: async () => false
    },
    monitor: {
      metrics: async () => metrics(),
      processes: async () => [],
      startup: async () => [],
      setStartupEnabled: async () => ({ ok: false, error: UNAVAILABLE }),
      battery: async () => null
    },
    browser: { list: async () => [] },
    storage: {
      scan: async () => {
        throw new Error(UNAVAILABLE)
      },
      cancel: async () => false,
      exportReport: async () => ({ ok: false, error: UNAVAILABLE })
    },
    duplicates: {
      scan: async () => {
        throw new Error(UNAVAILABLE)
      },
      delete: async () => {
        throw new Error(UNAVAILABLE)
      },
      cancel: async () => false
    },
    system: {
      info: async () => {
        throw new Error(UNAVAILABLE)
      },
      updateCheck: async () => ({ ok: false, message: UNAVAILABLE, pending: null }),
      integrityCheck: async () => ({ ok: false, message: UNAVAILABLE, stdout: '' })
    },
    network: {
      diagnostics: async () => {
        throw new Error(UNAVAILABLE)
      },
      throughput: async () => ({ ok: false, downMbps: null, upMbps: null, message: UNAVAILABLE })
    },
    history: {
      list: async () => [],
      clear: async () => undefined,
      export: async () => ({ ok: false, error: UNAVAILABLE })
    },
    schedule: {
      get: async () => emptySettings.schedule,
      set: async (config) => config,
      runNow: async () => null
    },
    events: {
      onProgress: () => () => undefined,
      onEvent: () => () => undefined,
      onMetrics: () => () => undefined,
      onNavigate: () => () => undefined,
      onScheduleFired: () => () => undefined
    },
    dialog: {
      pickFolders: async () => [],
      confirm: async () => false
    },
    platform: 'browser' as NodeJS.Platform,
    version: '1.0.0'
  }
}

let stub: ElectronAPI | null = null

export const api = (): ElectronAPI => {
  if (isDesktop()) return window.nexus
  if (!stub) stub = createStub()
  return stub
}

export const formatBytes = (bytes: number | null | undefined, decimals = 1): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

export const formatRate = (bytesPerSec: number | null | undefined): string => {
  if (bytesPerSec === null || bytesPerSec === undefined) return '—'
  return `${formatBytes(bytesPerSec, 1)}/s`
}

export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

export const formatDurationLong = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export const formatDateTime = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

export const shortPath = (p: string, max = 64): string => {
  if (p.length <= max) return p
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(sep)
  const file = parts.pop() ?? ''
  const head = parts.slice(0, 2).join(sep)
  return `${head}${sep}…${sep}${file}`
}

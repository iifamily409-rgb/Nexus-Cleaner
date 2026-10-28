import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type {
  AppMeta,
  AppSettings,
  BatteryStatus,
  BrowserInfo,
  CleanReport,
  CleanupCategory,
  DuplicateScanResult,
  ElectronAPI,
  HistoryRecord,
  LiveProgress,
  MetricsSnapshot,
  NetworkDiagnostics,
  OperationEvent,
  ProcessInfo,
  ScanOptions,
  ScanReport,
  ScheduleConfig,
  StartupEntry,
  StorageScanResult,
  SystemInfoReport,
  DeleteResult
} from '@shared/types'

/**
 * PRELOAD BRIDGE
 * The renderer gets this exact object and nothing else. There is no
 * `ipcRenderer`, no `require`, no `process`, and no way to invoke an
 * unlisted channel: every method below maps to one hard-coded channel.
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

const subscribe = <T>(channel: string, handler: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ElectronAPI = {
  app: {
    info: () => invoke<AppMeta>(IPC.APP_INFO),
    openPath: (p: string) => invoke<{ ok: boolean; error?: string }>(IPC.APP_OPEN_PATH, p),
    showItemInFolder: (p: string) => invoke<{ ok: boolean; error?: string }>(IPC.APP_SHOW_ITEM, p)
  },
  settings: {
    get: () => invoke<AppSettings>(IPC.SETTINGS_GET),
    set: (patch) => invoke<AppSettings>(IPC.SETTINGS_SET, patch),
    reset: () => invoke<AppSettings>(IPC.SETTINGS_RESET)
  },
  cleaner: {
    categories: () => invoke<CleanupCategory[]>(IPC.CLEAN_CATEGORIES),
    scan: (options: ScanOptions) => invoke<ScanReport>(IPC.CLEAN_SCAN, options),
    clean: (scanId: string) => invoke<CleanReport>(IPC.CLEAN_RUN, scanId),
    dryRun: (options: ScanOptions) => invoke<CleanReport>(IPC.CLEAN_DRY_RUN, options),
    cancel: (opId: string) => invoke<boolean>(IPC.CLEAN_CANCEL, opId)
  },
  monitor: {
    metrics: () => invoke<MetricsSnapshot>(IPC.MONITOR_METRICS),
    processes: () => invoke<ProcessInfo[]>(IPC.MONITOR_PROCESSES),
    startup: () => invoke<StartupEntry[]>(IPC.MONITOR_STARTUP),
    setStartupEnabled: (id: string, enabled: boolean) =>
      invoke<{ ok: boolean; error?: string; entry?: StartupEntry }>(IPC.MONITOR_STARTUP_TOGGLE, { id, enabled }),
    battery: () => invoke<BatteryStatus | null>(IPC.MONITOR_BATTERY)
  },
  browser: {
    list: () => invoke<BrowserInfo[]>(IPC.BROWSER_LIST)
  },
  storage: {
    scan: (root: string, maxDepth: number) => invoke<StorageScanResult>(IPC.STORAGE_SCAN, { root, maxDepth }),
    cancel: (opId: string) => invoke<boolean>(IPC.STORAGE_CANCEL, opId),
    exportReport: (report: StorageScanResult) => invoke<{ ok: boolean; path?: string; error?: string }>(IPC.STORAGE_EXPORT, { report })
  },
  duplicates: {
    scan: (roots: string[], minSizeBytes: number) => invoke<DuplicateScanResult>(IPC.DUP_SCAN, { roots, minSizeBytes }),
    delete: (paths: string[], keepPerGroup: number) => invoke<DeleteResult>(IPC.DUP_DELETE, { paths, keepPerGroup }),
    cancel: (opId: string) => invoke<boolean>(IPC.DUP_CANCEL, opId)
  },
  system: {
    info: () => invoke<SystemInfoReport>(IPC.SYSTEM_INFO),
    updateCheck: () => invoke<{ ok: boolean; message: string; pending: number | null }>(IPC.SYSTEM_UPDATE_CHECK),
    integrityCheck: () => invoke<{ ok: boolean; message: string; stdout: string }>(IPC.SYSTEM_INTEGRITY)
  },
  network: {
    diagnostics: () => invoke<NetworkDiagnostics>(IPC.NET_DIAGNOSTICS),
    throughput: () => invoke<{ ok: boolean; downMbps: number | null; upMbps: number | null; message: string }>(IPC.NET_THROUGHPUT)
  },
  history: {
    list: () => invoke<HistoryRecord[]>(IPC.HISTORY_LIST),
    clear: () => invoke<{ ok: boolean }>(IPC.HISTORY_CLEAR).then(() => undefined),
    export: () => invoke<{ ok: boolean; path?: string; error?: string }>(IPC.HISTORY_EXPORT)
  },
  schedule: {
    get: () => invoke<ScheduleConfig>(IPC.SCHEDULE_GET),
    set: (config: ScheduleConfig) => invoke<ScheduleConfig>(IPC.SCHEDULE_SET, config),
    runNow: () => invoke<CleanReport | null>(IPC.SCHEDULE_RUN_NOW)
  },
  events: {
    onProgress: (handler) => subscribe<LiveProgress>(EVENTS.PROGRESS, handler),
    onEvent: (handler) => subscribe<OperationEvent>(EVENTS.EVENT, handler),
    onMetrics: (handler) => subscribe<MetricsSnapshot>(EVENTS.METRICS, handler),
    onNavigate: (handler) => subscribe<string>(EVENTS.NAVIGATE, handler),
    onScheduleFired: (handler) => subscribe<HistoryRecord>(EVENTS.SCHEDULE_FIRED, handler)
  },
  dialog: {
    pickFolders: () => invoke<string[]>(IPC.DIALOG_PICK_FOLDERS),
    confirm: (opts) => invoke<boolean>(IPC.DIALOG_CONFIRM, opts)
  },
  platform: process.platform,
  version: '1.0.0'
}

// contextIsolation is on; this is the only object crossing the boundary.
contextBridge.exposeInMainWorld('nexus', api)

/**
 * Shared type contracts between main, preload and renderer.
 * Everything crossing the IPC bridge is described here.
 */

export type CleanupMode = 'quick' | 'smart' | 'deep' | 'custom'

export type CategoryId =
  | 'user-temp'
  | 'windows-temp'
  | 'app-caches'
  | 'browser-cache'
  | 'thumbnails'
  | 'crash-dumps'
  | 'error-reports'
  | 'recycle-bin'
  | 'delivery-optimization'
  | 'font-cache'
  | 'log-artifacts'

export type RiskLevel = 'safe' | 'caution'

export interface CleanupCategory {
  id: CategoryId
  name: string
  description: string
  /** What exactly is removed — shown verbatim in the UI before any delete. */
  removes: string
  risk: RiskLevel
  /** Whether the category is part of Quick Clean (fast, lowest risk). */
  quick: boolean
  /** Whether the category is included in Smart Clean. */
  smart: boolean
  /** Included only in Deep Analysis / Custom. */
  deep: boolean
  /** Requires a specific browser/app to be detected. */
  requires?: 'browser'
  /** Root locations this category may touch (for audit display). */
  roots: string[]
  available: boolean
  /** Reason why unavailable (wrong platform, permissions, etc.) */
  unavailableReason?: string
}

export interface ScanOptions {
  mode: CleanupMode
  categories?: CategoryId[]
  /** Only files older than this many hours are eligible. */
  minAgeHours: number
  /** Absolute folder paths that must never be touched. */
  exclusions: string[]
  /** Deep mode: also count files inside archives-adjacent caches, etc. */
  followAppSubdirs?: boolean
  /** Dry run performs analysis only and never deletes. */
  dryRun?: boolean
}

export interface ScanItem {
  path: string
  size: number
  mtimeMs: number
  category: CategoryId
  /** Containers (root folders) are useful for drill-down. */
  source: string
}

export interface CategoryScanResult {
  category: CategoryId
  eligibleFiles: number
  eligibleBytes: number
  scannedFiles: number
  skippedFiles: number
  errorCount: number
  /** Top-level folders that were inspected. */
  roots: string[]
  /** A bounded sample of eligible items for the preview list. */
  sample: ScanItem[]
  /** Why files were skipped, aggregated by reason. Shown in the UI. */
  skipReasons: Record<string, number>
  durationMs: number
  truncated: boolean
}

export interface ScanReport {
  id: string
  mode: CleanupMode
  startedAt: number
  endedAt: number
  categories: CategoryScanResult[]
  totalEligibleFiles: number
  totalEligibleBytes: number
  totalScannedFiles: number
  totalSkippedFiles: number
  /** Sum of every category's skip reasons; always equals `totalSkippedFiles`. */
  skipReasons: Record<string, number>
  errors: string[]
  cancelled: boolean
  diskBefore: DiskUsage | null
  options: ScanOptions
  platform: string
}

export interface DeleteResult {
  category: CategoryId
  attempted: number
  deleted: number
  bytesDeleted: number
  skipped: number
  failed: number
  /**
   * Why each skipped file was skipped, counted by reason. Every skip recorded
   * here also increments `skipped`, so the totals always reconcile.
   */
  skipReasons: Record<string, number>
  errors: string[]
  durationMs: number
}

export interface CleanReport {
  id: string
  scanId: string
  mode: CleanupMode
  startedAt: number
  endedAt: number
  results: DeleteResult[]
  totalDeleted: number
  totalBytesDeleted: number
  totalAttempted: number
  totalSkipped: number
  totalFailed: number
  diskBefore: DiskUsage | null
  diskAfter: DiskUsage | null
  verifiedBytesFreed: number | null
  cancelled: boolean
  /** Timings reported separately, never merged. */
  timings: { scanMs: number; deleteMs: number; verifyMs: number }
  warnings: string[]
}

export interface DiskUsage {
  mount: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
  usedPercent: number
}

export interface MetricsSnapshot {
  at: number
  cpuPercent: number
  memTotalBytes: number
  memUsedBytes: number
  memPercent: number
  disk: DiskUsage | null
  diskReadBytesPerSec: number | null
  diskWriteBytesPerSec: number | null
  uptimeSec: number
  loadAvg: [number, number, number]
  battery: BatteryStatus | null
  netRxBytesPerSec: number | null
  netTxBytesPerSec: number | null
  processCount: number
}

export interface BatteryStatus {
  hasBattery: boolean
  percent: number | null
  charging: boolean | null
  minutesRemaining: number | null
}

export interface ProcessInfo {
  pid: number
  name: string
  cpuPercent: number
  memBytes: number
  user: string
  command: string
  protected: boolean
}

export interface StartupEntry {
  id: string
  name: string
  command: string
  executable: string | null
  location: string
  source: StartupSource
  publisher: string | null
  enabled: boolean
  /** Whether we can toggle it without elevation. */
  controllable: boolean
  risk: 'safe' | 'caution' | 'critical'
  note: string
}

export type StartupSource =
  | 'HKCU Run'
  | 'HKLM Run'
  | 'Startup Folder (User)'
  | 'Startup Folder (Common)'
  | 'systemd user unit'
  | 'XDG autostart'

export interface BrowserInfo {
  id: string
  name: string
  detected: boolean
  running: boolean
  profileDataPaths: string[]
  cachePaths: { path: string; label: string; exists: boolean }[]
  supported: boolean
}

export interface StorageNode {
  name: string
  path: string
  size: number
  fileCount: number
  dirCount: number
  children?: StorageNode[]
  depth: number
  isDir: boolean
  denied?: boolean
}

export interface StorageScanResult {
  root: string
  startedAt: number
  endedAt: number
  totalBytes: number
  totalFiles: number
  totalDirs: number
  tree: StorageNode
  largestFiles: StorageNode[]
  categories: { label: string; bytes: number; fileCount: number }[]
  cancelled: boolean
  errors: string[]
}

export interface DuplicateGroup {
  hash: string
  size: number
  files: { path: string; mtimeMs: number }[]
  wastedBytes: number
}

export interface DuplicateScanResult {
  roots: string[]
  startedAt: number
  endedAt: number
  filesConsidered: number
  filesHashed: number
  groups: DuplicateGroup[]
  totalWastedBytes: number
  cancelled: boolean
  errors: string[]
  protectedSkipped: number
}

export interface InstalledApp {
  name: string
  version: string | null
  publisher: string | null
  installDate: string | null
  estimatedSizeBytes: number | null
  location: string | null
  source: 'Windows Registry' | 'dpkg' | 'desktop entry'
}

export interface DiskHealthInfo {
  device: string
  model: string | null
  sizeBytes: number | null
  health: string
  status: string
  temperatureC: number | null
  source: string
}

export interface SystemInfoReport {
  generatedAt: number
  platform: string
  osVersion: string
  release: string
  arch: string
  cpuModel: string
  cpuCores: number
  totalMemBytes: number
  hostname: string
  uptimeSec: number
  gpus: string[]
  disks: DiskUsage[]
  health: DiskHealthInfo[]
  apps: InstalledApp[]
  startup: StartupEntry[]
  notes: string[]
}

export interface NetworkAdapter {
  name: string
  address: string | null
  family: string | null
  internal: boolean
  mac: string | null
  speedMbps: number | null
}

export interface NetworkDiagnostics {
  at: number
  adapters: NetworkAdapter[]
  online: boolean
  latencyMs: number | null
  dnsResolutionMs: number | null
  dnsServers: string[]
  rxBytesPerSec: number | null
  txBytesPerSec: number | null
  throughputTest: { downMbps: number; upMbps: number; measured: boolean; note: string } | null
  recommendations: string[]
}

export interface ScheduleConfig {
  enabled: boolean
  mode: CleanupMode
  categories: CategoryId[]
  frequency: 'daily' | 'weekly' | 'monthly'
  hour: number
  minute: number
  notify: boolean
  maxAgeHours: number
}

export interface AppSettings {
  theme: 'dark' | 'light'
  accent: 'cyan' | 'blue' | 'green' | 'violet'
  animationIntensity: 'full' | 'reduced' | 'off'
  reducedMotion: boolean
  refreshIntervalMs: number
  defaultMode: CleanupMode
  enabledCategories: CategoryId[]
  exclusions: string[]
  maxAgeHours: number
  historyRetentionDays: number
  confirmDestructive: boolean
  schedule: ScheduleConfig
}

export interface HistoryRecord {
  id: string
  kind: 'scan' | 'clean' | 'duplicate' | 'storage' | 'startup' | 'diagnostics'
  at: number
  mode: CleanupMode | null
  categories: CategoryId[]
  estimatedBytes: number
  actualBytes: number
  verifiedBytesFreed: number | null
  scannedFiles: number
  deletedFiles: number
  skippedFiles: number
  errors: string[]
  cancelled: boolean
  durationMs: number
  diskBefore: DiskUsage | null
  diskAfter: DiskUsage | null
  summary: string
}

export interface OperationEvent {
  opId: string
  at: number
  type:
    | 'start'
    | 'progress'
    | 'category-start'
    | 'category-end'
    | 'delete-progress'
    | 'verify'
    | 'complete'
    | 'cancelled'
    | 'error'
    | 'log'
  category?: CategoryId
  message: string
  level: 'info' | 'warn' | 'error' | 'success'
  data?: Record<string, number | string | boolean | null>
}

export interface LiveProgress {
  opId: string
  phase: 'scan' | 'delete' | 'verify' | 'idle'
  currentTask: string
  currentCategory: CategoryId | null
  itemsScanned: number
  itemsEligible: number
  bytesEligible: number
  filesDeleted: number
  bytesDeleted: number
  itemsSkipped: number
  errors: number
  elapsedMs: number
  /** Null means unknown — the UI must show an indeterminate indicator. */
  estimatedRemainingMs: number | null
  categoriesDone: CategoryId[]
  categoriesTotal: CategoryId[]
}

export interface ElectronAPI {
  app: {
    info(): Promise<AppMeta>
    openPath(path: string): Promise<{ ok: boolean; error?: string }>
    showItemInFolder(path: string): Promise<{ ok: boolean; error?: string }>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  cleaner: {
    categories(): Promise<CleanupCategory[]>
    scan(options: ScanOptions): Promise<ScanReport>
    clean(scanId: string): Promise<CleanReport>
    dryRun(options: ScanOptions): Promise<CleanReport>
    cancel(opId: string): Promise<boolean>
  }
  monitor: {
    metrics(): Promise<MetricsSnapshot>
    processes(): Promise<ProcessInfo[]>
    startup(): Promise<StartupEntry[]>
    setStartupEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string; entry?: StartupEntry }>
    battery(): Promise<BatteryStatus | null>
  }
  browser: {
    list(): Promise<BrowserInfo[]>
  }
  storage: {
    scan(root: string, maxDepth: number): Promise<StorageScanResult>
    cancel(opId: string): Promise<boolean>
    exportReport(result: StorageScanResult): Promise<{ ok: boolean; path?: string; error?: string }>
  }
  duplicates: {
    scan(roots: string[], minSizeBytes: number): Promise<DuplicateScanResult>
    delete(paths: string[], keepPerGroup: number): Promise<DeleteResult>
    cancel(opId: string): Promise<boolean>
  }
  system: {
    info(): Promise<SystemInfoReport>
    updateCheck(): Promise<{ ok: boolean; message: string; pending: number | null }>
    integrityCheck(): Promise<{ ok: boolean; message: string; stdout: string }>
  }
  network: {
    diagnostics(): Promise<NetworkDiagnostics>
    throughput(): Promise<{ ok: boolean; downMbps: number | null; upMbps: number | null; message: string }>
  }
  history: {
    list(): Promise<HistoryRecord[]>
    clear(): Promise<void>
    export(): Promise<{ ok: boolean; path?: string; error?: string }>
  }
  schedule: {
    get(): Promise<ScheduleConfig>
    set(config: ScheduleConfig): Promise<ScheduleConfig>
    runNow(): Promise<CleanReport | null>
  }
  events: {
    onProgress(handler: (p: LiveProgress) => void): () => void
    onEvent(handler: (e: OperationEvent) => void): () => void
    onMetrics(handler: (m: MetricsSnapshot) => void): () => void
    onNavigate(handler: (page: string) => void): () => void
    onScheduleFired(handler: (r: HistoryRecord) => void): () => void
  }
  dialog: {
    pickFolders(): Promise<string[]>
    confirm(opts: { title: string; message: string; detail: string; confirmLabel: string }): Promise<boolean>
  }
  platform: NodeJS.Platform
  version: string
}

export interface AppMeta {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  isWindows: boolean
  elevated: boolean
  userDataPath: string
}

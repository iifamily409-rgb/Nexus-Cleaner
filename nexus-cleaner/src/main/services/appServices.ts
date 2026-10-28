import path from 'node:path'
import os from 'node:os'
import { CleanerEngine } from './cleanerEngine'
import { SystemMonitor } from './systemMonitor'
import { StartupManager } from './startupManager'
import { BrowserService } from './browserService'
import { StorageAnalyzer } from './storageAnalyzer'
import { DuplicateFinder } from './duplicateFinder'
import { SystemInfoService } from './systemInfo'
import { NetworkDiagnosticsService } from './networkDiagnostics'
import { HistoryStore, SettingsStore } from './settingsStore'
import { CleanupScheduler } from './scheduler'
import type { AppSettings, HistoryRecord, LiveProgress, MetricsSnapshot, OperationEvent } from '@shared/types'

export interface Emitter {
  progress: (p: LiveProgress) => void
  event: (e: OperationEvent) => void
  metrics: (m: MetricsSnapshot) => void
  scheduleFired: (r: HistoryRecord) => void
}

/** A no-op emitter used until the window registers its channels. */
const nullEmitter: Emitter = {
  progress: () => undefined,
  event: () => undefined,
  metrics: () => undefined,
  scheduleFired: () => undefined
}

/**
 * Composition root for the main process. Everything is instantiated once and
 * shared through validated IPC handlers.
 */
export class AppServices {
  static instances = new Set<AppServices>()

  readonly settings: SettingsStore
  readonly history: HistoryStore
  readonly monitor: SystemMonitor
  readonly startup: StartupManager
  readonly browser: BrowserService
  readonly storage: StorageAnalyzer
  readonly duplicates: DuplicateFinder
  readonly systemInfo: SystemInfoService
  readonly network: NetworkDiagnosticsService
  readonly cleaner: CleanerEngine
  readonly scheduler: CleanupScheduler
  emitter: Emitter = nullEmitter
  private metricsTimer: NodeJS.Timeout | null = null
  private metricsInterval = 2000
  private userDataDir: string

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir
    this.settings = new SettingsStore(userDataDir)
    this.history = new HistoryStore(userDataDir)
    this.monitor = new SystemMonitor()
    this.startup = new StartupManager()
    this.browser = new BrowserService()
    this.storage = new StorageAnalyzer()
    this.duplicates = new DuplicateFinder()
    this.systemInfo = new SystemInfoService()
    this.network = new NetworkDiagnosticsService()
    this.cleaner = new CleanerEngine({
      emitProgress: (p) => this.emitter.progress(p),
      emitEvent: (e) => this.emitter.event(e)
    })
    this.scheduler = new CleanupScheduler({
      engine: this.cleaner,
      getSettings: () => this.settings.get(),
      onRecord: (record) => {
        void this.history.add(record)
      },
      onFired: (record) => this.emitter.scheduleFired(record)
    })
    AppServices.instances.add(this)
  }

  async init(): Promise<void> {
    const settings = await this.settings.get()
    this.metricsInterval = settings.refreshIntervalMs
    await this.history.pruneOlderThan(settings.historyRetentionDays)
    this.scheduler.start()
    this.startMetricsLoop()
  }

  startMetricsLoop(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer)
    // Prime the CPU delta so the first emitted sample is meaningful.
    void this.monitor.snapshot()
    this.metricsTimer = setInterval(() => {
      void this.monitor
        .snapshot()
        .then((snapshot) => this.emitter.metrics(snapshot))
        .catch(() => undefined)
    }, this.metricsInterval)
    if (typeof this.metricsTimer.unref === 'function') this.metricsTimer.unref()
  }

  async applySettings(settings: AppSettings): Promise<void> {
    if (settings.refreshIntervalMs !== this.metricsInterval) {
      this.metricsInterval = settings.refreshIntervalMs
      this.startMetricsLoop()
    }
  }

  private async metricsSnapshotSafe(): Promise<MetricsSnapshot> {
    try {
      return await this.monitor.snapshot()
    } catch {
      return {
        at: Date.now(),
        cpuPercent: 0,
        memTotalBytes: os.totalmem(),
        memUsedBytes: 0,
        memPercent: 0,
        disk: null,
        diskReadBytesPerSec: null,
        diskWriteBytesPerSec: null,
        uptimeSec: os.uptime(),
        loadAvg: [0, 0, 0],
        battery: null,
        netRxBytesPerSec: null,
        netTxBytesPerSec: null,
        processCount: 0
      }
    }
  }

  metricsSafe(): Promise<MetricsSnapshot> {
    return this.metricsSnapshotSafe()
  }

  reportsDir(): string {
    return path.join(this.userDataDir, 'reports')
  }

  async shutdown(): Promise<void> {
    this.cleaner.cancelAll()
    this.storage.cancelAll()
    this.duplicates.cancelAll()
    this.scheduler.stop()
    if (this.metricsTimer) clearInterval(this.metricsTimer)
  }

  static async shutdownAll(): Promise<void> {
    for (const instance of AppServices.instances) await instance.shutdown()
  }
}

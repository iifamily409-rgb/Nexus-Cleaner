import type { AppSettings, CleanReport, HistoryRecord, ScheduleConfig } from '@shared/types'
import type { CleanerEngine } from './cleanerEngine'

/**
 * CLEANUP SCHEDULER
 * An in-process timer (no OS-level task registration, so nothing runs behind
 * the user's back after uninstall). A scheduled run only ever covers the
 * categories the user explicitly opted into, and always respects the age
 * filter and exclusions from settings.
 */

const TICK_MS = 30_000

export interface SchedulerDeps {
  engine: CleanerEngine
  getSettings: () => Promise<AppSettings>
  onRecord: (record: HistoryRecord) => void
  onFired: (record: HistoryRecord) => void
  now?: () => number
}

export class CleanupScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastRunKey: string | null = null
  private running = false

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, TICK_MS)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    void this.tick()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Returns the next scheduled Date for a config, or null when disabled. */
  static nextRunAt(config: ScheduleConfig, from: Date = new Date()): Date | null {
    if (!config.enabled) return null
    const candidate = new Date(from)
    candidate.setSeconds(0, 0)
    candidate.setHours(config.hour, config.minute, 0, 0)
    if (candidate.getTime() <= from.getTime()) {
      if (config.frequency === 'daily') candidate.setDate(candidate.getDate() + 1)
      else if (config.frequency === 'weekly') candidate.setDate(candidate.getDate() + 7)
      else candidate.setMonth(candidate.getMonth() + 1)
    } else if (config.frequency === 'weekly') {
      // Weekly runs on the day the schedule was configured; keep it simple:
      // next occurrence within 7 days at the chosen time.
      const days = (candidate.getTime() - from.getTime()) / 86_400_000
      if (days > 7) candidate.setDate(candidate.getDate() - 7)
    }
    return candidate
  }

  private keyFor(date: Date, config: ScheduleConfig): string {
    const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    if (config.frequency === 'daily') return `d:${day}`
    if (config.frequency === 'weekly') {
      const week = Math.floor(date.getTime() / (7 * 86_400_000))
      return `w:${week}`
    }
    return `m:${date.getFullYear()}-${date.getMonth() + 1}`
  }

  /** Evaluated on a timer; also called directly by tests. */
  async tick(nowInput?: Date): Promise<CleanReport | null> {
    if (this.running) return null
    const settings = await this.deps.getSettings()
    const config = settings.schedule
    if (!config.enabled) return null
    if (config.categories.length === 0) return null

    const now = nowInput ?? new Date(this.deps.now ? this.deps.now() : Date.now())
    const next = CleanupScheduler.nextRunAt(config, new Date(now.getTime() - 86_400_000 * 40))
    if (!next) return null

    // Due when the most recent scheduled instant is within the last 24h and
    // we have not already executed that period.
    const due = now.getTime() >= next.getTime() && now.getTime() - next.getTime() < 86_400_000
    if (!due) return null
    const key = this.keyFor(next, config)
    if (this.lastRunKey === key) return null

    this.running = true
    this.lastRunKey = key
    try {
      const scan = await this.deps.engine.scan({
        mode: 'custom',
        categories: config.categories,
        minAgeHours: config.maxAgeHours,
        exclusions: settings.exclusions
      })
      const report = await this.deps.engine.run(scan.id)
      const record: HistoryRecord = {
        id: report.id,
        kind: 'clean',
        at: Date.now(),
        mode: 'custom',
        categories: report.results.map((r) => r.category),
        estimatedBytes: scan.totalEligibleBytes,
        actualBytes: report.totalBytesDeleted,
        verifiedBytesFreed: report.verifiedBytesFreed,
        scannedFiles: scan.totalScannedFiles,
        deletedFiles: report.totalDeleted,
        skippedFiles: report.totalSkipped,
        errors: report.results.flatMap((r) => r.errors).slice(0, 30),
        cancelled: report.cancelled,
        durationMs: report.endedAt - report.startedAt,
        diskBefore: report.diskBefore,
        diskAfter: report.diskAfter,
        summary: `Scheduled cleanup removed ${report.totalDeleted} files (${report.totalBytesDeleted} bytes)`
      }
      this.deps.onRecord(record)
      this.deps.onFired(record)
      return report
    } catch {
      return null
    } finally {
      this.running = false
    }
  }

  /** Manual "run now", used by the Scheduler page button. */
  async runNow(): Promise<CleanReport | null> {
    const settings = await this.deps.getSettings()
    const config = settings.schedule
    if (config.categories.length === 0) return null
    this.running = true
    try {
      const scan = await this.deps.engine.scan({
        mode: 'custom',
        categories: config.categories,
        minAgeHours: config.maxAgeHours,
        exclusions: settings.exclusions
      })
      const report = await this.deps.engine.run(scan.id)
      const record: HistoryRecord = {
        id: report.id,
        kind: 'clean',
        at: Date.now(),
        mode: 'custom',
        categories: report.results.map((r) => r.category),
        estimatedBytes: scan.totalEligibleBytes,
        actualBytes: report.totalBytesDeleted,
        verifiedBytesFreed: report.verifiedBytesFreed,
        scannedFiles: scan.totalScannedFiles,
        deletedFiles: report.totalDeleted,
        skippedFiles: report.totalSkipped,
        errors: report.results.flatMap((r) => r.errors).slice(0, 30),
        cancelled: report.cancelled,
        durationMs: report.endedAt - report.startedAt,
        diskBefore: report.diskBefore,
        diskAfter: report.diskAfter,
        summary: `Manual scheduled cleanup removed ${report.totalDeleted} files`
      }
      this.deps.onRecord(record)
      return report
    } finally {
      this.running = false
    }
  }

  get isRunning(): boolean {
    return this.running
  }
}

import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings, CategoryId, CleanupMode, HistoryRecord, ScheduleConfig } from '@shared/types'

/**
 * Local, dependency-free persistence. JSON files under Electron's userData.
 * Atomic writes (tmp + rename) so a crash cannot corrupt settings.
 */

export const DEFAULT_CATEGORIES: CategoryId[] = [
  'user-temp',
  'windows-temp',
  'app-caches',
  'browser-cache',
  'thumbnails',
  'crash-dumps',
  'error-reports'
]

export const defaultSettings = (): AppSettings => ({
  theme: 'dark',
  accent: 'cyan',
  animationIntensity: 'full',
  reducedMotion: false,
  refreshIntervalMs: 2000,
  defaultMode: 'smart',
  enabledCategories: [...DEFAULT_CATEGORIES],
  exclusions: [],
  maxAgeHours: 24,
  historyRetentionDays: 90,
  confirmDestructive: true,
  schedule: {
    enabled: false,
    mode: 'quick',
    categories: ['user-temp', 'thumbnails'],
    frequency: 'weekly',
    hour: 3,
    minute: 0,
    notify: true,
    maxAgeHours: 24
  }
})

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const VALID_MODES: CleanupMode[] = ['quick', 'smart', 'deep', 'custom']

function sanitizeSettings(input: Partial<AppSettings> | null, base: AppSettings): AppSettings {
  if (!input) return base
  const merged: AppSettings = { ...base, ...input }
  merged.theme = input.theme === 'light' ? 'light' : input.theme === 'dark' ? 'dark' : base.theme
  merged.accent = ['cyan', 'blue', 'green', 'violet'].includes(input.accent ?? '')
    ? (input.accent as AppSettings['accent'])
    : base.accent
  merged.animationIntensity = ['full', 'reduced', 'off'].includes(input.animationIntensity ?? '')
    ? (input.animationIntensity as AppSettings['animationIntensity'])
    : base.animationIntensity
  if (typeof input.reducedMotion !== 'boolean') merged.reducedMotion = base.reducedMotion
  if (typeof input.refreshIntervalMs === 'number') {
    merged.refreshIntervalMs = Math.min(60_000, Math.max(500, Math.round(input.refreshIntervalMs)))
  } else merged.refreshIntervalMs = base.refreshIntervalMs
  merged.defaultMode =
    input.defaultMode && VALID_MODES.includes(input.defaultMode) ? input.defaultMode : base.defaultMode
  merged.enabledCategories = Array.isArray(input.enabledCategories)
    ? input.enabledCategories.filter((c) => typeof c === 'string')
    : base.enabledCategories
  merged.exclusions = Array.isArray(input.exclusions)
    ? input.exclusions.filter((e) => typeof e === 'string' && e.length > 0).slice(0, 500)
    : base.exclusions
  merged.maxAgeHours = typeof input.maxAgeHours === 'number' ? Math.max(0, Math.min(175_200, input.maxAgeHours)) : base.maxAgeHours
  merged.historyRetentionDays =
    typeof input.historyRetentionDays === 'number'
      ? Math.max(1, Math.min(3650, Math.round(input.historyRetentionDays)))
      : base.historyRetentionDays
  if (typeof input.confirmDestructive !== 'boolean') merged.confirmDestructive = base.confirmDestructive

  const sc = input.schedule
  if (sc && typeof sc === 'object') {
    const sched: ScheduleConfig = {
      enabled: Boolean(sc.enabled),
      mode: VALID_MODES.includes(sc.mode) ? sc.mode : base.schedule.mode,
      categories: Array.isArray(sc.categories) ? sc.categories : base.schedule.categories,
      frequency: ['daily', 'weekly', 'monthly'].includes(sc.frequency) ? sc.frequency : base.schedule.frequency,
      hour: Math.max(0, Math.min(23, Math.round(Number(sc.hour) || 0))),
      minute: Math.max(0, Math.min(59, Math.round(Number(sc.minute) || 0))),
      notify: Boolean(sc.notify),
      maxAgeHours: Math.max(0, Math.min(175_200, Number(sc.maxAgeHours) || 0))
    }
    merged.schedule = sched
  } else {
    merged.schedule = base.schedule
  }
  return merged
}

export class SettingsStore {
  private file: string
  private cache: AppSettings | null = null

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'settings.json')
  }

  async get(): Promise<AppSettings> {
    if (this.cache) return this.cache
    const stored = await readJson<Partial<AppSettings>>(this.file)
    this.cache = sanitizeSettings(stored, defaultSettings())
    return this.cache
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get()
    const next = sanitizeSettings({ ...current, ...patch }, current)
    this.cache = next
    await writeJsonAtomic(this.file, next)
    return next
  }

  async reset(): Promise<AppSettings> {
    this.cache = defaultSettings()
    await writeJsonAtomic(this.file, this.cache)
    return this.cache
  }
}

export class HistoryStore {
  private file: string
  private items: HistoryRecord[] = []
  private loaded = false
  private readonly maxRecords = 500

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'history.json')
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    const raw = await readJson<HistoryRecord[]>(this.file)
    this.items = Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === 'string') : []
    this.loaded = true
  }

  async list(): Promise<HistoryRecord[]> {
    await this.load()
    return [...this.items].sort((a, b) => b.at - a.at)
  }

  async add(record: HistoryRecord): Promise<void> {
    await this.load()
    this.items.push(record)
    if (this.items.length > this.maxRecords) this.items = this.items.slice(-this.maxRecords)
    await writeJsonAtomic(this.file, this.items)
  }

  async clear(): Promise<void> {
    this.items = []
    this.loaded = true
    await writeJsonAtomic(this.file, this.items)
  }

  async pruneOlderThan(days: number): Promise<number> {
    await this.load()
    const cutoff = Date.now() - days * 86_400_000
    const before = this.items.length
    this.items = this.items.filter((r) => r.at >= cutoff)
    if (this.items.length !== before) await writeJsonAtomic(this.file, this.items)
    return before - this.items.length
  }

  async exportTo(destination: string): Promise<string> {
    await this.load()
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'NEXUS Cleaner',
      recordCount: this.items.length,
      records: [...this.items].sort((a, b) => b.at - a.at)
    }
    await fs.writeFile(destination, JSON.stringify(payload, null, 2), 'utf8')
    return destination
  }
}

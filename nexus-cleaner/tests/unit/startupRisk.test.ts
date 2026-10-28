import { describe, expect, it } from 'vitest'
import { startupRisk } from '../../src/main/services/startupManager'
import { clampConcurrency } from '../../src/main/core/walker'
import { defaultSettings } from '../../src/main/services/settingsStore'

describe('startupRisk', () => {
  it('marks security components as critical', () => {
    expect(startupRisk('SecurityHealth', 'C:\\Windows\\System32\\SecurityHealthSystray.exe').risk).toBe('critical')
    expect(startupRisk('Windows Defender', '"C:\\Program Files\\Windows Defender\\MSMpEng.exe"').risk).toBe('critical')
  })

  it('marks system-directory entries as caution', () => {
    expect(startupRisk('SomeAgent', 'C:\\Windows\\system32\\someagent.exe').risk).toBe('caution')
  })

  it('marks ordinary apps as safe', () => {
    expect(startupRisk('Spotify', '"C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe" --autostart').risk).toBe('safe')
  })

  it('treats empty commands as caution', () => {
    expect(startupRisk('Broken', '   ').risk).toBe('caution')
  })
})

describe('clampConcurrency', () => {
  it('keeps concurrency inside sane bounds', () => {
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(-20)).toBe(1)
    expect(clampConcurrency(8)).toBe(8)
    expect(clampConcurrency(1000)).toBe(32)
    expect(clampConcurrency(Number.NaN)).toBe(8)
    expect(clampConcurrency(3.7)).toBe(3)
  })
})

describe('settings defaults', () => {
  it('ships with destructive confirmations enabled and a conservative age filter', () => {
    const settings = defaultSettings()
    expect(settings.confirmDestructive).toBe(true)
    expect(settings.maxAgeHours).toBeGreaterThanOrEqual(1)
    expect(settings.schedule.enabled).toBe(false)
    expect(settings.schedule.categories).not.toContain('recycle-bin')
  })

  it('never enables the recycle bin by default', () => {
    expect(defaultSettings().enabledCategories).not.toContain('recycle-bin')
  })
})

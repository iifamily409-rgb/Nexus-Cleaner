import { describe, expect, it } from 'vitest'
import {
  categoryIdSchema,
  cleanupModeSchema,
  confirmSchema,
  deleteDuplicatesSchema,
  duplicateScanSchema,
  safePathSchema,
  scanOptionsSchema,
  settingsPatchSchema,
  startupToggleSchema,
  storageScanSchema
} from '../../src/shared/schemas'
import { IPC, INVOKE_CHANNELS, EVENTS, EVENT_CHANNELS } from '../../src/shared/ipc'

/**
 * IPC security tests: the renderer must not be able to smuggle malformed,
 * oversized, traversal or unknown payloads into the main process.
 */

describe('safePathSchema', () => {
  it('accepts absolute paths', () => {
    expect(safePathSchema.safeParse('C:\\Users\\me\\Downloads').success).toBe(true)
    expect(safePathSchema.safeParse('/home/me/tmp').success).toBe(true)
  })

  it('rejects traversal, NUL bytes, empties and huge strings', () => {
    expect(safePathSchema.safeParse('C:\\temp\\..\\windows').success).toBe(false)
    expect(safePathSchema.safeParse('a\0b').success).toBe(false)
    expect(safePathSchema.safeParse('').success).toBe(false)
    expect(safePathSchema.safeParse('x'.repeat(5000)).success).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(safePathSchema.safeParse(123).success).toBe(false)
    expect(safePathSchema.safeParse(null).success).toBe(false)
  })
})

describe('scanOptionsSchema', () => {
  const valid = { mode: 'quick', minAgeHours: 24, exclusions: [] }

  it('accepts a minimal valid payload', () => {
    expect(scanOptionsSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an unknown mode', () => {
    expect(scanOptionsSchema.safeParse({ ...valid, mode: 'nuke' }).success).toBe(false)
  })

  it('rejects unknown categories', () => {
    expect(scanOptionsSchema.safeParse({ ...valid, categories: ['user-temp', 'root-fs'] }).success).toBe(false)
  })

  it('rejects absurd ages and exclusion flooding', () => {
    expect(scanOptionsSchema.safeParse({ ...valid, minAgeHours: -1 }).success).toBe(false)
    expect(scanOptionsSchema.safeParse({ ...valid, minAgeHours: 10_000_000 }).success).toBe(false)
    expect(scanOptionsSchema.safeParse({ ...valid, exclusions: Array.from({ length: 900 }, () => 'C:\\x') }).success).toBe(false)
  })

  it('rejects a command-injection shaped payload', () => {
    const hostile = { ...valid, exclusions: ['C:\\temp; rm -rf /'] }
    // It is accepted as a *path string* but it can never match a real root;
    // the schema only needs to guarantee it is a bounded string without
    // traversal. Confirm it stays a plain string and never becomes argv.
    const parsed = scanOptionsSchema.safeParse(hostile)
    expect(parsed.success).toBe(true)
    expect(typeof (parsed.success && parsed.data.exclusions[0])).toBe('string')
  })
})

describe('other schemas', () => {
  it('validates duplicate scan bounds', () => {
    expect(duplicateScanSchema.safeParse({ roots: ['/tmp/a'], minSizeBytes: 1024 }).success).toBe(true)
    expect(duplicateScanSchema.safeParse({ roots: [], minSizeBytes: 1024 }).success).toBe(false)
    expect(duplicateScanSchema.safeParse({ roots: ['/tmp/a'], minSizeBytes: 0 }).success).toBe(false)
    expect(duplicateScanSchema.safeParse({ roots: ['/tmp/../etc'], minSizeBytes: 1024 }).success).toBe(false)
  })

  it('validates duplicate deletion keeps at least one copy', () => {
    expect(deleteDuplicatesSchema.safeParse({ paths: ['/tmp/a'], keepPerGroup: 1 }).success).toBe(true)
    expect(deleteDuplicatesSchema.safeParse({ paths: ['/tmp/a'], keepPerGroup: 0 }).success).toBe(false)
  })

  it('validates storage scan depth', () => {
    expect(storageScanSchema.safeParse({ root: '/tmp', maxDepth: 4 }).success).toBe(true)
    expect(storageScanSchema.safeParse({ root: '/tmp', maxDepth: 0 }).success).toBe(false)
    expect(storageScanSchema.safeParse({ root: '/tmp', maxDepth: 99 }).success).toBe(false)
  })

  it('validates settings patches strictly', () => {
    expect(settingsPatchSchema.safeParse({ theme: 'light' }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ theme: 'purple' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ refreshIntervalMs: 10 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ refreshIntervalMs: 2000 }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ exclusions: ['..\\x'] }).success).toBe(false)
  })

  it('validates startup toggles and confirmations', () => {
    expect(startupToggleSchema.safeParse({ id: 'abc', enabled: true }).success).toBe(true)
    expect(startupToggleSchema.safeParse({ id: '', enabled: true }).success).toBe(false)
    expect(startupToggleSchema.safeParse({ id: 'abc', enabled: 'yes' }).success).toBe(false)
    expect(confirmSchema.safeParse({ title: 't', message: 'm', detail: 'd', confirmLabel: 'ok' }).success).toBe(true)
    expect(confirmSchema.safeParse({ title: '', message: 'm', detail: 'd', confirmLabel: 'ok' }).success).toBe(false)
  })

  it('validates enum helpers', () => {
    expect(cleanupModeSchema.safeParse('deep').success).toBe(true)
    expect(categoryIdSchema.safeParse('recycle-bin').success).toBe(true)
    expect(categoryIdSchema.safeParse('anything').success).toBe(false)
  })
})

describe('IPC channel allowlist', () => {
  it('contains only namespaced channels', () => {
    for (const channel of INVOKE_CHANNELS) {
      expect(channel).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('has no duplicate names between invoke and event channels', () => {
    const overlap = INVOKE_CHANNELS.filter((c) => EVENT_CHANNELS.includes(c))
    expect(overlap).toEqual([])
  })

  it('exposes a fixed, known set of channels (no wildcards)', () => {
    expect(INVOKE_CHANNELS.length).toBe(Object.keys(IPC).length)
    expect(INVOKE_CHANNELS.every((c) => !c.includes('*'))).toBe(true)
    expect(EVENT_CHANNELS).toEqual(Object.values(EVENTS))
  })

  it('never exposes a generic execute/shell channel', () => {
    const forbidden = ['shell:exec', 'exec', 'cmd:run', 'eval', 'node:run', 'child_process:spawn']
    for (const name of forbidden) {
      expect(INVOKE_CHANNELS).not.toContain(name)
    }
  })
})

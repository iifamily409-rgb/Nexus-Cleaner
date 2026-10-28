import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc'

/**
 * IPC ERROR-PROPAGATION TESTS
 * ------------------------------------------------------------------
 * Regression cover for a class of bug where a failed main-process operation
 * resolved as `undefined` / a half-built object, so the renderer showed success.
 *
 * These tests register the real handler table against a mocked Electron IPC bus
 * and a stub service layer, then invoke handlers exactly as the preload bridge
 * does. A handler that throws must reject the caller's promise.
 *
 * Nothing here touches the filesystem or a user folder: the services are stubs.
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => {
  const app = {
    getPath: vi.fn(() => '/tmp/nexus-ipc-test'),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false
  }
  return {
    app,
    BrowserWindow: class {},
    nativeTheme: { themeSource: 'dark' },
    dialog: {
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn()
    },
    shell: {
      openPath: vi.fn(),
      showItemInFolder: vi.fn()
    },
    ipcMain: {
      removeHandler: (channel: string) => handlers.delete(channel),
      handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
    }
  }
})

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  // Electron wraps the return in a promise; a rejection must surface as one.
  return Promise.resolve(handler({}, ...args))
}

let services: Record<string, unknown>
let registerIpcHandlers: (s: never, getWindow: () => null) => void

const settingsStub = { exclusions: [] as string[], refreshIntervalMs: 2000, historyRetentionDays: 90 }
const settings = {
  get: vi.fn(async () => settingsStub),
  set: vi.fn(async (patch: unknown) => ({ ...settingsStub, ...(patch as object) })),
  reset: vi.fn(async () => settingsStub)
}

function makeServices(): Record<string, unknown> {
  return {
    version: '1.0.0',
    emitter: {},
    settings,
    applySettings: vi.fn(async () => undefined),
    history: {
      add: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      clear: vi.fn(async () => undefined)
    },
    metricsSafe: vi.fn(async () => ({ at: Date.now(), cpuPercent: 0 })),
    monitor: { processes: vi.fn(async () => []), battery: vi.fn(async () => null) },
    startup: { list: vi.fn(async () => []), setEnabled: vi.fn(async () => ({ ok: true })) },
    browser: { list: vi.fn(async () => []) },
    cleaner: {
      categories: vi.fn(async () => []),
      scan: vi.fn(async () => ({ id: 'scan-1', mode: 'quick', categories: [], errors: [], totalEligibleBytes: 0 })),
      run: vi.fn(async () => ({ id: 'clean-1', results: [], mode: 'quick' })),
      dryRun: vi.fn(async () => ({ id: 'dry-1', results: [] })),
      cancel: vi.fn(async () => true)
    },
    storage: { scan: vi.fn(), cancel: vi.fn(), exportReport: vi.fn() },
    duplicates: { scan: vi.fn(), delete: vi.fn(), cancel: vi.fn() },
    systemInfo: { checkUpdates: vi.fn(), integrityCheck: vi.fn() },
    network: { diagnostics: vi.fn(), throughput: vi.fn() },
    schedule: { get: vi.fn(), set: vi.fn(), runNow: vi.fn() }
  }
}

beforeEach(async () => {
  handlers.clear()
  services = makeServices()
  vi.clearAllMocks()
  registerIpcHandlers = (await import('../../src/main/ipc/register')).registerIpcHandlers
  registerIpcHandlers(services as never, () => null as never)
})

afterEach(() => {
  handlers.clear()
})

describe('invalid payloads reject instead of resolving', () => {
  it('rejects a scan with an unknown mode', async () => {
    await expect(invoke(IPC.CLEAN_SCAN, { mode: 'turbo', categories: ['user-temp'], minAgeHours: 24, exclusions: [] })).rejects.toThrow(
      /Rejected by validation/i
    )
    expect((services.cleaner as { scan: ReturnType<typeof vi.fn> }).scan).not.toHaveBeenCalled()
  })

  it('rejects a scan with an unknown category id', async () => {
    await expect(
      invoke(IPC.CLEAN_SCAN, { mode: 'quick', categories: ['not-a-category'], minAgeHours: 24, exclusions: [] })
    ).rejects.toThrow(/Rejected by validation/i)
  })

  it('rejects traversal and NUL-byte paths', async () => {
    await expect(invoke(IPC.APP_OPEN_PATH, '/tmp/../../etc')).rejects.toThrow(/Rejected by validation/i)
    await expect(invoke(IPC.APP_OPEN_PATH, 'bad\0path')).rejects.toThrow(/Rejected by validation/i)
  })

  it('rejects a relative or empty path instead of guessing', async () => {
    await expect(invoke(IPC.APP_OPEN_PATH, 'relative/path')).rejects.toThrow(/Rejected by validation/i)
    await expect(invoke(IPC.APP_OPEN_PATH, '')).rejects.toThrow(/Rejected by validation/i)
  })

  it('rejects a missing / non-string id for clean and cancel', async () => {
    await expect(invoke(IPC.CLEAN_RUN, undefined)).rejects.toThrow(/Rejected by validation/i)
    await expect(invoke(IPC.CLEAN_CANCEL, 42)).rejects.toThrow(/Rejected by validation/i)
    await expect(invoke(IPC.CLEAN_CANCEL, '')).rejects.toThrow(/Rejected by validation/i)
  })

  it('rejects a malformed settings patch', async () => {
    await expect(invoke(IPC.SETTINGS_SET, { theme: 'neon' })).rejects.toThrow(/Rejected by validation/i)
    await expect(invoke(IPC.SETTINGS_SET, { maxAgeHours: -5 })).rejects.toThrow(/Rejected by validation/i)
    expect(settings.set).not.toHaveBeenCalled()
  })

  it('rejects duplicates deletion with an empty path list', async () => {
    await expect(invoke(IPC.DUP_DELETE, { paths: [], keepPerGroup: 1 })).rejects.toThrow(/Rejected by validation/i)
  })

  it('never leaks a stack trace in the rejection message', async () => {
    const error = await invoke(IPC.CLEAN_SCAN, { mode: 'nope' }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/\n\s+at /)
    expect((error as Error).message.length).toBeLessThanOrEqual(600)
  })
})

describe('ordinary valid calls still succeed', () => {
  it('returns app info', async () => {
    const info = (await invoke(IPC.APP_INFO)) as { version: string; platform: string }
    expect(info.version).toBe('1.0.0')
    expect(typeof info.platform).toBe('string')
  })

  it('returns settings and persists a valid patch', async () => {
    await expect(invoke(IPC.SETTINGS_GET)).resolves.toEqual(settingsStub)
    await expect(invoke(IPC.SETTINGS_SET, { maxAgeHours: 48 })).resolves.toMatchObject({ maxAgeHours: 48 })
    expect((services.applySettings as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('runs a valid scan and records history', async () => {
    const report = (await invoke(IPC.CLEAN_SCAN, {
      mode: 'quick',
      categories: ['user-temp'],
      minAgeHours: 24,
      exclusions: []
    })) as { id: string }
    expect(report.id).toBe('scan-1')
    const history = services.history as { add: ReturnType<typeof vi.fn> }
    expect(history.add).toHaveBeenCalledTimes(1)
  })

  it('cancels a valid operation', async () => {
    await expect(invoke(IPC.CLEAN_CANCEL, 'scan-1')).resolves.toBe(true)
  })
})

describe('service failures reject rather than resolving as success', () => {
  it('rejects when the cleaner throws mid-scan', async () => {
    ;(services.cleaner as { scan: ReturnType<typeof vi.fn> }).scan.mockRejectedValueOnce(new Error('engine exploded'))
    await expect(
      invoke(IPC.CLEAN_SCAN, { mode: 'quick', categories: ['user-temp'], minAgeHours: 24, exclusions: [] })
    ).rejects.toThrow('engine exploded')
    // No history record is written for a failed operation.
    expect((services.history as { add: ReturnType<typeof vi.fn> }).add).not.toHaveBeenCalled()
  })

  it('rejects when cleanup fails', async () => {
    ;(services.cleaner as { run: ReturnType<typeof vi.fn> }).run.mockRejectedValueOnce(new Error('unknown scan id'))
    await expect(invoke(IPC.CLEAN_RUN, 'missing-id')).rejects.toThrow('unknown scan id')
    expect((services.history as { add: ReturnType<typeof vi.fn> }).add).not.toHaveBeenCalled()
  })

  it('rejects when a settings write fails', async () => {
    settings.set.mockRejectedValueOnce(new Error('disk full'))
    await expect(invoke(IPC.SETTINGS_SET, { maxAgeHours: 12 })).rejects.toThrow('disk full')
    expect((services.applySettings as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('rejects when history listing fails', async () => {
    ;(services.history as { list: ReturnType<typeof vi.fn> }).list.mockRejectedValueOnce(new Error('store corrupt'))
    await expect(invoke(IPC.HISTORY_LIST)).rejects.toThrow('store corrupt')
  })
})

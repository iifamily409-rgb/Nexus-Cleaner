import { vi } from 'vitest'
import type { ElectronAPI, ScanReport, CleanReport } from '@shared/types'

/**
 * A deterministic mock of the preload bridge. It reports exactly the numbers
 * the fake engine decides on, so UI assertions can verify that the interface
 * renders the real numbers rather than decorative ones.
 */

export const mockScanReport: ScanReport = {
  id: 'scan-1',
  mode: 'quick',
  startedAt: Date.now() - 1500,
  endedAt: Date.now(),
  categories: [
    {
      category: 'user-temp',
      eligibleFiles: 12,
      eligibleBytes: 4096,
      scannedFiles: 30,
      skippedFiles: 3,
      errorCount: 0,
      roots: ['C:\\Users\\me\\AppData\\Local\\Temp'],
      sample: [{ path: 'C:\\Temp\\a.tmp', size: 2048, mtimeMs: Date.now(), category: 'user-temp', source: 'C:\\Temp' }],
      skipReasons: { 'not a cache/temp file type': 2, 'newer than the minimum-age filter': 1 },
      durationMs: 400,
      truncated: false
    }
  ],
  totalEligibleFiles: 12,
  totalEligibleBytes: 4096,
  totalScannedFiles: 30,
  totalSkippedFiles: 3,
  skipReasons: { 'not a cache/temp file type': 2, 'newer than the minimum-age filter': 1 },
  errors: [],
  cancelled: false,
  diskBefore: { mount: 'C:\\', totalBytes: 1000, freeBytes: 400, usedBytes: 600, usedPercent: 60 },
  options: { mode: 'quick', minAgeHours: 24, exclusions: [] },
  platform: 'win32'
}

export const mockCleanReport: CleanReport = {
  id: 'clean-1',
  scanId: 'scan-1',
  mode: 'quick',
  startedAt: Date.now(),
  endedAt: Date.now() + 800,
  results: [
    {
      category: 'user-temp',
      attempted: 12,
      deleted: 11,
      bytesDeleted: 4096,
      skipped: 1,
      failed: 0,
      skipReasons: { 'locked or in use by another program': 1 },
      errors: [],
      durationMs: 300
    }
  ],
  totalDeleted: 11,
  totalBytesDeleted: 4096,
  totalAttempted: 12,
  totalSkipped: 1,
  totalFailed: 0,
  diskBefore: { mount: 'C:\\', totalBytes: 1000, freeBytes: 400, usedBytes: 600, usedPercent: 60 },
  diskAfter: { mount: 'C:\\', totalBytes: 1000, freeBytes: 420, usedBytes: 580, usedPercent: 58 },
  verifiedBytesFreed: 20,
  cancelled: false,
  timings: { scanMs: 1500, deleteMs: 300, verifyMs: 40 },
  warnings: ['1 emptied folder(s) were pruned']
}

export function installMockApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  const api = {
    app: {
      info: vi.fn(async () => ({
        version: '1.0.0',
        electron: '38.0.0',
        chrome: '140',
        node: '22',
        platform: 'win32',
        isWindows: true,
        elevated: false,
        userDataPath: 'C:\\Users\\me\\AppData\\Roaming\\nexus'
      })),
      openPath: vi.fn(async () => ({ ok: true })),
      showItemInFolder: vi.fn(async () => ({ ok: true }))
    },
    settings: {
      get: vi.fn(async () => ({
        theme: 'dark' as const,
        accent: 'cyan' as const,
        animationIntensity: 'reduced' as const,
        reducedMotion: true,
        refreshIntervalMs: 2000,
        defaultMode: 'quick' as const,
        enabledCategories: ['user-temp'] as never,
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
      })),
      set: vi.fn(async (patch: unknown) => patch as never),
      reset: vi.fn(async () => ({}) as never)
    },
    cleaner: {
      categories: vi.fn(async () => [
        {
          id: 'user-temp' as const,
          name: 'User temporary files',
          description: 'Temporary files in your temp folder.',
          removes: 'Files in %TEMP% older than the age filter.',
          risk: 'safe' as const,
          quick: true,
          smart: true,
          deep: true,
          roots: ['C:\\Users\\me\\AppData\\Local\\Temp'],
          available: true
        },
        {
          id: 'windows-temp' as const,
          name: 'Windows temporary files',
          description: 'System temp folders.',
          removes: 'Files in Windows\\Temp.',
          risk: 'safe' as const,
          quick: true,
          smart: true,
          deep: true,
          roots: [],
          available: false,
          unavailableReason: 'Access denied without elevation'
        }
      ]),
      scan: vi.fn(async () => mockScanReport),
      clean: vi.fn(async () => mockCleanReport),
      dryRun: vi.fn(async () => ({ ...mockCleanReport, totalDeleted: 0, totalBytesDeleted: 0 })),
      cancel: vi.fn(async () => true)
    },
    monitor: {
      metrics: vi.fn(async () => ({
        at: Date.now(),
        cpuPercent: 12.5,
        memTotalBytes: 16 * 1024 ** 3,
        memUsedBytes: 8 * 1024 ** 3,
        memPercent: 50,
        disk: { mount: 'C:\\', totalBytes: 1000, freeBytes: 400, usedBytes: 600, usedPercent: 60 },
        diskReadBytesPerSec: 1000,
        diskWriteBytesPerSec: 500,
        uptimeSec: 3600,
        loadAvg: [0.5, 0.4, 0.3] as [number, number, number],
        battery: null,
        netRxBytesPerSec: 2048,
        netTxBytesPerSec: 512,
        processCount: 120
      })),
      processes: vi.fn(async () => [
        { pid: 4, name: 'System', cpuPercent: 1.2, memBytes: 1024, user: 'SYSTEM', command: '', protected: true },
        { pid: 1234, name: 'chrome.exe', cpuPercent: 22.5, memBytes: 1024 * 1024, user: 'me', command: 'chrome.exe --type=renderer', protected: false }
      ]),
      startup: vi.fn(async () => []),
      setStartupEnabled: vi.fn(async () => ({ ok: true })),
      battery: vi.fn(async () => null)
    },
    browser: { list: vi.fn(async () => []) },
    storage: {
      scan: vi.fn(async () => ({
        root: 'C:\\Data',
        startedAt: Date.now(),
        endedAt: Date.now(),
        totalBytes: 100,
        totalFiles: 2,
        totalDirs: 1,
        tree: { name: 'Data', path: 'C:\\Data', size: 100, fileCount: 2, dirCount: 1, depth: 0, isDir: true, children: [] },
        largestFiles: [],
        categories: [],
        cancelled: false,
        errors: []
      })),
      cancel: vi.fn(async () => true),
      exportReport: vi.fn(async () => ({ ok: true, path: 'C:\\out.json' }))
    },
    duplicates: {
      scan: vi.fn(async () => ({
        roots: ['C:\\Data'],
        startedAt: Date.now(),
        endedAt: Date.now(),
        filesConsidered: 10,
        filesHashed: 4,
        groups: [],
        totalWastedBytes: 0,
        cancelled: false,
        errors: [],
        protectedSkipped: 0
      })),
      delete: vi.fn(async () => ({
        category: 'user-temp' as const,
        attempted: 1,
        deleted: 1,
        bytesDeleted: 10,
        skipped: 0,
        failed: 0,
        errors: [],
        durationMs: 5
      })),
      cancel: vi.fn(async () => true)
    },
    system: {
      info: vi.fn(async () => {
        throw new Error('not used')
      }),
      updateCheck: vi.fn(async () => ({ ok: true, message: '0 updates', pending: 0 })),
      integrityCheck: vi.fn(async () => ({ ok: true, message: 'clean', stdout: '' }))
    },
    network: {
      diagnostics: vi.fn(async () => {
        throw new Error('not used')
      }),
      throughput: vi.fn(async () => ({ ok: true, downMbps: 100, upMbps: null, message: 'ok' }))
    },
    history: {
      list: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
      export: vi.fn(async () => ({ ok: true, path: 'C:\\history.json' }))
    },
    schedule: {
      get: vi.fn(async () => ({
        enabled: false,
        mode: 'quick' as const,
        categories: ['user-temp'] as never,
        frequency: 'weekly' as const,
        hour: 3,
        minute: 0,
        notify: true,
        maxAgeHours: 24
      })),
      set: vi.fn(async (config: unknown) => config as never),
      runNow: vi.fn(async () => null)
    },
    events: {
      onProgress: vi.fn(() => () => undefined),
      onEvent: vi.fn(() => () => undefined),
      onMetrics: vi.fn(() => () => undefined),
      onNavigate: vi.fn(() => () => undefined),
      onScheduleFired: vi.fn(() => () => undefined)
    },
    dialog: {
      pickFolders: vi.fn(async () => ['C:\\Data']),
      confirm: vi.fn(async () => true)
    },
    platform: 'win32' as NodeJS.Platform,
    version: '1.0.0'
  } as unknown as ElectronAPI

  const merged = { ...api, ...overrides } as ElectronAPI
  Object.defineProperty(window, 'nexus', { value: merged, writable: true, configurable: true })
  return merged
}

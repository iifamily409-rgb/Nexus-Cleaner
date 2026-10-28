import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { IPC, EVENTS } from '@shared/ipc'
import {
  confirmSchema,
  deleteDuplicatesSchema,
  duplicateScanSchema,
  idSchema,
  scanOptionsSchema,
  scheduleConfigSchema,
  settingsPatchSchema,
  startupToggleSchema,
  storageScanSchema,
  safePathSchema
} from '@shared/schemas'
import type { AppServices } from '../services/appServices'
import type { HistoryRecord, LiveProgress, OperationEvent } from '@shared/types'
import { validateScanRoot } from '../core/pathSafety'
import { APP_VERSION } from '../index'
import { DEFAULT_CATEGORIES } from '../services/settingsStore'

/**
 * IPC REGISTRATION
 * Every handler validates its arguments with zod before touching a service.
 * Every handler wraps errors into `{ ok:false, error }` shapes so the renderer
 * never receives a raw stack trace. There is no generic "run this command",
 * no arbitrary-path deletion, and no path that bypasses the cleaner engine.
 */

type Handler = (...args: unknown[]) => Promise<unknown> | unknown

const isWindows = process.platform === 'win32'

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

export function registerIpcHandlers(services: AppServices, getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  services.emitter = {
    progress: (p: LiveProgress) => send(EVENTS.PROGRESS, p),
    event: (e: OperationEvent) => send(EVENTS.EVENT, e),
    metrics: (m) => send(EVENTS.METRICS, m),
    scheduleFired: (r: HistoryRecord) => send(EVENTS.SCHEDULE_FIRED, r)
  }

  /**
   * Registers a handler with uniform error handling.
   *
   * Errors are RE-THROWN so the renderer's promise rejects: a failed or
   * rejected operation must never look like a successful one. Validation
   * failures therefore surface as exceptions in the UI layer instead of
   * silently resolving with a partial object.
   */
  const handle = (channel: string, fn: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        return await fn(...args)
      } catch (err) {
        const message = (err as Error)?.message ?? 'Unknown error'
        // Never leak stack traces, file contents or absolute internals beyond
        // the message the main process itself produced.
        throw new Error(message.slice(0, 600))
      }
    })
  }

  const validate = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, value: unknown): T => {
    const parsed = schema.safeParse(value)
    if (!parsed.success || parsed.data === undefined) {
      const detail = parsed.error?.issues.map((i) => i.message).join('; ') ?? 'invalid input'
      throw new Error(`Rejected by validation: ${detail}`)
    }
    return parsed.data
  }

  // ---------------------------------------------------------------- app ----
  handle(IPC.APP_INFO, async () => ({
    version: APP_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    isWindows,
    elevated: process.platform === 'win32' ? false : process.getuid?.() === 0,
    userDataPath: app.getPath('userData')
  }))

  handle(IPC.APP_OPEN_PATH, async (rawPath) => {
    const target = validate(safePathSchema, rawPath)
    const verdict = validateScanRoot(target)
    if (!verdict.ok) return { ok: false, error: verdict.reason }
    const error = await shell.openPath(target)
    return error ? { ok: false, error } : { ok: true }
  })

  handle(IPC.APP_SHOW_ITEM, async (rawPath) => {
    const target = validate(safePathSchema, rawPath)
    if (!path.isAbsolute(target)) return { ok: false, error: 'Path must be absolute' }
    shell.showItemInFolder(target)
    return { ok: true }
  })

  // ----------------------------------------------------------- settings ----
  handle(IPC.SETTINGS_GET, async () => services.settings.get())

  handle(IPC.SETTINGS_SET, async (patch) => {
    const valid = validate(settingsPatchSchema, patch)
    const next = await services.settings.set(valid)
    await services.applySettings(next)
    return next
  })

  handle(IPC.SETTINGS_RESET, async () => {
    const next = await services.settings.reset()
    await services.applySettings(next)
    return next
  })

  // ------------------------------------------------------------ cleaner ----
  handle(IPC.CLEAN_CATEGORIES, async () => services.cleaner.categories())

  handle(IPC.CLEAN_SCAN, async (rawOptions) => {
    const options = validate(scanOptionsSchema, rawOptions)
    const settings = await services.settings.get()
    const optionsMerged = {
      ...options,
      exclusions: [...new Set([...options.exclusions, ...settings.exclusions])]
    }
    const report = await services.cleaner.scan(optionsMerged)
    const record: HistoryRecord = {
      id: report.id,
      kind: 'scan',
      at: Date.now(),
      mode: report.mode,
      categories: report.categories.map((c) => c.category),
      estimatedBytes: report.totalEligibleBytes,
      actualBytes: 0,
      verifiedBytesFreed: null,
      scannedFiles: report.totalScannedFiles,
      deletedFiles: 0,
      skippedFiles: report.totalSkippedFiles,
      errors: report.errors.slice(0, 30),
      cancelled: report.cancelled,
      durationMs: report.endedAt - report.startedAt,
      diskBefore: report.diskBefore,
      diskAfter: null,
      summary: `Scan (${report.mode}): ${report.totalEligibleFiles} eligible files, ${report.totalEligibleBytes} bytes`
    }
    await services.history.add(record)
    return report
  })

  handle(IPC.CLEAN_RUN, async (rawId) => {
    const scanId = validate(idSchema, rawId)
    const report = await services.cleaner.run(scanId)
    const record: HistoryRecord = {
      id: report.id,
      kind: 'clean',
      at: Date.now(),
      mode: report.mode,
      categories: report.results.map((r) => r.category),
      estimatedBytes: report.results.reduce((acc, r) => acc + r.bytesDeleted, 0),
      actualBytes: report.totalBytesDeleted,
      verifiedBytesFreed: report.verifiedBytesFreed,
      scannedFiles: 0,
      deletedFiles: report.totalDeleted,
      skippedFiles: report.totalSkipped,
      errors: report.results.flatMap((r) => r.errors).slice(0, 30),
      cancelled: report.cancelled,
      durationMs: report.endedAt - report.startedAt,
      diskBefore: report.diskBefore,
      diskAfter: report.diskAfter,
      summary: `Cleanup (${report.mode}): ${report.totalDeleted} files, ${report.totalBytesDeleted} bytes`
    }
    await services.history.add(record)
    return report
  })

  handle(IPC.CLEAN_DRY_RUN, async (rawOptions) => {
    const options = validate(scanOptionsSchema, rawOptions)
    const settings = await services.settings.get()
    return services.cleaner.dryRun({ ...options, exclusions: [...new Set([...options.exclusions, ...settings.exclusions])] })
  })

  handle(IPC.CLEAN_CANCEL, async (rawId) => services.cleaner.cancel(validate(idSchema, rawId)))

  // ------------------------------------------------------------ monitor ----
  handle(IPC.MONITOR_METRICS, async () => services.metricsSafe())
  handle(IPC.MONITOR_PROCESSES, async () => services.monitor.processes())
  handle(IPC.MONITOR_STARTUP, async () => services.startup.list())
  handle(IPC.MONITOR_BATTERY, async () => services.monitor.battery())

  handle(IPC.MONITOR_STARTUP_TOGGLE, async (rawPatch) => {
    const patch = validate(startupToggleSchema, rawPatch)
    const result = await services.startup.setEnabled(patch.id, patch.enabled)
    if (!result.ok) return { ok: false, error: result.error }
    const entries = await services.startup.list()
    const entry = entries.find((e) => e.id === patch.id)
    return { ok: true, ...(entry ? { entry } : {}) }
  })

  // ------------------------------------------------------------ browser ----
  handle(IPC.BROWSER_LIST, async () => services.browser.list())

  // ------------------------------------------------------------ storage ----
  handle(IPC.STORAGE_SCAN, async (raw) => {
    const { root, maxDepth } = validate(storageScanSchema, raw)
    const verdict = validateScanRoot(root)
    if (!verdict.ok) throw new Error(`Refused: ${verdict.reason}`)
    const opId = `storage-${Date.now()}`
    return services.storage.scan(root, maxDepth, opId)
  })

  handle(IPC.STORAGE_CANCEL, async (rawId) => services.storage.cancel(validate(idSchema, rawId)))

  handle(IPC.STORAGE_EXPORT, async (raw) => {
    const parsed = raw as { report?: unknown } | undefined
    if (!parsed || typeof parsed.report !== 'object' || parsed.report === null) {
      throw new Error('Invalid storage report payload')
    }
    const report = parsed.report as Parameters<typeof services.storage.exportReport>[0]
    if (typeof report.root !== 'string') throw new Error('Invalid storage report: missing root')
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Export storage report',
      defaultPath: path.join(app.getPath('downloads'), `nexus-storage-${Date.now()}.json`),
      filters: [{ name: 'JSON report', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' }
    await fs.mkdir(path.dirname(result.filePath), { recursive: true })
    await services.storage.exportReport(report, result.filePath)
    return { ok: true, path: result.filePath }
  })

  // --------------------------------------------------------- duplicates ----
  handle(IPC.DUP_SCAN, async (raw) => {
    const { roots, minSizeBytes } = validate(duplicateScanSchema, raw)
    const opId = `dup-${Date.now()}`
    return services.duplicates.scan(roots, minSizeBytes, opId)
  })

  handle(IPC.DUP_DELETE, async (raw) => {
    const { paths, keepPerGroup } = validate(deleteDuplicatesSchema, raw)
    return services.duplicates.delete(paths, Math.max(1, keepPerGroup))
  })

  handle(IPC.DUP_CANCEL, async (rawId) => services.duplicates.cancel(validate(idSchema, rawId)))

  // ------------------------------------------------------------- system ----
  handle(IPC.SYSTEM_INFO, async () => {
    const info = await services.systemInfo.info()
    info.startup = await services.startup.list()
    return info
  })
  handle(IPC.SYSTEM_UPDATE_CHECK, async () => services.systemInfo.checkUpdates())
  handle(IPC.SYSTEM_INTEGRITY, async () => services.systemInfo.integrityCheck())

  // ------------------------------------------------------------ network ----
  handle(IPC.NET_DIAGNOSTICS, async () => services.network.diagnostics())
  handle(IPC.NET_THROUGHPUT, async () => services.network.throughput())

  // ------------------------------------------------------------ history ----
  handle(IPC.HISTORY_LIST, async () => services.history.list())
  handle(IPC.HISTORY_CLEAR, async () => {
    await services.history.clear()
    return { ok: true }
  })
  handle(IPC.HISTORY_EXPORT, async () => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Export activity history',
      defaultPath: path.join(app.getPath('downloads'), `nexus-history-${Date.now()}.json`),
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'CSV', extensions: ['csv'] }
      ]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' }
    if (result.filePath.endsWith('.csv')) {
      const records = await services.history.list()
      const header = 'id,kind,at,mode,categories,estimatedBytes,actualBytes,verifiedBytesFreed,scannedFiles,deletedFiles,skippedFiles,cancelled,durationMs,summary\n'
      const csv = records
        .map((r) =>
          [
            r.id,
            r.kind,
            new Date(r.at).toISOString(),
            r.mode ?? '',
            `"${r.categories.join(' ')}"`,
            r.estimatedBytes,
            r.actualBytes,
            r.verifiedBytesFreed ?? '',
            r.scannedFiles,
            r.deletedFiles,
            r.skippedFiles,
            r.cancelled,
            r.durationMs,
            `"${r.summary.replace(/"/g, "'")}"`
          ].join(',')
        )
        .join('\n')
      await fs.writeFile(result.filePath, header + csv, 'utf8')
      return { ok: true, path: result.filePath }
    }
    await services.history.exportTo(result.filePath)
    return { ok: true, path: result.filePath }
  })

  // ----------------------------------------------------------- schedule ----
  handle(IPC.SCHEDULE_GET, async () => (await services.settings.get()).schedule)
  handle(IPC.SCHEDULE_SET, async (raw) => {
    const schedule = validate(scheduleConfigSchema, raw)
    const next = await services.settings.set({ schedule })
    await services.applySettings(next)
    return next.schedule
  })
  handle(IPC.SCHEDULE_RUN_NOW, async () => services.scheduler.runNow())

  // ------------------------------------------------------------- dialog ----
  handle(IPC.DIALOG_PICK_FOLDERS, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select folders',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent']
    })
    if (result.canceled) return []
    return result.filePaths.filter((p) => validateScanRoot(p).ok)
  })

  handle(IPC.DIALOG_CONFIRM, async (raw) => {
    const payload = validate(confirmSchema, raw)
    const win = getWindow()
    const result = await dialog.showMessageBox(win ?? undefined!, {
      type: 'warning',
      buttons: [payload.confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: payload.title,
      message: payload.message,
      detail: payload.detail
    })
    return result.response === 0
  })

  // Expose the default categories so the renderer and main can never disagree.
  ipcMain.removeHandler('internal:defaults')
  ipcMain.handle('internal:defaults', async () => ({ categories: DEFAULT_CATEGORIES }))
  void ok
}

/**
 * The single source of truth for IPC channel names.
 * Both preload and main import from here, so adding a channel to the renderer
 * is impossible without also registering a validated handler.
 */
export const IPC = {
  // app
  APP_INFO: 'app:info',
  APP_OPEN_PATH: 'app:open-path',
  APP_SHOW_ITEM: 'app:show-item',
  // settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  // cleaner
  CLEAN_CATEGORIES: 'clean:categories',
  CLEAN_SCAN: 'clean:scan',
  CLEAN_RUN: 'clean:run',
  CLEAN_DRY_RUN: 'clean:dry-run',
  CLEAN_CANCEL: 'clean:cancel',
  // monitor
  MONITOR_METRICS: 'monitor:metrics',
  MONITOR_PROCESSES: 'monitor:processes',
  MONITOR_STARTUP: 'monitor:startup',
  MONITOR_STARTUP_TOGGLE: 'monitor:startup-toggle',
  MONITOR_BATTERY: 'monitor:battery',
  // browser
  BROWSER_LIST: 'browser:list',
  // storage
  STORAGE_SCAN: 'storage:scan',
  STORAGE_CANCEL: 'storage:cancel',
  STORAGE_EXPORT: 'storage:export',
  // duplicates
  DUP_SCAN: 'dup:scan',
  DUP_DELETE: 'dup:delete',
  DUP_CANCEL: 'dup:cancel',
  // system
  SYSTEM_INFO: 'system:info',
  SYSTEM_UPDATE_CHECK: 'system:update-check',
  SYSTEM_INTEGRITY: 'system:integrity',
  // network
  NET_DIAGNOSTICS: 'net:diagnostics',
  NET_THROUGHPUT: 'net:throughput',
  // history
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_EXPORT: 'history:export',
  // schedule
  SCHEDULE_GET: 'schedule:get',
  SCHEDULE_SET: 'schedule:set',
  SCHEDULE_RUN_NOW: 'schedule:run-now',
  // dialog
  DIALOG_PICK_FOLDERS: 'dialog:pick-folders',
  DIALOG_CONFIRM: 'dialog:confirm'
} as const

export const EVENTS = {
  PROGRESS: 'evt:progress',
  EVENT: 'evt:event',
  METRICS: 'evt:metrics',
  NAVIGATE: 'evt:navigate',
  SCHEDULE_FIRED: 'evt:schedule-fired'
} as const

/** Channels the renderer is allowed to invoke (allowlist enforced by preload shape). */
export const INVOKE_CHANNELS: readonly string[] = Object.values(IPC)
export const EVENT_CHANNELS: readonly string[] = Object.values(EVENTS)

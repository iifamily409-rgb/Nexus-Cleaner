import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import path from 'node:path'
import { registerIpcHandlers } from './ipc/register'
import { AppServices } from './services/appServices'

const isDev = !app.isPackaged

/**
 * `app.getVersion()` returns Electron's version when the app is launched from a
 * script rather than a packaged bundle (and before `app.setName`). Report the
 * package version we actually ship, and only trust getVersion() when it differs
 * from the Electron runtime version.
 */
export const APP_VERSION = ((): string => {
  const reported = app.getVersion()
  if (!reported || reported === process.versions.electron) return '1.0.0'
  return reported
})()
let mainWindow: BrowserWindow | null = null

// Single instance: a second launch focuses the existing window instead of
// running two cleaners against the same files.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#05070b',
    title: 'NEXUS Cleaner',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: isDev
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Block navigation to anything that is not our own bundle.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? /^http:\/\/localhost:\d+/.test(url) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.nexus.cleaner')
  nativeTheme.themeSource = 'dark'

  const services = new AppServices(app.getPath('userData'))
  await services.init()

  registerIpcHandlers(services, () => mainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Cooperative shutdown: cancel any in-flight operation so it exits cleanly
  // rather than being killed mid-delete.
  void AppServices.shutdownAll()
})

// Security: refuse to load any remote content in the renderer.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection', reason)
})

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Platform-specific location resolution.
 * Nothing here deletes anything; it only answers "where do the well known
 * caches live on this machine?" so that the cleaner can build an allowlist.
 */

export interface LocationCandidate {
  path: string
  /** Human label used in the UI. */
  label: string
  /** Whether the recipe is only valid on Windows. */
  windowsOnly?: boolean
}

export const isWindows = (platform: NodeJS.Platform = process.platform): boolean => platform === 'win32'

export function homeDir(): string {
  return os.homedir()
}

export function envPath(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim().length > 0) return path.resolve(value.trim())
  }
  return null
}

/** All temp roots we consider "the user's temp". */
export function userTempRoots(): string[] {
  const roots = new Set<string>()
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    if (local) roots.add(path.join(local, 'Temp'))
    const userTemp = envPath('TEMP', 'TMP')
    if (userTemp) roots.add(userTemp)
  } else {
    const tmp = envPath('XDG_RUNTIME_DIR', 'TMPDIR')
    if (tmp) roots.add(tmp)
    roots.add('/tmp')
    roots.add('/var/tmp')
    roots.add(path.join(homeDir(), '.cache'))
    roots.add(path.join(homeDir(), '.local', 'state'))
  }
  return [...roots]
}

export function windowsTempRoots(): string[] {
  if (!isWindows()) return []
  const roots = new Set<string>()
  const systemRoot = envPath('SystemRoot') ?? 'C:\\Windows'
  roots.add(path.join(systemRoot, 'Temp'))
  const programData = envPath('ProgramData') ?? 'C:\\ProgramData'
  roots.add(path.join(programData, 'Temp'))
  return [...roots]
}

export function appCacheRoots(): LocationCandidate[] {
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    if (!local) return []
    return [
      { path: path.join(local, 'Microsoft', 'Windows', 'Explorer'), label: 'Explorer cache files' },
      { path: path.join(local, 'Microsoft', 'Windows', 'INetCache'), label: 'IE/WinINet cache' },
      { path: path.join(local, 'Microsoft', 'Windows', 'WebCache'), label: 'WebCache' },
      { path: path.join(local, 'Microsoft', 'Terminal Server Client', 'Cache'), label: 'RDP cache' },
      { path: path.join(local, 'Packages'), label: 'App package caches', windowsOnly: true },
      { path: path.join(local, 'CrashDumps'), label: 'Local crash dumps' }
    ]
  }
  const home = homeDir()
  return [
    { path: path.join(home, '.cache', 'thumbnails'), label: 'Thumbnail cache' },
    { path: path.join(home, '.cache', 'fontconfig'), label: 'Font cache' },
    { path: path.join(home, '.cache', 'mesa_shader_cache'), label: 'Shader cache' },
    { path: path.join(home, '.cache', 'pip'), label: 'pip cache' },
    { path: path.join(home, '.npm', '_cacache'), label: 'npm cache' },
    { path: path.join(home, '.cache', 'yarn'), label: 'yarn cache' }
  ]
}

export function thumbnailRoots(): string[] {
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    const out: string[] = []
    if (local) {
      out.push(path.join(local, 'Microsoft', 'Windows', 'Explorer'))
      out.push(path.join(local, 'Microsoft', 'Windows', 'Explorer', 'ThumbCache'))
    }
    return out
  }
  return [
    path.join(homeDir(), '.cache', 'thumbnails'),
    path.join(homeDir(), '.thumbnails'),
    path.join(homeDir(), '.local', 'share', 'thumbnails')
  ]
}

export function crashDumpRoots(): string[] {
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    const systemRoot = envPath('SystemRoot') ?? 'C:\\Windows'
    const out: string[] = [path.join(systemRoot, 'Minidump')]
    if (local) {
      out.push(path.join(local, 'CrashDumps'))
      out.push(path.join(local, 'Microsoft', 'Windows', 'WER'))
    }
    return out
  }
  return [path.join(homeDir(), '.cache', 'crash'), '/var/crash']
}

export function errorReportRoots(): string[] {
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    const programData = envPath('ProgramData') ?? 'C:\\ProgramData'
    const out: string[] = [path.join(programData, 'Microsoft', 'Windows', 'WER')]
    if (local) out.push(path.join(local, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(local, 'Microsoft', 'Windows', 'WER', 'ReportQueue'))
    return out
  }
  return [path.join(homeDir(), '.cache', 'report'), '/var/log/apport']
}

export function deliveryOptimizationRoots(): string[] {
  if (!isWindows()) return []
  const systemRoot = envPath('SystemRoot') ?? 'C:\\Windows'
  const programData = envPath('ProgramData') ?? 'C:\\ProgramData'
  return [
    path.join(systemRoot, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'),
    path.join(programData, 'Microsoft', 'Network', 'Downloader')
  ]
}

export function fontCacheRoots(): string[] {
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    const out: string[] = []
    if (local) out.push(path.join(local, 'Microsoft', 'Windows', 'FontCache'))
    return out
  }
  return [path.join(homeDir(), '.cache', 'fontconfig')]
}

export function logArtifactRoots(): string[] {
  if (isWindows()) {
    const local = envPath('LOCALAPPDATA')
    const out: string[] = []
    if (local) out.push(path.join(local, 'Temp', 'Diagnostics'), path.join(local, 'Microsoft', 'Windows', 'WER', 'Temp'))
    return out
  }
  return [path.join(homeDir(), '.cache', 'logs'), path.join(homeDir(), '.local', 'state', 'logs')]
}

export interface BrowserRecipe {
  id: string
  name: string
  cachePaths: { path: string; label: string }[]
  processNames: string[]
}

/** Browser cache locations. Passwords/cookies/history are never in these lists. */
export function browserRecipes(): BrowserRecipe[] {
  const home = homeDir()
  const local = isWindows() ? envPath('LOCALAPPDATA') : null
  const roaming = isWindows() ? envPath('APPDATA') : null

  if (isWindows() && local && roaming) {
    return [
      {
        id: 'chrome',
        name: 'Google Chrome',
        processNames: ['chrome.exe'],
        cachePaths: [
          { path: path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'), label: 'Cache' },
          { path: path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'), label: 'Code Cache' },
          { path: path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'GPUCache'), label: 'GPU Cache' },
          { path: path.join(local, 'Google', 'Chrome', 'User Data', 'ShaderCache'), label: 'Shader Cache' }
        ]
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        processNames: ['msedge.exe'],
        cachePaths: [
          { path: path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'), label: 'Cache' },
          { path: path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'), label: 'Code Cache' },
          { path: path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'GPUCache'), label: 'GPU Cache' },
          { path: path.join(local, 'Microsoft', 'Edge', 'User Data', 'ShaderCache'), label: 'Shader Cache' }
        ]
      },
      {
        id: 'firefox',
        name: 'Mozilla Firefox',
        processNames: ['firefox.exe'],
        cachePaths: [
          { path: path.join(local, 'Mozilla', 'Firefox', 'Profiles'), label: 'Profile cache (cache2)' },
          { path: path.join(roaming, 'Mozilla', 'Firefox', 'Crash Reports'), label: 'Crash reports' }
        ]
      },
      {
        id: 'brave',
        name: 'Brave',
        processNames: ['brave.exe'],
        cachePaths: [
          { path: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'), label: 'Cache' },
          { path: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Code Cache'), label: 'Code Cache' }
        ]
      },
      {
        id: 'opera',
        name: 'Opera',
        processNames: ['opera.exe'],
        cachePaths: [
          { path: path.join(roaming, 'Opera Software', 'Opera Stable', 'Cache'), label: 'Cache' },
          { path: path.join(local, 'Opera Software', 'Opera Stable', 'Cache'), label: 'Cache (local)' }
        ]
      },
      {
        id: 'vivaldi',
        name: 'Vivaldi',
        processNames: ['vivaldi.exe'],
        cachePaths: [
          { path: path.join(local, 'Vivaldi', 'User Data', 'Default', 'Cache'), label: 'Cache' },
          { path: path.join(local, 'Vivaldi', 'User Data', 'Default', 'Code Cache'), label: 'Code Cache' }
        ]
      }
    ]
  }

  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      processNames: ['chrome'],
      cachePaths: [{ path: path.join(home, '.cache', 'google-chrome'), label: 'Cache' }]
    },
    {
      id: 'chromium',
      name: 'Chromium',
      processNames: ['chromium'],
      cachePaths: [{ path: path.join(home, '.cache', 'chromium'), label: 'Cache' }]
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      processNames: ['firefox'],
      cachePaths: [{ path: path.join(home, '.cache', 'mozilla'), label: 'Cache' }]
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      processNames: ['msedge'],
      cachePaths: [{ path: path.join(home, '.cache', 'microsoft-edge'), label: 'Cache' }]
    }
  ]
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.lstat(p)
    return st.isDirectory() && !st.isSymbolicLink()
  } catch {
    return false
  }
}

/** Well-known protected user folders that must never be offered as cleanup targets. */
export function personalFolderNames(): string[] {
  if (isWindows()) {
    return ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Videos', 'Music', 'OneDrive', 'Saved Games']
  }
  return ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Videos', 'Music']
}

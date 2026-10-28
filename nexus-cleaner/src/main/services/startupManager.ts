import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import type { StartupEntry, StartupSource } from '@shared/types'

/**
 * STARTUP MANAGER
 * Read: enumerates HKCU/HKLM Run keys, Startup folders, and (on Linux)
 * XDG autostart + systemd --user units.
 * Write: the ONLY mutation this app performs is toggling a value under
 * HKCU\...\Run or renaming a shortcut inside the user's own Startup folder.
 * HKLM entries are shown read-only because they need elevation, and the app
 * deliberately runs with `asInvoker`.
 */

const WIN_CRITICAL_HINTS = [
  'securityhealth',
  'windowsdefender',
  'defender',
  'windows security',
  'msmpeng',
  'rtkaudioservice',
  'realtek',
  'igfxtray',
  'hotkeyservice',
  'synaptics',
  'energy saver'
]

const SYSTEM_PATHS_HINT = ['system32', 'syswow64', 'windows\\', 'program files\\windows defender']

export function startupRisk(name: string, command: string): { risk: StartupEntry['risk']; note: string } {
  const lower = `${name} ${command}`.toLowerCase()
  if (WIN_CRITICAL_HINTS.some((h) => lower.includes(h))) {
    return { risk: 'critical', note: 'Security or hardware support component — disabling may reduce protection or break input devices.' }
  }
  if (SYSTEM_PATHS_HINT.some((h) => lower.includes(h))) {
    return { risk: 'caution', note: 'Located inside a system directory. Verify the publisher before changing anything.' }
  }
  if (command.trim().length === 0) {
    return { risk: 'caution', note: 'Empty command — the entry may be a leftover.' }
  }
  return { risk: 'safe', note: 'Regular user application startup entry.' }
}

const makeId = (source: string, key: string): string =>
  crypto.createHash('sha1').update(`${source}|${key}`).digest('hex').slice(0, 16)

export interface StartupRaw {
  name: string
  command: string
  location: string
  source: StartupSource
  controllable: boolean
  enabled: boolean
  executable: string | null
}

async function expandExe(command: string): Promise<string | null> {
  const trimmed = command.trim()
  if (!trimmed) return null
  let candidate: string
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)
    candidate = end > 0 ? trimmed.slice(1, end) : trimmed.replace(/"/g, '')
  } else {
    const spaceIdx = trimmed.indexOf(' ')
    candidate = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed
  }
  try {
    const st = await fs.stat(candidate)
    return st.isFile() ? candidate : null
  } catch {
    return null
  }
}

async function fileVersionInfo(exePath: string): Promise<string | null> {
  if (process.platform !== 'win32') return null
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$v = (Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).VersionInfo; if ($v) { $v.CompanyName }`
      ],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.trim() || null)
    )
  })
}

export class StartupManager {
  private log: { at: number; entryId: string; action: string; detail: string }[] = []

  activityLog(): typeof this.log {
    return this.log
  }

  async list(): Promise<StartupEntry[]> {
    const raw = process.platform === 'win32' ? await this.windowsEntries() : await this.posixEntries()
    const entries: StartupEntry[] = []
    for (const item of raw) {
      const exe = item.executable ?? (await expandExe(item.command))
      const publisher = exe ? await fileVersionInfo(exe) : null
      const risk = startupRisk(item.name, item.command)
      entries.push({
        id: makeId(item.source, item.name + item.location),
        name: item.name,
        command: item.command,
        executable: exe,
        location: item.location,
        source: item.source,
        publisher,
        enabled: item.enabled,
        controllable: item.controllable,
        risk: risk.risk,
        note: risk.note
      })
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  private async windowsEntries(): Promise<StartupRaw[]> {
    const script = [
      '$out = @()',
      "$paths = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')",
      'foreach ($p in $paths) {',
      '  if (Test-Path $p) {',
      '    $k = Get-Item -LiteralPath $p',
      '    foreach ($n in $k.GetValueNames()) {',
      "      $out += [pscustomobject]@{ name = $n; command = ($k.GetValue($n) -as [string]); hive = $p }",
      '    }',
      '  }',
      '}',
      '$out | ConvertTo-Json -Compress -Depth 3'
    ].join('\n')
    const raw = await new Promise<string | null>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 12_000, windowsHide: true },
        (err, stdout) => resolve(err ? null : stdout.trim() || null)
      )
    })

    const out: StartupRaw[] = []
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { name: string; command: string; hive: string } | { name: string; command: string; hive: string }[]
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of list) {
          if (!item?.name) continue
          const isHkcu = item.hive.startsWith('HKCU')
          out.push({
            name: item.name,
            command: item.command ?? '',
            location: item.hive.replace('HKEY_CURRENT_USER', 'HKCU').replace('HKEY_LOCAL_MACHINE', 'HKLM'),
            source: isHkcu ? 'HKCU Run' : 'HKLM Run',
            controllable: isHkcu,
            enabled: true,
            executable: null
          })
        }
      } catch {
        /* ignore malformed output */
      }
    }

    const programData = process.env.ProgramData ?? 'C:\\ProgramData'
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    const folders: { dir: string; source: StartupSource; controllable: boolean }[] = [
      { dir: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), source: 'Startup Folder (User)', controllable: true },
      { dir: path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp'), source: 'Startup Folder (Common)', controllable: false }
    ]
    for (const folder of folders) {
      try {
        const items = await fs.readdir(folder.dir, { withFileTypes: true })
        for (const item of items) {
          if (item.name.toLowerCase() === 'desktop.ini') continue
          out.push({
            name: item.name,
            command: path.join(folder.dir, item.name),
            location: folder.dir,
            source: folder.source,
            controllable: folder.controllable,
            enabled: !item.name.toLowerCase().endsWith('.disabled'),
            executable: item.name.toLowerCase().endsWith('.exe') ? path.join(folder.dir, item.name) : null
          })
        }
      } catch {
        /* folder absent */
      }
    }
    return out
  }

  private async posixEntries(): Promise<StartupRaw[]> {
    const home = os.homedir()
    const out: StartupRaw[] = []
    const autostartDirs = [path.join(home, '.config', 'autostart'), '/etc/xdg/autostart']
    for (const dir of autostartDirs) {
      const controllable = dir.startsWith(home)
      try {
        const items = await fs.readdir(dir)
        for (const item of items) {
          if (!item.endsWith('.desktop')) continue
          const full = path.join(dir, item)
          let content = ''
          try {
            content = await fs.readFile(full, 'utf8')
          } catch {
            continue
          }
          const execLine = /^Exec=(.*)$/m.exec(content)?.[1]?.trim() ?? ''
          const nameLine = /^Name=(.*)$/m.exec(content)?.[1]?.trim() ?? item
          const hidden = /^Hidden=true$/m.test(content) || /^X-GNOME-Autostart-enabled=false$/m.test(content)
          out.push({
            name: nameLine,
            command: execLine,
            location: full,
            source: 'XDG autostart',
            controllable,
            enabled: !hidden,
            executable: null
          })
        }
      } catch {
        /* absent */
      }
    }
    return out
  }

  async setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    const entries = await this.list()
    const entry = entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: 'Entry not found. Refresh the list.' }
    if (!entry.controllable) {
      return {
        ok: false,
        error: 'This entry requires administrator rights or belongs to a machine-wide location. NEXUS Cleaner does not modify it.'
      }
    }
    if (entry.risk === 'critical') {
      return { ok: false, error: 'Refused: this entry appears to be a security or hardware support component.' }
    }

    if (process.platform === 'win32') {
      if (entry.source === 'HKCU Run') {
        const script = enabled
          ? `Set-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${entry.name.replace(/'/g, "''")}' -Value '${entry.command.replace(/'/g, "''")}'`
          : `Remove-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${entry.name.replace(/'/g, "''")}' -ErrorAction Stop`
        const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { timeout: 10_000, windowsHide: true },
            (err, _stdout, stderr) => (err ? resolve({ ok: false, error: (stderr || err.message).slice(0, 300) }) : resolve({ ok: true }))
          )
        })
        this.log.push({ at: Date.now(), entryId: id, action: enabled ? 'enable' : 'disable', detail: `${entry.name} (${entry.source})` })
        return result
      }
      if (entry.source === 'Startup Folder (User)') {
        const target = entry.command
        const disabled = `${target}.disabled`
        try {
          if (enabled) await fs.rename(disabled, target)
          else await fs.rename(target, disabled)
          this.log.push({ at: Date.now(), entryId: id, action: enabled ? 'enable' : 'disable', detail: target })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      }
      return { ok: false, error: 'Unsupported startup source for changes.' }
    }

    // Linux: toggle Hidden= in the .desktop file.
    if (entry.source === 'XDG autostart') {
      try {
        const content = await fs.readFile(entry.location, 'utf8')
        const updated = enabled
          ? content.replace(/^Hidden=true$/m, 'Hidden=false')
          : /^Hidden=/m.test(content)
            ? content.replace(/^Hidden=.*$/m, 'Hidden=true')
            : content.replace(/\[Desktop Entry\]/, '[Desktop Entry]\nHidden=true')
        await fs.writeFile(entry.location, updated, 'utf8')
        this.log.push({ at: Date.now(), entryId: id, action: enabled ? 'enable' : 'disable', detail: entry.location })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
    return { ok: false, error: 'Unsupported startup source on this platform.' }
  }
}

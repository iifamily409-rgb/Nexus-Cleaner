import fs from 'node:fs/promises'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { listVolumes } from './diskUsage'
import { runPowerShell } from './systemMonitor'
import type { DiskHealthInfo, InstalledApp, SystemInfoReport } from '@shared/types'

/**
 * SOFTWARE INVENTORY & DISK HEALTH — strictly read-only.
 * Nothing here uninstalls, partitions, repairs or writes to the registry.
 */

export class SystemInfoService {
  async installedApps(): Promise<InstalledApp[]> {
    if (process.platform === 'win32') return this.windowsApps()
    return this.posixApps()
  }

  private async windowsApps(): Promise<InstalledApp[]> {
    const script = [
      '$paths = @(',
      "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
      ')',
      '$out = @()',
      'foreach ($p in $paths) {',
      '  Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {',
      '    $out += [pscustomobject]@{',
      '      name = $_.DisplayName;',
      '      version = $_.DisplayVersion;',
      '      publisher = $_.Publisher;',
      '      installDate = $_.InstallDate;',
      '      sizeKb = $_.EstimatedSize;',
      '      location = $_.InstallLocation',
      '    }',
      '  }',
      '}',
      '$out | Sort-Object name -Unique | ConvertTo-Json -Compress -Depth 3'
    ].join('\n')
    const raw = await runPowerShell(script, 40000)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as
        | {
            name: string
            version: string | null
            publisher: string | null
            installDate: string | null
            sizeKb: number | null
            location: string | null
          }[]
        | {
            name: string
            version: string | null
            publisher: string | null
            installDate: string | null
            sizeKb: number | null
            location: string | null
          }
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return list
        .filter((a) => a?.name)
        .map((a) => ({
          name: a.name,
          version: a.version ?? null,
          publisher: a.publisher ?? null,
          installDate: a.installDate ?? null,
          estimatedSizeBytes: typeof a.sizeKb === 'number' ? a.sizeKb * 1024 : null,
          location: a.location && a.location.trim() ? a.location : null,
          source: 'Windows Registry' as const
        }))
    } catch {
      return []
    }
  }

  private async posixApps(): Promise<InstalledApp[]> {
    const apps: InstalledApp[] = []
    // dpkg gives exact installed sizes; fall back to .desktop files.
    try {
      const out = await runCommand('dpkg-query', ['-W', '-f', '${Package}\t${Version}\t${Installed-Size}\n'])
      for (const line of out.split('\n')) {
        const [name, version, sizeKb] = line.split('\t')
        if (!name) continue
        apps.push({
          name,
          version: version ?? null,
          publisher: null,
          installDate: null,
          estimatedSizeBytes: sizeKb ? Number(sizeKb) * 1024 : null,
          location: null,
          source: 'dpkg'
        })
      }
      if (apps.length > 0) return apps.sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      /* dpkg unavailable */
    }
    try {
      const dirs = ['/usr/share/applications', `${os.homedir()}/.local/share/applications`]
      const seen = new Set<string>()
      for (const dir of dirs) {
        let files: string[] = []
        try {
          files = await fs.readdir(dir)
        } catch {
          continue
        }
        for (const file of files) {
          if (!file.endsWith('.desktop')) continue
          try {
            const content = await fs.readFile(`${dir}/${file}`, 'utf8')
            const name = /^Name=(.*)$/m.exec(content)?.[1]?.trim()
            if (!name || seen.has(name)) continue
            seen.add(name)
            apps.push({
              name,
              version: null,
              publisher: null,
              installDate: null,
              estimatedSizeBytes: null,
              location: `${dir}/${file}`,
              source: 'desktop entry'
            })
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* ignore */
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name))
  }

  async diskHealth(): Promise<DiskHealthInfo[]> {
    if (process.platform === 'win32') {
      const script = [
        'Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {',
        '  [pscustomobject]@{',
        '    device = $_.DeviceId; model = $_.Model; size = [int64]$_.Size;',
        '    health = "$($_.HealthStatus)"; status = "$($_.OperationalStatus)"',
        '  }',
        '} | ConvertTo-Json -Compress -Depth 3'
      ].join('\n')
      const raw = await runPowerShell(script, 15000)
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw) as
          | { device: string; model: string | null; size: number | null; health: string; status: string }[]
          | { device: string; model: string | null; size: number | null; health: string; status: string }
        const list = Array.isArray(parsed) ? parsed : [parsed]
        return list.map((d) => ({
          device: String(d.device),
          model: d.model ?? null,
          sizeBytes: typeof d.size === 'number' ? d.size : null,
          health: d.health || 'Unknown',
          status: d.status || 'Unknown',
          temperatureC: null,
          source: 'Win32 Get-PhysicalDisk'
        }))
      } catch {
        return []
      }
    }
    // Linux: SMART needs root, so report what is readable unprivileged.
    const out: DiskHealthInfo[] = []
    try {
      const names = await fs.readdir('/sys/block')
      for (const name of names) {
        if (/^(loop|ram|dm-|sr|fd|zram)/.test(name)) continue
        let sizeBlocks = 0
        try {
          sizeBlocks = Number((await fs.readFile(`/sys/block/${name}/size`, 'utf8')).trim())
        } catch {
          continue
        }
        out.push({
          device: name,
          model: null,
          sizeBytes: sizeBlocks * 512,
          health: 'Unavailable (needs SMART privileges)',
          status: 'Read-only check not permitted without elevation',
          temperatureC: null,
          source: '/sys/block'
        })
      }
    } catch {
      /* ignore */
    }
    return out
  }

  async info(): Promise<SystemInfoReport> {
    const cpus = os.cpus()
    const volumes = await listVolumes()
    const [health, apps] = await Promise.all([this.diskHealth(), this.installedApps()])
    const notes: string[] = []
    if (process.platform !== 'win32') {
      notes.push('This build is running on a non-Windows host: Windows-specific checks report as unavailable rather than guessing.')
    }
    return {
      generatedAt: Date.now(),
      platform: process.platform,
      osVersion: `${os.version?.() ?? os.release()} `,
      release: os.release(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model.trim() ?? 'Unknown',
      cpuCores: cpus.length,
      totalMemBytes: os.totalmem(),
      hostname: os.hostname(),
      uptimeSec: os.uptime(),
      gpus: [],
      disks: volumes.map((v) => ({
        mount: v.mount,
        totalBytes: v.totalBytes,
        freeBytes: v.freeBytes,
        usedBytes: v.totalBytes - v.freeBytes,
        usedPercent: v.usedPercent
      })),
      health,
      apps,
      startup: [],
      notes
    }
  }

  /** Checks for pending Windows updates without installing anything. */
  async checkUpdates(): Promise<{ ok: boolean; message: string; pending: number | null }> {
    if (process.platform !== 'win32') {
      try {
        const out = await runCommand('apt-get', ['-s', '-o', 'Debug::NoLocking=1', 'upgrade'])
        const pending = out.split('\n').filter((l) => /^Inst\s/.test(l)).length
        return { ok: true, message: `${pending} package update(s) available (simulation only, nothing was installed).`, pending }
      } catch {
        return { ok: false, message: 'Update check is not available on this platform.', pending: null }
      }
    }
    const script = [
      'try {',
      "  $session = New-Object -ComObject Microsoft.Update.Session",
      "  $searcher = $session.CreateUpdateSearcher()",
      '  $result = $searcher.Search("IsInstalled=0 and IsHidden=0")',
      '  $result.Updates.Count',
      '} catch { "ERROR: " + $_.Exception.Message }'
    ].join('\n')
    const raw = await runPowerShell(script, 60000)
    if (!raw) return { ok: false, message: 'Windows Update search did not return a result (it may be disabled or busy).', pending: null }
    if (raw.startsWith('ERROR')) return { ok: false, message: raw.slice(0, 300), pending: null }
    const count = Number(raw.trim())
    return Number.isFinite(count)
      ? { ok: true, message: `${count} update(s) are available. Nothing was downloaded or installed by NEXUS Cleaner.`, pending: count }
      : { ok: false, message: 'Could not parse the update search result.', pending: null }
  }

  /** Read-only system file integrity check (SFC /verifyonly). Never repairs. */
  async integrityCheck(): Promise<{ ok: boolean; message: string; stdout: string }> {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'System File Checker verification only exists on Windows.', stdout: '' }
    }
    return new Promise((resolve) => {
      execFile(
        'sfc.exe',
        ['/verifyonly'],
        { timeout: 10 * 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const text = `${stdout ?? ''}${stderr ?? ''}`.trim()
          if (err) {
            resolve({
              ok: false,
              message: 'sfc /verifyonly could not complete. It usually requires an elevated console.',
              stdout: text.slice(0, 20000)
            })
            return
          }
          const clean = /did not find any integrity violations/i.test(text)
          resolve({
            ok: true,
            message: clean
              ? 'Windows reports no integrity violations.'
              : 'Verification finished — review the output. No repairs were performed.',
            stdout: text.slice(0, 20000)
          })
        }
      )
    })
  }
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

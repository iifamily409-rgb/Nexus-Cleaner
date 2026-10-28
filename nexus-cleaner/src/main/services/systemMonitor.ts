import os from 'node:os'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { getDiskUsage } from './diskUsage'
import type { MetricsSnapshot, ProcessInfo, BatteryStatus } from '@shared/types'

/**
 * SYSTEM MONITOR
 * All values are measured from the OS. Anything unavailable stays `null`
 * rather than being replaced with a plausible-looking fake number.
 */

interface CpuSample {
  at: number
  idle: number
  total: number
}

interface NetSample {
  at: number
  rx: number
  tx: number
}

interface DiskIoSample {
  at: number
  read: number
  write: number
}

export class SystemMonitor {
  private lastCpu: CpuSample | null = null
  private lastNet: NetSample | null = null
  private lastDiskIo: DiskIoSample | null = null
  private cachedBattery: { at: number; value: BatteryStatus | null } = { at: 0, value: null }
  private cachedProcessCount = 0

  private cpuSnapshot(): { idle: number; total: number } {
    let idle = 0
    let total = 0
    for (const cpu of os.cpus()) {
      idle += cpu.times.idle
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
    }
    return { idle, total }
  }

  /** Non-blocking CPU percentage derived from two samples. First call returns 0. */
  cpuPercent(): number {
    const snap = this.cpuSnapshot()
    const previous = this.lastCpu
    this.lastCpu = { at: Date.now(), ...snap }
    if (!previous) return 0
    const idleDelta = snap.idle - previous.idle
    const totalDelta = snap.total - previous.total
    if (totalDelta <= 0) return 0
    const pct = (1 - idleDelta / totalDelta) * 100
    return Math.min(100, Math.max(0, Number(pct.toFixed(1))))
  }

  async netRates(): Promise<{ rx: number | null; tx: number | null }> {
    const counters = await readNetCounters()
    if (!counters) return { rx: null, tx: null }
    const now = Date.now()
    const prev = this.lastNet
    this.lastNet = { at: now, rx: counters.rx, tx: counters.tx }
    if (!prev || now - prev.at < 200) return { rx: null, tx: null }
    const seconds = (now - prev.at) / 1000
    const rx = Math.max(0, (counters.rx - prev.rx) / seconds)
    const tx = Math.max(0, (counters.tx - prev.tx) / seconds)
    // Counter reset (interface change) would produce nonsense.
    if (counters.rx < prev.rx || counters.tx < prev.tx) return { rx: null, tx: null }
    return { rx: Math.round(rx), tx: Math.round(tx) }
  }

  async diskRates(): Promise<{ read: number | null; write: number | null }> {
    if (process.platform === 'win32') return { read: null, write: null }
    try {
      const content = await fs.readFile('/proc/diskstats', 'utf8')
      let read = 0
      let write = 0
      for (const line of content.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 10) continue
        const name = parts[2] ?? ''
        if (/^(loop|ram|dm-|sr|fd)/.test(name)) continue
        read += Number(parts[5] ?? 0) * 512
        write += Number(parts[9] ?? 0) * 512
      }
      const now = Date.now()
      const prev = this.lastDiskIo
      this.lastDiskIo = { at: now, read, write }
      if (!prev) return { read: null, write: null }
      const seconds = (now - prev.at) / 1000
      if (seconds <= 0) return { read: null, write: null }
      return {
        read: Math.max(0, Math.round((read - prev.read) / seconds)),
        write: Math.max(0, Math.round((write - prev.write) / seconds))
      }
    } catch {
      return { read: null, write: null }
    }
  }

  async battery(): Promise<BatteryStatus | null> {
    const now = Date.now()
    if (now - this.cachedBattery.at < 15_000) return this.cachedBattery.value
    let value: BatteryStatus | null = null
    try {
      if (process.platform === 'win32') {
        value = await this.windowsBattery()
      } else {
        value = await this.posixBattery()
      }
    } catch {
      value = null
    }
    this.cachedBattery = { at: now, value }
    return value
  }

  private async windowsBattery(): Promise<BatteryStatus | null> {
    const script = [
      '$b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1',
      'if ($b) {',
      '  $est = Get-CimInstance -ClassName BatteryStatus -Namespace root\\wmi -ErrorAction SilentlyContinue | Select-Object -First 1',
      '  $o = [ordered]@{ percent = [int]$b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -ge 2); minutes = $null }',
      '  if ($est -and $est.EstimatedRunTime -and $est.EstimatedRunTime -lt 71582788) { $o.minutes = [int]$est.EstimatedRunTime }',
      '  $o | ConvertTo-Json -Compress',
      '}'
    ].join('\n')
    const raw = await runPowerShell(script, 6000)
    if (!raw) return { hasBattery: false, percent: null, charging: null, minutesRemaining: null }
    try {
      const parsed = JSON.parse(raw) as { percent?: number; charging?: boolean; minutes?: number | null }
      return {
        hasBattery: true,
        percent: typeof parsed.percent === 'number' ? parsed.percent : null,
        charging: typeof parsed.charging === 'boolean' ? parsed.charging : null,
        minutesRemaining: typeof parsed.minutes === 'number' ? parsed.minutes : null
      }
    } catch {
      return { hasBattery: false, percent: null, charging: null, minutesRemaining: null }
    }
  }

  private async posixBattery(): Promise<BatteryStatus | null> {
    const base = '/sys/class/power_supply'
    try {
      const names = await fs.readdir(base)
      const battery = names.find((n) => n.startsWith('BAT'))
      if (!battery) return { hasBattery: false, percent: null, charging: null, minutesRemaining: null }
      const read = async (file: string): Promise<string | null> => {
        try {
          return (await fs.readFile(`${base}/${battery}/${file}`, 'utf8')).trim()
        } catch {
          return null
        }
      }
      const capacity = await read('capacity')
      const status = await read('status')
      return {
        hasBattery: true,
        percent: capacity ? Number(capacity) : null,
        charging: status ? status.toLowerCase() === 'charging' : null,
        minutesRemaining: null
      }
    } catch {
      return null
    }
  }

  async processCount(): Promise<number> {
    try {
      const procs = await this.processes()
      this.cachedProcessCount = procs.length
      return procs.length
    } catch {
      return this.cachedProcessCount
    }
  }

  async snapshot(): Promise<MetricsSnapshot> {
    const cpuPercent = this.cpuPercent()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const [disk, net, diskIo, battery] = await Promise.all([
      getDiskUsage(),
      this.netRates(),
      this.diskRates(),
      this.battery()
    ])
    let processCount = this.cachedProcessCount
    try {
      processCount = (await fs.readdir('/proc')).filter((n) => /^\d+$/.test(n)).length
    } catch {
      if (process.platform === 'win32') {
        processCount = await this.windowsProcessCount()
      }
    }
    this.cachedProcessCount = processCount
    return {
      at: Date.now(),
      cpuPercent,
      memTotalBytes: totalMem,
      memUsedBytes: totalMem - freeMem,
      memPercent: totalMem > 0 ? Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1)) : 0,
      disk,
      diskReadBytesPerSec: diskIo.read,
      diskWriteBytesPerSec: diskIo.write,
      uptimeSec: os.uptime(),
      loadAvg: [os.loadavg()[0] ?? 0, os.loadavg()[1] ?? 0, os.loadavg()[2] ?? 0],
      battery,
      netRxBytesPerSec: net.rx,
      netTxBytesPerSec: net.tx,
      processCount
    }
  }

  private async windowsProcessCount(): Promise<number> {
    try {
      const list = await this.processes()
      return list.length
    } catch {
      return 0
    }
  }

  async processes(): Promise<ProcessInfo[]> {
    if (process.platform === 'win32') return this.windowsProcesses()
    return this.posixProcesses()
  }

  private async posixProcesses(): Promise<ProcessInfo[]> {
    const out: ProcessInfo[] = []
    const clockTicks = 100
    const pageSize = 4096
    let stat: string
    try {
      stat = await fs.readFile('/proc/stat', 'utf8')
    } catch {
      return out
    }
    const cpuLine = stat.split('\n')[0] ?? ''
    const cpuParts = cpuLine.trim().split(/\s+/).slice(1).map(Number)
    const totalTicks = cpuParts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
    let entries: string[] = []
    try {
      entries = (await fs.readdir('/proc')).filter((n) => /^\d+$/.test(n))
    } catch {
      return out
    }
    const readProc = async (pid: string): Promise<ProcessInfo | null> => {
      try {
        const [statRaw, status, cmdline] = await Promise.all([
          fs.readFile(`/proc/${pid}/stat`, 'utf8'),
          fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''),
          fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
        ])
        const closeParen = statRaw.lastIndexOf(')')
        const name = statRaw.slice(statRaw.indexOf('(') + 1, closeParen)
        const rest = statRaw.slice(closeParen + 2).split(' ')
        const utime = Number(rest[11] ?? 0)
        const stime = Number(rest[12] ?? 0)
        const rssPages = Number(rest[21] ?? 0)
        const uidMatch = /Uid:\s+(\d+)/.exec(status)
        const procTicks = utime + stime
        const cpuPercent = totalTicks > 0 ? Number(((procTicks / totalTicks) * os.cpus().length * 100).toFixed(1)) : 0
        const uid = uidMatch ? uidMatch[1] : '0'
        return {
          pid: Number(pid),
          name,
          cpuPercent: Math.min(10_000, cpuPercent),
          memBytes: rssPages * pageSize,
          user: uid === '0' ? 'root' : uid ?? 'unknown',
          command: cmdline.replace(/\0/g, ' ').trim().slice(0, 300),
          protected: ['systemd', 'init', 'kthreadd', 'dbus-daemon', 'sshd', 'kernel'].includes(name) || Number(pid) <= 2
        }
      } catch {
        return null
      }
    }
    const batch = 64
    for (let i = 0; i < entries.length; i += batch) {
      const slice = entries.slice(i, i + batch)
      const results = await Promise.all(slice.map(readProc))
      for (const r of results) if (r) out.push(r)
    }
    void clockTicks
    return out.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memBytes - a.memBytes)
  }

  private async windowsProcesses(): Promise<ProcessInfo[]> {
    const script = [
      'Get-CimInstance Win32_Process | ForEach-Object {',
      '  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue',
      '  [pscustomobject]@{',
      '    pid = $_.ProcessId;',
      '    name = $_.Name;',
      '    cpu = if ($p) { [math]::Round($p.CPU, 2) } else { 0 };',
      '    mem = if ($p) { [int64]$p.WorkingSet64 } else { [int64]$_.WorkingSetSize };',
      '    user = $_.GetOwner().User;',
      '    cmd = $_.CommandLine',
      '  }',
      '} | ConvertTo-Json -Compress -Depth 3'
    ].join('\n')
    const raw = await runPowerShell(script, 12_000)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as
        | { pid: number; name: string; cpu: number | null; mem: number | null; user: string | null; cmd: string | null }
        | { pid: number; name: string; cpu: number | null; mem: number | null; user: string | null; cmd: string | null }[]
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const systemCritical = new Set([
        'system',
        'system idle process',
        'smss.exe',
        'csrss.exe',
        'wininit.exe',
        'winlogon.exe',
        'services.exe',
        'lsass.exe',
        'svchost.exe',
        'dwm.exe',
        'explorer.exe',
        'ntoskrnl.exe',
        'registry'
      ])
      return list
        .map((p) => ({
          pid: p.pid,
          name: p.name,
          cpuPercent: typeof p.cpu === 'number' ? p.cpu : 0,
          memBytes: typeof p.mem === 'number' ? p.mem : 0,
          user: p.user ?? 'unknown',
          command: (p.cmd ?? '').slice(0, 300),
          protected: systemCritical.has((p.name ?? '').toLowerCase())
        }))
        .filter((p) => Number.isFinite(p.pid))
        .sort((a, b) => b.cpuPercent - a.cpuPercent || b.memBytes - a.memBytes)
    } catch {
      return []
    }
  }
}

async function readNetCounters(): Promise<{ rx: number; tx: number } | null> {
  if (process.platform !== 'win32') {
    try {
      const raw = await fs.readFile('/proc/net/dev', 'utf8')
      let rx = 0
      let tx = 0
      for (const line of raw.split('\n').slice(2)) {
        const [ifaceRaw, rest] = line.split(':')
        if (!ifaceRaw || !rest) continue
        const iface = ifaceRaw.trim()
        if (iface === 'lo') continue
        const parts = rest.trim().split(/\s+/)
        rx += Number(parts[0] ?? 0)
        tx += Number(parts[8] ?? 0)
      }
      return { rx, tx }
    } catch {
      return null
    }
  }
  // Windows: sum interface octets via PowerShell, cached by the caller's interval.
  const script =
    'Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Measure-Object -Property ReceivedBytes,SentBytes -Sum | ForEach-Object { [pscustomobject]@{ rx = ($_.Sum[0]); tx = ($_.Sum[1]) } } | ConvertTo-Json -Compress'
  const raw = await runPowerShell(script, 5000)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { rx?: number; tx?: number }
    return { rx: Number(parsed.rx ?? 0), tx: Number(parsed.tx ?? 0) }
  } catch {
    return null
  }
}

export function runPowerShell(command: string, timeoutMs = 10_000): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) resolve(null)
        else resolve(stdout.trim())
      }
    )
  })
}

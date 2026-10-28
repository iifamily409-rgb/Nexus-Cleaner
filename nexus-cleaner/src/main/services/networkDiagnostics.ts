import os from 'node:os'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import net from 'node:net'
import https from 'node:https'
import { runPowerShell } from './systemMonitor'
import type { NetworkAdapter, NetworkDiagnostics } from '@shared/types'

/**
 * NETWORK DIAGNOSTICS — read-only.
 * We never change DNS, reset adapters, disable security features or modify
 * firewall rules. Latency is measured against a couple of well-known
 * endpoints; throughput is measured in-process with no upload of user data.
 */

const PING_TARGETS = [
  { host: '1.1.1.1', port: 443, name: 'Cloudflare' },
  { host: '8.8.8.8', port: 443, name: 'Google DNS' },
  { host: '93.184.216.34', port: 80, name: 'example.com' }
]
const DNS_TEST_HOSTS = ['example.com', 'cloudflare.com']

export class NetworkDiagnosticsService {
  private lastRx: { at: number; value: number } | null = null
  private lastTx: { at: number; value: number } | null = null

  async adapters(): Promise<NetworkAdapter[]> {
    const out: NetworkAdapter[] = []
    const interfaces = os.networkInterfaces()
    for (const [name, addresses] of Object.entries(interfaces)) {
      if (!addresses) continue
      const ipv4 = addresses.find((a) => a.family === 'IPv4')
      const first = ipv4 ?? addresses[0]
      if (!first) continue
      out.push({
        name,
        address: first.address,
        family: first.family,
        internal: first.internal,
        mac: first.mac && first.mac !== '00:00:00:00:00:00' ? first.mac : null,
        speedMbps: await this.linkSpeed(name)
      })
    }
    return out.filter((a) => !a.internal || a.address !== '127.0.0.1')
  }

  private async linkSpeed(name: string): Promise<number | null> {
    try {
      const raw = await fs.readFile(`/sys/class/net/${name}/speed`, 'utf8')
      const value = Number(raw.trim())
      return Number.isFinite(value) && value > 0 ? value : null
    } catch {
      if (process.platform === 'win32') {
        const raw = await runPowerShell(
          `(Get-NetAdapter -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).LinkSpeed`,
          4000
        )
        if (raw) {
          const match = /([\d.]+)\s*(G|M)bps/i.exec(raw)
          if (match?.[1]) {
            const value = Number(match[1])
            return /G/i.test(match[2] ?? '') ? value * 1000 : value
          }
        }
        return null
      }
      return null
    }
  }

  async latency(): Promise<number | null> {
    const results: number[] = []
    for (const target of PING_TARGETS) {
      const ms = await tcpProbe(target.host, target.port, 2500)
      if (ms !== null) results.push(ms)
      if (results.length >= 2) break
    }
    if (results.length === 0) return null
    return Math.round(results.reduce((a, b) => a + b, 0) / results.length)
  }

  async dnsTest(): Promise<{ ms: number | null; servers: string[] }> {
    const started = Date.now()
    let ok = false
    for (const host of DNS_TEST_HOSTS) {
      try {
        await dns.lookup(host)
        ok = true
        break
      } catch {
        /* try next */
      }
    }
    const ms = ok ? Date.now() - started : null
    const servers = await this.dnsServers()
    return { ms, servers }
  }

  private async dnsServers(): Promise<string[]> {
    if (process.platform === 'win32') {
      const raw = await runPowerShell(
        'Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses } | ForEach-Object { $_.ServerAddresses } | Sort-Object -Unique',
        6000
      )
      return raw ? raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => isIp(s)).slice(0, 8) : []
    }
    try {
      const raw = await fs.readFile('/etc/resolv.conf', 'utf8')
      return raw
        .split('\n')
        .map((line) => /^nameserver\s+(\S+)/.exec(line.trim())?.[1])
        .filter((v): v is string => Boolean(v))
        .slice(0, 8)
    } catch {
      return []
    }
  }

  async rates(): Promise<{ rx: number | null; tx: number | null }> {
    let rx: number | null = null
    let tx: number | null = null
    try {
      if (process.platform === 'win32') {
        const raw = await runPowerShell(
          'Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Measure-Object -Property ReceivedBytes -Sum',
          5000
        )
        void raw
        return { rx: null, tx: null }
      }
      const content = await fs.readFile('/proc/net/dev', 'utf8')
      let totalRx = 0
      let totalTx = 0
      for (const line of content.split('\n').slice(2)) {
        const [ifaceRaw, rest] = line.split(':')
        if (!ifaceRaw || !rest || ifaceRaw.trim() === 'lo') continue
        const parts = rest.trim().split(/\s+/)
        totalRx += Number(parts[0] ?? 0)
        totalTx += Number(parts[8] ?? 0)
      }
      const now = Date.now()
      if (this.lastRx && this.lastTx) {
        const seconds = (now - this.lastRx.at) / 1000
        if (seconds > 0) {
          rx = Math.max(0, Math.round((totalRx - this.lastRx.value) / seconds))
          tx = Math.max(0, Math.round((totalTx - this.lastTx.value) / seconds))
        }
      }
      this.lastRx = { at: now, value: totalRx }
      this.lastTx = { at: now, value: totalTx }
    } catch {
      /* unavailable */
    }
    return { rx, tx }
  }

  async diagnostics(): Promise<NetworkDiagnostics> {
    const [adapters, latency, dnsResult, rates] = await Promise.all([
      this.adapters(),
      this.latency(),
      this.dnsTest(),
      this.rates()
    ])
    const online = latency !== null || dnsResult.ms !== null
    const recommendations: string[] = []
    if (!online) {
      recommendations.push('No outbound connectivity detected. Check the adapter, cable/Wi-Fi and router before investigating software causes.')
    } else if (latency !== null && latency > 200) {
      recommendations.push(`Average TCP handshake latency is ${latency} ms. High latency usually points to Wi-Fi signal quality, an overloaded router, or a distant VPN endpoint.`)
    }
    if (dnsResult.ms !== null && dnsResult.ms > 400) {
      recommendations.push('DNS resolution is slow. This is often a router or ISP resolver issue — NEXUS will not change your DNS settings for you.')
    }
    if (dnsResult.ms === null) {
      recommendations.push('DNS lookups failed. Try another network or check whether a VPN/proxy is intercepting traffic.')
    }
    if (rates.rx !== null && rates.rx > 5 * 1024 * 1024) {
      recommendations.push('Background download activity is currently high. Check the System Monitor page for processes using the network.')
    }
    return {
      at: Date.now(),
      adapters,
      online,
      latencyMs: latency,
      dnsResolutionMs: dnsResult.ms,
      dnsServers: dnsResult.servers,
      rxBytesPerSec: rates.rx,
      txBytesPerSec: rates.tx,
      throughputTest: null,
      recommendations
    }
  }

  /**
   * Download throughput measured by fetching a fixed, small public file.
   * Upload is not measured because that would require sending test data to a
   * third party; we report it as unsupported instead of inventing a number.
   */
  async throughput(): Promise<{ ok: boolean; downMbps: number | null; upMbps: number | null; message: string }> {
    const url = 'https://speed.cloudflare.com/__down?bytes=5000000'
    const timeoutMs = 20_000
    const started = Date.now()
    try {
      const bytes = await new Promise<number>((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs }, (res) => {
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          let total = 0
          res.on('data', (chunk: Buffer) => {
            total += chunk.length
          })
          res.on('end', () => resolve(total))
          res.on('error', reject)
        })
        req.on('timeout', () => {
          req.destroy(new Error('timeout'))
        })
        req.on('error', reject)
      })
      const seconds = Math.max(0.001, (Date.now() - started) / 1000)
      const mbps = Number(((bytes * 8) / seconds / 1_000_000).toFixed(2))
      return {
        ok: true,
        downMbps: mbps,
        upMbps: null,
        message: `Downloaded ${(bytes / 1_000_000).toFixed(1)} MB in ${seconds.toFixed(1)}s. Upload speed is not measured to avoid sending data to a third party.`
      }
    } catch (err) {
      return { ok: false, downMbps: null, upMbps: null, message: `Throughput test failed: ${(err as Error).message}` }
    }
  }
}

function isIp(value: string): boolean {
  return net.isIP(value) !== 0
}

/** Measures TCP connect time to a host:port. Returns null on failure. */
export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = new net.Socket()
    let settled = false
    const finish = (value: number | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(Date.now() - started))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
    try {
      socket.connect(port, host)
    } catch {
      finish(null)
    }
  })
}

import { useEffect, useState } from 'react'
import { Wifi, RefreshCw, ShieldAlert } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Panel, PanelHeader, StatCard } from '../components/ui'
import { api, formatRate } from '../lib/api'
import type { NetworkDiagnostics } from '@shared/types'

export function NetworkPage(): React.JSX.Element {
  const app = useApp()
  const [diag, setDiag] = useState<NetworkDiagnostics | null>(null)
  const [loading, setLoading] = useState(false)
  const [throughput, setThroughput] = useState<{ ok: boolean; downMbps: number | null; upMbps: number | null; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setDiag(await api().network.diagnostics())
    } catch (err) {
      app.notify(`Diagnostics failed: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runThroughput = async (): Promise<void> => {
    setTesting(true)
    try {
      setThroughput(await api().network.throughput())
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status" value={diag ? (diag.online ? 'Online' : 'Offline') : '—'} accent={Boolean(diag?.online)} sub={diag ? `${diag.adapters.length} interface(s)` : undefined} />
        <StatCard label="Latency (TCP)" value={diag?.latencyMs !== null && diag?.latencyMs !== undefined ? `${diag.latencyMs} ms` : '—'} sub="Average connect time to well-known endpoints" />
        <StatCard label="DNS lookup" value={diag?.dnsResolutionMs !== null && diag?.dnsResolutionMs !== undefined ? `${diag.dnsResolutionMs} ms` : 'failed'} sub="End-to-end resolution timing" />
        <StatCard label="Live traffic" value={formatRate(diag?.rxBytesPerSec ?? null)} sub={diag ? `upload ${formatRate(diag.txBytesPerSec)}` : undefined} />
      </div>

      <Panel glow>
        <PanelHeader
          title="Network Diagnostics"
          subtitle="Read-only checks. NEXUS never changes DNS servers, resets adapters, disables security features or modifies firewall rules."
          icon={<Wifi size={15} />}
          right={
            <Button onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Re-run
            </Button>
          }
        />
        <div className="divide-y divide-[color:var(--nx-border)]/60">
          {(diag?.adapters ?? []).length === 0 ? (
            <EmptyState title="No adapters reported" hint="The interface table could not be read." />
          ) : (
            diag?.adapters.map((adapter) => (
              <div key={`${adapter.name}-${adapter.address}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-[11.5px]">
                <span className="w-40 shrink-0 font-medium">{adapter.name}</span>
                <span className="nx-mono">{adapter.address ?? '—'}</span>
                <Badge>{adapter.family ?? '—'}</Badge>
                {adapter.mac && <span className="nx-mono text-[10.5px] text-[color:var(--nx-text-dim)]">{adapter.mac}</span>}
                {adapter.speedMbps !== null && <span className="nx-mono text-[10.5px] text-[color:var(--nx-text-dim)]">{adapter.speedMbps} Mbps link</span>}
              </div>
            ))
          )}
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Throughput test" subtitle="Measures real download speed against a public test endpoint. Upload is not measured, because that requires sending data to a third party." />
          <div className="px-4 py-3">
            <Button variant="primary" onClick={runThroughput} disabled={testing}>
              {testing ? 'Measuring…' : 'Run download test'}
            </Button>
            {throughput && (
              <div className="mt-3 space-y-1 text-[11.5px]">
                <div className="nx-mono text-base font-semibold nx-text-accent">{throughput.downMbps !== null ? `${throughput.downMbps} Mbps` : '—'}</div>
                <p className="text-[color:var(--nx-text-dim)]">{throughput.message}</p>
              </div>
            )}
            <p className="mt-3 text-[10.5px] leading-relaxed text-[color:var(--nx-text-dim)]">
              The test downloads a fixed 5 MB payload from Cloudflare’s public speed endpoint and discards it. No personal data is transmitted.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="DNS servers in use" subtitle="Reported, not modified." />
          <div className="px-4 py-3">
            {diag && diag.dnsServers.length > 0 ? (
              <ul className="nx-mono space-y-1 text-[11px]">
                {diag.dnsServers.map((server) => (
                  <li key={server}>{server}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[color:var(--nx-text-dim)]">No DNS servers could be read.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Recommendations" subtitle="Derived from the measurements above." icon={<ShieldAlert size={14} />} />
        <ul className="space-y-1.5 px-4 py-3 text-[11.5px]">
          {(diag?.recommendations ?? []).length === 0 ? (
            <li className="text-[color:var(--nx-text-dim)]">No issues identified in the latest measurements.</li>
          ) : (
            diag?.recommendations.map((rec) => (
              <li key={rec} className="flex gap-2 text-[color:var(--nx-text-dim)]">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--nx-accent)]" />
                <span>{rec}</span>
              </li>
            ))
          )}
        </ul>
      </Panel>
    </div>
  )
}

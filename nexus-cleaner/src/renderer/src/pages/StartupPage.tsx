import { useEffect, useState } from 'react'
import { Rocket, RefreshCw, ShieldAlert } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Panel, PanelHeader, Toggle } from '../components/ui'
import { api } from '../lib/api'
import type { StartupEntry } from '@shared/types'

export function StartupPage(): React.JSX.Element {
  const app = useApp()
  const [entries, setEntries] = useState<StartupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<string[]>([])

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setEntries(await api().monitor.startup())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggle = async (entry: StartupEntry, enabled: boolean): Promise<void> => {
    if (!enabled) {
      const confirmed = await app.confirmDestructive(
        'Disable startup entry',
        `Disable “${entry.name}”?`,
        `Source: ${entry.source}\nCommand: ${entry.command}\n\nThis ${entry.source === 'HKCU Run' ? 'removes the value from your user Run key (re-enable by adding it back, or use Restore below)' : 'renames the shortcut so Windows no longer starts it'}. It does not uninstall the application. A system restart is not required.`,
        'Disable entry'
      )
      if (!confirmed) return
    }
    const result = await api().monitor.setStartupEnabled(entry.id, enabled)
    if (!result.ok) {
      app.notify(result.error ?? 'Could not change that entry.', 'error')
      return
    }
    setActivity((prev) => [`${new Date().toLocaleTimeString()} — ${enabled ? 'enabled' : 'disabled'} ${entry.name} (${entry.source})`, ...prev].slice(0, 40))
    app.notify(`${entry.name} ${enabled ? 'enabled' : 'disabled'}`, 'success')
    await load()
  }

  const criticalCount = entries.filter((e) => e.risk === 'critical').length

  return (
    <div className="flex flex-col gap-3">
      <Panel glow>
        <PanelHeader
          title="Startup Manager"
          subtitle="Autostart entries from HKCU/HKLM Run keys and Startup folders (XDG autostart and systemd on Linux). Machine-wide entries are read-only because NEXUS runs at user level by design."
          icon={<Rocket size={15} />}
          right={
            <Button onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[11px] text-[color:var(--nx-text-dim)]">
          <Badge>{entries.length} entries</Badge>
          <Badge tone="ok">{entries.filter((e) => e.enabled).length} enabled</Badge>
          {criticalCount > 0 && <Badge tone="danger">{criticalCount} critical — protected</Badge>}
          <span className="ml-auto">Every change is listed below and written to the activity log.</span>
        </div>
        {error && <div className="mx-4 mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </Panel>

      <Panel>
        <PanelHeader title="Entries" subtitle="Disabled entries stay installed — this only controls whether they start with Windows." />
        {entries.length === 0 && !loading ? (
          <EmptyState title="No startup entries found" hint="Either the list could not be read or this system has no autostart entries." />
        ) : (
          <div className="divide-y divide-[color:var(--nx-border)]/60">
            {entries.map((entry) => (
              <div key={entry.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-[color:var(--nx-text)]">{entry.name}</span>
                      <Badge tone={entry.risk === 'critical' ? 'danger' : entry.risk === 'caution' ? 'warn' : 'ok'}>{entry.risk}</Badge>
                      <Badge>{entry.source}</Badge>
                      {!entry.controllable && <Badge tone="warn">read-only</Badge>}
                    </div>
                    <div className="nx-mono mt-1 max-w-[720px] truncate text-[10.5px] text-[color:var(--nx-text-dim)]" title={entry.command}>
                      {entry.command || '(no command recorded)'}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-[color:var(--nx-text-dim)]">
                      {entry.publisher && <span>publisher: {entry.publisher}</span>}
                      {entry.executable && <span className="truncate">exe: {entry.executable}</span>}
                    </div>
                    <p className="mt-1 max-w-[760px] text-[10.5px] leading-relaxed text-[color:var(--nx-text-dim)]">{entry.note}</p>
                  </div>
                  <div className="w-32 shrink-0">
                    <Toggle
                      label={entry.enabled ? 'Enabled' : 'Disabled'}
                      checked={entry.enabled}
                      disabled={!entry.controllable || entry.risk === 'critical'}
                      onChange={(next) => void toggle(entry, next)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Activity log (this session)" subtitle="What changed, when. Nothing else is modified." icon={<ShieldAlert size={14} />} />
        <div className="px-4 py-3">
          {activity.length === 0 ? (
            <p className="text-[11px] text-[color:var(--nx-text-dim)]">No startup changes were made in this session.</p>
          ) : (
            <ul className="nx-mono space-y-1 text-[10.5px] text-[color:var(--nx-text-dim)]">
              {activity.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-[color:var(--nx-border)] pt-2 text-[11px] leading-relaxed text-[color:var(--nx-text-dim)]">
            <strong className="text-[color:var(--nx-text)]">Restore instructions:</strong> re-enable an entry with the same toggle. If an entry was removed from
            HKCU\Software\Microsoft\Windows\CurrentVersion\Run, the original command is shown above and can be re-added with
            <span className="nx-mono"> reg add</span> or by re-running the installer for that application. Startup-folder entries are renamed with a
            <span className="nx-mono"> .disabled</span> suffix and can be renamed back manually at any time.
          </div>
        </div>
      </Panel>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { CalendarClock, Play, ShieldAlert, Save } from 'lucide-react'
import { useApp, useCategoriesById } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Field, Panel, PanelHeader, Select, Toggle } from '../components/ui'
import { api, formatBytes, formatDateTime } from '../lib/api'
import type { CategoryId, CleanupMode, ScheduleConfig } from '@shared/types'

export function SchedulerPage(): React.JSX.Element {
  const app = useApp()
  const byId = useCategoriesById()
  const [config, setConfig] = useState<ScheduleConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<string | null>(null)

  useEffect(() => {
    void api()
      .schedule.get()
      .then(setConfig)
      .catch(() => app.notify('Could not read the schedule.', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nextRun = (() => {
    if (!config?.enabled) return null
    const now = new Date()
    const candidate = new Date(now)
    candidate.setHours(config.hour, config.minute, 0, 0)
    if (candidate.getTime() <= now.getTime()) {
      if (config.frequency === 'daily') candidate.setDate(candidate.getDate() + 1)
      else if (config.frequency === 'weekly') candidate.setDate(candidate.getDate() + 7)
      else candidate.setMonth(candidate.getMonth() + 1)
    }
    return candidate
  })()

  const save = async (): Promise<void> => {
    if (!config) return
    if (config.enabled) {
      const confirmed = await app.confirmDestructive(
        'Enable scheduled cleanup',
        `Enable automatic ${config.frequency} cleanup at ${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')}?`,
        `Categories: ${config.categories.map((c) => byId.get(c)?.name ?? c).join(', ') || '(none selected)'}\n\n` +
          `Only these categories will be cleaned, using your exclusions and the ${config.maxAgeHours}h age filter. Scheduled runs never include the Recycle Bin unless you add it explicitly. ` +
          `The schedule runs inside the app while it is open — no Windows task is registered.\n\nEvery run is recorded in Activity History with real byte counts.`,
        'Enable schedule'
      )
      if (!confirmed) return
    }
    setSaving(true)
    try {
      const saved = await api().schedule.set(config)
      setConfig(saved)
      app.notify('Schedule saved', 'success')
    } catch (err) {
      app.notify(`Could not save schedule: ${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const runNow = async (): Promise<void> => {
    if (!config) return
    const allowed = await app.confirmDestructive(
      'Run scheduled cleanup now',
      'Execute the configured scheduled cleanup immediately?',
      `Categories: ${config.categories.map((c) => byId.get(c)?.name ?? c).join(', ') || '(none)'}\nAge filter: ${config.maxAgeHours}h\n\nThis deletes files permanently after the same safety checks as a manual clean.`,
      'Run cleanup now'
    )
    if (!allowed) return
    setRunning(true)
    try {
      const report = await api().schedule.runNow()
      if (report) {
        setLastRun(`Removed ${report.totalDeleted} files (${formatBytes(report.totalBytesDeleted)}) in ${((report.endedAt - report.startedAt) / 1000).toFixed(1)}s`)
        await app.refreshHistory()
      } else {
        setLastRun('No categories were configured, so nothing ran.')
      }
    } catch (err) {
      setLastRun(`Failed: ${(err as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  if (!config) {
    return (
      <Panel>
        <EmptyState title="Loading schedule…" hint="Reading your saved schedule preferences." />
      </Panel>
    )
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel glow>
        <PanelHeader
          title="Cleanup Scheduler"
          subtitle="Opt-in only. NEXUS does not register Windows scheduled tasks — the schedule runs while the app is open, so nothing happens behind your back after uninstall."
          icon={<CalendarClock size={15} />}
          right={
            <Button variant="primary" onClick={save} disabled={saving}>
              <Save size={13} /> {saving ? 'Saving…' : 'Save schedule'}
            </Button>
          }
        />
        <div className="grid gap-x-6 px-4 py-2 md:grid-cols-2">
          <Toggle
            label="Enable scheduled cleanup"
            description="Requires explicit confirmation whenever it is switched on."
            checked={config.enabled}
            onChange={(enabled) => setConfig({ ...config, enabled })}
          />
          <Field label="Frequency">
            <Select
              value={config.frequency}
              onChange={(frequency) => setConfig({ ...config, frequency })}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' }
              ]}
            />
          </Field>
          <Field label="Time" hint="Local time. The schedule is evaluated every 30 seconds while the app runs.">
            <div className="flex gap-2">
              <Select
                value={String(config.hour)}
                onChange={(hour) => setConfig({ ...config, hour: Number(hour) })}
                options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
              />
              <Select
                value={String(config.minute)}
                onChange={(minute) => setConfig({ ...config, minute: Number(minute) })}
                options={[0, 15, 30, 45].map((m) => ({ value: String(m), label: `:${String(m).padStart(2, '0')}` }))}
              />
            </div>
          </Field>
          <Field label="Mode">
            <Select
              value={config.mode}
              onChange={(mode) => setConfig({ ...config, mode: mode as CleanupMode })}
              options={[
                { value: 'quick', label: 'Quick' },
                { value: 'smart', label: 'Smart' },
                { value: 'deep', label: 'Deep' },
                { value: 'custom', label: 'Custom (categories below)' }
              ]}
            />
          </Field>
          <Field label="Only files older than (hours)" hint="A scheduled run never touches anything newer than this.">
            <input
              type="number"
              min={0}
              max={8760}
              className="nx-input"
              value={config.maxAgeHours}
              onChange={(e) => setConfig({ ...config, maxAgeHours: Math.max(0, Number(e.target.value)) })}
              aria-label="Maximum file age in hours"
            />
          </Field>
          <Toggle label="Notify when a scheduled run finishes" checked={config.notify} onChange={(notify) => setConfig({ ...config, notify })} />
        </div>

        <div className="border-t border-[color:var(--nx-border)] px-4 py-3">
          <div className="nx-label mb-2">Categories approved for scheduled cleanup</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {app.categories.map((category) => (
              <label key={category.id} className="flex items-center gap-2 text-[11.5px]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[color:var(--nx-accent)]"
                  checked={config.categories.includes(category.id)}
                  disabled={!category.available}
                  onChange={(e) => {
                    const next: CategoryId[] = e.target.checked
                      ? [...config.categories, category.id]
                      : config.categories.filter((c) => c !== category.id)
                    setConfig({ ...config, categories: next })
                  }}
                />
                <span className={category.available ? '' : 'opacity-45'}>{category.name}</span>
                {category.risk === 'caution' && <Badge tone="warn">caution</Badge>}
              </label>
            ))}
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-3">
        <Panel>
          <PanelHeader title="Status" />
          <div className="space-y-2 px-4 py-3 text-[11.5px]">
            <div className="flex items-center justify-between">
              <span className="text-[color:var(--nx-text-dim)]">Scheduled</span>
              <Badge tone={config.enabled ? 'ok' : 'neutral'}>{config.enabled ? 'enabled' : 'disabled'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[color:var(--nx-text-dim)]">Next run</span>
              <span className="nx-mono">{nextRun ? formatDateTime(nextRun.getTime()) : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[color:var(--nx-text-dim)]">Categories</span>
              <span className="nx-mono">{config.categories.length}</span>
            </div>
            <Button className="mt-2 w-full" onClick={runNow} disabled={running || config.categories.length === 0}>
              <Play size={13} /> {running ? 'Running…' : 'Run once now'}
            </Button>
            {lastRun && <p className="pt-1 text-[11px] text-[color:var(--nx-text-dim)]">{lastRun}</p>}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Guardrails" icon={<ShieldAlert size={14} />} />
          <ul className="space-y-1.5 px-4 py-3 text-[11px] text-[color:var(--nx-text-dim)]">
            <li>• Scheduled runs use only the categories you tick.</li>
            <li>• Your exclusions and age filter always apply.</li>
            <li>• The Recycle Bin is never scheduled unless you add it.</li>
            <li>• Each run is written to Activity History with real byte counts.</li>
            <li>• Turning the schedule off takes effect immediately.</li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

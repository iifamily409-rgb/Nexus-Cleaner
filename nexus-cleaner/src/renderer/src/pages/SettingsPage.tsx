import { useState } from 'react'
import { Settings as SettingsIcon, Plus, ShieldCheck, RotateCcw, FolderOpen, Palette, Gauge, Trash } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, Field, Panel, PanelHeader, Select, Toggle } from '../components/ui'
import { api, formatDateTime } from '../lib/api'
import type { CategoryId, CleanupMode } from '@shared/types'

export function SettingsPage(): React.JSX.Element {
  const app = useApp()
  const { settings, meta, categories } = app
  const [newExclusion, setNewExclusion] = useState('')

  if (!settings) {
    return (
      <Panel>
        <PanelHeader title="Settings" />
        <div className="p-6 text-sm text-[color:var(--nx-text-dim)]">Loading preferences…</div>
      </Panel>
    )
  }

  const addExclusion = async (): Promise<void> => {
    const value = newExclusion.trim()
    if (!value) return
    if (settings.exclusions.includes(value)) {
      app.notify('That folder is already excluded.', 'warn')
      return
    }
    await app.updateSettings({ exclusions: [...settings.exclusions, value].slice(0, 500) })
    setNewExclusion('')
    app.notify('Exclusion added', 'success')
  }

  const pickExclusion = async (): Promise<void> => {
    const folders = await api().dialog.pickFolders()
    if (folders.length === 0) return
    await app.updateSettings({ exclusions: [...new Set([...settings.exclusions, ...folders])].slice(0, 500) })
    app.notify(`${folders.length} exclusion(s) added`, 'success')
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel glow>
        <PanelHeader title="Appearance" icon={<Palette size={15} />} subtitle="Theme, accent and animation preferences persist locally and survive restarts." />
        <div className="grid gap-x-6 px-4 py-2 md:grid-cols-2">
          <Field label="Theme">
            <Select
              value={settings.theme}
              onChange={(theme) => void app.updateSettings({ theme })}
              options={[
                { value: 'dark', label: 'Dark (deep-black HUD)' },
                { value: 'light', label: 'Light (daylight HUD)' }
              ]}
            />
          </Field>
          <Field label="Accent">
            <Select
              value={settings.accent}
              onChange={(accent) => void app.updateSettings({ accent })}
              options={[
                { value: 'cyan', label: 'Neon cyan' },
                { value: 'blue', label: 'Electric blue' },
                { value: 'green', label: 'Signal green' },
                { value: 'violet', label: 'Ultraviolet' }
              ]}
            />
          </Field>
          <Field label="Animation intensity" hint="Decorative elements only. Cleaning animations always reflect real operations, but the ambient field can be toned down.">
            <Select
              value={settings.animationIntensity}
              onChange={(animationIntensity) => void app.updateSettings({ animationIntensity })}
              options={[
                { value: 'full', label: 'Full (all ambient effects)' },
                { value: 'reduced', label: 'Reduced (static HUD)' },
                { value: 'off', label: 'Off (no ambient motion)' }
              ]}
            />
          </Field>
          <Field label="Live metrics refresh">
            <Select
              value={String(settings.refreshIntervalMs)}
              onChange={(v) => void app.updateSettings({ refreshIntervalMs: Number(v) })}
              options={[
                { value: '1000', label: '1 second (higher CPU use)' },
                { value: '2000', label: '2 seconds (recommended)' },
                { value: '5000', label: '5 seconds' },
                { value: '10000', label: '10 seconds (lowest overhead)' }
              ]}
            />
          </Field>
        </div>
        <div className="px-4 pb-3">
          <Toggle
            label="Reduced motion (accessibility)"
            description="Disables all decorative animation, including the holographic rotation. Real progress indicators remain."
            checked={settings.reducedMotion}
            onChange={(reducedMotion) => void app.updateSettings({ reducedMotion })}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Cleanup defaults" icon={<Gauge size={15} />} subtitle="Used when a page opens and as the default for scheduled runs." />
        <div className="grid gap-x-6 px-4 py-2 md:grid-cols-2">
          <Field label="Default mode">
            <Select
              value={settings.defaultMode}
              onChange={(mode) => void app.updateSettings({ defaultMode: mode as CleanupMode })}
              options={[
                { value: 'quick', label: 'Quick' },
                { value: 'smart', label: 'Smart' },
                { value: 'deep', label: 'Deep' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </Field>
          <Field label="Minimum file age (hours)" hint="Files newer than this are never eligible. 0 disables the age filter and is not recommended.">
            <input
              type="number"
              min={0}
              max={8760}
              className="nx-input"
              value={settings.maxAgeHours}
              onChange={(e) => void app.updateSettings({ maxAgeHours: Math.max(0, Number(e.target.value)) })}
              aria-label="Minimum file age in hours"
            />
          </Field>
          <Field label="History retention (days)">
            <input
              type="number"
              min={1}
              max={3650}
              className="nx-input"
              value={settings.historyRetentionDays}
              onChange={(e) => void app.updateSettings({ historyRetentionDays: Math.max(1, Number(e.target.value)) })}
              aria-label="History retention in days"
            />
          </Field>
          <div className="py-2">
            <Toggle
              label="Confirm destructive actions"
              description="Strongly recommended. Turning this off uses a simpler in-app confirmation instead of the detailed OS dialog."
              checked={settings.confirmDestructive}
              onChange={(confirmDestructive) => void app.updateSettings({ confirmDestructive })}
            />
          </div>
        </div>

        <div className="border-t border-[color:var(--nx-border)] px-4 py-3">
          <div className="nx-label mb-2">Default categories for Custom Clean</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {categories.map((category) => (
              <label key={category.id} className="flex items-center gap-2 text-[11.5px]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[color:var(--nx-accent)]"
                  checked={settings.enabledCategories.includes(category.id)}
                  onChange={(e) => {
                    const next: CategoryId[] = e.target.checked
                      ? [...settings.enabledCategories, category.id]
                      : settings.enabledCategories.filter((c) => c !== category.id)
                    void app.updateSettings({ enabledCategories: next })
                  }}
                />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Folder exclusions"
          icon={<FolderOpen size={15} />}
          subtitle="Any path inside these folders is skipped by every scan and cleanup, including duplicates."
          right={<Button className="!px-2 !py-1 !text-[11px]" onClick={pickExclusion}><Plus size={12} /> Add folder</Button>}
        />
        <div className="flex gap-2 px-4 py-2">
          <input
            className="nx-input nx-mono"
            placeholder="C:\\Users\\you\\Projects"
            value={newExclusion}
            onChange={(e) => setNewExclusion(e.target.value)}
            aria-label="New exclusion path"
          />
          <Button onClick={addExclusion}>Add</Button>
        </div>
        <div className="max-h-48 divide-y divide-[color:var(--nx-border)]/60 overflow-auto">
          {settings.exclusions.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-[color:var(--nx-text-dim)]">
              No exclusions configured. Documents, downloads, photos, projects and source-control folders are protected by the engine regardless of this list.
            </p>
          ) : (
            settings.exclusions.map((exclusion) => (
              <div key={exclusion} className="flex items-center justify-between gap-2 px-4 py-1.5 text-[11px]">
                <span className="nx-mono truncate" title={exclusion}>
                  {exclusion}
                </span>
                <Button
                  variant="ghost"
                  className="!px-1.5 !py-0.5"
                  onClick={() => void app.updateSettings({ exclusions: settings.exclusions.filter((e) => e !== exclusion) })}
                  ariaLabel={`Remove ${exclusion}`}
                >
                  <Trash size={12} />
                </Button>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Privacy & security posture" icon={<ShieldCheck size={15} />} subtitle="What this application does and does not do." />
        <div className="space-y-1.5 px-4 py-3 text-[11px] leading-relaxed text-[color:var(--nx-text-dim)]">
          {[
            'contextIsolation enabled, nodeIntegration disabled, renderer sandboxed.',
            'Only allowlisted IPC channels exist; every argument is validated with zod in the main process.',
            'No arbitrary shell execution is exposed to the renderer.',
            'No API keys, telemetry, analytics or personal data leave this machine.',
            'No administrator rights are requested for normal cleanup.',
            'Antivirus, Defender, firewall, Windows Update and other protections are never modified.',
            'No registry cleaning of any kind is performed.',
            'Every path is re-validated immediately before deletion; when uncertain, the file is skipped.'
          ].map((line) => (
            <div key={line} className="flex gap-2">
              <ShieldCheck size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              <span>{line}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-[color:var(--nx-border)] px-4 py-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px]">
            {[
              ['Version', meta?.version ?? '—'],
              ['Electron', meta?.electron ?? '—'],
              ['Chromium', meta?.chrome ?? '—'],
              ['Node', meta?.node ?? '—'],
              ['Platform', meta?.platform ?? '—'],
              ['Elevated', meta?.elevated ? 'yes' : 'no'],
              ['User data', meta?.userDataPath ?? '—'],
              ['Session started', formatDateTime(app.metrics?.at ?? Date.now())]
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 border-b border-[color:var(--nx-border)]/40 py-0.5">
                <span className="text-[color:var(--nx-text-dim)]">{label}</span>
                <span className="nx-mono max-w-[60%] truncate text-right" title={value}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                const confirmed = await app.confirmDestructive(
                  'Reset all settings',
                  'Restore every preference to its default value?',
                  'This resets theme, accent, exclusions, age filters, retention and the schedule. It does not delete history, and it does not touch any file on disk.',
                  'Reset settings'
                )
                if (confirmed) await app.resetSettings()
              }}
            >
              <RotateCcw size={13} /> Reset all settings
            </Button>
            <Badge tone="ok">changes save automatically</Badge>
          </div>
        </div>
      </Panel>
    </div>
  )
}

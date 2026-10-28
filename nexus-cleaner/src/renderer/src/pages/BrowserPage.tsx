import { useEffect, useState } from 'react'
import { Globe, ShieldCheck, RefreshCw } from 'lucide-react'
import { useApp } from '../hooks/useAppState'
import { Badge, Button, EmptyState, Panel, PanelHeader } from '../components/ui'
import { api, formatBytes } from '../lib/api'
import type { BrowserInfo, ScanOptions } from '@shared/types'

export function BrowserPage(): React.JSX.Element {
  const app = useApp()
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([])
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setBrowsers(await api().browser.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const cleanBrowsers = async (): Promise<void> => {
    const running = browsers.filter((b) => b.running && b.detected)
    if (running.length > 0) {
      const proceed = await app.confirmDestructive(
        'Browsers appear to be running',
        `${running.map((b) => b.name).join(', ')} ${running.length === 1 ? 'is' : 'are'} running.`,
        'NEXUS Cleaner never force-closes a browser. Closed-cache files will be skipped automatically because they are locked.\n\nFor a complete cache clean, close the browser yourself first and re-run. Passwords, cookies, history, bookmarks and open sessions are never touched.',
        'Continue anyway'
      )
      if (!proceed) return
    }
    const options: ScanOptions = {
      mode: 'custom',
      categories: ['browser-cache'],
      minAgeHours: app.settings?.maxAgeHours ?? 24,
      exclusions: app.settings?.exclusions ?? []
    }
    const scan = await app.scan(options)
    if (scan) app.setPage('home')
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel glow>
        <PanelHeader
          title="Browser Cleaner"
          subtitle="Only disposable cache data is eligible. Cookies, Login Data, History, Bookmarks, Web Data, Preferences, Local State and session storage are blocked by name in the cleanup engine."
          icon={<Globe size={15} />}
          right={
            <div className="flex gap-2">
              <Button onClick={load} disabled={loading}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Re-detect
              </Button>
              <Button variant="primary" onClick={cleanBrowsers} disabled={app.busy || !browsers.some((b) => b.detected)}>
                Scan browser caches
              </Button>
            </div>
          }
        />
      </Panel>

      {browsers.length === 0 && !loading ? (
        <Panel>
          <EmptyState title="No browsers detected" hint="No supported browser cache directories were found on this system." />
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {browsers.map((browser) => (
            <Panel key={browser.id}>
              <PanelHeader
                title={browser.name}
                subtitle={browser.detected ? `${browser.cachePaths.filter((c) => c.exists).length} cache location(s) found` : 'Not installed / not detected'}
                right={
                  <div className="flex gap-1.5">
                    {browser.detected ? <Badge tone="ok">detected</Badge> : <Badge>absent</Badge>}
                    {browser.running && <Badge tone="warn">running</Badge>}
                  </div>
                }
              />
              <div className="divide-y divide-[color:var(--nx-border)]/60">
                {browser.cachePaths.map((cache) => (
                  <div key={cache.path} className="px-4 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cache.exists ? 'text-[color:var(--nx-text)]' : 'text-[color:var(--nx-text-dim)]'}>{cache.label}</span>
                      <span className={`nx-chip ${cache.exists ? 'border-emerald-500/40 text-emerald-300' : ''}`}>{cache.exists ? 'present' : 'missing'}</span>
                    </div>
                    <div className="nx-mono truncate text-[10px] text-[color:var(--nx-text-dim)]" title={cache.path}>
                      {cache.path}
                    </div>
                  </div>
                ))}
              </div>
              {browser.running && (
                <div className="border-t border-[color:var(--nx-border)] px-4 py-2 text-[10.5px] leading-relaxed text-amber-300/90">
                  {browser.name} is running. Cache files in use are locked by the OS and will be skipped, not forced. Close the browser first for a full clean.
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Panel>
        <PanelHeader title="What is never removed" icon={<ShieldCheck size={14} />} />
        <div className="grid gap-x-6 gap-y-1 px-4 py-3 text-[11px] text-[color:var(--nx-text-dim)] sm:grid-cols-2">
          {[
            'Saved passwords / Login Data',
            'Cookies and site sessions',
            'Browsing history',
            'Bookmarks',
            'Autofill and Web Data',
            'Extensions and their storage',
            'Browser profiles and Preferences',
            'Open tabs / session state'
          ].map((item) => (
            <div key={item} className="flex items-center gap-1.5">
              <ShieldCheck size={11} className="text-emerald-400" />
              {item}
            </div>
          ))}
        </div>
        <div className="border-t border-[color:var(--nx-border)] px-4 py-2 text-[10.5px] text-[color:var(--nx-text-dim)]">
          Estimated cache size appears on the Quick Clean page after a scan. NEXUS shows the exact byte totals it measured ({formatBytes(0)} means nothing was measured, not
          “0 bytes optimised”).
        </div>
      </Panel>
    </div>
  )
}

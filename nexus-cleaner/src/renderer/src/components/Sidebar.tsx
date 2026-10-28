import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Zap,
  Radar,
  ScanSearch,
  HardDrive,
  Copy,
  Rocket,
  Globe,
  Activity,
  Wifi,
  Package,
  CalendarClock,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck
} from 'lucide-react'
import type { PageId } from '../hooks/useAppState'

export interface NavItem {
  id: PageId
  label: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  group: 'Operate' | 'Analyse' | 'Maintain' | 'System'
  hint: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Operate', hint: 'Overview of health and quick actions' },
  { id: 'quick', label: 'Quick Clean', icon: Zap, group: 'Operate', hint: 'Fastest safe cleanup' },
  { id: 'smart', label: 'Smart Scan', icon: Radar, group: 'Operate', hint: 'Balanced analysis and cleanup' },
  { id: 'deep', label: 'Deep Analysis', icon: ScanSearch, group: 'Operate', hint: 'Broad inspection, still safe' },
  { id: 'storage', label: 'Storage Analyzer', icon: HardDrive, group: 'Analyse', hint: 'Treemap and largest files' },
  { id: 'duplicates', label: 'Duplicate Finder', icon: Copy, group: 'Analyse', hint: 'Verified content hashing' },
  { id: 'startup', label: 'Startup Manager', icon: Rocket, group: 'Maintain', hint: 'Autostart entries' },
  { id: 'browser', label: 'Browser Cleaner', icon: Globe, group: 'Maintain', hint: 'Cache only, never passwords' },
  { id: 'monitor', label: 'System Monitor', icon: Activity, group: 'Analyse', hint: 'CPU, RAM, disk, processes' },
  { id: 'network', label: 'Network Diagnostics', icon: Wifi, group: 'Analyse', hint: 'Latency and DNS checks' },
  { id: 'software', label: 'Software Inventory', icon: Package, group: 'Maintain', hint: 'Installed apps and disk health' },
  { id: 'scheduler', label: 'Scheduler', icon: CalendarClock, group: 'System', hint: 'Optional scheduled scans' },
  { id: 'history', label: 'Activity History', icon: History, group: 'System', hint: 'Every recorded operation' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'System', hint: 'Preferences and privacy' }
]

const GROUP_ORDER: NavItem['group'][] = ['Operate', 'Analyse', 'Maintain', 'System']

export function Sidebar({
  page,
  setPage,
  collapsed,
  onToggle,
  version,
  isWindows
}: {
  page: PageId
  setPage: (page: PageId) => void
  collapsed: boolean
  onToggle: () => void
  version: string
  isWindows: boolean
}): React.JSX.Element {
  return (
    <aside
      className="relative z-20 flex h-full shrink-0 flex-col border-r border-[color:var(--nx-border)] bg-[color:var(--nx-surface-2)]/70 backdrop-blur-xl transition-[width] duration-200"
      style={{ width: collapsed ? 68 : 244 }}
      aria-label="Primary navigation"
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-[color:var(--nx-border)] px-3">
        <div className="relative grid h-8 w-8 shrink-0 place-items-center">
          <div className="absolute inset-0 rounded-lg border border-[color:var(--nx-accent)] opacity-40 nx-anim-spin-slow" />
          <ShieldCheck size={16} className="nx-text-accent" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold tracking-[0.18em] text-[color:var(--nx-text)]">NEXUS</div>
            <div className="truncate text-[9px] tracking-[0.28em] text-[color:var(--nx-text-dim)]">CLEANER {version}</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {GROUP_ORDER.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group)
          return (
            <div key={group} className="mb-2">
              {!collapsed && <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[color:var(--nx-text-dim)]">{group}</div>}
              {items.map((item) => {
                const Icon = item.icon
                const activeItem = page === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
                    aria-current={activeItem ? 'page' : undefined}
                    className={`group relative mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                      activeItem ? 'bg-[color:var(--nx-accent)]/12 nx-text-accent' : 'text-[color:var(--nx-text-dim)] hover:bg-white/5 hover:text-[color:var(--nx-text)]'
                    }`}
                  >
                    {activeItem && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r"
                        style={{ background: 'var(--nx-accent)' }}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && <span className="truncate font-medium">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="border-t border-[color:var(--nx-border)] p-2">
        {!collapsed && (
          <div className="mb-1.5 rounded-lg border border-[color:var(--nx-border)] px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--nx-text-dim)]">Host</div>
            <div className="truncate text-[11px] text-[color:var(--nx-text)]">{isWindows ? 'Windows 11 · user level' : 'Non-Windows host'}</div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--nx-border)] py-1.5 text-[11px] text-[color:var(--nx-text-dim)] hover:text-[color:var(--nx-text)]"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

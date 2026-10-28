import type { LucideIcon } from 'lucide-react'
import {
  Globe,
  HardDrive,
  Copy,
  Activity,
  Wifi,
  Rocket,
  Package,
  CalendarClock,
  History,
  Settings
} from 'lucide-react'

/**
 * Single source of truth for the tool catalogue shown in the "All Features"
 * drawer. Every entry maps to an existing page component and its unchanged
 * backend services — the redesign only changes how they are reached.
 */

export type PageId =
  | 'home'
  | 'browser'
  | 'storage'
  | 'duplicates'
  | 'monitor'
  | 'network'
  | 'startup'
  | 'software'
  | 'scheduler'
  | 'history'
  | 'settings'

export type FeatureGroup = 'Clean' | 'Analyze' | 'Manage' | 'App'

export interface FeatureItem {
  id: Exclude<PageId, 'home'>
  label: string
  description: string
  group: FeatureGroup
  icon: LucideIcon
}

export const FEATURES: FeatureItem[] = [
  {
    id: 'browser',
    label: 'Browser Cleaner',
    description: 'Cache-only cleanup for detected browsers. Passwords, cookies and history are never touched.',
    group: 'Clean',
    icon: Globe
  },
  {
    id: 'storage',
    label: 'Storage Analyzer',
    description: 'Read-only folder analysis with a treemap, largest files and category breakdown.',
    group: 'Analyze',
    icon: HardDrive
  },
  {
    id: 'duplicates',
    label: 'Duplicate Finder',
    description: 'SHA-256 verified duplicate detection with keep-one-per-group review.',
    group: 'Analyze',
    icon: Copy
  },
  {
    id: 'monitor',
    label: 'System Monitor',
    description: 'Live CPU, memory and disk readings plus a read-only process viewer.',
    group: 'Analyze',
    icon: Activity
  },
  {
    id: 'network',
    label: 'Network Diagnostics',
    description: 'Adapter details, latency and DNS timing. Read-only — nothing is reconfigured.',
    group: 'Analyze',
    icon: Wifi
  },
  {
    id: 'startup',
    label: 'Startup Manager',
    description: 'Inspect autostart entries and toggle the ones Windows lets you control at user level.',
    group: 'Manage',
    icon: Rocket
  },
  {
    id: 'software',
    label: 'Software Inventory',
    description: 'Installed applications, disk health, update availability and read-only integrity checks.',
    group: 'Manage',
    icon: Package
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    description: 'Opt-in scheduled scans limited to categories you explicitly approve.',
    group: 'Manage',
    icon: CalendarClock
  },
  {
    id: 'history',
    label: 'Activity History',
    description: 'Every recorded scan and cleanup with real byte counts and export options.',
    group: 'App',
    icon: History
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Theme, accent, exclusions, age filter, retention and animation preferences.',
    group: 'App',
    icon: Settings
  }
]

export const FEATURE_GROUPS: FeatureGroup[] = ['Clean', 'Analyze', 'Manage', 'App']

export const FEATURE_BY_ID = new Map<PageId, FeatureItem>(FEATURES.map((feature) => [feature.id, feature]))

export const isPageId = (value: string): value is PageId =>
  value === 'home' || FEATURES.some((feature) => feature.id === value)

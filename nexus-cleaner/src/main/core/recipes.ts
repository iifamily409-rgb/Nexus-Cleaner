import path from 'node:path'
import {
  appCacheRoots,
  browserRecipes,
  crashDumpRoots,
  deliveryOptimizationRoots,
  errorReportRoots,
  fontCacheRoots,
  isWindows,
  logArtifactRoots,
  pathExists,
  thumbnailRoots,
  userTempRoots,
  windowsTempRoots
} from './platform'
import type { CategoryId, CleanupCategory } from '@shared/types'
import { hasProtectedExtension, platformKind } from './pathSafety'

/**
 * RECIPES
 * ------------------------------------------------------------------
 * A recipe is the *only* definition of what a category may touch. The engine
 * builds its deletion allowlist strictly from `roots()`. If a folder is not
 * listed here it can never be deleted from.
 */

export interface RecipeRoot {
  root: string
  label: string
  /** true when only files directly inside (no recursion) should be considered. */
  flat?: boolean
}

export interface CleanupRecipe {
  id: CategoryId
  name: string
  description: string
  removes: string
  risk: 'safe' | 'caution'
  quick: boolean
  smart: boolean
  deep: boolean
  /** Returns the existing roots for this category on this machine. */
  roots: () => Promise<RecipeRoot[]>
  /** Extra per-file eligibility filter. Default: everything not protected. */
  eligible?: (fileName: string, ext: string) => boolean
  /** Files matching these names are always skipped. */
  skipFileNames?: string[]
  unavailableReason?: string
}

const existsFilter = async (roots: RecipeRoot[]): Promise<RecipeRoot[]> => {
  const out: RecipeRoot[] = []
  for (const r of roots) {
    if (await pathExists(r.root)) out.push(r)
  }
  return out
}

/** Cache/temp files that are never worth deleting even if in a temp folder. */
const NEVER_TOUCH = [
  'desktop.ini',
  'ntuser.dat',
  'ntuser.ini',
  'boot.ini',
  'thumbs.db',
  'index.dat'
]

const tempEligible = (name: string, ext: string): boolean => {
  if (NEVER_TOUCH.includes(name.toLowerCase())) return false
  // In temp folders everything except protected personal file types is fair game.
  return !hasProtectedExtension(name) || ext === ''
}

export function createRecipes(platform: NodeJS.Platform = process.platform): CleanupRecipe[] {
  const win = isWindows(platform)
  const kind = platformKind(platform)

  return [
    {
      id: 'user-temp',
      name: 'User temporary files',
      description: 'Temporary files created by your own applications inside your temp folder.',
      removes:
        'Files in %TEMP% / %LOCALAPPDATA%\\Temp (or the OS temp dirs on this platform). Office lock files, setup leftovers and app scratch data older than the age filter.',
      risk: 'safe',
      quick: true,
      smart: true,
      deep: true,
      roots: async () => existsFilter(userTempRoots().map((p) => ({ root: p, label: 'User temp' }))),
      eligible: tempEligible,
      skipFileNames: NEVER_TOUCH
    },
    {
      id: 'windows-temp',
      name: 'Windows temporary files',
      description: 'System-wide temp folders that are readable without elevation.',
      removes: 'Files in %SystemRoot%\\Temp and %ProgramData%\\Temp that your account can access.',
      risk: 'safe',
      quick: true,
      smart: true,
      deep: true,
      roots: async () => {
        if (!win) return []
        return existsFilter(windowsTempRoots().map((p) => ({ root: p, label: 'Windows temp' })))
      },
      eligible: tempEligible,
      skipFileNames: NEVER_TOUCH,
      unavailableReason: win ? undefined : 'Windows-only category'
    },
    {
      id: 'app-caches',
      name: 'Application caches',
      description: 'Disposable caches that applications rebuild automatically.',
      removes:
        'Explorer thumbnail database, WinINet cache, RDP cache, shader/GPU caches, package-manager caches (npm, pip, yarn). Never user documents or app settings.',
      risk: 'safe',
      quick: false,
      smart: true,
      deep: true,
      roots: async () => {
        const candidates = appCacheRoots().map((c) => ({ root: c.path, label: c.label }))
        return existsFilter(candidates)
      },
      eligible: (name, ext) => {
        const lower = name.toLowerCase()
        if (NEVER_TOUCH.includes(lower)) return false
        if (lower.startsWith('iconcache') || lower === 'thumbs.db') return true
        return !hasProtectedExtension(name) || ext === ''
      },
      skipFileNames: NEVER_TOUCH
    },
    {
      id: 'browser-cache',
      name: 'Browser caches',
      description: 'Cache directories of detected browsers only. Passwords, cookies and history are preserved.',
      removes: 'Cache, Code Cache, GPUCache and ShaderCache folders of detected browsers. Never Cookies, Login Data, History, Bookmarks or Extensions.',
      risk: 'safe',
      quick: true,
      smart: true,
      deep: true,
      roots: async () => {
        const out: RecipeRoot[] = []
        for (const browser of browserRecipes()) {
          for (const c of browser.cachePaths) {
            out.push({ root: c.path, label: `${browser.name} — ${c.label}` })
          }
        }
        return existsFilter(out)
      },
      eligible: (name, ext) => {
        const lower = name.toLowerCase()
        // Explicit hard blocks, even inside a cache directory.
        const blocked = [
          'cookies',
          'cookies-journal',
          'login data',
          'login data-journal',
          'history',
          'history-journal',
          'bookmarks',
          'web data',
          'preferences',
          'local state',
          'session storage',
          'local storage',
          'indexeddb'
        ]
        if (blocked.some((b) => lower === b || lower === b + '.sqlite')) return false
        if (ext === '.sqlite' || ext === '.db') return false
        return !hasProtectedExtension(name) || ext === ''
      },
      skipFileNames: [...NEVER_TOUCH, 'Cookies', 'Login Data', 'History', 'Bookmarks']
    },
    {
      id: 'thumbnails',
      name: 'Thumbnail & icon caches',
      description: 'Image preview caches that Windows regenerates on demand.',
      removes: 'thumbcache_*.db, iconcache_*.db and thumbnail cache folders. Never your images.',
      risk: 'safe',
      quick: true,
      smart: true,
      deep: true,
      roots: async () => existsFilter(thumbnailRoots().map((p) => ({ root: p, label: 'Thumbnail cache' }))),
      eligible: (name) => {
        const lower = name.toLowerCase()
        if (lower === 'desktop.ini') return false
        return (
          lower.startsWith('thumbcache') ||
          lower.startsWith('iconcache') ||
          lower.endsWith('.db') ||
          lower.endsWith('.png') ||
          lower.endsWith('.jpg') ||
          lower.startsWith('thumbnail')
        )
      }
    },
    {
      id: 'crash-dumps',
      name: 'Crash dumps',
      description: 'Crash dumps and minidumps written by applications and Windows.',
      removes: 'Dump files in the crash-dump and WER local folders. These are only useful for debugging past crashes.',
      risk: 'caution',
      quick: false,
      smart: true,
      deep: true,
      roots: async () => existsFilter(crashDumpRoots().map((p) => ({ root: p, label: 'Crash dumps' }))),
      eligible: (name, ext) => ext === '.dmp' || ext === '.mdmp' || ext === '.hdmp' || ext === '.wer' || !hasProtectedExtension(name)
    },
    {
      id: 'error-reports',
      name: 'Error reporting queue',
      description: 'Windows Error Reporting archives and queued reports.',
      removes: 'Files in WER ReportArchive / ReportQueue that are not currently in use.',
      risk: 'caution',
      quick: false,
      smart: true,
      deep: true,
      roots: async () => existsFilter(errorReportRoots().map((p) => ({ root: p, label: 'Error reports' }))),
      eligible: (name) => !hasProtectedExtension(name)
    },
    {
      id: 'recycle-bin',
      name: 'Recycle Bin contents',
      description: 'Files you already deleted. Removing them frees the space permanently.',
      removes: 'Contents of the current user’s Recycle Bin / trash directory. Files are NOT recoverable afterwards.',
      risk: 'caution',
      quick: false,
      smart: false,
      deep: false,
      roots: async () => {
        if (win) {
          const drive = process.env.SystemDrive ?? 'C:'
          const bin = path.join(`${drive}${kind === 'win32' ? '\\' : '/'}`, '$Recycle.Bin')
          // The recycle bin is protected from generic deletion: it is only ever
          // emptied through the dedicated API in the cleaner, never by path.
          return (await pathExists(bin)) ? [] : []
        }
        const home = process.env.HOME ?? '/root'
        const local = path.join(home, '.local', 'share', 'Trash')
        return (await pathExists(local)) ? [{ root: local, label: 'Trash' }] : []
      },
      eligible: (name) => !NEVER_TOUCH.includes(name.toLowerCase())
    },
    {
      id: 'delivery-optimization',
      name: 'Delivery Optimization cache',
      description: 'Windows Update delivery cache that Windows re-downloads on demand.',
      removes: 'Files in the DeliveryOptimization cache folder only.',
      risk: 'caution',
      quick: false,
      smart: false,
      deep: true,
      roots: async () => (win ? existsFilter(deliveryOptimizationRoots().map((p) => ({ root: p, label: 'Delivery Optimization' }))) : []),
      eligible: (name) => !hasProtectedExtension(name),
      unavailableReason: win ? undefined : 'Windows-only category'
    },
    {
      id: 'font-cache',
      name: 'Font cache',
      description: 'Font cache entries that Windows rebuilds at next sign-in.',
      removes: 'FontCache service cache files that are not locked by the running service.',
      risk: 'caution',
      quick: false,
      smart: false,
      deep: true,
      roots: async () => existsFilter(fontCacheRoots().map((p) => ({ root: p, label: 'Font cache' }))),
      eligible: (name) => name.toLowerCase().endsWith('.dat') || !hasProtectedExtension(name)
    },
    {
      id: 'log-artifacts',
      name: 'Diagnostic log artifacts',
      description: 'Rotated diagnostic logs explicitly listed as disposable.',
      removes: 'Old rotated logs and diagnostic temp files in the listed folders. Current logs used for troubleshooting are kept.',
      risk: 'caution',
      quick: false,
      smart: false,
      deep: true,
      roots: async () => existsFilter(logArtifactRoots().map((p) => ({ root: p, label: 'Log artifacts' }))),
      eligible: (name, ext) => ext === '.log' || ext === '.etl' || ext === '.old' || !hasProtectedExtension(name)
    }
  ]
}

/** UI-facing metadata, with availability resolved against the filesystem. */
export async function describeCategories(recipes: CleanupRecipe[]): Promise<CleanupCategory[]> {
  const out: CleanupCategory[] = []
  for (const recipe of recipes) {
    let roots: RecipeRoot[] = []
    let available = true
    let reason = recipe.unavailableReason
    try {
      roots = await recipe.roots()
      if (roots.length === 0) available = false
      if (roots.length === 0 && !reason) reason = 'Not present on this system'
      if (recipe.id === 'recycle-bin' && roots.length === 0) {
        // The recycle bin is emptied via shell API; keep it visible on Windows.
        available = isWindows()
        reason = isWindows() ? undefined : 'Recycle Bin is emptied through the OS API and is unavailable here'
      }
    } catch (err) {
      available = false
      reason = `Could not resolve locations: ${(err as Error).message}`
    }
    out.push({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      removes: recipe.removes,
      risk: recipe.risk,
      quick: recipe.quick,
      smart: recipe.smart,
      deep: recipe.deep,
      roots: roots.map((r) => r.root),
      available,
      ...(reason ? { unavailableReason: reason } : {})
    })
  }
  return out
}

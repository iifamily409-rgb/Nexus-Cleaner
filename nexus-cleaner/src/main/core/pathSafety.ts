import path from 'node:path'

/**
 * PATH SAFETY CORE
 * ---------------------------------------------------------------
 * Every deletion decision in NEXUS Cleaner passes through this module.
 * It is intentionally dependency-free and platform-parametric so that the
 * Windows rules can be unit-tested on any CI platform.
 *
 * Rules:
 *  1. A deletion candidate must be an absolute path with no NUL byte, no
 *     `..` segment, and no empty segment.
 *  2. A candidate must be *strictly inside* one of the caller-supplied
 *     allowlisted roots (the cleanup category roots or the user-picked
 *     duplicate scan roots). The root itself is never deletable.
 *  3. A candidate must never be (or live inside) a critical system location.
 *  4. A candidate must never match a user exclusion.
 *  5. Protected document/photo/source extensions are skipped by cleanup.
 */

export type Plat = 'win32' | 'posix'

const pathFor = (platform: Plat): path.PlatformPath =>
  platform === 'win32' ? path.win32 : path.posix

export const platformKind = (p: NodeJS.Platform = process.platform): Plat =>
  p === 'win32' ? 'win32' : 'posix'

const caseFold = (p: Plat, s: string): string => (p === 'win32' ? s.toLowerCase() : s)

/** Strip trailing separators (but keep filesystem roots like `C:\` or `/`). */
export function normalize(input: string, platform: NodeJS.Platform = process.platform): string {
  const kind = platformKind(platform)
  const pi = pathFor(kind)
  let s = input.trim()
  if (s.length === 0) return s
  // Collapse forward/back slashes to the platform separator.
  if (kind === 'win32') s = s.replace(/\//g, '\\')
  const normalized = pi.normalize(s)
  if (normalized.length > 1 && normalized.endsWith(pi.sep) && pi.dirname(normalized) !== normalized) {
    return normalized.slice(0, -1)
  }
  return normalized
}

export function isAbsolutePath(input: string, platform: NodeJS.Platform = process.platform): boolean {
  const kind = platformKind(platform)
  const pi = pathFor(kind)
  if (kind === 'win32') {
    // Reject UNC-ish weirdness that os-level APIs dislike, but keep drive + UNC names.
    return pi.isAbsolute(input) && /^([a-zA-Z]:\\|\\\\)/.test(input)
  }
  return pi.isAbsolute(input)
}

/** Reject paths containing NUL, traversal segments or empty segments. */
export function hasDangerousSegments(input: string): boolean {
  if (input.includes('\0')) return true
  const parts = input.split(/[\\/]/)
  return parts.some((seg) => seg === '..' || seg === '.')
}

export function isSamePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const kind = platformKind(platform)
  return caseFold(kind, normalize(a, platform)) === caseFold(kind, normalize(b, platform))
}

/** True when `child` is inside `parent`. Equality counts only if `allowEqual`. */
export function isInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
  allowEqual = false
): boolean {
  const kind = platformKind(platform)
  const pi = pathFor(kind)
  const p = caseFold(kind, normalize(parent, platform))
  const c = caseFold(kind, normalize(child, platform))
  if (p === c) return allowEqual
  const withSep = p.endsWith(pi.sep) ? p : p + pi.sep
  return c.startsWith(withSep)
}

/** Filesystem roots and generic paths that must never be deleted or traversed into. */
const CRITICAL_WIN_DIRS = [
  '\\windows',
  '\\windows\\system32',
  '\\windows\\system32\\config',
  '\\windows\\system32\\drivers',
  '\\windows\\syswow64',
  '\\windows\\winsxs',
  '\\windows\\servicing',
  '\\windows\\system32\\catroot',
  '\\windows\\system32\\catroot2',
  '\\windows\\boot',
  '\\windows\\fonts',
  '\\windows\\assembly',
  '\\program files',
  '\\program files (x86)',
  '\\programdata',
  '\\$recycle.bin',
  '\\system volume information',
  '\\recovery',
  '\\boot',
  '\\perflogs',
  '\\windows\\softwaredistribution',
  '\\windows\\installer',
  '\\windows\\system32\\driverstore',
  '\\windows\\minidump',
  '\\windows\\memory.dmp',
  '\\windows\\system.ini',
  '\\windows\\win.ini',
  '\\drivers',
  '\\$winreagent',
  '\\config.msi'
]

/**
 * POSIX paths that must never be deleted or scanned.
 *
 * EXACT: the directory itself is refused, but children are ordinary user space
 * (e.g. `/home` itself, not `/home/alice/Downloads`).
 * SUBTREE: everything below is OS or package-manager state.
 */
const CRITICAL_POSIX_EXACT = ['/', '/home', '/usr', '/var', '/srv', '/opt', '/media', '/mnt', '/tmp', '/var/tmp', '/var/lib']

const CRITICAL_POSIX_SUBTREES = [
  '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/lib32', '/proc', '/root', '/sbin', '/sys',
  '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib32', '/usr/lib64', '/usr/libexec', '/usr/include', '/usr/share',
  '/var/lib/dpkg', '/var/lib/apt', '/var/lib/rpm', '/var/lib/systemd', '/var/log', '/var/cache/apt',
  '/snap', '/boot/efi'
]

/** Directory names that strongly indicate user data or version control. */
const PROTECTED_NAME_PATTERNS = [
  /^documents?$/i,
  /^desktop$/i,
  /^downloads?$/i,
  /^pictures?$/i,
  /^photos?$/i,
  /^videos?$/i,
  /^music$/i,
  /^onedrive/i,
  /^dropbox$/i,
  /^google drive$/i,
  /^\.git$/i,
  /^\.svn$/i,
  /^\.hg$/i,
  /^node_modules$/i,
  /^\.ssh$/i,
  /^\.gnupg$/i,
  /^passwords?$/i,
  /^keychains?$/i,
  /^wallet$/i,
  /^saved games$/i,
  /^projects?$/i,
  /^source$/i,
  /^repos?$/i
]

/** Extensions that cleanup will never delete, even inside a cache folder. */
export const PROTECTED_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.rtf', '.odt', '.ods', '.odp',
  '.txt', '.md', '.rtf', '.csv', '.tex',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.webp', '.raw', '.cr2', '.nef', '.arw', '.dng',
  '.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a',
  '.psd', '.ai', '.indd', '.sketch', '.fig', '.blend', '.max', '.ma',
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz',
  '.kdbx', '.key', '.pem', '.pfx', '.p12', '.asc', '.gpg',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.rb', '.php',
  '.sqlite', '.db', '.sql', '.json', '.yaml', '.yml', '.toml', '.env',
  '.bak', '.backup', '.sav'
])

/** Exact filenames that are always off-limits. */
const CRITICAL_FILENAMES = new Set([
  'ntuser.dat',
  'ntuser.ini',
  'boot.ini',
  'bootmgr',
  'bcd',
  'pagefile.sys',
  'swapfile.sys',
  'hiberfil.sys',
  'sam',
  'security',
  'system',
  'software',
  'default',
  'win.ini',
  'system.ini',
  'windows.edb',
  'desktop.ini',
  'thumbs.db'
])

export function isCriticalSystemPath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  const kind = platformKind(platform)
  const pi = pathFor(kind)
  const n = caseFold(kind, normalize(p, platform))
  if (kind === 'win32') {
    // Drive root such as `c:\` or `c:` is never deletable.
    if (/^[a-z]:\\?$/.test(n)) return true
    // Strip the drive letter for the prefix comparison.
    const noDrive = n.replace(/^[a-z]:/, '')
    return CRITICAL_WIN_DIRS.some((dir) => noDrive === dir || noDrive.startsWith(dir + '\\'))
  }
  if (CRITICAL_POSIX_EXACT.includes(n)) return true
  return CRITICAL_POSIX_SUBTREES.some((dir) => n === dir || n.startsWith(dir + '/'))
}

export function isCriticalSegmentName(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower === 'windows' || lower === 'system32' || lower === 'syswow64' || lower === 'winsxs') return true
  if (lower === '$recycle.bin' || lower === 'system volume information') return true
  return CRITICAL_FILENAMES.has(lower)
}

export function isProtectedName(name: string): boolean {
  return PROTECTED_NAME_PATTERNS.some((re) => re.test(name))
}

export function hasProtectedExtension(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  return ext.length > 0 && PROTECTED_EXTENSIONS.has(ext)
}

/** Is this path inside a user "personal" directory? Used only for reporting/dup protection. */
export function isPersonalPath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  const kind = platformKind(platform)
  const pi = pathFor(kind)
  const parts = normalize(p, platform).split(pi.sep).filter(Boolean)
  return parts.some((seg) => PROTECTED_NAME_PATTERNS.some((re) => re.test(seg)))
}

export interface ValidationContext {
  allowedRoots: string[]
  exclusions: string[]
  platform?: NodeJS.Platform
  minAgeMs?: number
  nowMs?: number
  mtimeMs?: number
  /** Skip protected-extension check (used for duplicate review, which is explicit). */
  ignoreExtensionProtection?: boolean
}

export type PathVerdict = { ok: true } | { ok: false; reason: string }

export const OK: PathVerdict = { ok: true }

/**
 * The single gate for "may this path be deleted?".
 * Returns a human-readable refusal reason when the answer is no.
 */
export function validateDeletionCandidate(candidate: string, ctx: ValidationContext): PathVerdict {
  const platform = ctx.platform ?? process.platform
  const kind = platformKind(platform)

  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, reason: 'empty path' }
  }
  if (candidate.includes('\0')) return { ok: false, reason: 'path contains NUL byte' }
  if (!isAbsolutePath(candidate, platform)) return { ok: false, reason: 'path is not absolute' }
  if (hasDangerousSegments(candidate)) return { ok: false, reason: 'path contains traversal segment' }

  const normalized = normalize(candidate, platform)
  const pi = pathFor(kind)

  if (!ctx.ignoreExtensionProtection) {
    const ext = pi.extname(normalized).toLowerCase()
    if (ext && PROTECTED_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `protected file type (${ext})` }
    }
  }

  if (isCriticalSystemPath(normalized, platform)) {
    return { ok: false, reason: 'inside a critical system location' }
  }
  if (isCriticalSegmentName(pi.basename(normalized))) {
    return { ok: false, reason: 'critical file name' }
  }
  if (isPersonalPath(normalized, platform)) {
    return { ok: false, reason: 'inside a personal/document folder' }
  }

  // Must be strictly inside an allowlisted root.
  const insideAny = ctx.allowedRoots.some((root) => isInside(root, normalized, platform, false))
  if (!insideAny) return { ok: false, reason: 'outside every allowlisted cleanup root' }

  for (const ex of ctx.exclusions) {
    if (!ex) continue
    if (isInside(ex, normalized, platform, true)) return { ok: false, reason: 'matches a user exclusion' }
  }

  if (typeof ctx.minAgeMs === 'number' && ctx.minAgeMs > 0) {
    const now = ctx.nowMs ?? Date.now()
    if (typeof ctx.mtimeMs === 'number' && now - ctx.mtimeMs < ctx.minAgeMs) {
      return { ok: false, reason: 'newer than the minimum-age filter' }
    }
  }

  return OK
}

/**
 * Root validation for *scanning*: scanning may read a broader area, but the
 * target still has to be a real, absolute, non-critical directory.
 */
export function validateScanRoot(root: string, platform: NodeJS.Platform = process.platform): PathVerdict {
  if (typeof root !== 'string' || root.trim().length === 0) return { ok: false, reason: 'empty path' }
  if (root.includes('\0')) return { ok: false, reason: 'path contains NUL byte' }
  if (!isAbsolutePath(root, platform)) return { ok: false, reason: 'path is not absolute' }
  if (hasDangerousSegments(root)) return { ok: false, reason: 'path contains traversal segment' }
  const n = normalize(root, platform)
  if (isCriticalSystemPath(n, platform)) return { ok: false, reason: 'critical system location' }
  return OK
}

/**
 * Deletion roots are scanned roots *plus* the guarantee that the path is not
 * the root itself. Used to build the allowlist handed to validateDeletionCandidate.
 */
export function deletionRootsFor(scanRoots: string[], platform: NodeJS.Platform = process.platform): string[] {
  return scanRoots.filter((r) => validateScanRoot(r, platform).ok)
}

/** Human readable byte formatter shared by main + renderer. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

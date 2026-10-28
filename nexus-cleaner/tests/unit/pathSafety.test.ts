import { describe, expect, it } from 'vitest'
import {
  hasDangerousSegments,
  hasProtectedExtension,
  isCriticalSystemPath,
  isInside,
  isPersonalPath,
  normalize,
  validateDeletionCandidate,
  validateScanRoot,
  formatBytes
} from '../../src/main/core/pathSafety'

/**
 * Path validation is the last line of defence before an unlink call, so these
 * tests cover the dangerous cases explicitly.
 */

describe('normalize', () => {
  it('collapses separators and removes trailing separators on Windows', () => {
    expect(normalize('C:\\Users\\me\\AppData\\Local\\Temp\\', 'win32')).toBe('C:\\Users\\me\\AppData\\Local\\Temp')
    expect(normalize('C:/Users/me/Temp', 'win32')).toBe('C:\\Users\\me\\Temp')
  })

  it('keeps a drive root intact', () => {
    expect(normalize('C:\\', 'win32')).toBe('C:\\')
  })

  it('handles posix paths', () => {
    expect(normalize('/tmp/cache/', 'linux')).toBe('/tmp/cache')
    expect(normalize('/', 'linux')).toBe('/')
  })
})

describe('hasDangerousSegments', () => {
  it('flags traversal and NUL bytes', () => {
    expect(hasDangerousSegments('C:\\temp\\..\\windows\\system32')).toBe(true)
    expect(hasDangerousSegments('/tmp/./x')).toBe(true)
    expect(hasDangerousSegments('C:\\temp\0evil')).toBe(true)
  })

  it('allows normal paths', () => {
    expect(hasDangerousSegments('C:\\Users\\me\\AppData\\Local\\Temp\\a.tmp')).toBe(false)
  })
})

describe('isInside', () => {
  it('detects containment including case-insensitivity on Windows', () => {
    expect(isInside('C:\\Temp', 'C:\\Temp\\sub\\file.tmp', 'win32')).toBe(true)
    expect(isInside('c:\\temp', 'C:\\TEMP\\sub\\file.tmp', 'win32')).toBe(true)
    expect(isInside('C:\\Temp', 'C:\\Tempish\\file.tmp', 'win32')).toBe(false)
  })

  it('does not treat the root itself as inside unless asked', () => {
    expect(isInside('C:\\Temp', 'C:\\Temp', 'win32')).toBe(false)
    expect(isInside('C:\\Temp', 'C:\\Temp', 'win32', true)).toBe(true)
  })
})

describe('isCriticalSystemPath', () => {
  it.each([
    'C:\\Windows',
    'C:\\Windows\\System32',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'C:\\Windows\\WinSxS\\x',
    'C:\\Program Files\\Something',
    'C:\\ProgramData',
    'C:\\System Volume Information\\x',
    'C:\\$Recycle.Bin',
    'C:\\'
  ])('blocks %s', (p) => {
    expect(isCriticalSystemPath(p, 'win32')).toBe(true)
  })

  it('allows ordinary temp paths', () => {
    expect(isCriticalSystemPath('C:\\Users\\me\\AppData\\Local\\Temp\\x.tmp', 'win32')).toBe(false)
  })

  it('blocks posix system directories', () => {
    expect(isCriticalSystemPath('/etc', 'linux')).toBe(true)
    expect(isCriticalSystemPath('/etc/passwd', 'linux')).toBe(true)
    expect(isCriticalSystemPath('/tmp/x', 'linux')).toBe(false)
  })
})

describe('isPersonalPath and protected extensions', () => {
  it('detects documents/downloads/photos and vcs folders', () => {
    expect(isPersonalPath('C:\\Users\\me\\Documents\\a.tmp', 'win32')).toBe(true)
    expect(isPersonalPath('C:\\Users\\me\\Downloads\\setup.exe.tmp', 'win32')).toBe(true)
    expect(isPersonalPath('C:\\Users\\me\\Projects\\repo\\.git\\x', 'win32')).toBe(true)
    expect(isPersonalPath('C:\\Users\\me\\AppData\\Local\\Temp\\x.tmp', 'win32')).toBe(false)
  })

  it('protects document, media, archive and key extensions', () => {
    for (const name of ['a.docx', 'b.pdf', 'c.jpg', 'd.mp4', 'e.zip', 'f.kdbx', 'g.py', 'h.sqlite']) {
      expect(hasProtectedExtension(name)).toBe(true)
    }
    expect(hasProtectedExtension('cache.tmp')).toBe(false)
    // .db files are protected from generic cleanup; the thumbnail recipe
    // explicitly opts back in to `.db` cache files it owns, and the delete
    // guard re-checks the real path before unlinking.
    expect(hasProtectedExtension('thumbcache_256.db')).toBe(true)
  })
})

describe('validateDeletionCandidate', () => {
  const allowedRoots = ['C:\\Users\\me\\AppData\\Local\\Temp']
  const exclusions = ['C:\\Users\\me\\AppData\\Local\\Temp\\keep']

  it('accepts a file inside an allowlisted root', () => {
    expect(
      validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\a.tmp', {
        allowedRoots,
        exclusions,
        platform: 'win32'
      }).ok
    ).toBe(true)
  })

  it('rejects a file outside every allowlisted root', () => {
    const verdict = validateDeletionCandidate('C:\\Users\\me\\Nowhere\\a.tmp', { allowedRoots, exclusions, platform: 'win32' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/outside every allowlisted/)

    // Personal folders are refused for a different (also correct) reason.
    const desktop = validateDeletionCandidate('C:\\Users\\me\\Desktop\\a.tmp', { allowedRoots, exclusions, platform: 'win32' })
    expect(desktop.ok).toBe(false)
    expect(desktop.ok === false && desktop.reason).toMatch(/personal/)
  })

  it('rejects the allowlisted root itself', () => {
    expect(validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp', { allowedRoots, exclusions, platform: 'win32' }).ok).toBe(false)
  })

  it('rejects traversal segments', () => {
    expect(
      validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\..\\..\\Windows\\x.dll', { allowedRoots, exclusions, platform: 'win32' })
        .ok
    ).toBe(false)
  })

  it('rejects excluded subtrees', () => {
    const verdict = validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\keep\\a.tmp', { allowedRoots, exclusions, platform: 'win32' })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/exclusion/)
  })

  it('rejects protected file types', () => {
    expect(
      validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\thesis.docx', { allowedRoots, exclusions, platform: 'win32' }).ok
    ).toBe(false)
  })

  it('rejects critical system locations even if a root was misconfigured', () => {
    expect(
      validateDeletionCandidate('C:\\Windows\\System32\\drivers\\etc\\hosts', {
        allowedRoots: ['C:\\Windows'],
        exclusions: [],
        platform: 'win32',
        ignoreExtensionProtection: true
      }).ok
    ).toBe(false)
  })

  it('enforces the minimum age filter', () => {
    const now = 1_000_000_000
    const fresh = validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\new.tmp', {
      allowedRoots,
      exclusions,
      platform: 'win32',
      minAgeMs: 60_000,
      nowMs: now,
      mtimeMs: now - 1000
    })
    expect(fresh.ok).toBe(false)
    const old = validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\old.tmp', {
      allowedRoots,
      exclusions,
      platform: 'win32',
      minAgeMs: 60_000,
      nowMs: now,
      mtimeMs: now - 120_000
    })
    expect(old.ok).toBe(true)
  })

  it('rejects relative and NUL-containing paths', () => {
    expect(validateDeletionCandidate('temp/a.tmp', { allowedRoots, exclusions, platform: 'win32' }).ok).toBe(false)
    expect(validateDeletionCandidate('C:\\Users\\me\\AppData\\Local\\Temp\\a\0.tmp', { allowedRoots, exclusions, platform: 'win32' }).ok).toBe(false)
  })

  it('works on posix paths too', () => {
    expect(
      validateDeletionCandidate('/tmp/nexus/a.tmp', { allowedRoots: ['/tmp/nexus'], exclusions: [], platform: 'linux' }).ok
    ).toBe(true)
    expect(validateDeletionCandidate('/etc/passwd', { allowedRoots: ['/etc'], exclusions: [], platform: 'linux', ignoreExtensionProtection: true }).ok).toBe(false)
  })
})

describe('validateScanRoot', () => {
  it('accepts a normal folder', () => {
    expect(validateScanRoot('C:\\Users\\me\\Downloads', 'win32').ok).toBe(true)
    expect(validateScanRoot('/srv/data', 'linux').ok).toBe(true)
  })

  it('rejects system locations and drive roots', () => {
    expect(validateScanRoot('C:\\Windows', 'win32').ok).toBe(false)
    expect(validateScanRoot('C:\\', 'win32').ok).toBe(false)
    expect(validateScanRoot('/', 'linux').ok).toBe(false)
  })

  it('rejects relative paths', () => {
    expect(validateScanRoot('Users\\me', 'win32').ok).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

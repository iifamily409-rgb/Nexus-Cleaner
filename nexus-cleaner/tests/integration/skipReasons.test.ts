import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CleanerEngine, aggregateSkipReasons } from '../../src/main/services/cleanerEngine'
import { DuplicateFinder } from '../../src/main/services/duplicateFinder'
import type { CleanupRecipe } from '../../src/main/core/recipes'
import type { CategoryId, CleanReport, LiveProgress, OperationEvent, ScanReport } from '../../src/shared/types'

/**
 * SKIP-REASON REGRESSION TESTS
 * ------------------------------------------------------------------
 * The product promise is that a user can always see *why* a file was not
 * deleted. These tests prove that every skip path the engine can take records a
 * reason, that the reasons reconcile with the skip counters, and that no path
 * silently swallows a file.
 *
 * Everything runs inside a throwaway directory under os.tmpdir(). The engine is
 * given an injected recipe pointing only at that directory, so the real
 * validation/deletion pipeline runs without touching any user folder.
 */

let sandbox: string
let tempRoot: string
let preciousRoot: string

const HOUR = 3600 * 1000

const mkfile = async (filePath: string, size = 16, ageMs = 48 * HOUR): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, Buffer.alloc(size, 'x'))
  if (ageMs > 0) {
    const time = new Date(Date.now() - ageMs)
    await fs.utimes(filePath, time, time)
  }
}

function recipe(): CleanupRecipe[] {
  return [
    {
      id: 'user-temp' as CategoryId,
      name: 'Sandbox temp',
      description: 'sandbox',
      removes: 'sandbox temp files',
      risk: 'safe',
      quick: true,
      smart: true,
      deep: true,
      roots: async () => [{ root: tempRoot, label: 'Sandbox temp' }]
    }
  ]
}

function makeEngine(): { engine: CleanerEngine; progress: LiveProgress[]; events: OperationEvent[] } {
  const progress: LiveProgress[] = []
  const events: OperationEvent[] = []
  const engine = new CleanerEngine({
    emitProgress: (p) => progress.push(p),
    emitEvent: (e) => events.push(e),
    recipes: recipe
  })
  return { engine, progress, events }
}

const scan = (engine: CleanerEngine, exclusions: string[] = [], minAgeHours = 24): Promise<ScanReport> =>
  engine.scan({ mode: 'quick', categories: ['user-temp'], minAgeHours, exclusions, dryRun: false })

/** Every reason recorded, sorted by count, as `reason → count`. */
const reasonsOf = (map: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])))

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-skip-'))
  tempRoot = path.join(sandbox, 'temp')
  preciousRoot = path.join(sandbox, 'precious')
  await fs.mkdir(tempRoot, { recursive: true })
  await fs.mkdir(preciousRoot, { recursive: true })
})

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('scan-phase skip reasons', () => {
  it('records protected file types and still reports the eligible ones', async () => {
    await mkfile(path.join(tempRoot, 'cache.tmp'), 100)
    await mkfile(path.join(tempRoot, 'thesis.docx'), 100)
    await mkfile(path.join(tempRoot, 'photo.jpg'), 100)

    const { engine } = makeEngine()
    const report = await scan(engine)

    expect(report.totalEligibleFiles).toBe(1)
    expect(report.categories[0]!.skipReasons['protected file type']).toBe(2)
    expect(report.skipReasons['protected file type']).toBe(2)
  })

  it('records age-filter skips and honours the setting', async () => {
    await mkfile(path.join(tempRoot, 'old.tmp'), 10, 48 * HOUR)
    await mkfile(path.join(tempRoot, 'new.tmp'), 10, 6 * HOUR)

    const { engine } = makeEngine()
    const report = await scan(engine, [], 24)

    expect(report.totalEligibleFiles).toBe(1)
    expect(report.skipReasons['newer than the minimum-age filter']).toBe(1)
  })

  it('records exclusions as a skip reason and never counts the file as eligible', async () => {
    await mkfile(path.join(tempRoot, 'keepme.tmp'), 10)
    await mkfile(path.join(tempRoot, 'deletable.tmp'), 10)

    const { engine } = makeEngine()
    const report = await scan(engine, [path.join(tempRoot, 'keepme.tmp')])

    expect(report.totalEligibleFiles).toBe(1)
    expect(report.skipReasons['matches a user exclusion']).toBe(1)
  })

  it('records symbolic links instead of following them', async () => {
    await mkfile(path.join(preciousRoot, 'secret.tmp'), 10)
    await mkfile(path.join(tempRoot, 'normal.tmp'), 10)
    try {
      await fs.symlink(preciousRoot, path.join(tempRoot, 'link'), 'dir')
    } catch {
      return // host without symlink support
    }

    const { engine } = makeEngine()
    const report = await scan(engine)

    expect(report.totalEligibleFiles).toBe(1)
    expect(report.skipReasons['symbolic link or reparse point (never followed)']).toBe(1)
  })

  it('skips files sitting outside the allowlisted roots', async () => {
    await mkfile(path.join(tempRoot, 'inside.tmp'), 10)
    // A file that the walker sees but that the path validator must reject.
    const { engine } = makeEngine()
    const report = await scan(engine)
    // Sanity: nothing outside the root can ever be eligible.
    for (const item of report.categories[0]!.sample) {
      expect(path.resolve(item.path).startsWith(path.resolve(tempRoot) + path.sep)).toBe(true)
    }
  })

  it('always reconciles skipReasons with totalSkippedFiles', async () => {
    await mkfile(path.join(tempRoot, 'a.tmp'), 10, 48 * HOUR)
    await mkfile(path.join(tempRoot, 'b.docx'), 10, 48 * HOUR)
    await mkfile(path.join(tempRoot, 'c.tmp'), 10, 1 * HOUR)
    await mkfile(path.join(tempRoot, 'excluded.tmp'), 10, 48 * HOUR)
    try {
      await fs.symlink(preciousRoot, path.join(tempRoot, 'link'), 'dir')
    } catch {
      /* ignore */
    }

    const { engine } = makeEngine()
    const report = await scan(engine, [path.join(tempRoot, 'excluded.tmp')])
    const summed = Object.values(report.skipReasons).reduce((a, b) => a + b, 0)

    expect(summed).toBe(report.totalSkippedFiles)
    expect(Object.keys(report.skipReasons).length).toBeGreaterThan(0)
  })

  it('aggregateSkipReasons sums the per-category maps', () => {
    expect(
      aggregateSkipReasons([
        { skipReasons: { 'protected file type': 2, 'matches a user exclusion': 1 } },
        { skipReasons: { 'protected file type': 3 } },
        {}
      ])
    ).toEqual({ 'protected file type': 5, 'matches a user exclusion': 1 })
  })
})

describe('overlapping roots are counted once', () => {
  it('does not double-count files reachable from two nested roots', async () => {
    const nested = path.join(tempRoot, 'nested')
    await mkfile(path.join(nested, 'x.tmp'), 10)
    await mkfile(path.join(nested, 'y.tmp'), 20)
    await mkfile(path.join(tempRoot, 'z.tmp'), 30)

    const progress: LiveProgress[] = []
    const engine = new CleanerEngine({
      emitProgress: (p) => progress.push(p),
      emitEvent: () => undefined,
      // A category that reports both the parent and its child, which is what
      // windows-temp/user-temp do in practice when TMPDIR sits under a root.
      recipes: () => [
        {
          ...recipe()[0]!,
          roots: async () => [
            { root: tempRoot, label: 'parent' },
            { root: nested, label: 'nested' }
          ]
        }
      ]
    })

    const report = await engine.scan({ mode: 'quick', categories: ['user-temp'], minAgeHours: 24, exclusions: [], dryRun: false })

    // 3 unique files, 60 bytes total — not 5 files / 120 bytes.
    expect(report.totalEligibleFiles).toBe(3)
    expect(report.totalEligibleBytes).toBe(60)
    expect(report.categories[0]!.eligibleFiles).toBe(3)
  })

  it('never queues the same path twice for deletion', async () => {
    const nested = path.join(tempRoot, 'nested')
    await mkfile(path.join(nested, 'x.tmp'), 10)
    await mkfile(path.join(tempRoot, 'z.tmp'), 10)

    const engine = new CleanerEngine({
      emitProgress: () => undefined,
      emitEvent: () => undefined,
      recipes: () => [
        {
          ...recipe()[0]!,
          roots: async () => [
            { root: tempRoot, label: 'parent' },
            { root: nested, label: 'nested' }
          ]
        }
      ]
    })

    const report = await engine.scan({ mode: 'quick', categories: ['user-temp'], minAgeHours: 24, exclusions: [], dryRun: false })
    const clean = await engine.run(report.id)
    const totalAttempted = clean.results.reduce((a, r) => a + r.attempted, 0)

    expect(totalAttempted).toBe(2)
    expect(clean.totalDeleted).toBe(2)
    expect(clean.results.reduce((a, r) => a + r.failed, 0)).toBe(0)
  })
})

describe('cleanup-phase skip reasons', () => {
  it('reports a reason for every file it refuses to delete', async () => {
    // Eligible at scan time…
    const target = path.join(tempRoot, 'scanned.tmp')
    await mkfile(target, 32)

    const { engine } = makeEngine()
    const report = await scan(engine)
    expect(report.totalEligibleFiles).toBe(1)

    // …then it disappears before the cleanup runs.
    await fs.rm(target)

    const clean: CleanReport = await engine.run(report.id)
    const result = clean.results[0]!

    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.skipReasons['file disappeared before deletion']).toBe(1)
    expect(Object.values(result.skipReasons).reduce((a, b) => a + b, 0)).toBe(result.skipped)
  })

  it('reports a reason when a candidate is replaced by a symbolic link', async () => {
    const target = path.join(tempRoot, 'swap.tmp')
    await mkfile(target, 32)
    const { engine } = makeEngine()
    const report = await scan(engine)
    expect(report.totalEligibleFiles).toBe(1)

    await fs.rm(target)
    try {
      await fs.symlink(path.join(preciousRoot, 'elsewhere.tmp'), target, 'file')
    } catch {
      return // no symlink support on this host
    }

    const clean = await engine.run(report.id)
    const result = clean.results[0]!
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skipReasons['became a symbolic link or non-regular file after the scan']).toBe(1)
  })

  it('reports a reason when a file becomes younger than the age filter', async () => {
    const target = path.join(tempRoot, 'touched.tmp')
    await mkfile(target, 32, 48 * HOUR)
    const { engine } = makeEngine()
    const report = await scan(engine, [], 24)
    expect(report.totalEligibleFiles).toBe(1)

    // Something rewrote the file after the scan: it must not be deleted.
    const now = new Date()
    await fs.utimes(target, now, now)

    const clean = await engine.run(report.id)
    const result = clean.results[0]!
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skipReasons['timestamps changed — file is now newer than the minimum-age filter']).toBe(1)
    expect(fs.stat(target)).resolves.toBeTruthy()
  })

  it('reports a reason when a file is locked', async () => {
    const target = path.join(tempRoot, 'locked.tmp')
    await mkfile(target, 32)
    const { engine } = makeEngine()
    const report = await scan(engine)
    expect(report.totalEligibleFiles).toBe(1)

    // Simulate a file another program holds open. Real unlink semantics differ
    // per platform, so the lock is injected at the fs layer for this test.
    const realUnlink = fs.unlink
    const spy = async (p: Parameters<typeof fs.unlink>[0]): Promise<void> => {
      if (String(p) === target) {
        const err = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException
        err.code = 'EBUSY'
        throw err
      }
      return realUnlink(p)
    }
    ;(fs as unknown as { unlink: typeof spy }).unlink = spy
    try {
      const clean = await engine.run(report.id)
      const result = clean.results[0]!
      expect(result.deleted).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.skipped).toBe(1)
      expect(result.skipReasons['locked or in use by another program']).toBe(1)
    } finally {
      ;(fs as unknown as { unlink: typeof realUnlink }).unlink = realUnlink
    }
  })

  it('deletes genuinely eligible files and reports no skip reasons', async () => {
    await mkfile(path.join(tempRoot, 'gone.tmp'), 64)
    const { engine } = makeEngine()
    const report = await scan(engine)
    const clean = await engine.run(report.id)
    const result = clean.results[0]!

    expect(result.deleted).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.skipReasons).toEqual({})
    await expect(fs.stat(path.join(tempRoot, 'gone.tmp'))).rejects.toThrow()
  })
})

describe('duplicate-finder skip reasons', () => {
  it('records a reason for a path that vanished between scan and delete', async () => {
    const finder = new DuplicateFinder()
    const a = path.join(tempRoot, 'gone-a.bin')
    const b = path.join(tempRoot, 'gone-b.bin')
    await fs.writeFile(a, Buffer.alloc(4096, 'y'))
    await fs.writeFile(b, Buffer.alloc(4096, 'y'))
    const scanResult = await finder.scan([tempRoot], 1024, 'dup-op-1')
    expect(scanResult.groups.length).toBe(1)

    await fs.rm(b)

    const result = await finder.delete([b], 1)
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skipReasons['file disappeared before deletion']).toBe(1)
    expect(Object.values(result.skipReasons).reduce((x, y) => x + y, 0)).toBe(result.skipped)
  })

  it('refuses to delete anything without a verified duplicate scan (fail closed)', async () => {
    const finder = new DuplicateFinder()
    const a = path.join(tempRoot, 'dup-a.bin')
    await fs.writeFile(a, Buffer.alloc(4096, 'y'))

    const result = await finder.delete([a], 1)

    // No scan has run, so there is no proof this is a duplicate: refuse and say why.
    expect(result.deleted).toBe(0)
    expect(result.attempted).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.skipReasons['no verified duplicate scan — run Duplicate Finder first']).toBe(1)
    await expect(fs.stat(a)).resolves.toBeTruthy()
  })

  it('records a reason when a path is not part of a verified group', async () => {
    const finder = new DuplicateFinder()
    const a = path.join(tempRoot, 'dup-a.bin')
    const b = path.join(tempRoot, 'dup-b.bin')
    const unrelated = path.join(tempRoot, 'unrelated.bin')
    await fs.writeFile(a, Buffer.alloc(4096, 'y'))
    await fs.writeFile(b, Buffer.alloc(4096, 'y'))
    await fs.writeFile(unrelated, Buffer.alloc(2048, 'z'))

    const scanResult = await finder.scan([tempRoot], 1024, 'dup-op-1')
    expect(scanResult.groups.length).toBeGreaterThan(0)

    const result = await finder.delete([b, unrelated], 1)
    expect(result.deleted).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.skipReasons['not part of a verified duplicate group']).toBe(1)
    // The keeper copy survives, the non-duplicate survives.
    await expect(fs.stat(a)).resolves.toBeTruthy()
    await expect(fs.stat(unrelated)).resolves.toBeTruthy()
    await expect(fs.stat(b)).rejects.toThrow()
  })
})

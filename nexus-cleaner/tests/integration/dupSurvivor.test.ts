import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DuplicateFinder } from '../../src/main/services/duplicateFinder'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-dup-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const write = async (name: string, content: string): Promise<string> => {
  const p = path.join(root, name)
  await fs.writeFile(p, content)
  return p
}

describe('duplicate deletion preserves survivors', () => {
  it('refuses to remove the last remaining copy when the keeper vanished after the scan', async () => {
    const a = await write('a.bin', 'x'.repeat(4096))
    const b = await write('b.bin', 'x'.repeat(4096))

    const finder = new DuplicateFinder()
    const scan = await finder.scan([root], 1024, 'op-1')
    expect(scan.groups.length).toBe(1)

    // Someone else removes the copy that was meant to survive.
    await fs.rm(a)

    const result = await finder.delete([b], 1)

    // The group would otherwise drop to zero copies, so the deletion must be refused.
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(1)
    await expect(fs.stat(b)).resolves.toBeTruthy()
  })

  it('still deletes a genuine duplicate when a verified copy survives', async () => {
    const a = await write('a.bin', 'y'.repeat(4096))
    const b = await write('b.bin', 'y'.repeat(4096))

    const finder = new DuplicateFinder()
    const scan = await finder.scan([root], 1024, 'op-2')
    expect(scan.groups.length).toBe(1)

    const result = await finder.delete([b], 1)

    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(0)
    await expect(fs.stat(a)).resolves.toBeTruthy()
    await expect(fs.stat(b)).rejects.toThrow()
  })

  it('does not count a same-size file with different content as a survivor', async () => {
    const a = await write('a.bin', 'z'.repeat(4096))
    const b = await write('b.bin', 'z'.repeat(4096))

    const finder = new DuplicateFinder()
    await finder.scan([root], 1024, 'op-3')

    // Replace the copy that would have survived with different content of the
    // same length: same size, different bytes, so it is not a real copy.
    await fs.writeFile(a, 'q'.repeat(4096))

    const result = await finder.delete([b], 1)

    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skipReasons['no verified surviving copy — refusing to delete the last copy']).toBe(1)
    await expect(fs.stat(b)).resolves.toBeTruthy()
  })

  it('refuses paths that were never part of the scan', async () => {
    const a = await write('a.bin', 'w'.repeat(4096))
    const b = await write('b.bin', 'w'.repeat(4096))
    const outside = await write('unrelated.bin', 'u'.repeat(512))

    const finder = new DuplicateFinder()
    await finder.scan([root], 1024, 'op-4')

    const result = await finder.delete([outside], 1)
    expect(result.deleted).toBe(0)
    expect(result.skipReasons['not part of a verified duplicate group']).toBe(1)
    await expect(fs.stat(outside)).resolves.toBeTruthy()
    await expect(fs.stat(a)).resolves.toBeTruthy()
    await expect(fs.stat(b)).resolves.toBeTruthy()
  })
})

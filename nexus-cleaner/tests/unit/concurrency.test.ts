import { describe, expect, it } from 'vitest'
import { Batcher, CancellationToken, LRU, OperationCancelledError, TaskPool, hoursToMs, isCancellation, mapLimit } from '../../src/main/core/concurrency'
import { CleanupScheduler } from '../../src/main/services/scheduler'

describe('CancellationToken', () => {
  it('reports and propagates cancellation', () => {
    const token = new CancellationToken()
    expect(token.isCancelled).toBe(false)
    let fired = 0
    token.onCancel(() => fired++)
    token.cancel()
    token.cancel()
    expect(token.isCancelled).toBe(true)
    expect(fired).toBe(1)
    expect(() => token.throwIfCancelled()).toThrow(OperationCancelledError)
  })

  it('fires listeners registered after cancellation', () => {
    const token = new CancellationToken()
    token.cancel()
    let fired = false
    token.onCancel(() => {
      fired = true
    })
    expect(fired).toBe(true)
  })

  it('recognises cancellation errors', () => {
    expect(isCancellation(new OperationCancelledError())).toBe(true)
    expect(isCancellation({ cancelled: true })).toBe(true)
    expect(isCancellation(new Error('other'))).toBe(false)
  })
})

describe('mapLimit', () => {
  it('never exceeds the concurrency limit and preserves order', async () => {
    let active = 0
    let peak = 0
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([])
  })
})

describe('TaskPool', () => {
  it('bounds work and drains', async () => {
    const pool = new TaskPool(2)
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 10 }, () =>
      pool.run(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 2))
        active--
        return 1
      })
    )
    await pool.drain()
    const results = await Promise.all(tasks)
    expect(results.length).toBe(10)
    expect(peak).toBeLessThanOrEqual(2)
    expect(pool.pending).toBe(0)
  })

  it('rejects invalid limits', () => {
    expect(() => new TaskPool(0)).toThrow()
  })
})

describe('Batcher', () => {
  it('flushes when full', () => {
    const chunks: number[][] = []
    const batcher = new Batcher<number>(3, (items) => chunks.push(items), 10_000)
    batcher.push(1)
    batcher.push(2)
    batcher.push(3)
    expect(chunks).toEqual([[1, 2, 3]])
    batcher.flushNow()
    expect(chunks.length).toBe(1)
  })

  it('flushes on dispose', () => {
    const chunks: number[][] = []
    const batcher = new Batcher<number>(10, (items) => chunks.push(items), 10_000)
    batcher.push(1)
    batcher.dispose()
    expect(chunks).toEqual([[1]])
  })
})

describe('LRU', () => {
  it('evicts the least recently used entry', () => {
    const lru = new LRU<string, number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    expect(lru.get('a')).toBe(1)
    lru.set('c', 3)
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBe(1)
    expect(lru.get('c')).toBe(3)
  })
})

describe('hoursToMs', () => {
  it('converts and clamps', () => {
    expect(hoursToMs(1)).toBe(3_600_000)
    expect(hoursToMs(-5)).toBe(0)
  })
})

describe('CleanupScheduler.nextRunAt', () => {
  const base = {
    enabled: true,
    mode: 'quick' as const,
    categories: ['user-temp' as const],
    frequency: 'daily' as const,
    hour: 3,
    minute: 30,
    notify: true,
    maxAgeHours: 24
  }

  it('returns null when disabled', () => {
    expect(CleanupScheduler.nextRunAt({ ...base, enabled: false })).toBeNull()
  })

  it('returns the next daily occurrence', () => {
    const from = new Date(2026, 0, 5, 1, 0, 0)
    const next = CleanupScheduler.nextRunAt(base, from)
    expect(next?.getHours()).toBe(3)
    expect(next?.getMinutes()).toBe(30)
    expect(next?.getDate()).toBe(5)
  })

  it('rolls to tomorrow when the time already passed', () => {
    const from = new Date(2026, 0, 5, 9, 0, 0)
    const next = CleanupScheduler.nextRunAt(base, from)
    expect(next?.getDate()).toBe(6)
  })
})

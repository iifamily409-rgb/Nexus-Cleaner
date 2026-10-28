/**
 * Bounded-concurrency primitives and cooperative cancellation.
 * No external dependencies: small, predictable, and testable.
 */

export class CancellationToken {
  private cancelled = false
  private listeners = new Set<() => void>()

  get isCancelled(): boolean {
    return this.cancelled
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* listener errors must not break cancellation */
      }
    }
    this.listeners.clear()
  }

  onCancel(listener: () => void): () => void {
    if (this.cancelled) {
      listener()
      return () => undefined
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new OperationCancelledError()
  }
}

export class OperationCancelledError extends Error {
  readonly cancelled = true
  constructor(message = 'Operation cancelled') {
    super(message)
    this.name = 'OperationCancelledError'
  }
}

export const isCancellation = (err: unknown): boolean =>
  err instanceof OperationCancelledError || (err as { cancelled?: boolean } | null)?.cancelled === true

/** Run `fn` over `items` with at most `limit` in flight. Preserves result order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      const item = items[index] as T
      results[index] = await fn(item, index)
    }
  })
  await Promise.all(workers)
  return results
}

/** A tiny promise pool used for streaming scans where inputs are not known upfront. */
export class TaskPool {
  private active = 0
  private queue: (() => void)[] = []
  private idleResolvers: (() => void)[] = []
  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('TaskPool limit must be >= 1')
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.active++
  }

  private release(): void {
    this.active--
    const nextResolve = this.queue.shift()
    if (nextResolve) nextResolve()
    else if (this.active === 0) {
      const resolvers = this.idleResolvers
      this.idleResolvers = []
      for (const r of resolvers) r()
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve))
  }

  get pending(): number {
    return this.active + this.queue.length
  }
}

/** Batches values into arrays of `size`, flushing on a timer or when full. */
export class Batcher<T> {
  private buffer: T[] = []
  private timer: NodeJS.Timeout | null = null
  constructor(
    private readonly size: number,
    private readonly flush: (items: T[]) => void,
    private readonly intervalMs = 120
  ) {}

  push(item: T): void {
    this.buffer.push(item)
    if (this.buffer.length >= this.size) {
      this.flushNow()
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flushNow(), this.intervalMs)
      if (typeof this.timer.unref === 'function') this.timer.unref()
    }
  }

  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return
    const items = this.buffer
    this.buffer = []
    this.flush(items)
  }

  dispose(): void {
    this.flushNow()
  }
}

/** Simple bounded LRU used to memoize scan results and file hashes. */
export class LRU<K, V> {
  private map = new Map<K, V>()
  constructor(private readonly max: number) {}
  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next()
      if (!oldest.done) this.map.delete(oldest.value)
    }
  }
  get size(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Convert hours to milliseconds, clamped. */
export const hoursToMs = (hours: number): number => Math.max(0, hours) * 3_600_000

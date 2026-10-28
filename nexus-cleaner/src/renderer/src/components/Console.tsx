import { useEffect, useRef } from 'react'
import { formatBytes } from '../lib/api'
import type { OperationEvent } from '@shared/types'
import { Button } from './ui'
import { Trash2 } from 'lucide-react'

/**
 * Live operation console. Every line originates from a real engine event
 * (category start/end, deletion counts, verification, errors). Nothing is
 * synthesised for visual effect — if no operation is running, the console is
 * simply empty.
 */

const LEVEL_COLORS: Record<OperationEvent['level'], string> = {
  info: 'text-[color:var(--nx-text-dim)]',
  warn: 'text-amber-300',
  error: 'text-red-300',
  success: 'text-emerald-300'
}

const TYPE_LABEL: Record<OperationEvent['type'], string> = {
  start: 'START',
  progress: 'PROG',
  'category-start': 'CAT>',
  'category-end': 'CAT<',
  'delete-progress': 'DEL',
  verify: 'VERIFY',
  complete: 'DONE',
  cancelled: 'CANCEL',
  error: 'ERR',
  log: 'LOG'
}

export function OperationConsole({
  events,
  onClear,
  height = 'h-56'
}: {
  events: OperationEvent[]
  onClear: () => void
  height?: string
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [events])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[color:var(--nx-border)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--nx-text-dim)]">Operation console</span>
          <span className="nx-mono text-[10px] text-[color:var(--nx-text-dim)]">{events.length} events</span>
        </div>
        <Button variant="ghost" onClick={onClear} disabled={events.length === 0} className="!px-1.5 !py-0.5" ariaLabel="Clear console">
          <Trash2 size={12} />
        </Button>
      </div>
      <div
        className={`nx-mono ${height} flex-1 overflow-auto bg-black/25 px-3 py-1.5 text-[10.5px] leading-[1.55]`}
        onScroll={(e) => {
          const el = e.currentTarget
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        role="log"
        aria-live="polite"
        aria-label="Operation console"
      >
        {events.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-[color:var(--nx-text-dim)]">
            No events yet. Start a scan or cleanup — this console only records real operations.
          </div>
        ) : (
          events.map((event, index) => (
            <div key={`${event.at}-${index}`} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="shrink-0 opacity-45">{new Date(event.at).toLocaleTimeString()}</span>
              <span className={`shrink-0 font-bold ${LEVEL_COLORS[event.level]}`}>{TYPE_LABEL[event.type]}</span>
              <span className={LEVEL_COLORS[event.level]}>{event.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

export function LiveMetricsStrip({
  items
}: {
  items: { label: string; value: string; hint?: string }[]
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[color:var(--nx-border)] bg-[color:var(--nx-border)] sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-[color:var(--nx-surface-2)] px-3 py-2" title={item.hint}>
          <div className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--nx-text-dim)]">{item.label}</div>
          <div className="nx-mono text-[13px] font-semibold text-[color:var(--nx-text)]">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

export const bytesOrDash = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : formatBytes(value)

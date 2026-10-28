import { useMemo, useState } from 'react'
import { formatBytes } from '../lib/api'
import type { StorageNode } from '@shared/types'

/**
 * Squarified treemap. Pure SVG, no chart dependency.
 * Click a rectangle to drill down; breadcrumb to go back up.
 */

interface Rect {
  node: StorageNode
  x: number
  y: number
  w: number
  h: number
}

function worstRatio(row: number[], length: number, scale: number): number {
  if (row.length === 0 || length <= 0) return Infinity
  const sum = row.reduce((a, b) => a + b, 0) * scale
  if (sum === 0) return Infinity
  const max = Math.max(...row) * scale
  const min = Math.min(...row) * scale
  return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min))
}

/** Classic squarified layout. `items` must be sorted descending by value. */
export function squarify(items: { node: StorageNode; value: number }[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((acc, i) => acc + i.value, 0)
  if (total <= 0 || items.length === 0) return []
  const area = w * h
  const scale = area / total
  const rects: Rect[] = []
  let remaining = [...items]
  let cx = x
  let cy = y
  let cw = w
  let ch = h

  while (remaining.length > 0) {
    const shortSide = Math.min(cw, ch)
    const row: typeof remaining = []
    let bestRatio = Infinity
    let index = 0
    // Grow the row while it improves the aspect ratio.
    for (const item of remaining) {
      const candidate = [...row, item]
      const ratio = worstRatio(candidate.map((c) => c.value), shortSide, scale)
      if (ratio <= bestRatio) {
        bestRatio = ratio
        row.push(item)
        index++
      } else break
    }
    if (row.length === 0) {
      row.push(remaining[0] as (typeof remaining)[number])
      index = 1
    }

    const rowSum = row.reduce((acc, i) => acc + i.value, 0) * scale
    const horizontal = cw >= ch
    const thickness = shortSide > 0 ? rowSum / shortSide : 0

    let offset = 0
    for (const item of row) {
      const itemArea = item.value * scale
      const extent = thickness > 0 ? itemArea / thickness : 0
      if (horizontal) {
        rects.push({ node: item.node, x: cx, y: cy + offset, w: thickness, h: extent })
        offset += extent
      } else {
        rects.push({ node: item.node, x: cx + offset, y: cy, w: extent, h: thickness })
        offset += extent
      }
    }

    if (horizontal) {
      cx += thickness
      cw -= thickness
    } else {
      cy += thickness
      ch -= thickness
    }
    remaining = remaining.slice(index)
    if (cw <= 0.5 || ch <= 0.5) break
  }
  return rects
}

const COLORS = ['#22e6ff', '#2e9bff', '#2ee6a8', '#a78bfa', '#f59e0b', '#f472b6', '#38bdf8', '#34d399', '#fbbf24', '#c084fc']

export function Treemap({
  root,
  onOpen,
  width = 720,
  height = 420
}: {
  root: StorageNode
  onOpen?: (node: StorageNode) => void
  width?: number
  height?: number
}): React.JSX.Element {
  const [hover, setHover] = useState<{ node: StorageNode; x: number; y: number } | null>(null)
  const [path, setPath] = useState<StorageNode[]>([])

  const current = path.length > 0 ? (path[path.length - 1] as StorageNode) : root

  const layout = useMemo(() => {
    const children = (current.children ?? []).filter((c) => c.size > 0).slice(0, 80)
    const items = children.map((node) => ({ node, value: node.size })).sort((a, b) => b.value - a.value)
    return squarify(items, 0, 0, width, height)
  }, [current, width, height])

  const total = current.size || 1

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
        <button
          className="rounded px-1.5 py-0.5 text-[color:var(--nx-accent)] hover:bg-white/5"
          onClick={() => setPath([])}
          title="Back to root"
        >
          {root.name || root.path}
        </button>
        {path.map((node, i) => (
          <span key={node.path} className="flex items-center gap-1">
            <span className="text-[color:var(--nx-text-dim)]">/</span>
            <button
              className="max-w-[160px] truncate rounded px-1.5 py-0.5 hover:bg-white/5"
              onClick={() => setPath(path.slice(0, i + 1))}
              title={node.path}
            >
              {node.name}
            </button>
          </span>
        ))}
        <span className="ml-auto nx-mono text-[color:var(--nx-text-dim)]">{formatBytes(current.size)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-lg border border-[color:var(--nx-border)]" style={{ aspectRatio: `${width}/${height}` }}>
        {layout.length === 0 && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fill="#64748b" fontSize={13}>
            No readable content in this folder
          </text>
        )}
        {layout.map((rect, i) => {
          const share = rect.node.size / total
          const fill = COLORS[i % COLORS.length] as string
          const showLabel = rect.w > 68 && rect.h > 26
          return (
            <g
              key={rect.node.path}
              role={onOpen || rect.node.isDir ? 'button' : undefined}
              tabIndex={rect.node.isDir ? 0 : -1}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setHover({ node: rect.node, x: e.clientX - box.left, y: e.clientY - box.top })
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                if (rect.node.isDir && rect.node.children && rect.node.children.length > 0) {
                  setPath([...path, rect.node])
                } else {
                  onOpen?.(rect.node)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (rect.node.isDir && rect.node.children && rect.node.children.length > 0) setPath([...path, rect.node])
                  else onOpen?.(rect.node)
                }
              }}
              style={{ cursor: rect.node.isDir ? 'pointer' : 'default' }}
            >
              <rect
                x={rect.x + 1}
                y={rect.y + 1}
                width={Math.max(0, rect.w - 2)}
                height={Math.max(0, rect.h - 2)}
                rx={3}
                fill={fill}
                fillOpacity={0.16 + Math.min(0.5, share * 1.8)}
                stroke={fill}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
              {showLabel && (
                <>
                  <text x={rect.x + 6} y={rect.y + 15} fill="#e2e8f0" fontSize={10.5} fontWeight={600} pointerEvents="none">
                    {rect.node.name.length > Math.floor(rect.w / 6.2) ? `${rect.node.name.slice(0, Math.max(4, Math.floor(rect.w / 6.2) - 1))}…` : rect.node.name}
                  </text>
                  <text x={rect.x + 6} y={rect.y + 28} fill="#94a3b8" fontSize={9} pointerEvents="none">
                    {formatBytes(rect.node.size)}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-[color:var(--nx-border)] bg-[color:var(--nx-surface-2)] px-2 py-1.5 text-[11px] shadow-xl"
          style={{ left: Math.min(hover.x + 12, width - 200), top: hover.y + 12 }}
        >
          <div className="truncate font-semibold text-[color:var(--nx-text)]">{hover.node.name}</div>
          <div className="nx-mono text-[color:var(--nx-accent)]">{formatBytes(hover.node.size)}</div>
          <div className="text-[color:var(--nx-text-dim)]">
            {hover.node.fileCount.toLocaleString()} files · {hover.node.dirCount.toLocaleString()} folders
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[color:var(--nx-text-dim)]">{hover.node.path}</div>
        </div>
      )}
    </div>
  )
}

/** Horizontal stacked bar used for storage categories. */
export function CategoryBar({ items }: { items: { label: string; bytes: number; fileCount: number }[] }): React.JSX.Element {
  const total = items.reduce((acc, i) => acc + i.bytes, 0) || 1
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-[color:var(--nx-border)]">
        {items.map((item, i) => (
          <div
            key={item.label}
            title={`${item.label}: ${formatBytes(item.bytes)}`}
            style={{ width: `${(item.bytes / total) * 100}%`, background: COLORS[i % COLORS.length], opacity: 0.75 }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item, i) => (
          <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="text-[color:var(--nx-text)]">{item.label}</span>
            <span className="nx-mono text-[color:var(--nx-text-dim)]">{formatBytes(item.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

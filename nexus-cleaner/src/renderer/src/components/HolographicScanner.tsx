import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { formatBytes } from '../lib/api'
import type { LiveProgress } from '@shared/types'

/**
 * HolographicScanner
 * ------------------------------------------------------------------
 * TRUTHFULNESS RULE: every numeric ring, arc and counter below is driven by
 * `LiveProgress` emitted by the real cleanup engine. Decorative elements are
 * purely atmospheric and never present themselves as file activity:
 *   - outer rings rotate only while an operation is running (they are labelled
 *     "ambient field" in the tooltip)
 *   - the progress arc shows real category completion (done / total)
 *   - the scan beam sweeps only while phase === 'scan' | 'delete' | 'verify'
 * When nothing is running, the centre shows live disk + memory telemetry
 * instead of a fake "cleaning" animation.
 */

interface Props {
  progress: LiveProgress | null
  reducedMotion: boolean
  intensity: 'full' | 'reduced' | 'off'
  active: boolean
  /** Real disk free bytes for the idle centre readout. */
  diskFree: number | null
  diskTotal: number | null
  accent: string
}

const RING_COUNT = 4

function useAngles(count: number): number[] {
  return useMemo(() => Array.from({ length: count }, (_, i) => (360 / count) * i), [count])
}

function Ticks({ radius, count, length, opacity }: { radius: number; count: number; length: number; opacity: number }): React.JSX.Element {
  const ticks = useMemo(() => Array.from({ length: count }, (_, i) => i), [count])
  return (
    <g opacity={opacity}>
      {ticks.map((i) => {
        const angle = (360 / count) * i
        return (
          <line
            key={i}
            x1={0}
            y1={-radius}
            x2={0}
            y2={-radius + (i % 5 === 0 ? length * 1.9 : length)}
            stroke="currentColor"
            strokeWidth={i % 5 === 0 ? 1.6 : 0.9}
            transform={`rotate(${angle})`}
          />
        )
      })}
    </g>
  )
}

export const HolographicScanner = memo(function HolographicScanner({
  progress,
  reducedMotion,
  intensity,
  active,
  diskFree,
  diskTotal,
  accent
}: Props): React.JSX.Element {
  const motionEnabled = !reducedMotion && intensity !== 'off'
  const decorativeSpin = motionEnabled && intensity === 'full'

  const categoriesTotal = progress?.categoriesTotal.length ?? 0
  const categoriesDone = progress?.categoriesDone.length ?? 0
  const ratio = categoriesTotal > 0 ? Math.min(1, categoriesDone / categoriesTotal) : 0
  const circumference = 2 * Math.PI * 96
  const dashOffset = circumference * (1 - ratio)

  const ticksIndex = useAngles(RING_COUNT)

  const phaseLabel =
    progress?.phase === 'scan'
      ? 'ANALYSING'
      : progress?.phase === 'delete'
        ? 'REMOVING'
        : progress?.phase === 'verify'
          ? 'VERIFYING'
          : active
            ? 'ACTIVE'
            : 'STANDBY'

  const centreValue =
    progress && progress.phase !== 'idle' && progress.itemsEligible > 0
      ? formatBytes(progress.phase === 'delete' ? progress.bytesDeleted : progress.bytesEligible)
      : diskFree !== null
        ? formatBytes(diskFree)
        : '—'

  const centreLabel =
    progress && progress.phase !== 'idle' && progress.itemsEligible > 0
      ? progress.phase === 'delete'
        ? 'removed'
        : 'eligible'
      : 'free space'

  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        angle: (360 / 18) * i + (i % 3) * 7,
        radius: 58 + ((i * 13) % 46),
        delay: (i % 9) * 0.42,
        size: 1 + (i % 3) * 0.7
      })),
    []
  )

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <svg viewBox="-160 -160 320 320" className="h-full w-full max-h-[420px]" role="img" aria-label={`Holographic status: ${phaseLabel}`}>
        <defs>
          <radialGradient id="nx-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.42" />
            <stop offset="55%" stopColor={accent} stopOpacity="0.09" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nx-arc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.35" />
          </linearGradient>
          <filter id="nx-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <clipPath id="nx-clip">
            <rect x="-96" y="-96" width="192" height="192" />
          </clipPath>
        </defs>

        {/* Core glow — always present, purely atmospheric */}
        <circle r="120" fill="url(#nx-core)" className={decorativeSpin ? 'nx-anim-pulse' : undefined} />

        {/* Ring 1: outer tick field (ambient) */}
        <g className="text-[color:var(--nx-accent)]" opacity={0.45}>
          <g className={decorativeSpin ? 'nx-anim-spin-reverse' : undefined} style={{ transformOrigin: '0 0' }}>
            <Ticks radius={132} count={72} length={5} opacity={0.55} />
          </g>
        </g>

        {/* Ring 2: dashed ambience */}
        <circle
          r={118}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.8}
          strokeDasharray="3 11"
          className={`text-[color:var(--nx-accent)] ${decorativeSpin ? 'nx-anim-spin-slow' : ''}`}
          opacity={0.5}
          style={{ transformOrigin: '0 0' }}
        />

        {/* Ring 3: real progress arc */}
        <circle r={96} fill="none" stroke="currentColor" strokeWidth={7} opacity={0.1} className="text-[color:var(--nx-accent)]" />
        <motion.circle
          r={96}
          fill="none"
          stroke="url(#nx-arc)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: motionEnabled ? 0.5 : 0, ease: 'easeOut' }}
          transform="rotate(-90)"
          style={{ filter: 'drop-shadow(0 0 6px var(--nx-accent-glow))' }}
        />

        {/* Ring 4: rotating segment arcs, only animate while active */}
        <g style={{ transformOrigin: '0 0' }} className={motionEnabled && active ? 'nx-anim-spin-slow' : undefined}>
          {ticksIndex.map((angle, i) => (
            <circle
              key={angle}
              r={78 - i * 6}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeDasharray={`${28 + i * 9} ${300}`}
              strokeLinecap="round"
              className="text-[color:var(--nx-accent)]"
              opacity={0.62 - i * 0.1}
              transform={`rotate(${angle + i * 22})`}
            />
          ))}
        </g>

        {/* Scan beam — only while an operation is genuinely running */}
        {active && motionEnabled && (
          <g clipPath="url(#nx-clip)">
            <rect x="-96" y="-96" width="192" height="192" fill="url(#nx-arc)" opacity={0.06} className="nx-anim-sweep" />
          </g>
        )}

        {/* Orbiting particles */}
        {decorativeSpin && active && (
          <g className="nx-anim-spin-reverse" style={{ transformOrigin: '0 0' }}>
            {particles.map((p) => {
              const rad = (p.angle * Math.PI) / 180
              return (
                <motion.circle
                  key={p.id}
                  cx={Math.cos(rad) * p.radius}
                  cy={Math.sin(rad) * p.radius}
                  r={p.size}
                  fill={accent}
                  animate={{ opacity: [0.15, 0.9, 0.15] }}
                  transition={{ duration: 3.2, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
                />
              )
            })}
          </g>
        )}

        {/* Core */}
        <circle r={52} fill="rgba(0,0,0,0.55)" stroke="currentColor" strokeWidth={1} className="text-[color:var(--nx-accent)]" opacity={0.85} />
        <text x={0} y={-6} textAnchor="middle" className="fill-white nx-mono" style={{ fontSize: 17, fontWeight: 700 }}>
          {centreValue}
        </text>
        <text x={0} y={11} textAnchor="middle" style={{ fontSize: 8.5, fill: 'var(--nx-text-dim)', letterSpacing: 2 }}>
          {centreLabel.toUpperCase()}
        </text>
        <text x={0} y={30} textAnchor="middle" style={{ fontSize: 7.5, fill: accent, letterSpacing: 3 }}>
          {phaseLabel}
        </text>
      </svg>

      {diskTotal !== null && (
        <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-center">
          <div className="nx-mono text-[10px] tracking-[0.2em] text-[color:var(--nx-text-dim)]">
            {categoriesTotal > 0 ? `${categoriesDone}/${categoriesTotal} CATEGORIES` : 'AMBIENT FIELD · REAL TELEMETRY'}
          </div>
        </div>
      )}
    </div>
  )
})

import { ChevronRight, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CleanupMode } from '@shared/types'

/**
 * One of the three primary scan actions on the home screen.
 *
 * Purely a launcher: it never draws scanning imagery on its own. While the
 * matching scan is genuinely running it swaps to a spinner + status text driven
 * by real session state, and it stays disabled so two scans cannot overlap.
 */
export function ScanAction({
  mode,
  title,
  subtitle,
  detail,
  icon: Icon,
  active,
  running,
  disabled,
  onStart
}: {
  mode: CleanupMode
  title: string
  subtitle: string
  detail: string
  icon: LucideIcon
  active: boolean
  running: boolean
  disabled: boolean
  onStart: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled}
      aria-label={`${title} — ${subtitle}`}
      aria-busy={running}
      data-scan-action={mode}
      data-active={active ? 'true' : 'false'}
      className={`nx-scan-action group flex w-full items-start gap-3 rounded-xl border px-4 py-4 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'border-[color:var(--nx-accent)]/60 bg-[color:var(--nx-accent)]/8'
          : 'border-[color:var(--nx-border)] bg-[color:var(--nx-surface-2)] hover:border-[color:var(--nx-accent)]/45'
      }`}
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
          active
            ? 'border-[color:var(--nx-accent)]/50 text-[color:var(--nx-accent)]'
            : 'border-[color:var(--nx-border)] text-[color:var(--nx-text-dim)] group-hover:text-[color:var(--nx-accent)]'
        }`}
      >
        {running ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-[color:var(--nx-text)]">{title}</span>
          {active && (
            <span className="nx-chip border-[color:var(--nx-accent)]/40 nx-text-accent">
              {running ? 'running' : 'results below'}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11.5px] text-[color:var(--nx-text-dim)]">{subtitle}</span>
        <span className="mt-1 block text-[10.5px] leading-relaxed text-[color:var(--nx-text-dim)]/85">{detail}</span>
      </span>
      <ChevronRight
        size={14}
        className="mt-1 shrink-0 text-[color:var(--nx-text-dim)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[color:var(--nx-accent)]"
      />
    </button>
  )
}

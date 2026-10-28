import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { FEATURES, FEATURE_GROUPS, type PageId } from '../lib/navigation'

/**
 * "All Features" launcher in the top bar.
 *
 * A drawer, not a replacement: every entry still routes to the original page
 * component with its original services and IPC channels.
 */
export function AllFeatures({
  open,
  onClose,
  onSelect,
  current
}: {
  open: boolean
  onClose: () => void
  onSelect: (page: PageId) => void
  current: PageId
}): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    // Move focus into the drawer so keyboard users land in the menu.
    const first = panelRef.current?.querySelector<HTMLButtonElement>('button[data-feature-id]')
    first?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/55"
        role="presentation"
        onClick={onClose}
        data-testid="all-features-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="All features"
        data-testid="all-features-drawer"
        className="relative flex h-full w-full max-w-[420px] flex-col border-l border-[color:var(--nx-border)] bg-[color:var(--nx-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[color:var(--nx-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--nx-text)]">All features</h2>
            <p className="mt-0.5 text-[11px] text-[color:var(--nx-text-dim)]">
              Every tool keeps its own backend service. Pick one to open it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close all features"
            className="rounded-lg border border-[color:var(--nx-border)] p-1.5 text-[color:var(--nx-text-dim)] hover:border-[color:var(--nx-accent)]/50 hover:text-[color:var(--nx-accent)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-2 py-2">
          {FEATURE_GROUPS.map((group) => {
            const items = FEATURES.filter((feature) => feature.group === group)
            return (
              <section key={group} className="mb-2">
                <h3 className="nx-label px-2 pb-1 pt-2">{group}</h3>
                <ul>
                  {items.map((feature) => {
                    const Icon = feature.icon
                    const active = current === feature.id
                    return (
                      <li key={feature.id}>
                        <button
                          type="button"
                          data-feature-id={feature.id}
                          onClick={() => onSelect(feature.id)}
                          aria-current={active ? 'page' : undefined}
                          className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-150 ${
                            active
                              ? 'bg-[color:var(--nx-accent)]/10 text-[color:var(--nx-accent)]'
                              : 'text-[color:var(--nx-text)] hover:bg-[color:var(--nx-surface-2)]'
                          }`}
                        >
                          <Icon size={15} className="mt-0.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium">{feature.label}</span>
                            <span className="mt-0.5 block text-[10.5px] leading-snug text-[color:var(--nx-text-dim)]">
                              {feature.description}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

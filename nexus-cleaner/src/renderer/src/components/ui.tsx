import React, { useEffect, useId, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Info, X, ChevronDown } from 'lucide-react'

/* ------------------------------------------------------------- Panel ----- */
export function Panel({
  children,
  className = '',
  glow = false,
  as: Tag = 'section'
}: {
  children: React.ReactNode
  className?: string
  glow?: boolean
  as?: 'section' | 'div' | 'article'
}): React.JSX.Element {
  return <Tag className={`nx-panel ${glow ? 'nx-panel-glow' : ''} ${className}`}>{children}</Tag>
}

export function PanelHeader({
  title,
  subtitle,
  right,
  icon
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  icon?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[color:var(--nx-border)] px-4 py-3">
      <div className="flex items-start gap-2.5">
        {icon && <div className="mt-0.5 text-[color:var(--nx-accent)]">{icon}</div>}
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-[color:var(--nx-text)]">{title}</h2>
          {subtitle && <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-[color:var(--nx-text-dim)]">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

/* ------------------------------------------------------------- Button ---- */
type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost'

export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  title,
  className = '',
  type = 'button',
  ariaLabel
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: ButtonVariant
  title?: string
  className?: string
  type?: 'button' | 'submit'
  ariaLabel?: string
}): React.JSX.Element {
  const variantClass =
    variant === 'primary' ? 'nx-btn-primary' : variant === 'danger' ? 'nx-btn-danger' : variant === 'ghost' ? 'border-transparent bg-transparent' : ''
  return (
    <button
      type={type}
      className={`nx-btn ${variantClass} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </button>
  )
}

/* --------------------------------------------------------- Stat card ----- */
export function StatCard({
  label,
  value,
  sub,
  accent = false,
  icon,
  percent
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  icon?: React.ReactNode
  percent?: number | null
}): React.JSX.Element {
  return (
    <div className="nx-panel nx-panel-glow px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="nx-label">{label}</span>
        {icon && <span className="text-[color:var(--nx-accent)] opacity-80">{icon}</span>}
      </div>
      <div className={`nx-mono mt-1.5 text-xl font-semibold ${accent ? 'nx-text-accent' : 'text-[color:var(--nx-text)]'}`}>{value}</div>
      {typeof percent === 'number' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[color:var(--nx-border)]">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, var(--nx-accent), var(--nx-accent-dim))' }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      )}
      {sub && <div className="mt-1.5 text-[11px] leading-snug text-[color:var(--nx-text-dim)]">{sub}</div>}
    </div>
  )
}

/* ------------------------------------------------------------ Tooltip ---- */
export function Tooltip({ text, children }: { text: string; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-[color:var(--nx-border)] bg-[color:var(--nx-surface-2)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[color:var(--nx-text)] shadow-xl"
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

export function InfoHint({ text }: { text: string }): React.JSX.Element {
  return (
    <Tooltip text={text}>
      <button type="button" aria-label="More information" className="text-[color:var(--nx-text-dim)] hover:text-[color:var(--nx-accent)]">
        <Info size={13} />
      </button>
    </Tooltip>
  )
}

/* --------------------------------------------------------------- Modal --- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`nx-panel max-h-[86vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-hidden`}
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[color:var(--nx-border)] px-4 py-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <button onClick={onClose} aria-label="Close dialog" className="text-[color:var(--nx-text-dim)] hover:text-[color:var(--nx-text)]">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[62vh] overflow-auto px-4 py-3 text-sm">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-[color:var(--nx-border)] px-4 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* -------------------------------------------------------------- Toggle --- */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  description
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
  description?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <label htmlFor={id} className="text-[13px] font-medium text-[color:var(--nx-text)]">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-[color:var(--nx-text-dim)]">{description}</p>}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? 'border-transparent' : 'border-[color:var(--nx-border)] bg-black/30'} ${disabled ? 'opacity-40' : ''}`}
        style={checked ? { background: 'linear-gradient(135deg, var(--nx-accent), var(--nx-accent-dim))' } : undefined}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow"
          style={{ left: checked ? 18 : 3 }}
        />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------ Progress --- */
export function ProgressBar({
  value,
  indeterminate = false,
  label
}: {
  value: number
  indeterminate?: boolean
  label?: string
}): React.JSX.Element {
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-[11px] text-[color:var(--nx-text-dim)]">
          <span>{label}</span>
          {!indeterminate && <span className="nx-mono">{Math.round(value)}%</span>}
        </div>
      )}
      <div className="relative h-1.5 overflow-hidden rounded-full bg-[color:var(--nx-border)]">
        {indeterminate ? (
          <motion.div
            className="absolute top-0 h-full w-1/3 rounded-full"
            style={{ background: 'linear-gradient(90deg, transparent, var(--nx-accent), transparent)' }}
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />
        ) : (
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: 'linear-gradient(90deg, var(--nx-accent), var(--nx-accent-dim))' }}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- Select ---- */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  id
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  label?: string
  id?: string
}): React.JSX.Element {
  const generated = useId()
  const selectId = id ?? generated
  return (
    <div>
      {label && (
        <label htmlFor={selectId} className="nx-label mb-1 block">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className="nx-input appearance-none pr-8"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--nx-text-dim)]" />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Empty ---- */
export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="nx-anim-pulse mb-1 h-10 w-10 rounded-full border border-[color:var(--nx-accent)] opacity-40" />
      <p className="text-sm font-medium text-[color:var(--nx-text)]">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-[color:var(--nx-text-dim)]">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* --------------------------------------------------------------- Badge ---- */
export function Badge({
  children,
  tone = 'neutral'
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'
}): React.JSX.Element {
  const tones: Record<string, string> = {
    neutral: 'border-[color:var(--nx-border)] text-[color:var(--nx-text-dim)]',
    ok: 'border-emerald-500/40 text-emerald-300',
    warn: 'border-amber-500/40 text-amber-300',
    danger: 'border-red-500/40 text-red-300',
    accent: 'border-[color:var(--nx-accent)]/40 nx-text-accent'
  }
  return <span className={`nx-chip ${tones[tone]}`}>{children}</span>
}

/* ---------------------------------------------------------------- Toast --- */
export function Toast({
  toast,
  onClose
}: {
  toast: { id: number; message: string; level: 'info' | 'success' | 'error' | 'warn' } | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          className="fixed bottom-5 right-5 z-[120] flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur"
          style={{
            borderColor:
              toast.level === 'error'
                ? 'rgba(239,68,68,0.5)'
                : toast.level === 'success'
                  ? 'rgba(16,185,129,0.5)'
                  : toast.level === 'warn'
                    ? 'rgba(245,158,11,0.5)'
                    : 'var(--nx-border)',
            background: 'var(--nx-surface-2)'
          }}
          role="status"
          aria-live="polite"
        >
          <div className="text-xs leading-relaxed text-[color:var(--nx-text)]">{toast.message}</div>
          <button onClick={onClose} aria-label="Dismiss notification" className="text-[color:var(--nx-text-dim)] hover:text-[color:var(--nx-text)]">
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------- Section ---- */
export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="nx-label">{label}</span>
        {hint && <InfoHint text={hint} />}
      </div>
      {children}
    </div>
  )
}

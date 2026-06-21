import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  variant = 'default',
}) {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
  }

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  if (variant === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-[1200]">
        <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--modal-backdrop)' }} onClick={onClose} />

        <div className="absolute inset-0 flex flex-col p-2 sm:p-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center text-[var(--muted-text-strong)] transition-colors hover:text-[var(--page-fg)]"
          >
            <X size={18} />
          </button>

          <div className="mx-auto flex w-full flex-1 flex-col overflow-hidden bg-transparent">
            {title ? (
              <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 py-3 text-[var(--page-fg)]">
                <h2 className="min-w-0 truncate text-sm font-bold sm:text-base">{title}</h2>
                <div className="w-11" />
              </div>
            ) : null}
            <div className="min-h-0 flex-1 text-[var(--muted-text-strong)]">{children}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 backdrop-blur-sm"
        style={{ background: 'var(--modal-backdrop)' }}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div
        className={`relative my-3 flex max-h-[calc(100dvh-1.5rem)] w-full ${sizes[size]} flex-col overflow-hidden rounded-2xl p-4 animate-in fade-in zoom-in duration-200 sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:p-6 ${
          variant === 'light'
            ? 'border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--page-fg)] shadow-2xl'
            : 'border border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--page-fg)] shadow-2xl'
        }`}
      >
        {/* Header */}
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-bold sm:text-lg">{title}</h2>
          <button 
            onClick={onClose}
            aria-label="Close"
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg transition-colors ${
              variant === 'light'
                ? 'text-[var(--muted-text)] hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)]'
                : 'text-[var(--muted-text)] hover:bg-[var(--muted-bg)] hover:text-[var(--page-fg)]'
            }`}
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Content */}
        <div className={`min-h-0 overflow-x-hidden overflow-y-auto ${variant === 'light' ? 'text-[var(--muted-text-strong)]' : 'text-[var(--muted-text-strong)]'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

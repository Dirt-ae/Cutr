import { X } from 'lucide-react'

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className={`relative my-3 flex max-h-[calc(100dvh-1.5rem)] w-full ${sizes[size]} flex-col overflow-hidden glass rounded-2xl p-4 animate-in fade-in zoom-in duration-200 sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:p-6`}>
        {/* Header */}
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-bold sm:text-lg">{title}</h2>
          <button 
            onClick={onClose}
            className="shrink-0 p-1.5 text-white/40 hover:text-white transition-colors rounded-lg hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Content */}
        <div className="min-h-0 overflow-y-auto text-white/80">
          {children}
        </div>
      </div>
    </div>
  )
}

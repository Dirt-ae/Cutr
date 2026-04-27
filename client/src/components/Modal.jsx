import { X } from 'lucide-react'

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className={`relative w-full ${sizes[size]} glass rounded-2xl p-6 animate-in fade-in zoom-in duration-200`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button 
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white transition-colors rounded-lg hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Content */}
        <div className="text-white/80">
          {children}
        </div>
      </div>
    </div>
  )
}

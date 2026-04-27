import { Check, X, AlertCircle, Info } from 'lucide-react'

export default function Toast({ type = 'info', message, onClose }) {
  const icons = {
    success: <Check size={18} className="text-green-400" />,
    error: <X size={18} className="text-red-400" />,
    warning: <AlertCircle size={18} className="text-yellow-400" />,
    info: <Info size={18} className="text-blue-400" />
  }

  const colors = {
    success: 'border-green-500/30',
    error: 'border-red-500/30',
    warning: 'border-yellow-500/30',
    info: 'border-blue-500/30'
  }

  return (
    <div className={`fixed bottom-4 right-4 z-50 glass rounded-xl p-4 border ${colors[type]} flex items-center gap-3 animate-in slide-in-from-right duration-200`}>
      {icons[type]}
      <span className="text-sm text-white/90">{message}</span>
      <button 
        onClick={onClose}
        className="p-1 text-white/40 hover:text-white transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}

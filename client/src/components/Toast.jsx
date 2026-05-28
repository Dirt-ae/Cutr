import { Check, X, AlertCircle, Info } from 'lucide-react'

export default function Toast({ type = 'info', message, variant = 'toast', onClose }) {
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

  if (variant === 'notice') {
    return (
      <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/35 px-4 backdrop-blur-sm animate-in fade-in duration-200">
        <div className={`glass w-full max-w-lg rounded-2xl border ${colors[type]} p-5 shadow-2xl shadow-black/40`}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {icons[type]}
              <p className="text-sm font-bold text-white">
                {type === 'warning' ? 'Still processing' : type === 'error' ? 'Upload issue' : 'CUTRR'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close message"
            >
              <X size={16} />
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
            {message}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`fixed inset-x-3 bottom-4 z-50 glass rounded-xl p-4 border ${colors[type]} flex items-start gap-3 animate-in slide-in-from-right duration-200 sm:left-auto sm:right-4 sm:w-auto sm:max-w-md`}>
      {icons[type]}
      <span className="min-w-0 flex-1 text-sm text-white/90">{message}</span>
      <button 
        onClick={onClose}
        className="shrink-0 p-1 text-white/40 hover:text-white transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}

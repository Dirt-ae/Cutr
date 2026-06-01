import { createContext, useContext, useRef, useState } from 'react'
import Toast from '../components/Toast'

const ToastContext = createContext()

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timeoutsRef = useRef(new Map())

  const closeToast = (id) => {
    const timeoutId = timeoutsRef.current.get(id)
    if (timeoutId) clearTimeout(timeoutId)
    timeoutsRef.current.delete(id)
    setToasts((current) => current.filter((t) => t.id !== id))
  }

  const showToast = (message, type = 'info', options = {}) => {
    const variant = options.variant || 'toast'
    const duration = options.duration ?? (variant === 'notice' ? 15000 : 3000)
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`

    setToasts((current) => {
      if (variant === 'notice') {
        // Only show one blocking notice at a time.
        return [{ id, message, type, variant }]
      }
      return [...current, { id, message, type, variant }]
    })

    const timeoutId = setTimeout(() => {
      timeoutsRef.current.delete(id)
      setToasts((current) => current.filter((t) => t.id !== id))
    }, duration)
    timeoutsRef.current.set(id, timeoutId)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1100] flex w-[min(calc(100vw-2rem),26rem)] flex-col gap-2">
        {toasts
          .filter((t) => t.variant !== 'notice')
          .map((toast) => (
            <Toast
              key={toast.id}
              type={toast.type}
              message={toast.message}
              variant={toast.variant}
              onClose={() => closeToast(toast.id)}
            />
          ))}
      </div>
      {toasts
        .filter((t) => t.variant === 'notice')
        .map((toast) => (
          <Toast
            key={toast.id}
            type={toast.type}
            message={toast.message}
            variant={toast.variant}
            onClose={() => closeToast(toast.id)}
          />
        ))}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

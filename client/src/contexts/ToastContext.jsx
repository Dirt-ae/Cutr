import { createContext, useContext, useRef, useState } from 'react'
import Toast from '../components/Toast'

const ToastContext = createContext()

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timeoutRef = useRef(null)

  const closeToast = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setToast(null)
  }

  const showToast = (message, type = 'info', options = {}) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const variant = options.variant || 'toast'
    const duration = options.duration ?? (variant === 'notice' ? 15000 : 3000)
    setToast({ message, type, variant })
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      setToast(null)
    }, duration)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast 
          type={toast.type} 
          message={toast.message} 
          variant={toast.variant}
          onClose={closeToast} 
        />
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

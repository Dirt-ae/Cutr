import { createContext, useContext, useState } from 'react'
import Toast from '../components/Toast'

const ToastContext = createContext()

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)

  const showToast = (message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast 
          type={toast.type} 
          message={toast.message} 
          onClose={() => setToast(null)} 
        />
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

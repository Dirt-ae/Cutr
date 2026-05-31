import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { API_URL } from '../utils/api'

const API_PATHS = ['/api/', '/embed/', '/thumb/', '/download/', '/video-stream/']
const WAKE_NOTICE_DELAY_MS = 3500
const WAKE_NOTICE_HIDE_MS = 5000

const getRequestUrl = (input) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url || ''
}

const isApiRequest = (input) => {
  const url = getRequestUrl(input)
  if (!url) return false
  if (API_PATHS.some((path) => url.startsWith(path))) return true
  if (!API_URL) return false

  try {
    const requestUrl = new URL(url, window.location.origin)
    const apiUrl = new URL(API_URL, window.location.origin)
    return requestUrl.origin === apiUrl.origin
  } catch {
    return false
  }
}

export default function ServerWakeNotice() {
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef(null)

  useEffect(() => {
    const originalFetch = window.fetch

    window.fetch = async (...args) => {
      if (!isApiRequest(args[0])) return originalFetch(...args)

      let noticeShown = false
      const showTimer = window.setTimeout(() => {
        noticeShown = true
        window.clearTimeout(hideTimerRef.current)
        setVisible(true)
      }, WAKE_NOTICE_DELAY_MS)

      try {
        return await originalFetch(...args)
      } finally {
        window.clearTimeout(showTimer)
        if (noticeShown) {
          window.clearTimeout(hideTimerRef.current)
          hideTimerRef.current = window.setTimeout(() => {
            setVisible(false)
          }, WAKE_NOTICE_HIDE_MS)
        }
      }
    }

    return () => {
      window.fetch = originalFetch
      window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center px-4 transition-opacity duration-500 ${
        visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-live="polite"
      aria-hidden={!visible}
    >
      <div className="w-full max-w-sm rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 text-center text-[var(--page-fg)] shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--muted-border)] bg-[var(--muted-bg)]">
          <Loader2 className="animate-spin text-[var(--muted-text-strong)]" size={22} />
        </div>
        <h2 className="text-base font-semibold tracking-tight">Server waking up</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">
          The free server restarts after nobody uses the site for a bit. This should only take a few seconds. Please wait.
        </p>
      </div>
    </div>
  )
}

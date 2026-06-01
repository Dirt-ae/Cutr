import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { API_URL } from '../utils/api'

const API_PATHS = ['/api/', '/embed/', '/thumb/', '/download/', '/video-stream/']
const WAKE_NOTICE_DELAY_MS = 10000
const WAKE_NOTICE_HIDE_MS = 5000
const WAKE_NOTICE_COOLDOWN_MS = 60000

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
  const lastNoticeAtRef = useRef(0)

  useEffect(() => {
    const originalFetch = window.fetch

    window.fetch = async (...args) => {
      if (!isApiRequest(args[0])) return originalFetch(...args)

      let noticeShown = false
      const showTimer = window.setTimeout(() => {
        if (Date.now() - lastNoticeAtRef.current < WAKE_NOTICE_COOLDOWN_MS) return
        noticeShown = true
        lastNoticeAtRef.current = Date.now()
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
      className={`fixed bottom-4 right-4 z-[9999] w-[min(calc(100vw-2rem),22rem)] transition-opacity duration-500 ${
        visible ? 'pointer-events-none opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-live="polite"
      aria-hidden={!visible}
    >
      <div className="flex items-start gap-3 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 text-[var(--page-fg)] shadow-[0_16px_44px_rgba(0,0,0,0.24)] backdrop-blur-xl">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--muted-border)] bg-[var(--muted-bg)]">
          <Loader2 className="animate-spin text-[var(--muted-text-strong)]" size={18} />
        </div>
        <div className="min-w-0 text-left">
          <h2 className="text-sm font-semibold tracking-tight">Still waiting on the server</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-text)]">
            One request is taking longer than usual. The page can keep working while it finishes.
          </p>
        </div>
      </div>
    </div>
  )
}

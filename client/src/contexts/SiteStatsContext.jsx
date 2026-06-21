import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getSiteStatsFallbackUrls } from '../utils/api'

export const PLATFORM_DATA_CHANGED = 'cutr:platform-data-changed'
const STATS_POLL_MS = 5_000
const STATS_SYNC_DEBOUNCE_MS = 250

const SiteStatsContext = createContext(null)

const isSiteStatsPayload = (value) =>
  value &&
  typeof value === 'object' &&
  Number.isFinite(Number(value.videosUploaded)) &&
  Number.isFinite(Number(value.storageBytes)) &&
  Number.isFinite(Number(value.usersSignedUp))

export function notifyPlatformDataChanged(siteStats) {
  window.dispatchEvent(
    new CustomEvent(PLATFORM_DATA_CHANGED, {
      detail: isSiteStatsPayload(siteStats) ? siteStats : undefined,
    }),
  )
}

export function notifyFromApiResponse(data) {
  notifyPlatformDataChanged(data?.siteStats)
}

export function useSiteStats() {
  const ctx = useContext(SiteStatsContext)
  if (!ctx) {
    throw new Error('useSiteStats must be used within SiteStatsProvider')
  }
  return ctx
}

export function SiteStatsProvider({ children }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const syncTimeoutRef = useRef(null)

  const refreshStats = useCallback(async () => {
    const cacheBust = `_=${Date.now()}`
    for (const baseUrl of getSiteStatsFallbackUrls()) {
      const url = baseUrl.includes('?')
        ? `${baseUrl}&${cacheBust}`
        : `${baseUrl}?${cacheBust}`
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) continue
        const data = await response.json()
        if (isSiteStatsPayload(data)) {
          setStats(data)
          return true
        }
      } catch {
        // Try the next URL (direct API, then Vite/Netlify proxy).
      }
    }
    return false
  }, [])

  const scheduleStatsSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null
      refreshStats()
    }, STATS_SYNC_DEBOUNCE_MS)
  }, [refreshStats])

  useEffect(() => {
    let cancelled = false

    refreshStats().finally(() => {
      if (!cancelled) setLoading(false)
    })

    const pollId = setInterval(refreshStats, STATS_POLL_MS)

    const onChanged = (event) => {
      const nextStats = event?.detail
      if (isSiteStatsPayload(nextStats)) {
        setStats(nextStats)
      }
      scheduleStatsSync()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshStats()
      }
    }

    window.addEventListener(PLATFORM_DATA_CHANGED, onChanged)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(pollId)
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
      window.removeEventListener(PLATFORM_DATA_CHANGED, onChanged)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshStats, scheduleStatsSync])

  const value = useMemo(
    () => ({ stats, loading, refreshStats }),
    [stats, loading, refreshStats],
  )

  return (
    <SiteStatsContext.Provider value={value}>
      {children}
    </SiteStatsContext.Provider>
  )
}

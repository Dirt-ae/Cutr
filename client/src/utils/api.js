const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

const PRODUCTION_API_URL = 'https://cutr.onrender.com'
const DEV_API_PORT = import.meta.env.VITE_DEV_API_PORT || '3001'

const shouldUseProductionApi = () => {
  if (typeof window === 'undefined') return false
  return /(^|\.)cutrr\.xyz$/i.test(window.location.hostname)
}

// On the live domain, send uploads/auth straight to the Render API for reliability.
export const API_URL = configuredApiUrl || (shouldUseProductionApi() ? PRODUCTION_API_URL : '')

const isLocalDevHost = (hostname) =>
  hostname === 'localhost' || hostname === '127.0.0.1'

/** Base URL for the Express API (no trailing slash). */
export const getApiBaseUrl = () => {
  if (configuredApiUrl) return configuredApiUrl

  if (typeof window !== 'undefined') {
    const { hostname, origin, protocol } = window.location

    if (isLocalDevHost(hostname)) {
      return `${protocol}//${hostname}:${DEV_API_PORT}`
    }

    if (shouldUseProductionApi()) {
      return PRODUCTION_API_URL
    }

    return origin
  }

  return ''
}

export const getSiteStatsUrl = () => {
  const base = getApiBaseUrl()
  return base ? `${base}/api/site-stats` : '/api/site-stats'
}

export const getSiteStatsFallbackUrls = () => {
  const urls = []
  const add = (url) => {
    if (url && !urls.includes(url)) urls.push(url)
  }

  add(getSiteStatsUrl())

  if (typeof window !== 'undefined') {
    add(`${window.location.origin}/api/site-stats`)
  }

  return urls
}

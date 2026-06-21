const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

const PRODUCTION_API_URL = 'https://cutr.onrender.com'

const shouldUseProductionApi = () => {
  if (typeof window === 'undefined') return false
  return /(^|\.)cutrr\.xyz$/i.test(window.location.hostname)
}

// On the live domain, send uploads/auth straight to the Render API for reliability.
export const API_URL = configuredApiUrl || (shouldUseProductionApi() ? PRODUCTION_API_URL : '')

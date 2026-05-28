const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// Prefer an explicitly configured API host when present. If it is not set,
// fall back to same-origin Netlify redirects for /api, /embed, /thumb, etc.
export const API_URL = configuredApiUrl || ''

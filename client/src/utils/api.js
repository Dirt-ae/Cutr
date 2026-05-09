// Production uses Netlify same-origin redirects for /api, /embed, /thumb, and video streams.
// That avoids browser CORS entirely even if VITE_API_URL is set in Netlify.
export const API_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_URL || '') : ''

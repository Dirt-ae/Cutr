import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSiteStatsFallbackUrls } from '../utils/api'
import { APP_VERSION } from '../constants/version'

const formatCount = (value) => {
  const count = Number(value)
  if (!Number.isFinite(count) || count < 0) return '—'
  return count.toLocaleString('en-US')
}

const formatStorage = (bytes) => {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  )
  const value = size / 1024 ** exponent
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[exponent]}`
}

const FOOTER_LINKS = [
  { to: '/info', label: 'Info' },
  { to: '/resources', label: 'Resources' },
  { to: '/legal', label: 'Legal' },
  { to: '/forms', label: 'Forms' },
  { href: 'https://ko-fi.com/cutrr', label: 'Donations', external: true },
  { href: 'https://discord.gg/JAbzJX4Jce', label: 'Discord', external: true },
]

function SiteStats({ className = '' }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadStats = async () => {
      for (const url of getSiteStatsFallbackUrls()) {
        try {
          const response = await fetch(url)
          if (!response.ok) continue
          const data = await response.json()
          if (!cancelled && data && typeof data === 'object') {
            setStats(data)
            break
          }
        } catch {
          // Try the next URL (direct API, then Vite/Netlify proxy).
        }
      }

      if (!cancelled) setLoading(false)
    }

    loadStats()

    return () => {
      cancelled = true
    }
  }, [])

  const videosUploaded = stats ? formatCount(stats.videosUploaded) : '—'
  const storage = stats ? formatStorage(stats.storageBytes) : '—'
  const usersSignedUp = stats ? formatCount(stats.usersSignedUp) : '—'

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[var(--muted-text)] ${className}`}
      aria-busy={loading}
    >
      <span>
        <span className="font-semibold text-[var(--muted-text-strong)]">{videosUploaded}</span>
        <span> videos uploaded</span>
      </span>
      <span className="opacity-30" aria-hidden="true">
        ·
      </span>
      <span>
        <span className="font-semibold text-[var(--muted-text-strong)]">{storage}</span>
        <span> storage</span>
      </span>
      <span className="opacity-30" aria-hidden="true">
        ·
      </span>
      <span>
        <span className="font-semibold text-[var(--muted-text-strong)]">{usersSignedUp}</span>
        <span> users signed up</span>
      </span>
    </div>
  )
}

export default function SiteFooter() {
  return (
    <footer className="mt-auto w-full shrink-0 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-5 py-6 text-center text-xs sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4">
        <SiteStats />
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium text-[var(--muted-text-strong)]">
          {FOOTER_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-[var(--page-fg)]"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={link.to}
                className="transition-colors hover:text-[var(--page-fg)]"
              >
                {link.label}
              </Link>
            ),
          )}
        </div>
        <div className="text-[var(--muted-text)]">v{APP_VERSION}</div>
      </div>
    </footer>
  )
}

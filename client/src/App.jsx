import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Home from './pages/Home'
import Video from './pages/Video'
import Login from './pages/Login'
import AdminLogin from './pages/AdminLogin'
import AdminPanel from './pages/AdminPanel'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Forms from './pages/Forms'
import ApplyForm from './pages/ApplyForm'
import DiscordCallback from './pages/DiscordCallback'
import Info from './pages/Info'
import Legal from './pages/Legal'
import Resources from './pages/Resources'
import { ToastProvider } from './contexts/ToastContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ThemeEffect from './components/ThemeEffect'
import ServerWakeNotice from './components/ServerWakeNotice'
import AdBlockNotice from './components/AdBlockNotice'
import { API_URL } from './utils/api'

const SITE_URL = 'https://cutrr.byethost32.com'
const HOME_TITLE = 'CUTRR | Fast Discord Video Hosting'
const HOME_DESCRIPTION = 'Upload videos up to 100MB, get short links, and share clean Discord embeds. Free, fast hosting for editors and creators.'
const HOME_SOCIAL_DESCRIPTION = 'Upload videos up to 100MB, get short links, and share clean Discord embeds. Free, fast hosting for editors and creators.'

const setMetaTag = ({ selector, attribute = 'content', value, create }) => {
  let element = document.head.querySelector(selector)
  if (!element && create) {
    element = document.createElement(create.tag)
    Object.entries(create.attrs || {}).forEach(([key, attrValue]) => element.setAttribute(key, attrValue))
    document.head.appendChild(element)
  }
  if (element) element.setAttribute(attribute, value)
}

const setJsonLd = (data) => {
  let script = document.getElementById('seo-jsonld')
  if (!data) {
    script?.remove()
    return
  }
  if (!script) {
    script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = 'seo-jsonld'
    document.head.appendChild(script)
  }
  script.textContent = JSON.stringify(data)
}

const getSeoConfig = (pathname) => {
  const path = pathname.replace(/\/+$/, '') || '/'
  const videoId = path.slice(1)
  const isVideoPage = videoId.length === 8 && /^[a-f0-9]{8}$/.test(videoId)
  const canonical = `${SITE_URL}${path === '/' ? '/' : path}`

  if (path === '/') {
    return {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      robots: 'index, follow',
      canonical,
      type: 'website',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'CUTRR',
        alternateName: 'Discord video host',
        url: `${SITE_URL}/`,
        applicationCategory: 'MultimediaApplication',
        description: 'Discord video hosting for editors and creators. Upload videos up to 100MB, get short links, and share clean embeds in Discord.',
        operatingSystem: 'Web',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
    }
  }

  if (path === '/info') {
    return {
      title: 'CUTRR Help Center - Discord Video Hosting',
      description: 'Learn how CUTRR lets editors and creators upload videos up to 100MB, manage thumbnails and titles, and share short links that embed in Discord.',
      robots: 'index, follow',
      canonical,
      type: 'article',
    }
  }

  if (path === '/legal') {
    return {
      title: 'CUTRR Legal',
      description: 'Terms, acceptable use, and copyright policies for CUTRR video hosting.',
      robots: 'index, follow',
      canonical,
      type: 'article',
    }
  }

  if (path === '/resources') {
    return {
      title: 'CUTRR Resources - Helpful Websites for Video Editors',
      description: 'Curated websites, tools, assets, and learning resources for anime, Call of Duty, and IRL video editors.',
      robots: 'index, follow',
      canonical,
      type: 'article',
    }
  }

  const noindexTitles = {
    '/login': 'CUTRR - Login',
    '/admin-login': 'CUTRR - Admin Login',
    '/admin': 'CUTRR - Admin',
    '/register': 'CUTRR - Register',
    '/dashboard': 'CUTRR - Dashboard',
    '/forms': 'CUTRR - Forms',
    '/discord/callback': 'CUTRR - Discord',
  }

  if (isVideoPage) {
    return {
      title: 'CUTRR - Video',
      description: 'A video shared on CUTRR.',
      robots: 'noindex, nofollow',
      canonical,
      type: 'video.other',
    }
  }

  return {
    title: path.startsWith('/apply/') ? 'CUTRR - Application' : (noindexTitles[path] || 'CUTRR'),
    description: 'CUTRR account and app workspace.',
    robots: 'noindex, nofollow',
    canonical,
    type: 'website',
  }
}

const applySeo = (pathname) => {
  const seo = getSeoConfig(pathname)
  const socialDescription = pathname === '/' ? HOME_SOCIAL_DESCRIPTION : seo.description

  document.title = seo.title
  setMetaTag({ selector: 'meta[name="description"]', value: seo.description, create: { tag: 'meta', attrs: { name: 'description' } } })
  setMetaTag({ selector: 'meta[name="robots"]', value: seo.robots, create: { tag: 'meta', attrs: { name: 'robots' } } })
  setMetaTag({ selector: 'link[rel="canonical"]', attribute: 'href', value: seo.canonical, create: { tag: 'link', attrs: { rel: 'canonical' } } })
  setMetaTag({ selector: 'meta[property="og:title"]', value: seo.title, create: { tag: 'meta', attrs: { property: 'og:title' } } })
  setMetaTag({ selector: 'meta[property="og:description"]', value: socialDescription, create: { tag: 'meta', attrs: { property: 'og:description' } } })
  setMetaTag({ selector: 'meta[property="og:type"]', value: seo.type, create: { tag: 'meta', attrs: { property: 'og:type' } } })
  setMetaTag({ selector: 'meta[property="og:url"]', value: seo.canonical, create: { tag: 'meta', attrs: { property: 'og:url' } } })
  setMetaTag({ selector: 'meta[property="og:site_name"]', value: 'CUTRR', create: { tag: 'meta', attrs: { property: 'og:site_name' } } })
  setMetaTag({ selector: 'meta[name="twitter:card"]', value: 'summary', create: { tag: 'meta', attrs: { name: 'twitter:card' } } })
  setMetaTag({ selector: 'meta[name="twitter:title"]', value: seo.title, create: { tag: 'meta', attrs: { name: 'twitter:title' } } })
  setMetaTag({ selector: 'meta[name="twitter:description"]', value: socialDescription, create: { tag: 'meta', attrs: { name: 'twitter:description' } } })
  setJsonLd(seo.jsonLd)
}

function AppContent() {
  const location = useLocation()
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null')
    } catch {
      return null
    }
  })

  useEffect(() => {
    applySeo(location.pathname)
  }, [location])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(async res => {
          const data = await res.json().catch(() => null)
          return { ok: res.ok, status: res.status, data }
        })
        .then(({ ok, status, data }) => {
          if (data.id) {
            setUser(data)
            localStorage.setItem('user', JSON.stringify(data))
          } else if (!ok && (status === 401 || status === 403)) {
            localStorage.removeItem('token')
            localStorage.removeItem('user')
            setUser(null)
          }
        })
        .catch(() => {
          // Keep the cached session during transient database/server hiccups.
        })
    }
  }, [])

  const login = (token, userData) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard user={user} logout={logout} />} />
      <Route path="/upload" element={<Dashboard user={user} logout={logout} />} />
      <Route path="/:id" element={<Video user={user} logout={logout} />} />
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={login} />} />
      <Route path="/admin-login" element={user?.isAdmin ? <Navigate to="/admin" /> : <AdminLogin onLogin={login} />} />
      <Route path="/admin" element={<AdminPanel user={user} logout={logout} />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register onRegister={login} />} />
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route path="/forms" element={<Forms user={user} logout={logout} />} />
      <Route path="/discord/callback" element={<DiscordCallback />} />
      <Route path="/apply/:slug" element={<ApplyForm user={user} logout={logout} />} />
      <Route path="/info" element={<Info user={user} logout={logout} />} />
      <Route path="/legal" element={<Legal user={user} logout={logout} />} />
      <Route path="/resources" element={<Resources user={user} logout={logout} />} />
    </Routes>
  )
}

function App() {
  return (
    <ThemeProvider>
      <ThemeEffect />
      <ToastProvider>
        <AdBlockNotice />
        <ServerWakeNotice />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppContent />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App

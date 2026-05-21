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
import { API_URL } from './utils/api'

const SITE_URL = 'https://cutrr.xyz'
const HOME_DESCRIPTION = 'CUTRR is fast no-compression video hosting for anime edits, Call of Duty edits, IRL edits, and quick 100MB share links.'
const HOME_SOCIAL_DESCRIPTION = 'Fast no-compression video hosting for anime, Call of Duty, and IRL edit creators. Upload videos up to 100MB and share clean links.'

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
      title: 'CUTRR - No-Compression Video Hosting for Editors',
      description: HOME_DESCRIPTION,
      robots: 'index, follow',
      canonical,
      type: 'website',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'CUTRR',
        url: `${SITE_URL}/`,
        applicationCategory: 'MultimediaApplication',
        description: 'No-compression video hosting for anime edits, Call of Duty edits, IRL edits, and fast share links.',
        operatingSystem: 'Web',
      },
    }
  }

  if (path === '/info') {
    return {
      title: 'CUTRR Help Center - Video Hosting for Editors',
      description: 'Learn how CUTRR helps anime, Call of Duty, and IRL edit creators upload 100MB videos, preserve quality, and share fast links.',
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
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    applySeo(location.pathname)
  }, [location])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.id) {
            setUser(data)
            localStorage.setItem('user', JSON.stringify(data))
          } else {
            localStorage.removeItem('token')
            localStorage.removeItem('user')
          }
        })
        .catch(() => {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white/50">Loading...</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Home user={user} logout={logout} />} />
      <Route path="/:id" element={<Video user={user} logout={logout} />} />
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={login} />} />
      <Route path="/admin-login" element={user?.isAdmin ? <Navigate to="/admin" /> : <AdminLogin onLogin={login} />} />
      <Route path="/admin" element={<AdminPanel user={user} logout={logout} />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register onRegister={login} />} />
      <Route path="/dashboard" element={<Dashboard user={user} logout={logout} />} />
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
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppContent />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App

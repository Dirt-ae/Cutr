import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Home from './pages/Home'
import Video from './pages/Video'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import { ToastProvider } from './contexts/ToastContext'
import { API_URL } from './utils/api'

function AppContent() {
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Reset title to CUTR when not on video page
    const path = location.pathname.slice(1)
    const isVideoPage = path.length === 8 && /^[a-f0-9]{8}$/.test(path)
    if (!isVideoPage) {
      document.title = 'CUTR'
    }
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
      <Route path="/:id" element={<Video />} />
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={login} />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register onRegister={login} />} />
      <Route path="/dashboard" element={<Dashboard user={user} logout={logout} />} />
    </Routes>
  )
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App

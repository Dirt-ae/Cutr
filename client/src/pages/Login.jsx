import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import MainNav from '../components/MainNav'
import { API_URL } from '../utils/api'

export default function Login({ onLogin }) {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 30000)

    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || (res.status === 503 ? 'Server is waking up. Try again in a moment.' : 'Login failed'))
      onLogin(data.token, data.user)
      navigate('/')
      showToast('Logged in successfully', 'success')
    } catch (e) {
      showToast(e.name === 'AbortError' ? 'Login is taking too long. Try again in a moment.' : e.message, 'error')
    } finally {
      window.clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav />
      <main className="flex min-h-[calc(100dvh-86px)] items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-sm glass rounded-[22px] border border-white/5 p-5 sm:p-6">
        <Link to="/" className="touch-link mb-5 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">
          <ArrowLeft size={14} />
          Back
        </Link>

        <h1 className="text-xl font-bold mb-1 tracking-tight">Welcome back</h1>
        <p className="text-white/40 text-sm mb-6">Sign in to manage your videos</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full bg-white/5 border border-white/10 rounded-xl px-3 text-base text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors sm:text-sm"
              placeholder="Email"
              required
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full bg-white/5 border border-white/10 rounded-xl px-3 text-base text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors sm:text-sm"
              placeholder="Password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full bg-white text-black rounded-full text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-white/40 text-xs mt-4">
          No account?{' '}
          <Link to="/register" className="text-white/70 hover:text-white">Sign up</Link>
        </p>
      </div>
      </main>
    </div>
  )
}

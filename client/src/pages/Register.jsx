import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import MainNav from '../components/MainNav'
import { API_URL } from '../utils/api'

export default function Register({ onRegister }) {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const getPasswordError = () => {
    if (password.length < 12) return 'Password must be at least 12 characters'
    if (password.length > 128) return 'Password must be no more than 128 characters'
    if (/\s/.test(password)) return 'Password cannot contain spaces'

    const classes = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length
    if (classes < 3) return 'Password must include at least three of: lowercase, uppercase, number, symbol'

    const emailPrefix = email.split('@')[0]?.toLowerCase()
    if (emailPrefix && emailPrefix.length >= 4 && password.toLowerCase().includes(emailPrefix)) {
      return 'Password cannot contain your email name'
    }

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error')
      return
    }

    const passwordError = getPasswordError()
    if (passwordError) {
      showToast(passwordError, 'error')
      return
    }

    setLoading(true)

    // Get anonymous video IDs to claim
    const claimVideoIds = JSON.parse(localStorage.getItem('anonVideos') || '[]')

    try {
      const res = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, claimVideoIds })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      
      // Clear anonymous videos from localStorage after claiming
      localStorage.removeItem('anonVideos')
      
      onRegister(data.token, data.user)
      navigate('/')
      showToast('Account created successfully', 'success')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
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

        <h1 className="text-xl font-bold mb-1 tracking-tight">Create account</h1>
        <p className="text-white/40 text-sm mb-6">Get 6 months of video retention</p>

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
          <div>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 w-full bg-white/5 border border-white/10 rounded-xl px-3 text-base text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors sm:text-sm"
              placeholder="Confirm password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full bg-white text-black rounded-full text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-white/40 text-xs mt-4">
          Have an account?{' '}
          <Link to="/login" className="text-white/70 hover:text-white">Sign in</Link>
        </p>
      </div>
      </main>
    </div>
  )
}

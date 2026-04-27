import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { API_URL } from '../utils/api'

export default function Register({ onRegister }) {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error')
      return
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error')
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
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white mb-6">
          <ArrowLeft size={14} />
          Back
        </Link>

        <h1 className="text-xl font-bold mb-1">Create account</h1>
        <p className="text-white/40 text-sm mb-6">Get 6 months of video storage</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
              placeholder="Email"
              required
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
              placeholder="Password"
              required
            />
          </div>
          <div>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
              placeholder="Confirm password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black py-2 rounded-lg text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-white/40 text-xs mt-4">
          Have an account?{' '}
          <Link to="/login" className="text-white/70 hover:text-white">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

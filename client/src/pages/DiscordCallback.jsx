import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import MainNav from '../components/MainNav'

export default function DiscordCallback() {
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const discordSession = params.get('discordSession')
      const discordUser = params.get('discordUser')
      const returnTo = params.get('returnTo') || '/forms'

      if (!discordSession || !discordUser) {
        throw new Error('Discord did not return a valid session.')
      }

      localStorage.setItem('discordSession', discordSession)
      localStorage.setItem('discordUser', discordUser)
      window.history.replaceState(null, '', '/discord/callback')
      window.location.replace(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/forms')
    } catch (e) {
      setError(e.message || 'Discord connection failed.')
    }
  }, [])

  return (
    <div className="obsidian-ui min-h-screen text-white text-center selection:bg-white/15">
      <MainNav />
      <main className="grid min-h-[calc(100vh-82px)] place-items-center px-6 py-8">
      {error ? (
        <div className="glass rounded-[22px] border border-white/5 p-6">
          <h1 className="text-xl font-bold mb-2">Discord connection failed</h1>
          <p className="text-sm text-white/50 mb-4">{error}</p>
          <Link to="/forms" className="text-sm text-white/70 underline">Back to forms</Link>
        </div>
      ) : (
        <div className="glass rounded-[22px] border border-white/5 p-6">
          <Loader2 size={24} className="animate-spin mx-auto mb-3 text-white/50" />
          <p className="text-sm text-white/50">Finishing Discord connection...</p>
        </div>
      )}
      </main>
    </div>
  )
}

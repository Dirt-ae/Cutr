import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LogOut, Copy, Check, Trash2, Calendar, HardDrive, AlertCircle } from 'lucide-react'
import { API_URL } from '../utils/api'

export default function MyVideos({ user, logout }) {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    fetch(`${API_URL}/api/my-videos`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(setVideos)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const copyLink = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/video/${id}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatBytes = (bytes) => {
    if (!bytes) return 'Unknown'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatExpiry = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const days = Math.ceil((date - now) / (1000 * 60 * 60 * 24))
    if (days < 0) return 'Expired'
    if (days > 30) {
      const months = Math.floor(days / 30)
      return `${months} month${months > 1 ? 's' : ''} left`
    }
    return `${days} day${days > 1 ? 's' : ''} left`
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold tracking-tight">CUTR</Link>
          <button onClick={logout} className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
            <LogOut size={18} />
            <span className="text-sm">Logout</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Videos</h1>
            <p className="text-white/50 text-sm mt-1">{user.email}</p>
          </div>
          <Link to="/" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
            <ArrowLeft size={18} />
            <span className="text-sm">Upload more</span>
          </Link>
        </div>

        {loading ? (
          <div className="text-white/50 text-center py-20">Loading...</div>
        ) : videos.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle size={48} className="mx-auto text-white/20 mb-4" />
            <p className="text-white/50">No videos uploaded yet</p>
            <Link to="/" className="inline-block mt-4 text-white underline">Upload your first video</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {videos.map((video) => (
              <div key={video.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                <Link to={`/video/${video.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-12 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
                      <span className="text-xs text-white/30">VIDEO</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{video.originalName || 'Video'}</p>
                      <div className="flex items-center gap-4 text-sm text-white/50 mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar size={14} />
                          {formatExpiry(video.expiresAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive size={14} />
                          {formatBytes(video.size)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
                <button
                  onClick={() => copyLink(video.id)}
                  className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg text-sm hover:bg-white/20 transition-colors shrink-0 ml-4"
                >
                  {copiedId === video.id ? <Check size={16} /> : <Copy size={16} />}
                  {copiedId === video.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

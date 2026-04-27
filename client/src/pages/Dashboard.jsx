import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, Check, Calendar, HardDrive, Volume2, Edit3, Play, Pause, Settings, Trash2, X, Save } from 'lucide-react'
import Modal from '../components/Modal'
import { useToast } from '../contexts/ToastContext'
import { API_URL } from '../utils/api'

export default function Dashboard({ user, logout }) {
  const { showToast } = useToast()
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ volume: 100, description: '', autoplay: true })
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, videoId: null })

  useEffect(() => {
    loadVideos()
  }, [user])

  const loadVideos = async () => {
    setLoading(true)
    try {
      if (user) {
        // Signed-up user: fetch from API
        const token = localStorage.getItem('token')
        const res = await fetch(`${API_URL}/api/my-videos`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const data = await res.json()
        setVideos(data)
      } else {
        // Anonymous: fetch by IDs from localStorage
        const anonVideoIds = JSON.parse(localStorage.getItem('anonVideos') || '[]')
        if (anonVideoIds.length > 0) {
          const res = await fetch(`${API_URL}/api/videos/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: anonVideoIds })
          })
          const data = await res.json()
          setVideos(data)
          // Update localStorage if some videos expired
          const validIds = data.map(v => v.id)
          localStorage.setItem('anonVideos', JSON.stringify(validIds))
        } else {
          setVideos([])
        }
      }
    } catch (e) {
      showToast('Failed to load videos', 'error')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/${id}`)
    setCopiedId(id)
    showToast('Link copied', 'success')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const startEditing = (video) => {
    setEditingId(video.id)
    setEditForm({
      volume: video.volume || 100,
      description: video.description || '',
      autoplay: video.autoplay !== false
    })
  }

  const saveSettings = async (videoId) => {
    const token = localStorage.getItem('token')
    if (!token) return // Only signed-up users can save
    
    try {
      await fetch(`${API_URL}/api/video/${videoId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(editForm)
      })
      
      // Update local state
      setVideos(videos.map(v => 
        v.id === videoId ? { ...v, ...editForm } : v
      ))
      setEditingId(null)
    } catch (e) {
      showToast('Failed to save settings', 'error')
    }
  }

  const deleteVideo = async (videoId) => {
    const token = localStorage.getItem('token')
    if (!token) return
    
    setDeleteModal({ isOpen: true, videoId })
  }

  const confirmDelete = async () => {
    const token = localStorage.getItem('token')
    if (!token || !deleteModal.videoId) return
    
    try {
      await fetch(`${API_URL}/api/video/${deleteModal.videoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      
      // Remove from local state
      setVideos(videos.filter(v => v.id !== deleteModal.videoId))
      setDeleteModal({ isOpen: false, videoId: null })
      showToast('Video deleted', 'success')
    } catch (e) {
      showToast('Failed to delete video', 'error')
    }
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

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">CUTR</Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-xs text-white/40">{user.email}</span>
                <button onClick={logout} className="text-xs text-white/60 hover:text-white transition-colors">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-xs text-white/60 hover:text-white transition-colors">Login</Link>
                <Link to="/register" className="text-xs bg-white text-black px-3 py-1 rounded hover:bg-white/90 transition-colors">Sign Up</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold">Dashboard</h1>
          <Link to="/" className="flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={14} />
            Upload more
          </Link>
        </div>

        {/* Features info for signed-up users */}
        {user && (
          <div className="glass rounded-lg p-3 mb-4 text-xs text-white/50">
            <span className="text-white/70 font-medium">Pro:</span> Click ⚙️ to set volume, descriptions & autoplay
          </div>
        )}

        {loading ? (
          <div className="text-white/40 text-center py-12 text-sm">Loading...</div>
        ) : videos.length === 0 ? (
          <div className="text-center py-12">
            <Play size={24} className="mx-auto mb-2 text-white/20" />
            <p className="text-white/40 text-sm">No videos yet</p>
            <Link to="/" className="text-white/60 text-xs underline">Upload one</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map((video) => (
              <div key={video.id} className="glass rounded-lg p-3">
                {editingId === video.id ? (
                  // Edit Mode
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{video.originalName}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingId(null)} className="p-1 text-white/40 hover:text-white">
                          <X size={14} />
                        </button>
                        <button 
                          onClick={() => saveSettings(video.id)}
                          className="flex items-center gap-1 bg-white text-black px-2 py-1 rounded text-xs font-medium"
                        >
                          <Save size={12} />
                          Save
                        </button>
                      </div>
                    </div>
                    
                    {/* Volume Slider */}
                    <div>
                      <label className="flex items-center gap-1 text-xs text-white/60 mb-1">
                        <Volume2 size={12} />
                        Volume: {editForm.volume}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editForm.volume}
                        onChange={(e) => setEditForm({ ...editForm, volume: parseInt(e.target.value) })}
                        className="w-full accent-white h-1"
                      />
                    </div>
                    
                    {/* Description */}
                    <div>
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        placeholder="Description..."
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white resize-none focus:outline-none focus:border-white/30"
                        rows={1}
                        maxLength={500}
                      />
                    </div>
                    
                    {/* Autoplay Toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/60">Autoplay</span>
                      <button
                        onClick={() => setEditForm({ ...editForm, autoplay: !editForm.autoplay })}
                        className={`w-8 h-4 rounded-full transition-colors ${editForm.autoplay ? 'bg-white' : 'bg-white/20'}`}
                      >
                        <div className={`w-3 h-3 rounded-full bg-black transition-transform ${editForm.autoplay ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="flex items-center justify-between gap-3">
                    <Link to={`/${video.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                      <Play size={14} className="text-white/30 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{video.originalName || 'Video'}</p>
                        <p className="text-xs text-white/40">
                          {formatExpiry(video.expiresAt)} • {formatBytes(video.size)}
                          {video.volume !== 100 && ` • ${video.volume}%`}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-1 shrink-0">
                      {user && (
                        <>
                          <button
                            onClick={() => startEditing(video)}
                            className="p-1.5 text-white/40 hover:text-white transition-colors"
                          >
                            <Settings size={14} />
                          </button>
                          <button
                            onClick={() => deleteVideo(video.id)}
                            className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => copyLink(video.id)}
                        className="flex items-center gap-1 glass px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors"
                      >
                        {copiedId === video.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedId === video.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {videos.length > 0 && (
          <div className="mt-6 grid grid-cols-3 gap-2">
            <div className="glass rounded-lg p-3 text-center">
              <p className="text-lg font-bold">{videos.length}</p>
              <p className="text-white/40 text-xs">Videos</p>
            </div>
            <div className="glass rounded-lg p-3 text-center">
              <p className="text-lg font-bold">
                {formatBytes(videos.reduce((sum, v) => sum + (v.size || 0), 0))}
              </p>
              <p className="text-white/40 text-xs">Size</p>
            </div>
            <div className="glass rounded-lg p-3 text-center">
              <p className="text-lg font-bold">
                {user ? '6mo' : '14d'}
              </p>
              <p className="text-white/40 text-xs">Keep</p>
            </div>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, videoId: null })}
        title="Delete Video"
        size="sm"
      >
        <p className="text-sm mb-4">Are you sure you want to delete this video? This action cannot be undone.</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setDeleteModal({ isOpen: false, videoId: null })}
            className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}

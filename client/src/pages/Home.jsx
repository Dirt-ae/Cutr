import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Link as LinkIcon, Copy, Check, User, X, Loader2 } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import ThemeSettings from '../components/ThemeSettings'
import MainNav from '../components/MainNav'
import { API_URL } from '../utils/api'

const MAX_VIDEO_SIZE_MB = 100
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024

export default function Home({ user, logout }) {
  const { showToast } = useToast()
  const [queue, setQueue] = useState([])
  const [queueRunning, setQueueRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false)
  const fileInputRef = useRef(null)
  const pollIntervalsRef = useRef(new Map())

  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach(clearInterval)
      pollIntervalsRef.current.clear()
    }
  }, [])

  const updateQueueItem = (localId, patch) => {
    setQueue((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    )
  }

  const pollTranscodingStatus = async (localId, videoId) => {
    updateQueueItem(localId, {
      status: 'transcoding',
      label: 'Checking Bunny status...',
      progress: 92,
    })
    
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/video/${videoId}`)
        const data = await res.json()
        const status = Number(data.transcodingStatus)

        if (status === 0) {
          updateQueueItem(localId, { label: 'Queued for processing...', progress: 94 })
        } else if (status === 1 || status === 2) {
          updateQueueItem(localId, { label: 'Processing video...', progress: 96 })
        } else if (status === 3) {
          updateQueueItem(localId, { label: 'Transcoding video...', progress: 98 })
        } else if (status === 4) {
          updateQueueItem(localId, { label: 'Finalizing...', progress: 100 })
        } else if (status === 9) {
          updateQueueItem(localId, { label: 'Generating captions...', progress: 99 })
        }
        
        // Bunny status: 4 = finished/ready, 5 = error
        if (data.transcodingStatus === 4 || data.transcodingStatus === 'ready' || data.transcodingStatus === 'completed') {
          clearInterval(interval)
          pollIntervalsRef.current.delete(localId)
          updateQueueItem(localId, { status: 'ready', label: 'Ready', progress: 100, result: data })
          setResult(data)
          showToast('Video ready to share!', 'success')
        } else if (data.transcodingStatus === 5 || data.transcodingStatus === 'error') {
          clearInterval(interval)
          pollIntervalsRef.current.delete(localId)
          updateQueueItem(localId, { status: 'error', label: 'Processing failed' })
          showToast('Video processing failed', 'error')
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }, 3000)
    pollIntervalsRef.current.set(localId, interval)
  }

  const uploadQueueItem = (item) =>
    new Promise((resolve) => {
    const formData = new FormData()
    formData.append('video', item.file)

    const token = localStorage.getItem('token')
    const endpoint = token ? `${API_URL}/api/upload` : `${API_URL}/api/upload-anonymous`

    const xhr = new XMLHttpRequest()
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        // Scale to 0-90% — server still needs to forward to Bunny after receiving
        const progress = Math.round((e.loaded / e.total) * 90)
        updateQueueItem(item.localId, { status: 'uploading', label: 'Uploading to CUTR...', progress })
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText)
        
        // Track anonymous uploads in localStorage
        if (!token) {
          const anonVideos = JSON.parse(localStorage.getItem('anonVideos') || '[]')
          anonVideos.push(data.id)
          localStorage.setItem('anonVideos', JSON.stringify(anonVideos))
        }
        
        updateQueueItem(item.localId, {
          status: 'uploaded',
          label: 'Upload complete. Sending to Bunny...',
          progress: 92,
          videoId: data.id,
        })
        pollTranscodingStatus(item.localId, data.id)
        resolve(true)
      } else {
        let errorMsg = 'Upload failed'
        try {
          const error = JSON.parse(xhr.responseText)
          errorMsg = error.error || errorMsg
        } catch {}
        showToast(errorMsg, 'error')
        updateQueueItem(item.localId, { status: 'error', label: errorMsg })
        resolve(false)
      }
    })

    xhr.addEventListener('error', () => {
      showToast('Network error during upload', 'error')
      updateQueueItem(item.localId, { status: 'error', label: 'Network error during upload' })
      resolve(false)
    })

    xhr.addEventListener('timeout', () => {
      showToast('Upload timed out', 'error')
      updateQueueItem(item.localId, { status: 'error', label: 'Upload timed out' })
      resolve(false)
    })

    xhr.open('POST', endpoint)
    xhr.timeout = 30 * 60 * 1000 // 30 minute timeout for large files
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.send(formData)
  })

  const addFiles = (files) => {
    const validFiles = [...files].filter((candidate) => {
      if (!candidate.type.startsWith('video/')) {
        showToast(`${candidate.name}: only video files allowed`, 'error')
        return false
      }
      if (candidate.size > MAX_VIDEO_SIZE_BYTES) {
        showToast(`${candidate.name}: max size is ${MAX_VIDEO_SIZE_MB}MB`, 'error')
        return false
      }
      return true
    })
    if (!validFiles.length) return
    setResult(null)
    setQueue((current) => [
      ...current,
      ...validFiles.map((nextFile) => ({
        localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file: nextFile,
        status: 'queued',
        label: 'Queued',
        progress: 0,
      })),
    ])
  }

  const startQueue = async () => {
    if (queueRunning) return
    setQueueRunning(true)
    for (const item of queue.filter((queued) => queued.status === 'queued')) {
      await uploadQueueItem(item)
    }
    setQueueRunning(false)
  }

  const copyLink = () => {
    const url = `${window.location.origin}/${result.id}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    showToast('Link copied', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatExpiry = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const days = Math.max(0, Math.round((date - now) / (1000 * 60 * 60 * 24)))
    if (days > 30) {
      const months = Math.floor(days / 30)
      return `${months} month${months > 1 ? 's' : ''}`
    }
    return `${days} day${days > 1 ? 's' : ''}`
  }

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav
        user={user}
        logout={logout}
        onOpenSettings={() => setThemeSettingsOpen(true)}
      />

      {/* Main */}
      <main className="max-w-3xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-1">Upload. Share. Done.</h1>
          <p className="text-white/40 text-sm max-w-md mx-auto">
            Video hosting for editors. No compression. No hassle.
          </p>
        </div>

        {/* Sign up benefits - only show for anonymous users */}
        {!user && (
          <div className="max-w-sm mx-auto mb-4 glass rounded-[22px] p-3 text-center">
            <p className="text-xs text-white/60">
              <span className="text-white font-medium">Sign up:</span> 6mo retention • Volume • Descriptions
            </p>
          </div>
        )}

        {/* Upload Area */}
        <div className="max-w-lg mx-auto">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addFiles(e.dataTransfer.files)
            }}
            className="glass rounded-[22px] p-6 text-center cursor-pointer transition-all"
            style={dragOver ? { background: 'rgba(255,255,255,0.08)' } : {}}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp4,.webm,.mov,.avi,.mkv"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
              className="hidden"
            />
            <Upload size={32} className="mx-auto mb-3 text-white/30" />
            <div>
              <p className="text-sm font-medium">Drop videos or click</p>
              <p className="text-white/30 text-xs mt-1">Video only - max {MAX_VIDEO_SIZE_MB}MB each</p>
            </div>
          </div>

          {queue.length > 0 && (
            <div className="mt-3 glass rounded-[22px] p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Upload queue</p>
                <button
                  onClick={startQueue}
                  disabled={queueRunning || !queue.some((item) => item.status === 'queued')}
                  className="bg-white text-black px-3 py-1 rounded-full text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {queueRunning ? 'Uploading...' : 'Start queue'}
                </button>
              </div>
              {queue.map((item) => (
                <div key={item.localId} className="rounded-xl bg-white/[0.03] p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{item.file.name.replace(/\.[^/.]+$/, '')}</p>
                      <p className="text-[11px] text-white/40">{formatBytes(item.file.size)} - {item.label}</p>
                    </div>
                    {item.status === 'queued' && (
                      <button
                        onClick={() => setQueue((current) => current.filter((queued) => queued.localId !== item.localId))}
                        className="p-1 text-white/40 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-white transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mt-4 glass-strong rounded-[22px] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Check size={16} className="text-green-400" />
                <p className="text-sm font-medium">Uploaded • {formatExpiry(result.expiresAt)}</p>
              </div>
              
              <div className="glass rounded p-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                  <LinkIcon size={12} className="text-white/40 shrink-0" />
                  <code className="text-xs text-white/60 truncate">
                    {window.location.origin}/{result.id}
                  </code>
                </div>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1 bg-white text-black px-2 py-1 rounded-full text-xs font-medium hover:bg-white/90 transition-colors shrink-0 ml-2"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Upload Another */}
          {result && (
            <button
              onClick={() => setResult(null)}
              className="mt-2 w-full py-1.5 text-white/40 hover:text-white text-xs transition-colors"
            >
              Upload another
            </button>
          )}
        </div>

        {/* Features */}
        <div className="mt-8 grid gap-2 max-w-lg mx-auto sm:grid-cols-3">
          <div className="glass rounded-2xl p-2 text-center">
            <Upload size={16} className="mx-auto mb-1 text-white/40" />
            <h3 className="text-xs font-medium mb-0.5">No Compression</h3>
            <p className="text-white/40 text-xs">Crisp edits</p>
          </div>
          <div className="glass rounded-2xl p-2 text-center">
            <LinkIcon size={16} className="mx-auto mb-1 text-white/40" />
            <h3 className="text-xs font-medium mb-0.5">Instant Links</h3>
            <p className="text-white/40 text-xs">Share fast</p>
          </div>
          <div className="glass rounded-2xl p-2 text-center">
            <User size={16} className="mx-auto mb-1 text-white/40" />
            <h3 className="text-xs font-medium mb-0.5">6mo Retention</h3>
            <p className="text-white/40 text-xs">Signed users</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] mt-8">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col gap-3 text-center text-white/30 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-left">
          <span>Video hosting for anime, Call of Duty, and IRL Edit creators.</span>
          <div className="flex gap-3">
            <Link to="/info" className="text-accent hover:text-accent transition-colors">Info</Link>
            <Link to="/legal" className="text-accent hover:text-accent transition-colors">Legal</Link>
            <a href="https://discord.gg/JAbzJX4Jce" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent transition-colors">Discord</a>
            <a href="https://ko-fi.com/cutrr" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent transition-colors">Ko-Fi</a>
          </div>
        </div>
      </footer>

      {/* Theme Settings Modal */}
      <ThemeSettings isOpen={themeSettingsOpen} onClose={() => setThemeSettingsOpen(false)} user={user} />
    </div>
  )
}

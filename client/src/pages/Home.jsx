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
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [transcoding, setTranscoding] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('')
  const [processingProgress, setProcessingProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false)
  const fileInputRef = useRef(null)
  const pollIntervalRef = useRef(null)

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  const pollTranscodingStatus = async (videoId) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setTranscoding(true)
    setProcessingLabel('Checking Bunny status...')
    setProcessingProgress(92)
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/video/${videoId}`)
        const data = await res.json()
        const status = Number(data.transcodingStatus)

        if (status === 0) {
          setProcessingLabel('Queued for processing...')
          setProcessingProgress(94)
        } else if (status === 1 || status === 2) {
          setProcessingLabel('Processing video...')
          setProcessingProgress(96)
        } else if (status === 3) {
          setProcessingLabel('Transcoding video...')
          setProcessingProgress(98)
        } else if (status === 4) {
          setProcessingLabel('Finalizing...')
          setProcessingProgress(100)
        } else if (status === 9) {
          setProcessingLabel('Generating captions...')
          setProcessingProgress(99)
        }
        
        // Bunny status: 4 = finished/ready, 5 = error
        if (data.transcodingStatus === 4 || data.transcodingStatus === 'ready' || data.transcodingStatus === 'completed') {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
          setTranscoding(false)
          setProcessingLabel('')
          setProcessingProgress(0)
          setResult(data)
          showToast('Video ready to share!', 'success')
        } else if (data.transcodingStatus === 5 || data.transcodingStatus === 'error') {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
          setTranscoding(false)
          setProcessingLabel('')
          setProcessingProgress(0)
          showToast('Video processing failed', 'error')
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }, 3000)
  }

  const handleUpload = async () => {
    if (!file) return
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      showToast(`File too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB`, 'error')
      return
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setUploading(true)
    setUploadProgress(0)
    setProcessingLabel('Uploading to CUTR...')
    setProcessingProgress(0)
    setResult(null)
    setTranscoding(false)

    const formData = new FormData()
    formData.append('video', file)

    const token = localStorage.getItem('token')
    const endpoint = token ? `${API_URL}/api/upload` : `${API_URL}/api/upload-anonymous`

    const xhr = new XMLHttpRequest()
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        // Scale to 0-90% — server still needs to forward to Bunny after receiving
        const progress = Math.round((e.loaded / e.total) * 90)
        setUploadProgress(progress)
        setProcessingProgress(progress)
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
        
        setUploadProgress(100)
        setProcessingLabel('Upload complete. Sending to Bunny...')
        setProcessingProgress(92)
        setUploading(false)
        setFile(null)
        
        // Start polling for transcoding status
        pollTranscodingStatus(data.id)
      } else {
        let errorMsg = 'Upload failed'
        try {
          const error = JSON.parse(xhr.responseText)
          errorMsg = error.error || errorMsg
        } catch {}
        showToast(errorMsg, 'error')
        setUploading(false)
        setProcessingLabel('')
        setProcessingProgress(0)
      }
    })

    xhr.addEventListener('error', () => {
      showToast('Network error during upload', 'error')
      setUploading(false)
      setProcessingLabel('')
      setProcessingProgress(0)
    })

    xhr.addEventListener('timeout', () => {
      showToast('Upload timed out', 'error')
      setUploading(false)
      setProcessingLabel('')
      setProcessingProgress(0)
    })

    xhr.open('POST', endpoint)
    xhr.timeout = 30 * 60 * 1000 // 30 minute timeout for large files
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.send(formData)
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
      <main className="max-w-3xl mx-auto px-6 py-8">
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
              const droppedFile = e.dataTransfer.files[0]
              if (droppedFile && !droppedFile.type.startsWith('video/')) {
                showToast('Only video files allowed', 'error')
                return
              }
              if (droppedFile && droppedFile.size > MAX_VIDEO_SIZE_BYTES) {
                showToast(`File too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB`, 'error')
                return
              }
              if (droppedFile) setFile(droppedFile)
            }}
            className="glass rounded-[22px] p-6 text-center cursor-pointer transition-all"
            style={dragOver ? { background: 'rgba(255,255,255,0.08)' } : {}}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,.webm,.mov,.avi,.mkv"
              onChange={(e) => {
                const f = e.target.files[0]
                if (f && f.size > MAX_VIDEO_SIZE_BYTES) {
                  showToast(`File too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB`, 'error')
                  e.target.value = ''
                  return
                }
                if (f && !f.type.startsWith('video/')) {
                  showToast('Only video files allowed', 'error')
                  e.target.value = ''
                  return
                }
                setFile(f)
              }}
              className="hidden"
            />
            <Upload size={32} className="mx-auto mb-3 text-white/30" />
            {file ? (
              <div>
                <p className="text-sm font-medium">{file.name.replace(/\.[^/.]+$/, '')}</p>
                <p className="text-white/40 text-xs mt-1">{formatBytes(file.size)}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">Drop video or click</p>
                <p className="text-white/30 text-xs mt-1">Video only - max {MAX_VIDEO_SIZE_MB}MB</p>
              </div>
            )}
          </div>

          {/* File Selected */}
          {file && !result && !transcoding && (
            <div className="mt-3 glass rounded-2xl p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="font-medium text-xs truncate">{file.name.replace(/\.[^/.]+$/, '')}</p>
                <p className="text-white/40 text-xs">{formatBytes(file.size)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setFile(null)} className="p-1 text-white/40 hover:text-white">
                  <X size={14} />
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="bg-white text-black px-3 py-1 rounded-full text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

          {/* Upload/Processing Progress */}
          {(uploading || transcoding) && (
            <div className="mt-3 glass rounded-[22px] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-white/60" />
                  <p className="text-sm font-medium">{processingLabel || 'Processing...'}</p>
                </div>
                <p className="text-xs text-white/60">{processingProgress}%</p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5">
                <div 
                  className="bg-white rounded-full h-1.5 transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                <div className={`rounded px-2 py-1 ${processingProgress >= 1 ? 'bg-white/15 text-white/80' : 'bg-white/5 text-white/40'}`}>Upload</div>
                <div className={`rounded px-2 py-1 ${processingProgress >= 92 ? 'bg-white/15 text-white/80' : 'bg-white/5 text-white/40'}`}>Transcode</div>
                <div className={`rounded px-2 py-1 ${processingProgress >= 99 ? 'bg-white/15 text-white/80' : 'bg-white/5 text-white/40'}`}>Captions</div>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mt-4 glass-strong rounded-[22px] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Check size={16} className="text-green-400" />
                <p className="text-sm font-medium">Uploaded • {formatExpiry(result.expiresAt)}</p>
              </div>
              
              <div className="glass rounded p-2 flex items-center justify-between">
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
        <div className="mt-8 grid grid-cols-3 gap-2 max-w-lg mx-auto">
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
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between text-white/30 text-xs">
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

import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Link as LinkIcon, Copy, Check, User, LogOut, FolderOpen, X, Loader2 } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { API_URL } from '../utils/api'

export default function Home({ user, logout }) {
  const { showToast } = useToast()
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [transcoding, setTranscoding] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
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
    setTranscoding(true)
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/video/${videoId}`)
        const data = await res.json()
        
        // Bunny status: 4 = finished/ready, 5 = error
        if (data.transcodingStatus === 4 || data.transcodingStatus === 'ready' || data.transcodingStatus === 'completed') {
          clearInterval(pollIntervalRef.current)
          setTranscoding(false)
          setResult(data)
          showToast('Video ready to share!', 'success')
        } else if (data.transcodingStatus === 5 || data.transcodingStatus === 'error') {
          clearInterval(pollIntervalRef.current)
          setTranscoding(false)
          showToast('Video processing failed', 'error')
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }, 3000)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setUploadProgress(0)
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
      }
    })

    xhr.addEventListener('error', () => {
      showToast('Network error during upload', 'error')
      setUploading(false)
    })

    xhr.addEventListener('timeout', () => {
      showToast('Upload timed out', 'error')
      setUploading(false)
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
    const days = Math.ceil((date - now) / (1000 * 60 * 60 * 24))
    if (days > 30) {
      const months = Math.floor(days / 30)
      return `${months} month${months > 1 ? 's' : ''}`
    }
    return `${days} day${days > 1 ? 's' : ''}`
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">CUTR</Link>
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-xs text-white/60 hover:text-white transition-colors">
              Dashboard
            </Link>
            {user ? (
              <button onClick={logout} className="flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors">
                <LogOut size={14} />
                Logout
              </button>
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
          <div className="max-w-sm mx-auto mb-4 glass rounded-lg p-3 text-center">
            <p className="text-xs text-white/60">
              <span className="text-white font-medium">Sign up:</span> 6mo storage • Volume • Descriptions
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
              if (droppedFile && droppedFile.type.startsWith('video/')) {
                setFile(droppedFile)
              }
            }}
            className={`glass rounded-lg p-6 text-center cursor-pointer transition-all ${
              dragOver ? 'border-white/20 bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files[0])}
              className="hidden"
            />
            <Upload size={32} className="mx-auto mb-3 text-white/30" />
            {file ? (
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-white/40 text-xs mt-1">{formatBytes(file.size)}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">Drop video or click</p>
              </div>
            )}
          </div>

          {/* File Selected */}
          {file && !result && !transcoding && (
            <div className="mt-3 glass rounded-lg p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="font-medium text-xs truncate">{file.name}</p>
                <p className="text-white/40 text-xs">{formatBytes(file.size)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setFile(null)} className="p-1 text-white/40 hover:text-white">
                  <X size={14} />
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="bg-white text-black px-3 py-1 rounded text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {uploading && (
            <div className="mt-3 glass rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-white/60" />
                  <p className="text-sm font-medium">Uploading to server...</p>
                </div>
                <p className="text-xs text-white/60">{uploadProgress}%</p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5">
                <div 
                  className="bg-white rounded-full h-1.5 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Transcoding Progress */}
          {transcoding && (
            <div className="mt-3 glass rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-white/60" />
                  <p className="text-sm font-medium">Processing video...</p>
                </div>
                <p className="text-xs text-white/40">This may take a few minutes</p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5">
                <div className="bg-white/30 rounded-full h-1.5 animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mt-4 glass-strong rounded-lg p-3">
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
                  className="flex items-center gap-1 bg-white text-black px-2 py-1 rounded text-xs font-medium hover:bg-white/90 transition-colors shrink-0 ml-2"
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
          <div className="glass rounded-lg p-2 text-center">
            <Upload size={16} className="mx-auto mb-1 text-white/40" />
            <h3 className="text-xs font-medium mb-0.5">No Compression</h3>
            <p className="text-white/40 text-xs">Crisp edits</p>
          </div>
          <div className="glass rounded-lg p-2 text-center">
            <LinkIcon size={16} className="mx-auto mb-1 text-white/40" />
            <h3 className="text-xs font-medium mb-0.5">Instant Links</h3>
            <p className="text-white/40 text-xs">Share fast</p>
          </div>
          <div className="glass rounded-lg p-2 text-center">
            <User size={16} className="mx-auto mb-1 text-white/40" />
            <h3 className="text-xs font-medium mb-0.5">6mo Storage</h3>
            <p className="text-white/40 text-xs">Signed users</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-8">
        <div className="max-w-3xl mx-auto px-6 py-4 text-center text-white/30 text-xs">
          Video hosting for anime, Call of Duty, and IRL Edit creators.
        </div>
      </footer>
    </div>
  )
}

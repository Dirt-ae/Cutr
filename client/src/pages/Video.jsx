import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Copy, Check, AlertCircle, Calendar, HardDrive, Volume2, FileText, Loader2 } from 'lucide-react'
import { API_URL } from '../utils/api'

export default function Video() {
  const { id } = useParams()
  const [video, setVideo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [processing, setProcessing] = useState(false)
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    loadVideo()
    return () => {
      if (hlsRef.current) hlsRef.current.destroy()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [id])

  const loadVideo = async () => {
    try {
      const res = await fetch(`${API_URL}/api/video/${id}`)
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else if (data.transcodingStatus !== 4 && data.transcodingStatus !== 'ready' && data.transcodingStatus !== 'completed') {
        setProcessing(true)
        setVideo(data)
        // Poll until ready
        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(`${API_URL}/api/video/${id}`)
            const pollData = await pollRes.json()
            if (pollData.transcodingStatus === 4 || pollData.transcodingStatus === 'ready' || pollData.transcodingStatus === 'completed') {
              clearInterval(pollRef.current)
              setProcessing(false)
              setVideo(pollData)
              initPlayer(pollData)
            } else if (pollData.transcodingStatus === 5 || pollData.transcodingStatus === 'error') {
              clearInterval(pollRef.current)
              setProcessing(false)
              setError('Video processing failed')
            }
          } catch {}
        }, 3000)
      } else {
        setVideo(data)
        initPlayer(data)
      }
    } catch {
      setError('Failed to load video')
    } finally {
      setLoading(false)
    }
  }

  const initPlayer = (videoData) => {
    // Needs a short delay for the video element to be in the DOM
    setTimeout(() => {
      if (!videoRef.current) return
      
      // Set volume
      if (videoData.volume !== undefined) {
        videoRef.current.volume = videoData.volume / 100
      }

      const videoSrc = videoData.url
      
      // Load HLS.js for browsers that don't support HLS natively
      if (videoSrc.includes('.m3u8')) {
        if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari supports HLS natively
          videoRef.current.src = videoSrc
        } else {
          // Use HLS.js for Chrome/Firefox/etc
          const script = document.createElement('script')
          script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest'
          script.onload = () => {
            if (window.Hls && window.Hls.isSupported()) {
              if (hlsRef.current) hlsRef.current.destroy()
              const hls = new window.Hls()
              hls.loadSource(videoSrc)
              hls.attachMedia(videoRef.current)
              hlsRef.current = hls
            }
          }
          document.head.appendChild(script)
        }
      } else {
        videoRef.current.src = videoSrc
      }

      // Autoplay if enabled
      if (videoData.autoplay) {
        videoRef.current.play().catch(() => {})
      }

      // Set browser title
      document.title = videoData.originalName
    }, 100)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatBytes = (bytes) => {
    if (!bytes) return 'Unknown'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/50">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white mb-8">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle size={64} className="text-red-400 mb-4" />
            <h1 className="text-2xl font-bold mb-2">Video Not Found</h1>
            <p className="text-white/50">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Back */}
        <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white mb-8">
          <ArrowLeft size={20} />
          Back
        </Link>

        {/* Video Player */}
        <div className="bg-white/5 rounded-2xl overflow-hidden mb-6">
          {processing ? (
            <div className="w-full aspect-video bg-black flex flex-col items-center justify-center">
              <Loader2 size={32} className="animate-spin text-white/40 mb-3" />
              <p className="text-white/60 text-sm">Processing video...</p>
              <p className="text-white/30 text-xs mt-1">This may take a few minutes</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              controls
              className="w-full aspect-video bg-black"
            />
          )}
        </div>

        {/* Info */}
        <div className="bg-white/5 rounded-xl p-6">
          <h1 className="text-xl font-semibold mb-1">{video.originalName || 'Video'}</h1>
          <p className="text-white/50 text-sm mb-4">ID: {video.id}</p>

          <div className="flex gap-6 text-sm flex-wrap">
            <div className="flex items-center gap-2 text-white/70">
              <Calendar size={16} />
              <span>Expires {formatDate(video.expiresAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-white/70">
              <HardDrive size={16} />
              <span>{formatBytes(video.size)}</span>
            </div>
            {video.volume !== undefined && video.volume !== 100 && (
              <div className="flex items-center gap-2 text-white/70">
                <Volume2 size={16} />
                <span>{video.volume}% volume</span>
              </div>
            )}
          </div>
          
          {video.description && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center gap-2 text-white/50 mb-2">
                <FileText size={16} />
                <span className="text-sm">Description</span>
              </div>
              <p className="text-white/80">{video.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

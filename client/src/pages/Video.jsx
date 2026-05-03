import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Copy, Check, AlertCircle, Calendar, HardDrive, Volume2, FileText, Loader2, Settings } from 'lucide-react'
import { API_URL } from '../utils/api'
import ThemeSettings from '../components/ThemeSettings'

export default function Video() {
  const { id } = useParams()
  const [video, setVideo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false)
  const pollRef = useRef(null)
  const iframeRef = useRef(null)

  useEffect(() => {
    loadVideo()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [id])

  const loadVideo = async () => {
    try {
      const res = await fetch(`${API_URL}/api/video/${id}`)
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else if (Number(data.transcodingStatus) !== 4) {
        setProcessing(true)
        setVideo(data)
        // Poll until ready
        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(`${API_URL}/api/video/${id}`)
            const pollData = await pollRes.json()
            const status = Number(pollData.transcodingStatus)
            if (status === 4) {
              clearInterval(pollRef.current)
              setProcessing(false)
              setVideo(pollData)
              initPlayer(pollData)
            } else if (status === 5) {
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
    // Set browser title
    document.title = videoData.originalName || 'Video'
    // Apply volume after iframe loads - try multiple times with different delays
    if (videoData.volume !== undefined && videoData.volume !== 100) {
      const setVolume = () => {
        if (iframeRef.current) {
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({
              context: 'player.js',
              method: 'setVolume',
              value: videoData.volume
            }),
            '*'
          )
        }
      }
      // Try at different intervals to ensure iframe is ready
      setTimeout(setVolume, 500)
      setTimeout(setVolume, 1000)
      setTimeout(setVolume, 2000)
      setTimeout(setVolume, 3000)
    }
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
    const isDeleted = error === 'Video not found'
    const isExpired = error === 'Video expired'
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white mb-8">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle size={64} className={`${isExpired ? 'text-yellow-400' : 'text-red-400'} mb-4`} />
            <h1 className="text-2xl font-bold mb-2">
              {isDeleted ? 'Video Has Been Deleted' : isExpired ? 'Video Has Expired' : 'Video Not Found'}
            </h1>
            <p className="text-white/50">
              {isDeleted
                ? 'This video has been deleted and is no longer available.'
                : isExpired
                  ? 'This video has expired and has been automatically removed.'
                  : error}
            </p>
            <Link to="/" className="mt-6 bg-white text-black px-5 py-2 rounded-lg text-sm font-medium hover:bg-white/90 transition-colors">
              Upload a Video
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Back */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white">
            <ArrowLeft size={20} />
            Back
          </Link>
          <button
            onClick={() => setThemeSettingsOpen(true)}
            className="text-white/60 hover:text-white transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Video Player */}
        <div className="bg-white/5 rounded-2xl overflow-hidden mb-6">
          {processing ? (
            <div className="w-full aspect-video bg-black flex flex-col items-center justify-center">
              <Loader2 size={32} className="animate-spin text-white/40 mb-3" />
              <p className="text-white/60 text-sm">Processing video...</p>
              <p className="text-white/30 text-xs mt-1">This may take a few minutes</p>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={`${video.embedUrl}?autoplay=${video.autoplay ? 'true' : 'false'}&loop=false&muted=false&preload=true&responsive=true`}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={() => {
                if (video.volume !== undefined && video.volume !== 100 && iframeRef.current) {
                  const setVolume = () => {
                    if (iframeRef.current) {
                      iframeRef.current.contentWindow.postMessage(
                        JSON.stringify({
                          context: 'player.js',
                          method: 'setVolume',
                          value: video.volume
                        }),
                        '*'
                      )
                    }
                  }
                  // Try at different intervals to ensure iframe is ready
                  setTimeout(setVolume, 500)
                  setTimeout(setVolume, 1000)
                  setTimeout(setVolume, 2000)
                }
              }}
              className="w-full aspect-video bg-black border-0"
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

      {/* Theme Settings Modal */}
      <ThemeSettings isOpen={themeSettingsOpen} onClose={() => setThemeSettingsOpen(false)} />
    </div>
  )
}

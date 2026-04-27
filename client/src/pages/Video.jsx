import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Copy, Check, AlertCircle, Calendar, HardDrive, Volume2, FileText } from 'lucide-react'
import { API_URL } from '../utils/api'

export default function Video() {
  const { id } = useParams()
  const [video, setVideo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const videoRef = useRef(null)

  useEffect(() => {
    fetch(`${API_URL}/api/video/${id}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error)
        } else {
          setVideo(data)
        }
      })
      .catch(() => setError('Failed to load video'))
      .finally(() => setLoading(false))
  }, [id])

  // Apply video settings when loaded
  useEffect(() => {
    if (video && videoRef.current) {
      // Set volume
      if (video.volume !== undefined) {
        videoRef.current.volume = video.volume / 100
      }
      // Autoplay if enabled
      if (video.autoplay) {
        videoRef.current.play().catch(() => {})
      }
      // Set browser title
      document.title = video.originalName
    }
  }, [video])

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
          <video
            ref={videoRef}
            src={video.url}
            controls
            className="w-full aspect-video bg-black"
            onError={(e) => {
              // Try direct playback if HLS fails
              e.target.src = video.url.replace('/playlist.m3u8', '/play.mp4')
            }}
          />
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

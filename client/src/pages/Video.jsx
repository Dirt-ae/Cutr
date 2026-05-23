import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Copy, Check, AlertCircle, Calendar, HardDrive, Volume2, FileText, Loader2, Download, Flag, X as CloseIcon, Code2 } from 'lucide-react'
import { API_URL } from '../utils/api'
import ThemeSettings from '../components/ThemeSettings'
import MainNav from '../components/MainNav'

export default function Video({ user, logout }) {
  const { id } = useParams()
  const location = useLocation()
  const privateToken = new URLSearchParams(location.search).get('token')
  const tokenQuery = privateToken ? `?token=${encodeURIComponent(privateToken)}` : ''
  const [video, setVideo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportSuccess, setReportSuccess] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    loadVideo()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [id])

  const loadVideo = async () => {
    try {
      const res = await fetch(`${API_URL}/api/video/${id}${tokenQuery}`)
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else if (Number(data.transcodingStatus) !== 4) {
        setProcessing(true)
        setVideo(data)
        // Poll until ready
        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(`${API_URL}/api/video/${id}${tokenQuery}`)
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
    document.title = `CUTRR - ${videoData.originalName || id}`
  }

  const submitReport = async (e) => {
    e.preventDefault()
    if (!reportReason.trim() || reportReason.length < 5) return
    
    setReporting(true)
    try {
      const res = await fetch(`${API_URL}/api/videos/${id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reportReason })
      })
      const data = await res.json()
      if (data.success) {
        setReportSuccess(true)
        setReportReason('')
        setTimeout(() => {
          setReportModalOpen(false)
          setReportSuccess(false)
        }, 3000)
      }
    } catch {
      alert('Failed to submit report')
    } finally {
      setReporting(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyEmbedCode = () => {
    const src = `${window.location.origin}${video.embedUrl}?autoplay=${video.autoplay ? 'true' : 'false'}&volume=${video.volume ?? 15}`
    navigator.clipboard.writeText(
      `<iframe src="${src}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" loading="lazy"></iframe>`,
    )
    setEmbedCopied(true)
    setTimeout(() => setEmbedCopied(false), 2000)
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

  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'Unknown'
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="obsidian-ui min-h-screen flex items-center justify-center">
        <div className="text-white/50">Loading...</div>
      </div>
    )
  }

  if (error) {
    const isDeleted = error === 'Video not found'
    const isExpired = error === 'Video expired'
    return (
      <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
        <MainNav user={user} logout={logout} />
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
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
            <Link to="/" className="touch-link mt-6 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90">
              Upload a Video
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav
        user={user}
        logout={logout}
        onOpenSettings={() => setThemeSettingsOpen(true)}
      />
      <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {/* Back */}
        <div className="mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white">
            <ArrowLeft size={20} />
            Back
          </Link>
        </div>

        {/* Video Player */}
        <div className="glass rounded-[22px] overflow-hidden mb-6">
          {processing ? (
            <div className="w-full aspect-video bg-black flex flex-col items-center justify-center">
              <Loader2 size={32} className="animate-spin text-white/40 mb-3" />
              <p className="text-white/60 text-sm">Processing video...</p>
              <p className="text-white/30 text-xs mt-1">This may take a few minutes</p>
            </div>
          ) : (
            <iframe
              src={`${API_URL}${video.embedUrl}?autoplay=${video.autoplay ? 'true' : 'false'}&volume=${video.volume ?? 15}${privateToken ? `&token=${encodeURIComponent(privateToken)}` : ''}`}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
              scrolling="no"
              className="w-full aspect-video bg-black border-0"
            />
          )}
        </div>

        {/* Info */}
        <div className="glass rounded-[22px] p-4 sm:p-6">
          <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold mb-1">{video.originalName || 'Video'}</h1>
              <p className="text-white/50 text-sm mb-1">ID: {video.id}</p>
              <p className="text-white/40 text-xs">Uploaded {formatDateTime(video.createdAt)}</p>
            </div>
            {!processing && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={copyLink}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.045] px-3 text-xs font-semibold text-white/60 transition-all hover:bg-white/10 hover:text-white"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={copyEmbedCode}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.045] px-3 text-xs font-semibold text-white/60 transition-all hover:bg-white/10 hover:text-white"
                >
                  {embedCopied ? <Check size={14} /> : <Code2 size={14} />}
                  {embedCopied ? 'Copied' : 'Embed'}
                </button>
                <a
                  href={`${API_URL}/api/video/${video.id}/download${tokenQuery}`}
                  download
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-black transition-all hover:bg-white/90"
                >
                  <Download size={14} />
                  Download
                </a>
                <button
                  onClick={() => setReportModalOpen(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 text-xs font-semibold text-red-400 transition-all hover:bg-red-500/20"
                >
                  <Flag size={14} />
                  Report
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:gap-6">
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
      <ThemeSettings isOpen={themeSettingsOpen} onClose={() => setThemeSettingsOpen(false)} user={user} />

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center overflow-y-auto p-3 animate-in fade-in duration-200 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !reporting && setReportModalOpen(false)} />
          <div className="relative my-3 max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto glass rounded-[22px] border border-white/10 p-4 shadow-[0_32px_64px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-200 sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:rounded-[32px] sm:p-8">
            <button
              onClick={() => setReportModalOpen(false)}
              className="absolute right-4 top-4 text-white/20 hover:text-white transition-colors sm:right-6 sm:top-6"
              disabled={reporting}
            >
              <CloseIcon size={20} />
            </button>

            {reportSuccess ? (
              <div className="py-6 text-center">
                <div className="w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check size={32} />
                </div>
                <h3 className="text-xl font-bold mb-2">Thank You</h3>
                <p className="text-white/50 text-sm">Your report has been submitted. Our team will review this content shortly.</p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mb-4">
                    <Flag size={24} />
                  </div>
                  <h3 className="text-2xl font-bold tracking-tight">Report Content</h3>
                  <p className="text-white/40 text-sm mt-1">Help us understand what's wrong with this video.</p>
                </div>

                <form onSubmit={submitReport} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 px-1">
                      Reason for Reporting
                    </label>
                    <textarea
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="Tell us why this video should be removed..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-all min-h-[120px] resize-none"
                      required
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={reporting || reportReason.length < 5}
                    className="w-full h-12 rounded-2xl bg-white text-black font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                  >
                    {reporting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      'Submit Report'
                    )}
                  </button>
                  <p className="text-[10px] text-center text-white/20 px-4">
                    Abuse of the reporting system may lead to an account ban.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Check, AlertCircle, Calendar, HardDrive, Volume2, FileText, Loader2, Download, Flag, MoreHorizontal, Settings, X as CloseIcon, Share2, Copy } from 'lucide-react'
import { API_URL } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import { formatLocalUploadDateTime, normalizeUtcTimestamp } from '../utils/dates'
import { getOriginalPlaybackUrl, getSafePlaybackUrl } from '../utils/videoUrls'
import { isPlaybackReady, isPlaybackFailed } from '../utils/videoReadiness'
import { getAdaptiveVideoFrameStyle } from '../utils/videoFrame'
import MainNav from '../components/MainNav'
import VideoPlayer from '../components/VideoPlayer'

export default function Video({ user, logout }) {
  const { id } = useParams()
  const location = useLocation()
  const { showToast } = useToast()
  const urlSearchParams = new URLSearchParams(location.search)
  const privateToken = urlSearchParams.get('token')
  const startTimeParam = urlSearchParams.get('t')
  const startTimeSeconds =
    startTimeParam != null && startTimeParam !== '' && Number.isFinite(Number(startTimeParam))
      ? Math.max(0, Number(startTimeParam))
      : null
  const [videoPassword, setVideoPassword] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const buildVideoQuery = (password = videoPassword) => {
    const params = new URLSearchParams()
    const effectivePrivateToken = privateToken || video?.privateToken || ''
    if (effectivePrivateToken) params.set('token', effectivePrivateToken)
    if (password) params.set('password', password)
    const query = params.toString()
    return query ? `?${query}` : ''
  }
  const [video, setVideo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [timeCommentsEnabled, setTimeCommentsEnabled] = useState(false)
  const [timeComments, setTimeComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentDraftOpen, setCommentDraftOpen] = useState(false)
  const [commentDraftBody, setCommentDraftBody] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [playerTime, setPlayerTime] = useState({ currentTime: 0, duration: 0 })
  const [activeCommentId, setActiveCommentId] = useState(null)
  const [hoveredCommentId, setHoveredCommentId] = useState(null)
  const [timeCommentsCollapsed, setTimeCommentsCollapsed] = useState(() => localStorage.getItem('hideTimedCommentsByDefault') === 'true')
  const [timeCommentsMenuOpen, setTimeCommentsMenuOpen] = useState(false)
  const [timeCommentsSettingsOpen, setTimeCommentsSettingsOpen] = useState(false)
  const [hideTimedCommentsByDefault, setHideTimedCommentsByDefault] = useState(() => localStorage.getItem('hideTimedCommentsByDefault') === 'true')
  const [showPlayerMarkers, setShowPlayerMarkers] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportSuccess, setReportSuccess] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [includeTimestamp, setIncludeTimestamp] = useState(false)
  const [isPaused, setIsPaused] = useState(true)
  const videoPlayerRef = useRef(null)
  const playerMarkerHideTimerRef = useRef(null)
  const pollRef = useRef(null)
  const pollAttemptRef = useRef(0)
  const pendingSeekRef = useRef(null)
  const [playerFrame, setPlayerFrame] = useState(() => getAdaptiveVideoFrameStyle())

  useEffect(() => {
    pendingSeekRef.current = startTimeSeconds
  }, [id, startTimeSeconds])

  useEffect(() => {
    if (video?.width && video?.height) {
      setPlayerFrame(getAdaptiveVideoFrameStyle(video.width, video.height))
    }
  }, [video?.width, video?.height])

  const getPollIntervalMs = () => {
    const attempt = pollAttemptRef.current || 0
    if (attempt >= 200) return 15000
    if (attempt >= 100) return 10000
    if (attempt >= 40) return 5000
    return 3000
  }

  const hidePlayerMarkers = () => {
    if (playerMarkerHideTimerRef.current) clearTimeout(playerMarkerHideTimerRef.current)
    playerMarkerHideTimerRef.current = null
    setShowPlayerMarkers(false)
    setHoveredCommentId(null)
  }

  const revealPlayerMarkersBriefly = () => {
    setShowPlayerMarkers(true)
    if (playerMarkerHideTimerRef.current) clearTimeout(playerMarkerHideTimerRef.current)
    playerMarkerHideTimerRef.current = setTimeout(() => {
      setShowPlayerMarkers(false)
      setHoveredCommentId(null)
      playerMarkerHideTimerRef.current = null
    }, 900)
  }

  useEffect(() => {
    if (!shareOpen) return undefined
    const handleClickOutside = (event) => {
      if (event.target.closest?.('[data-share-menu]')) return
      setShareOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [shareOpen])

  useEffect(() => {
    loadVideo()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
      if (playerMarkerHideTimerRef.current) clearTimeout(playerMarkerHideTimerRef.current)
    }
  }, [id, videoPassword])

  useEffect(() => {
    const loadTimeComments = async () => {
      if (!video?.id) return
      if (video.allowTimeComments !== true) {
        setTimeCommentsEnabled(false)
        setTimeComments([])
        return
      }
      const token = localStorage.getItem('token')
      setCommentsLoading(true)
      try {
        const res = await fetch(`${API_URL}/api/video/${video.id}/time-comments${buildVideoQuery()}`, token ? {
          headers: { Authorization: `Bearer ${token}` },
        } : undefined)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed to load comments')
        setTimeCommentsEnabled(data.enabled === true)
        setTimeComments(Array.isArray(data.comments) ? data.comments : [])
      } catch (_e) {
        setTimeCommentsEnabled(false)
        setTimeComments([])
      } finally {
        setCommentsLoading(false)
      }
    }
    loadTimeComments()
  }, [video?.id, video?.allowTimeComments, video?.isOwner, videoPassword, privateToken])

  const sortedTimeComments = useMemo(() => {
    return [...timeComments].sort((a, b) => (a.timeSeconds ?? 0) - (b.timeSeconds ?? 0))
  }, [timeComments])

  const markerComments = useMemo(() => {
    const buckets = new Map()
    for (const comment of sortedTimeComments) {
      const bucket = Math.round((Number(comment.timeSeconds) || 0) * 10) / 10
      if (!buckets.has(bucket)) buckets.set(bucket, [])
      buckets.get(bucket).push(comment)
    }
    return [...buckets.entries()].map(([timeSeconds, comments]) => {
      const randomIndex = Math.floor(Math.random() * comments.length)
      return {
        ...comments[randomIndex],
        timeSeconds,
        commentCount: comments.length,
      }
    })
  }, [sortedTimeComments])

  const formatTimestamp = (seconds) => {
    const clamped = Math.max(0, Math.round((Number(seconds) || 0) * 10) / 10)
    const m = Math.floor(clamped / 60)
    const s = String(Math.floor(clamped % 60)).padStart(2, '0')
    const tenth = Math.round((clamped % 1) * 10)
    return `${m}:${s}.${tenth}`
  }

  const submitTimeComment = async () => {
    if (!video?.id) return
    const token = localStorage.getItem('token')
    if (!token) {
      setError('Sign in to comment')
      return
    }
    const body = commentDraftBody.trim()
    if (!body) return
    setCommentSubmitting(true)
    const optimisticId = `optimistic_${Date.now()}`
    const payload = {
      timeSeconds: Math.round((playerTime.currentTime || 0) * 10) / 10,
      body,
    }
    setTimeComments((current) => [
      ...current,
      { id: optimisticId, timeSeconds: payload.timeSeconds, body: payload.body, author: { name: video?.isOwner ? 'Owner' : 'Viewer' }, createdAt: new Date().toISOString() },
    ])
    setCommentDraftBody('')
    setCommentDraftOpen(false)
    try {
      const res = await fetch(`${API_URL}/api/video/${video.id}/time-comments${buildVideoQuery()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add comment')
      setTimeComments((current) => current.map((c) => (c.id === optimisticId ? data : c)))
    } catch (e) {
      setTimeComments((current) => current.filter((c) => c.id !== optimisticId))
      setError(e.message || 'Failed to add comment')
    } finally {
      setCommentSubmitting(false)
    }
  }

  const deleteTimeComment = async (commentId) => {
    if (!video?.id) return
    const token = localStorage.getItem('token')
    if (!token) return
    const previous = timeComments
    setTimeComments((current) => current.filter((c) => c.id !== commentId))
    try {
      const res = await fetch(`${API_URL}/api/video/${video.id}/time-comments/${commentId}${buildVideoQuery()}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete comment')
    } catch (e) {
      setTimeComments(previous)
      setError(e.message || 'Failed to delete comment')
    }
  }

  const loadVideo = async () => {
    try {
      const videoQuery = buildVideoQuery()
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_URL}/api/video/${id}${videoQuery}`, token ? {
        headers: { Authorization: `Bearer ${token}` }
      } : undefined)
      const data = await res.json()
      if (data.requiresPassword) {
        setError('PASSWORD_REQUIRED')
        setVideo(data)
      } else if (data.error) {
        setError(data.error)
      } else if (!isPlaybackReady(data)) {
        setProcessing(true)
        setVideo(data)
        pollAttemptRef.current = 0
        let pollInFlight = false
        const pollOnce = async () => {
          if (pollInFlight) return
          pollInFlight = true
          try {
            const pollRes = await fetch(`${API_URL}/api/video/${id}${videoQuery}`, token ? {
              headers: { Authorization: `Bearer ${token}` }
            } : undefined)
            const pollData = await pollRes.json()
            pollAttemptRef.current += 1
            if (isPlaybackReady(pollData)) {
              pollRef.current = null
              setProcessing(false)
              setVideo(pollData)
              initPlayer(pollData)
              return
            }
            if (isPlaybackFailed(pollData)) {
              pollRef.current = null
              setProcessing(false)
              setError('Video processing failed')
              return
            }
          } catch {}
          finally {
            pollInFlight = false
          }

          pollRef.current = setTimeout(pollOnce, getPollIntervalMs())
        }

        pollOnce()
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

  const unlockVideo = (event) => {
    event.preventDefault()
    if (!passwordInput.trim()) return
    setLoading(true)
    setError(null)
    setVideoPassword(passwordInput)
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

  const formatBytes = (bytes) => {
    if (!bytes) return 'Unknown'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown'
    const normalized = normalizeUtcTimestamp(dateStr)
    return new Date(normalized).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatDateTime = (dateStr) => {
    return formatLocalUploadDateTime(dateStr) || 'Unknown'
  }

  const seekToComment = (timeSeconds) => {
    videoPlayerRef.current?.seekTo(timeSeconds)
    setPlayerTime((current) => ({ ...current, currentTime: Math.max(0, Number(timeSeconds) || 0) }))
  }

  const buildShareLink = (withTimestamp = false) => {
    const params = new URLSearchParams()
    const effectivePrivateToken = privateToken || video?.privateToken || ''
    if (effectivePrivateToken) params.set('token', effectivePrivateToken)
    if (withTimestamp) {
      params.set('t', String(Math.round((playerTime.currentTime || 0) * 1000) / 1000))
    }
    const query = params.toString()
    return `${window.location.origin}/${id}${query ? `?${query}` : ''}`
  }

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareLink(includeTimestamp))
      showToast(
        includeTimestamp ? 'Link copied — opens at this moment' : 'Link copied',
        'success',
      )
      setShareOpen(false)
    } catch {
      showToast('Could not copy link', 'error')
    }
  }

  const openShareMenu = () => {
    setIncludeTimestamp(isPaused && (playerTime.currentTime || 0) > 0)
    setShareOpen((current) => !current)
  }

  const handlePlayerSeekReady = (currentTime, duration, dimensions) => {
    if (dimensions?.width && dimensions?.height) {
      setPlayerFrame(getAdaptiveVideoFrameStyle(dimensions.width, dimensions.height))
    }
    if (pendingSeekRef.current != null) {
      videoPlayerRef.current?.seekTo(pendingSeekRef.current)
      setPlayerTime({
        currentTime: pendingSeekRef.current,
        duration: duration || 0,
      })
      pendingSeekRef.current = null
      return
    }
    setPlayerTime({ currentTime, duration })
  }

  const toggleHideTimedCommentsByDefault = () => {
    setHideTimedCommentsByDefault((current) => {
      const next = !current
      localStorage.setItem('hideTimedCommentsByDefault', String(next))
      setTimeCommentsCollapsed(next)
      if (next) {
        setActiveCommentId(null)
        setHoveredCommentId(null)
        setCommentDraftOpen(false)
      }
      return next
    })
  }

  const hasAuthToken = Boolean(localStorage.getItem('token'))
  const timedCommentsAllowed = video?.allowTimeComments === true
  const canShowTimedComments = timedCommentsAllowed && timeCommentsEnabled
  const canShowTimedCommentsControls = timedCommentsAllowed && (canShowTimedComments || hideTimedCommentsByDefault)
  const shouldRenderCommentMarkers = canShowTimedComments && !timeCommentsCollapsed

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--page-bg)] text-[var(--page-fg)]">
        <div className="text-[var(--muted-text)]">Loading...</div>
      </div>
    )
  }

  if (error) {
    if (error === 'PASSWORD_REQUIRED') {
      return (
        <div className="flex flex-1 flex-col bg-[var(--page-bg)] text-[var(--page-fg)] selection:bg-blue-500/15">
          <MainNav user={user} logout={logout} />
          <div className="mx-auto max-w-md px-4 py-20">
            <form onSubmit={unlockVideo} className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-6">
              <h1 className="mb-2 text-xl font-semibold">Password protected</h1>
              <p className="mb-4 text-sm text-[var(--muted-text)]">Enter the video password to continue.</p>
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                className="theme-input mb-3 h-11 w-full rounded-lg px-3 text-sm"
                autoFocus
              />
              <button className="h-10 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">
                Unlock
              </button>
            </form>
          </div>
        </div>
      )
    }
    const isDeleted = error === 'Video not found'
    const isExpired = error === 'Video expired'
    return (
        <div className="flex flex-1 flex-col bg-[var(--page-bg)] text-[var(--page-fg)] selection:bg-blue-500/15">
        <MainNav user={user} logout={logout} />
        <div className="mx-auto max-w-5xl px-4 py-6 pb-12 sm:px-6 sm:py-8">
          <Link to="/" className="mb-8 inline-flex items-center gap-2 text-[var(--muted-text)] hover:text-[var(--page-fg)]">
            <ArrowLeft size={20} />
            Back
          </Link>
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle size={64} className={`${isExpired ? 'text-yellow-400' : 'text-red-400'} mb-4`} />
            <h1 className="text-2xl font-bold mb-2">
              {isDeleted ? 'Video Has Been Deleted' : isExpired ? 'Video Has Expired' : 'Video Not Found'}
            </h1>
            <p className="text-[var(--muted-text)]">
              {isDeleted
                ? 'This video has been deleted and is no longer available.'
                : isExpired
                  ? 'This video has expired and has been automatically removed.'
                  : error}
            </p>
            <Link to="/" className="touch-link mt-6 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
              Upload a Video
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-[var(--page-bg)] text-[var(--page-fg)] selection:bg-blue-500/15">
      <MainNav
        user={user}
        logout={logout}
      />
      <div className="mx-auto max-w-5xl px-4 py-6 pb-12 sm:px-6 sm:py-8">
        {/* Back */}
        <div className="mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-[var(--muted-text)] hover:text-[var(--page-fg)]">
            <ArrowLeft size={20} />
            Back
          </Link>
        </div>

        {/* Video Player */}
        <div
          className="relative mb-6 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)]"
          onMouseMove={revealPlayerMarkersBriefly}
          onMouseLeave={hidePlayerMarkers}
          onFocus={revealPlayerMarkersBriefly}
          onBlur={hidePlayerMarkers}
        >
          {processing ? (
            <div
              className={`${playerFrame.className} flex flex-col items-center justify-center bg-black`}
              style={playerFrame.style}
            >
              <Loader2 size={32} className="animate-spin text-white/40 mb-3" />
              <p className="text-white/60 text-sm">Processing video...</p>
              <p className="text-white/30 text-xs mt-1">This may take a few minutes</p>
            </div>
          ) : (
            <div className={playerFrame.className} style={playerFrame.style}>
              <VideoPlayer
                ref={videoPlayerRef}
                src={getOriginalPlaybackUrl(video, buildVideoQuery())}
                fallbackSrc={getSafePlaybackUrl(video)}
                autoPlay={video.autoplay === true}
                volume={(video.volume ?? 100) / 100}
                onError={() => setError('Video is still becoming available. Try again in a moment.')}
                onLoadedMetadata={handlePlayerSeekReady}
                onTimeUpdate={(currentTime, duration) => setPlayerTime({ currentTime, duration })}
                onPlay={() => setIsPaused(false)}
                onPause={() => setIsPaused(true)}
                className="h-full w-full bg-black border-0 object-contain"
              />
            </div>
          )}
          {!processing && shouldRenderCommentMarkers && playerTime.duration > 0 && markerComments.length > 0 && (
            <div className={`pointer-events-none absolute bottom-[17px] left-[18px] right-[18px] z-10 h-3 ${showPlayerMarkers ? 'opacity-100' : 'opacity-0'}`}>
              {markerComments.map((c) => {
                const left = `${Math.min(100, Math.max(0, ((c.timeSeconds ?? 0) / playerTime.duration) * 100))}%`
                return (
                  <div
                    key={`${c.timeSeconds}-${c.id}`}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left }}
                  >
                    <button
                      type="button"
                      onClick={() => seekToComment(c.timeSeconds)}
                      onMouseEnter={() => setHoveredCommentId(c.id)}
                      onMouseLeave={() => setHoveredCommentId(null)}
                      onFocus={() => setHoveredCommentId(c.id)}
                      onBlur={() => setHoveredCommentId(null)}
                      className="pointer-events-auto h-2.5 w-2.5 rounded-full border border-black/60 bg-blue-400 shadow-[0_0_0_2px_rgba(255,255,255,0.85)] transition-transform hover:scale-125 focus:scale-125 focus:outline-none"
                      aria-label={`Seek to comment at ${formatTimestamp(c.timeSeconds)}`}
                    />
                    {hoveredCommentId === c.id && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 min-w-24 max-w-56 -translate-x-1/2 rounded-lg border border-white/15 bg-black/90 p-2 text-left text-xs text-white shadow-xl">
                        <div className="mb-1 font-semibold text-white/75">
                          {formatTimestamp(c.timeSeconds)}{c.commentCount > 1 ? ` · ${c.commentCount} comments` : ''}
                        </div>
                        <div className="line-clamp-3 text-white/90">{c.body}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {canShowTimedCommentsControls && !processing && (
          <div className="mb-6 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Timed comments</h2>
                <p className="mt-0.5 text-xs text-[var(--muted-text)]">
                  {timeCommentsCollapsed ? 'Hidden on this video.' : 'Comments appear on the timeline at their timestamp.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!timeCommentsCollapsed && (user || hasAuthToken) && (
                  <button
                    disabled={commentSubmitting || commentsLoading}
                    onClick={() => setCommentDraftOpen((v) => !v)}
                    className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 text-xs font-semibold text-[var(--muted-text-strong)] transition-colors hover:bg-[var(--muted-bg-strong)] disabled:opacity-50"
                  >
                    Add comment at {formatTimestamp(playerTime.currentTime)}
                  </button>
                )}
                {!timeCommentsCollapsed && !(user || hasAuthToken) && (
                  <div className="text-xs text-[var(--muted-text)]">Sign in to comment</div>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setTimeCommentsSettingsOpen((value) => !value)
                      setTimeCommentsMenuOpen(false)
                    }}
                    className="grid h-11 w-11 place-items-center rounded-lg border border-[var(--muted-border)] bg-[var(--muted-bg)] text-[var(--muted-text-strong)] transition-colors hover:bg-[var(--muted-bg-strong)]"
                    aria-label="Timed comment settings"
                  >
                    <Settings size={16} />
                  </button>
                  {timeCommentsSettingsOpen && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3 shadow-xl">
                      <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--muted-text-strong)]">
                        <input
                          type="checkbox"
                          checked={hideTimedCommentsByDefault}
                          onChange={toggleHideTimedCommentsByDefault}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold">Hide by default</span>
                          <span className="block text-xs text-[var(--muted-text)]">Auto-collapse timed comments on every video.</span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setTimeCommentsMenuOpen((value) => !value)
                      setTimeCommentsSettingsOpen(false)
                    }}
                    className="grid h-11 w-11 place-items-center rounded-lg border border-[var(--muted-border)] bg-[var(--muted-bg)] text-[var(--muted-text-strong)] transition-colors hover:bg-[var(--muted-bg-strong)]"
                    aria-label="Timed comment menu"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {timeCommentsMenuOpen && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-40 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setTimeCommentsCollapsed((value) => !value)
                          setTimeCommentsMenuOpen(false)
                          setActiveCommentId(null)
                          setHoveredCommentId(null)
                          setCommentDraftOpen(false)
                        }}
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg)]"
                      >
                        {timeCommentsCollapsed ? 'Show comments' : 'Hide comments'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!timeCommentsCollapsed && (
            <div className="mt-4">
              <div className="relative h-10 rounded bg-black/20">
                {playerTime.duration > 0 &&
                  markerComments.map((c) => (
                    <button
                      key={`${c.timeSeconds}-${c.id}`}
                      type="button"
                      onClick={() => setActiveCommentId(c.id)}
                      title={`${formatTimestamp(c.timeSeconds)} - ${c.body}`}
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/70 hover:bg-white"
                      style={{ left: `${Math.min(100, Math.max(0, ((c.timeSeconds ?? 0) / playerTime.duration) * 100))}%` }}
                    />
                  ))}

                {activeCommentId && (
                  (() => {
                    const active = sortedTimeComments.find((c) => c.id === activeCommentId)
                    if (!active) return null
                    return (
                      <div className="absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
                        <div className="rounded-lg border border-[var(--muted-border)] bg-[var(--panel-bg)] p-3 shadow-xl">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-text)]">
                                {formatTimestamp(active.timeSeconds)} - {active.author?.name || 'Viewer'}
                              </div>
                              <div className="mt-1 text-sm text-[var(--muted-text-strong)]">{active.body}</div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => seekToComment(active.timeSeconds)}
                                className="min-h-11 rounded-md border border-[var(--muted-border)] bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-blue-700 sm:min-h-0 sm:px-2 sm:py-1"
                              >
                                Go to
                              </button>
                              {video?.isOwner === true && (
                                <button
                                  onClick={() => deleteTimeComment(active.id)}
                                  className="min-h-11 rounded-md border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 py-2 text-[11px] text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg-strong)] sm:min-h-0 sm:px-2 sm:py-1"
                                >
                                  Delete
                                </button>
                              )}
                              <button
                                onClick={() => setActiveCommentId(null)}
                                className="min-h-11 rounded-md border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 py-2 text-[11px] text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg-strong)] sm:min-h-0 sm:px-2 sm:py-1"
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()
                )}
              </div>

              {commentDraftOpen && user && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--muted-text)]">
                      Comment at {formatTimestamp(playerTime.currentTime)}
                    </label>
                    <input
                      value={commentDraftBody}
                      onChange={(e) => setCommentDraftBody(e.target.value)}
                      placeholder="Write a quick note..."
                      className="theme-input h-11 w-full rounded-md px-3 text-sm"
                      maxLength={500}
                    />
                  </div>
                  <button
                    onClick={submitTimeComment}
                    disabled={commentSubmitting || !commentDraftBody.trim()}
                    className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    Post
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 sm:p-6">
          <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold mb-1">{video.originalName || 'Video'}</h1>
              <p className="text-xs text-[var(--muted-text)]">
                Uploaded {formatDateTime(video.uploadedAtUtc || video.createdAt)}
              </p>
            </div>
            {!processing && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative" data-share-menu>
                  <button
                    type="button"
                    onClick={openShareMenu}
                    className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 text-xs font-semibold text-[var(--muted-text-strong)] transition-colors hover:bg-[var(--muted-bg-strong)]"
                  >
                    <Share2 size={14} />
                    Share
                  </button>
                  {shareOpen && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-xl">
                      <p className="mb-3 text-sm font-semibold text-[var(--page-fg)]">Share link</p>
                      <label className="mb-3 flex cursor-pointer items-start gap-3 text-sm text-[var(--muted-text-strong)]">
                        <input
                          type="checkbox"
                          checked={includeTimestamp}
                          onChange={(event) => setIncludeTimestamp(event.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold">Jump to this moment</span>
                          <span className="block text-xs text-[var(--muted-text)]">
                            {includeTimestamp
                              ? `Opens at ${formatTimestamp(playerTime.currentTime)}`
                              : 'Share the full video from the start'}
                          </span>
                        </span>
                      </label>
                      <div className="mb-3 truncate rounded-md border border-[var(--muted-border)] bg-[var(--muted-bg)] px-2.5 py-2 text-[11px] text-blue-500">
                        {buildShareLink(includeTimestamp)}
                      </div>
                      <button
                        type="button"
                        onClick={copyShareLink}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                      >
                        <Copy size={14} />
                        Copy link
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setReportModalOpen(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 text-xs font-semibold text-[var(--muted-text-strong)] transition-colors hover:bg-[var(--muted-bg-strong)]"
                >
                  <Flag size={14} />
                  Report
                </button>
                {video.allowDownloading !== false && (
                  <a
                    href={`${API_URL}/api/video/${video.id}/download${buildVideoQuery()}`}
                    download
                    className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-all hover:bg-blue-700"
                  >
                    <Download size={14} />
                    Download
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:gap-6">
            <div className="flex items-center gap-2 text-[var(--muted-text)]">
              <Calendar size={16} />
              <span>Expires {formatDate(video.expiresAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-[var(--muted-text)]">
              <HardDrive size={16} />
              <span>{formatBytes(video.size)}</span>
            </div>
            {video.volume !== undefined && video.volume !== 100 && (
              <div className="flex items-center gap-2 text-[var(--muted-text)]">
                <Volume2 size={16} />
                <span>{video.volume}% volume</span>
              </div>
            )}
          </div>
          
          {video.description && (
            <div className="mt-4 border-t border-[var(--panel-border)] pt-4">
              <div className="mb-2 flex items-center gap-2 text-[var(--muted-text)]">
                <FileText size={16} />
                <span className="text-sm">Description</span>
              </div>
              <p className="text-[var(--muted-text-strong)]">{video.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center overflow-y-auto p-3 animate-in fade-in duration-200 sm:items-center sm:p-4">
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--modal-backdrop)' }} onClick={() => !reporting && setReportModalOpen(false)} />
          <div className="relative my-3 max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-2xl animate-in zoom-in-95 duration-200 sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:p-8">
            <button
              onClick={() => setReportModalOpen(false)}
              className="absolute right-4 top-4 text-[var(--muted-text)] transition-colors hover:text-[var(--page-fg)] sm:right-6 sm:top-6"
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
                <p className="text-sm text-[var(--muted-text)]">Your report has been submitted. Our team will review this content shortly.</p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mb-4">
                    <Flag size={24} />
                  </div>
                  <h3 className="text-2xl font-bold tracking-tight">Report Content</h3>
                  <p className="mt-1 text-sm text-[var(--muted-text)]">Help us understand what's wrong with this video.</p>
                </div>

                <form onSubmit={submitReport} className="space-y-4">
                  <div>
                    <label className="mb-2 block px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-text)]">
                      Reason for Reporting
                    </label>
                    <textarea
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="Tell us why this video should be removed..."
                      className="theme-input min-h-[120px] w-full resize-none rounded-lg p-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-red-500/20"
                      required
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={reporting || reportReason.length < 5}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 text-sm font-bold text-white transition-all hover:bg-red-700 disabled:opacity-50"
                  >
                    {reporting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      'Submit Report'
                    )}
                  </button>
                  <p className="px-4 text-center text-[10px] text-[var(--muted-text)]">
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

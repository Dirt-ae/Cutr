import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Check, Clock, Copy, Link as LinkIcon, LogIn, LogOut, Menu, Upload, X } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { API_URL } from '../utils/api'
import { isPlaybackReady, isPlaybackFailed } from '../utils/videoReadiness'
import { getUploadProgressForStatus, getUploadStatusCopy } from '../utils/processingStatus'
import { APP_VERSION } from '../constants/version'

const MAX_VIDEO_SIZE_MB = 100
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024
const DISCORD_SUPPORT_URL = 'https://discord.gg/JAbzJX4Jce'
const LONG_PROCESSING_ATTEMPTS = 20
const MAX_PROCESSING_ATTEMPTS = 120
const PROCESSING_REASONS = [
  'CUTRR keeps your upload high quality with no extra compression, so bigger edits can take a little longer.',
  'Discord embeds need the video and preview data to finish cleanly before the link is ready.',
  'Bunny may still be building the playback versions for your clip.',
  'Large effects, high bitrate, or longer clips can take extra time to finish processing.',
]

const getProcessingWaitMessage = () => {
  const shuffled = [...PROCESSING_REASONS].sort(() => Math.random() - 0.5)
  return `Sorry, this video is taking a little longer than usual. ${shuffled.slice(0, 2).join(' ')}`
}

const getUploadFailureMessage = (failureCount = 1) =>
  failureCount >= 2
    ? 'This upload failed again. Join the Discord and make a ticket so I can figure out what is going on.'
    : 'Something may have happened during upload or processing. Try uploading it one more time.'

function HomeMobileMenu({ open, onClose, user }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close menu"
      />
      <aside className="absolute right-0 top-0 flex h-dvh w-[min(86vw,22rem)] flex-col border-l border-white/10 bg-[#090b10]/95 p-4 shadow-[-24px_0_70px_rgba(0,0,0,0.55)]">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight text-white">CUTRR</span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white transition-colors hover:bg-white/[0.14]"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="grid gap-1">
          <Link to="/info" className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white">
            Help Center
          </Link>
          <Link to="/resources" className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white">
            Resources
          </Link>
          <Link to="/forms" className="touch-link justify-start rounded-2xl bg-white px-4 text-sm font-semibold text-black">
            Forms
          </Link>
          {user?.isAdmin && (
            <Link to="/admin" className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white">
              Admin
            </Link>
          )}
          <a href="https://discord.gg/JAbzJX4Jce" target="_blank" rel="noopener noreferrer" className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white">
            Discord
          </a>
          <a href="https://ko-fi.com/cutrr" target="_blank" rel="noopener noreferrer" className="touch-link justify-start rounded-2xl px-4 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white">
            Donations
          </a>
        </nav>
      </aside>
    </div>
  );
}

export default function Home({ user, logout }) {
  const location = useLocation()
  const { showToast } = useToast()
  const [queue, setQueue] = useState([])
  const [queueRunning, setQueueRunning] = useState(false)
  const queueRef = useRef([])
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const fileInputRef = useRef(null)
  const pollIntervalsRef = useRef(new Map())

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach(clearInterval)
      pollIntervalsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!location.search.includes('pick=1')) return
    const timeout = setTimeout(() => {
      fileInputRef.current?.click()
    }, 120)
    return () => clearTimeout(timeout)
  }, [location.search])

  useEffect(() => {
    const onDragOver = (event) => {
      event.preventDefault()
      setDragOver(true)
    }
    const onDragLeave = (event) => {
      if (event.relatedTarget == null) setDragOver(false)
    }
    const onDrop = (event) => {
      event.preventDefault()
      setDragOver(false)
      addFiles(event.dataTransfer.files)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const updateQueueItem = (localId, patch) => {
    setQueue((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    )
  }

  const markQueueItemFailed = (localId, patch = {}) => {
    let message = ''
    setQueue((current) =>
      current.map((item) => {
        if (item.localId !== localId) return item
        const failureCount = (item.failureCount || 0) + 1
        message = getUploadFailureMessage(failureCount)
        return {
          ...item,
          ...patch,
          status: 'error',
          label: message,
          failureCount,
          progress: 0,
          discordUrl: failureCount >= 2 ? (patch.discordUrl || DISCORD_SUPPORT_URL) : patch.discordUrl,
        }
      }),
    )
    return message
  }

  const pollTranscodingStatus = async (localId, videoId) => {
    updateQueueItem(localId, {
      status: 'transcoding',
      label: 'Checking Bunny status',
      detail: 'CUTRR is asking Bunny for the latest encode progress.',
      progress: 92,
    })

    let attempts = 0
    let showedLongProcessingNotice = false
    const getPollIntervalMs = () => {
      if (attempts >= 200) return 15000
      if (attempts >= 100) return 10000
      if (attempts >= 40) return 5000
      return 3000
    }

    const pollOnce = async () => {
      try {
        attempts += 1
        const res = await fetch(`${API_URL}/api/video/${videoId}`)
        const data = await res.json()
        const status = Number(data.transcodingStatus)
        const progress = Number(data.encodeProgress) || 0
        const statusCopy = getUploadStatusCopy({
          status,
          progress,
          processingMessage: data.processingMessage,
        })

        updateQueueItem(localId, {
          label: statusCopy.label,
          detail: statusCopy.detail,
          progress: getUploadProgressForStatus(status, progress),
        })

        if (isPlaybackReady(data)) {
          pollIntervalsRef.current.delete(localId)
          updateQueueItem(localId, { status: 'ready', label: 'Ready', detail: 'Playback is ready to share.', progress: 100, result: data })
          setResult(data)
          showToast('Video ready to share!', 'success')
          return
        } else if (isPlaybackFailed(data)) {
          pollIntervalsRef.current.delete(localId)
          const message = markQueueItemFailed(localId)
          showToast(message, 'error', { variant: 'notice', duration: 15000 })
          return
        } else if (attempts >= MAX_PROCESSING_ATTEMPTS) {
          pollIntervalsRef.current.delete(localId)
          const message = markQueueItemFailed(localId, {
            label: 'Processing took too long. Try the upload again.',
          })
          showToast(message, 'error', { variant: 'notice', duration: 15000 })
          return
        } else if (!showedLongProcessingNotice && attempts >= LONG_PROCESSING_ATTEMPTS) {
          showedLongProcessingNotice = true
          const message = getProcessingWaitMessage()
          updateQueueItem(localId, { label: message })
          showToast(message, 'warning', { variant: 'notice', duration: 15000 })
        }
      } catch (e) {
        console.error('Polling error:', e)
        if (attempts >= MAX_PROCESSING_ATTEMPTS) {
          pollIntervalsRef.current.delete(localId)
          const message = markQueueItemFailed(localId, {
            label: 'Processing status could not be checked. Try the upload again.',
          })
          showToast(message, 'error', { variant: 'notice', duration: 15000 })
          return
        }
      }

      const timeoutId = setTimeout(pollOnce, getPollIntervalMs())
      pollIntervalsRef.current.set(localId, timeoutId)
    }

    pollOnce()
  }

  const uploadQueueItem = (item) =>
    new Promise((resolve) => {
      const formData = new FormData()
      formData.append('video', item.file)
      try {
        const uploadTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (uploadTimezone) formData.append('uploadTimezone', uploadTimezone)
      } catch {}

      const token = localStorage.getItem('token')
      const endpoint = token ? `${API_URL}/api/upload` : `${API_URL}/api/upload-anonymous`

      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 90)
          updateQueueItem(item.localId, {
            status: 'uploading',
            label: 'Uploading to CUTRR',
            detail: `${progress}% uploaded before Bunny starts processing.`,
            progress,
          })
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText)

          if (!token) {
            const anonVideos = JSON.parse(localStorage.getItem('anonVideos') || '[]')
            anonVideos.push(data.id)
            localStorage.setItem('anonVideos', JSON.stringify(anonVideos))
          }

          updateQueueItem(item.localId, {
            status: 'uploaded',
            label: 'Sending video to Bunny',
            detail: 'CUTRR saved the upload and Bunny is creating the video record.',
            progress: 92,
            videoId: data.id,
          })
          pollTranscodingStatus(item.localId, data.id)
          resolve(true)
        } else {
          let errorMsg = 'Upload failed'
          let discordUrl = ''
          try {
            const error = JSON.parse(xhr.responseText)
            errorMsg = error.error || errorMsg
            discordUrl = error.discordUrl || ''
          } catch {}
          if (discordUrl) {
            showToast(errorMsg, 'error')
            updateQueueItem(item.localId, {
              status: 'error',
              label: 'Active video limit reached. Open a Discord ticket to add more.',
              discordUrl,
            })
          } else {
            const message = markQueueItemFailed(item.localId, { label: errorMsg })
            showToast(message, 'error', { variant: 'notice', duration: 15000 })
          }
          resolve(false)
        }
      })

      xhr.addEventListener('error', () => {
        const message = markQueueItemFailed(item.localId, { label: 'Network error during upload' })
        showToast(message, 'error', { variant: 'notice', duration: 15000 })
        resolve(false)
      })

      xhr.addEventListener('timeout', () => {
        const message = markQueueItemFailed(item.localId, { label: 'Upload timed out' })
        showToast(message, 'error', { variant: 'notice', duration: 15000 })
        resolve(false)
      })

      xhr.open('POST', endpoint)
      xhr.timeout = 30 * 60 * 1000
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }
      xhr.send(formData)
    })

  const isVideoFile = (file) =>
    file.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)

  const addFiles = (files) => {
    const validFiles = [...files].filter((candidate) => {
      if (!isVideoFile(candidate)) {
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
    try {
      while (true) {
        const nextItem = queueRef.current.find((item) => item.status === 'queued')
        if (!nextItem) break
        await uploadQueueItem(nextItem)
      }
    } finally {
      setQueueRunning(false)
    }
  }

  useEffect(() => {
    if (queueRunning) return
    if (!queue.some((item) => item.status === 'queued')) return
    startQueue()
  }, [queue, queueRunning])

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
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
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
    <div className="obsidian-ui flex min-h-screen flex-col text-white selection:bg-white/15">
      <header className="relative z-[700] mx-auto w-full max-w-7xl px-4 py-4 sm:px-8 sm:py-5 lg:px-12">
        <nav className="flex w-full items-center justify-between rounded-[28px] border border-white/[0.08] bg-white/[0.035] px-3 py-2 backdrop-blur-xl md:border-transparent md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
          <Link to="/" className="text-2xl font-black tracking-tight text-white">
            CUTRR
          </Link>

          <div className="hidden items-center gap-8 text-sm font-medium text-white/45 md:flex">
            <Link to="/info" className="transition-colors hover:text-white">Help Center</Link>
            <Link to="/resources" className="transition-colors hover:text-white">Resources</Link>
            <Link to="/forms" className="transition-colors hover:text-white">Forms</Link>
            {user?.isAdmin && <Link to="/admin" className="transition-colors hover:text-white">Admin</Link>}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to={user ? "/" : "/login"}
              onClick={(event) => {
                if (user && logout) {
                  event.preventDefault()
                  logout()
                }
              }}
              className="hidden h-11 w-11 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white sm:grid"
              aria-label={user ? "Logout" : "Login"}
              title={user ? "Logout" : "Login"}
            >
              {user ? <LogOut size={18} /> : <LogIn size={18} />}
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/85 sm:px-6"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((current) => !current)}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white transition-colors hover:bg-white/[0.14] md:hidden"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </nav>

        <HomeMobileMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          user={user}
        />
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        <div className="mb-10 text-center sm:mb-12">
          <h1 className="mb-4 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            Upload videos. Share Discord embeds.
          </h1>
          <p className="mx-auto max-w-lg text-sm text-white/45 sm:text-base lg:text-lg">
            A fast Discord video host for editors and creators. Upload up to 100MB, get a short link, and share clean video embeds.
          </p>
        </div>

        {!user && (
          <div className="mb-5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-center backdrop-blur-xl">
            <p className="text-xs text-white/60">
              <span className="font-semibold text-white">Sign up:</span> 6mo retention - volume - descriptions
            </p>
          </div>
        )}
        {user && !user.activeVideoUnlimited && (
          <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center backdrop-blur-xl">
            <p className="text-xs text-white/60">
              Your account includes <span className="font-semibold text-white">{user.activeVideoLimit || 5} active videos</span>. Need more?{" "}
              <a href={DISCORD_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline underline-offset-4">
                Join Discord and make a ticket
              </a>
              .
            </p>
          </div>
        )}
        {user?.activeVideoUnlimited && (
          <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-center backdrop-blur-xl">
            <p className="text-xs font-semibold text-emerald-100">
              Unlimited active videos enabled
            </p>
          </div>
        )}

        <div className="w-full max-w-2xl px-2">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addFiles(e.dataTransfer.files)
            }}
            className={`group flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-[2rem] border border-white/10 p-6 text-center transition-all duration-300 sm:p-12 md:min-h-[300px] md:p-20 ${
              dragOver
                ? 'bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_24px_80px_rgba(0,0,0,0.45)]'
                : 'bg-white/[0.055] hover:bg-white/[0.085]'
            }`}
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
            <Upload size={48} strokeWidth={1.5} className="mb-5 text-white transition-transform duration-300 group-hover:-translate-y-2" />
            <h2 className="mb-2 text-lg font-semibold text-white md:text-xl">Drop videos or click</h2>
            <p className="text-xs text-white/40 md:text-sm">Video only - max {MAX_VIDEO_SIZE_MB}MB each</p>
          </div>

          {queue.length > 0 && (
            <div className="mt-5 space-y-3 rounded-[2rem] border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Upload queue</p>
                <p className="text-xs text-white/50">{queueRunning ? 'Uploading...' : 'Waiting...'}</p>
              </div>
              {queue.map((item) => (
                <div key={item.localId} className="rounded-2xl bg-white/[0.04] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{item.file.name.replace(/\.[^/.]+$/, '')}</p>
                      <p className="text-[11px] text-white/55">{formatBytes(item.file.size)} - {item.label}</p>
                      <p className="mt-0.5 min-h-4 max-w-[19rem] truncate text-[11px] text-white/35 sm:max-w-[28rem]">
                        {item.detail || 'Waiting for the next upload step.'}
                      </p>
                      {item.discordUrl && (
                        <a
                          href={item.discordUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-[11px] font-semibold text-white underline underline-offset-4"
                        >
                          Join Discord and make a ticket
                        </a>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.status === 'error' && (
                        <button
                          type="button"
                          onClick={() =>
                            setQueue((current) =>
                              current.map((queued) =>
                                queued.localId === item.localId
                                  ? { ...queued, status: 'queued', label: 'Queued', progress: 0, discordUrl: '' }
                                  : queued,
                              ),
                            )
                          }
                          className="rounded-full bg-white px-3 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-white/85"
                        >
                          Try again
                        </button>
                      )}
                      {(item.status === 'queued' || item.status === 'error') && (
                        <button
                          onClick={() => setQueue((current) => current.filter((queued) => queued.localId !== item.localId))}
                          className="grid h-11 w-11 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                          aria-label="Remove upload"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
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

          {result && (
            <div className="mt-5 rounded-[2rem] border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
              <div className="mb-2 flex items-center gap-2">
                <Check size={16} className="text-green-400" />
                <p className="text-sm font-semibold">Uploaded - {formatExpiry(result.expiresAt)}</p>
              </div>

              <div className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                  <LinkIcon size={12} className="shrink-0 text-white/40" />
                  <code className="truncate text-xs text-white/60">
                    {window.location.origin}/{result.id}
                  </code>
                </div>
                <button
                  onClick={copyLink}
                  className="touch-button ml-0 flex shrink-0 items-center justify-center gap-1 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/85 sm:ml-2"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {result && (
            <button
              onClick={() => setResult(null)}
              className="touch-button mt-3 w-full py-2 text-xs text-white/40 transition-colors hover:text-white"
            >
              Upload another
            </button>
          )}
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-4 text-xs text-white/45 sm:mt-16 sm:text-sm md:gap-x-10">
          <div className="flex items-center gap-2">
            <Check size={16} />
            <span className="font-medium text-white/75">No Compression</span>
          </div>
          <div className="flex items-center gap-2">
            <LinkIcon size={16} />
            <span className="font-medium text-white/75">Discord Embeds</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={16} />
            <span className="font-medium text-white/75">6mo Retention</span>
          </div>
        </div>
      </main>

      <footer className="mx-auto mt-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 border-t border-white/10 px-5 py-8 text-center text-xs text-white/35 sm:px-8 md:flex-row md:text-left lg:px-12">
        <span>Discord video hosting for editors, creators, clips, previews, and quick video sharing.</span>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium">
          <Link to="/info" className="transition-colors hover:text-white">Info</Link>
          <Link to="/resources" className="transition-colors hover:text-white">Resources</Link>
          <Link to="/legal" className="transition-colors hover:text-white">Legal</Link>
          <a href="https://discord.gg/JAbzJX4Jce" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">Discord</a>
          <a href="https://ko-fi.com/cutrr" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">Ko-Fi</a>
        </div>
        <div className="text-xs text-white/25">v{APP_VERSION}</div>
      </footer>
    </div>
  )
}

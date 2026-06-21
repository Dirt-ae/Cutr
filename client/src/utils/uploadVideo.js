import * as tus from 'tus-js-client'
import { API_URL } from './api'

const TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload'
const TUS_CHUNK_SIZE = 5 * 1024 * 1024

const getUploadTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

const createUploadSession = async (file, token) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const uploadTimezone = getUploadTimezone()
  const response = await fetch(`${API_URL}/api/upload/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      uploadTimezone,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Failed to start upload')
    error.status = response.status
    error.code = data.code
    error.discordUrl = data.discordUrl
    throw error
  }

  if (!data.id || !data.tus) {
    throw new Error('Upload session response was invalid')
  }

  return data
}

export const uploadVideoFile = (file, { token = '', onProgress } = {}) =>
  new Promise((resolve, reject) => {
    createUploadSession(file, token)
      .then((session) => {
        const tusAuth = session.tus
        const upload = new tus.Upload(file, {
          endpoint: tusAuth.endpoint || TUS_ENDPOINT,
          retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
          chunkSize: TUS_CHUNK_SIZE,
          headers: {
            AuthorizationSignature: tusAuth.authorizationSignature,
            AuthorizationExpire: String(tusAuth.authorizationExpire),
            VideoId: tusAuth.videoId,
            LibraryId: String(tusAuth.libraryId),
          },
          metadata: {
            filename: file.name,
            filetype: file.type || 'video/mp4',
          },
          onError: (error) => {
            reject(error instanceof Error ? error : new Error('Upload failed'))
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            if (!onProgress || !bytesTotal) return
            const progress = Math.round((bytesUploaded / bytesTotal) * 90)
            onProgress(progress)
          },
          onSuccess: () => resolve(session),
        })

        upload.start()
      })
      .catch(reject)
  })

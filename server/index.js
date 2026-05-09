import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import pg from 'pg';
import rateLimit from 'express-rate-limit';
import youtubeDlExec from 'youtube-dl-exec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// Look for manually downloaded ffmpeg binary (fallback to ffmpeg-static if installed locally)
let ffmpegPath = null;
const manualFfmpeg = path.join(__dirname, 'bin', 'ffmpeg');
if (fs.existsSync(manualFfmpeg)) {
  ffmpegPath = manualFfmpeg;
} else {
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    ffmpegPath = ffmpegStatic.default;
  } catch {
    console.log('ffmpeg not available; 1080p YouTube merge disabled');
  }
}

// Limit concurrent yt-dlp processes to reduce DoS risk.
// (yt-dlp can be CPU/network intensive and may spawn additional work internally.)
const YTDLP_MAX_CONCURRENT_RAW = process.env.YTDLP_MAX_CONCURRENT?.trim() || '2';
const YTDLP_MAX_CONCURRENT = Number.parseInt(YTDLP_MAX_CONCURRENT_RAW, 10);
if (!/^\d+$/.test(YTDLP_MAX_CONCURRENT_RAW) || YTDLP_MAX_CONCURRENT < 1 || YTDLP_MAX_CONCURRENT > 4) {
  throw new Error('YTDLP_MAX_CONCURRENT must be an integer between 1 and 4');
}
let ytdlpActive = 0;
const ytdlpQueue = [];
const withYtDlpSlot = async (fn) => {
  if (ytdlpActive >= YTDLP_MAX_CONCURRENT) {
    await new Promise(resolve => ytdlpQueue.push(resolve));
  }
  ytdlpActive += 1;
  try {
    return await fn();
  } finally {
    ytdlpActive -= 1;
    const next = ytdlpQueue.shift();
    if (next) next();
  }
};

// Load env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valParts] = line.split('=');
    if (key && valParts.length) {
      process.env[key.trim()] = valParts.join('=').trim();
    }
  });
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

const getRequiredEnv = (key) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const JWT_SECRET = getRequiredEnv('JWT_SECRET');
const ADMIN_EMAIL = getRequiredEnv('ADMIN_EMAIL');
const ADMIN_PASSWORD = getRequiredEnv('ADMIN_PASSWORD');
const BCRYPT_ROUNDS_RAW = process.env.BCRYPT_ROUNDS?.trim() || '12';
const BCRYPT_ROUNDS = Number.parseInt(BCRYPT_ROUNDS_RAW, 10);

if (!/^\d+$/.test(BCRYPT_ROUNDS_RAW) || BCRYPT_ROUNDS < 10 || BCRYPT_ROUNDS > 15) {
  throw new Error('BCRYPT_ROUNDS must be an integer between 10 and 15');
}

if (JWT_SECRET.length < 32 || JWT_SECRET === 'replace-with-at-least-32-random-bytes') {
  throw new Error('JWT_SECRET must be at least 32 characters and must not use the example value');
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) {
  throw new Error('ADMIN_EMAIL must be a valid email address');
}

const adminPasswordError = getPasswordValidationError(ADMIN_PASSWORD, ADMIN_EMAIL);
if (adminPasswordError) {
  throw new Error(`ADMIN_PASSWORD is not strong enough: ${adminPasswordError}`);
}

// Bunny.net config
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST;
const USER_UPLOAD_LIMIT = 5;
const getYtDlpPath = () => {
  // Prefer standalone binary (no system Python required)
  const standalonePath = path.join(__dirname, 'bin', 'yt-dlp-standalone');
  if (fs.existsSync(standalonePath)) {
    return standalonePath;
  }
  const p = youtubeDlExec?.constants?.YOUTUBE_DL_PATH;
  if (!p) throw new Error('yt-dlp binary not available. YouTube imports are disabled.');
  return p;
};
const HLS_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
const HLS_SCRIPT_INTEGRITY = 'sha384-5E8B0pTlZZJMabWpC0fyYf6OUpe15jJij34BqBAh4NXoHAlLNOjCPRrwtOXOQFAn';

// Frontend URL for OG tags (Netlify)
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://cutr-production.up.railway.app';

// PostgreSQL connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database schema
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id VARCHAR(8) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        bunny_video_id VARCHAR(255) NOT NULL,
        original_name VARCHAR(500),
        size BIGINT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        volume INTEGER DEFAULT 100,
        description TEXT,
        autoplay BOOLEAN DEFAULT true,
        trimmed BOOLEAN DEFAULT false,
        trim_start VARCHAR(20),
        trim_end VARCHAR(20)
      )
    `);
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_expires_at ON videos(expires_at)');

    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
    await pool.query(
      `INSERT INTO users (email, password, is_admin)
       VALUES ($1, $2, true)
       ON CONFLICT (email)
       DO UPDATE SET password = EXCLUDED.password, is_admin = true`,
      [ADMIN_EMAIL, adminHash]
    );
    
    console.log('Database initialized');
  } catch (e) {
    console.error('Failed to initialize database:', e);
  }
}

initDB();

// Middleware
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || '').trim();
const allowedOrigins = FRONTEND_ORIGINS
  ? FRONTEND_ORIGINS.split(',').map(v => v.trim()).filter(Boolean)
  : [];

const corsOptions = {
  origin: (origin, cb) => {
    // Allow non-browser clients (no Origin header)
    if (!origin) return cb(null, true);
    // If not configured, default to allow all (legacy behavior)
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
};

// Ensure preflight always gets CORS headers.
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (!req.secure && forwardedProto !== 'https') {
      return res.status(400).json({ error: 'HTTPS required' });
    }
  }
  next();
});

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later' }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Upload limit reached, try again later' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts, try again later' }
});

app.use('/api/', generalLimiter);

// Handle multer errors (file too large, wrong type)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 100MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message && err.message.includes('Only video files')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer for file uploads (temp storage)
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const ALLOWED_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_VIDEO_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed (mp4, webm, mov, avi, mkv). Max 100MB.'), false);
    }
  }
});

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const normalizeYoutubeUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;

    const host = parsed.hostname.toLowerCase();
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (parsed.pathname === '/watch') videoId = parsed.searchParams.get('v') || '';
      if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/').filter(Boolean)[1] || '';
      }
    }

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
};

const isYoutubeUrl = (value) => Boolean(normalizeYoutubeUrl(value));

const runYtDlp = async (args, options = {}) => {
  return await withYtDlpSlot(async () => {
    const { stdout } = await execFileAsync(getYtDlpPath(), args, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      ...options
    });
    return stdout;
  });
};

const getYoutubeInfo = async (url) => {
  const stdout = await runYtDlp([
    '--no-config',
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--',
    url
  ], { timeout: 60 * 1000 });
  try {
    return JSON.parse(stdout);
  } catch (e) {
    const preview = String(stdout || '').slice(0, 500);
    throw new Error(`yt-dlp returned invalid JSON: ${getErrorMessage(e)} (stdout preview: ${preview})`);
  }
};

const downloadYoutubeVideo = (url, outputPath) => {
  const args = [
    '--no-config',
    '--output',
    outputPath,
    '--no-playlist',
    '--no-warnings',
    '--max-filesize',
    '100M'
  ];
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    args.push('--ffmpeg-location', ffmpegPath);
    // With ffmpeg we can merge separate video+audio tracks for up to 1080p
    args.push('--format', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    args.push('--merge-output-format', 'mp4');
  } else {
    // Fallback: single pre-merged file (no ffmpeg)
    args.push('--format', 'best[height<=1080]/best');
  }
  args.push('--', url);
  return runYtDlp(args, { timeout: 10 * 60 * 1000 });
};

const findDownloadedFile = (dir, videoId) => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const matches = entries
      .filter(e => e.isFile() && e.name.includes(videoId))
      .map(e => ({ name: e.name, path: path.join(dir, e.name), size: fs.statSync(path.join(dir, e.name)).size }));
    if (!matches.length) return null;
    // Prefer .mp4, then largest file
    const mp4 = matches.find(m => m.name.endsWith('.mp4'));
    if (mp4) return mp4.path;
    matches.sort((a, b) => b.size - a.size);
    return matches[0].path;
  } catch {
    return null;
  }
};

const getUserIdFromAuthHeader = (req) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.id;
  } catch {
    return null;
  }
};

const getErrorMessage = (error, fallback = 'Request failed') => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const getActiveUserVideoCount = async (userId) => {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS count FROM videos WHERE user_id = $1 AND expires_at > NOW()',
    [userId]
  );
  return result.rows[0]?.count || 0;
};

const requireUserUploadSlot = async (req, res, next) => {
  try {
    const count = await getActiveUserVideoCount(req.user.id);
    if (count >= USER_UPLOAD_LIMIT) {
      return res.status(403).json({
        error: `Upload limit reached. Signed-in accounts include ${USER_UPLOAD_LIMIT} active videos. Delete an old video or buy more uploads when upgrades launch.`
      });
    }
    next();
  } catch (e) {
    console.error('Upload slot check error:', e);
    res.status(500).json({ error: 'Failed to check upload limit' });
  }
};

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const escapeJsString = (value = '') => JSON.stringify(String(value));

const sanitizeText = (value, maxLength) => {
  if (value === undefined || value === null) return '';
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return typeof maxLength === 'number' ? cleaned.slice(0, maxLength) : cleaned;
};

const isVideoId = (value) => typeof value === 'string' && /^[a-f0-9]{8}$/.test(value);

const normalizeVideoIds = (ids, maxCount = USER_UPLOAD_LIMIT) => {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(isVideoId))].slice(0, maxCount);
};

const createCspNonce = () => crypto.randomBytes(16).toString('base64');

const setContentSecurityPolicy = (res, directives) => {
  const value = Object.entries(directives)
    .map(([directive, sources]) => sources.length ? `${directive} ${sources.join(' ')}` : directive)
    .join('; ');
  res.set('Content-Security-Policy', value);
};

const setOgContentSecurityPolicy = (res, nonce) => {
  setContentSecurityPolicy(res, {
    'default-src': ["'none'"],
    'base-uri': ["'none'"],
    'script-src': [`'nonce-${nonce}'`],
    'img-src': ['https:', 'data:'],
    'media-src': ['https:'],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'upgrade-insecure-requests': []
  });
};

const setEmbedContentSecurityPolicy = (res, nonce) => {
  const bunnyCdnSource = BUNNY_CDN_HOST ? `https://${BUNNY_CDN_HOST}` : 'https:';
  setContentSecurityPolicy(res, {
    'default-src': ["'none'"],
    'base-uri': ["'none'"],
    'script-src': [`'nonce-${nonce}'`, 'https://cdn.jsdelivr.net'],
    'style-src': [`'nonce-${nonce}'`],
    'img-src': [bunnyCdnSource, 'data:'],
    'media-src': [bunnyCdnSource, 'blob:'],
    'connect-src': [bunnyCdnSource],
    'object-src': ["'none'"],
    'form-action': ["'none'"],
    'upgrade-insecure-requests': []
  });
};

const setSpaContentSecurityPolicy = (res) => {
  setContentSecurityPolicy(res, {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:', 'https:'],
    'connect-src': ["'self'", 'https:'],
    'frame-src': ['https://iframe.mediadelivery.net'],
    'object-src': ["'none'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': []
  });
};

function getPasswordValidationError(password, email = '') {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be no more than ${PASSWORD_MAX_LENGTH} characters`;
  if (/\s/.test(password)) return 'Password cannot contain spaces';

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;
  if (classes < 3) return 'Password must include at least three of: lowercase, uppercase, number, symbol';

  const emailPrefix = String(email).split('@')[0]?.toLowerCase();
  if (emailPrefix && emailPrefix.length >= 4 && password.toLowerCase().includes(emailPrefix)) {
    return 'Password cannot contain your email name';
  }

  const commonPasswords = new Set([
    'password',
    'password123',
    'qwerty123',
    'letmein123',
    'admin123',
    'welcome123',
    'changeme123'
  ]);
  if (commonPasswords.has(password.toLowerCase())) return 'Password is too common';

  return null;
}

// Discord Open Graph support - detect Discord user agent
app.get('/:id', async (req, res, next) => {
  const userAgent = req.get('user-agent') || ''
  const isDiscord = userAgent.includes('Discordbot') || userAgent.includes('Twitterbot')
  
  // If it's Discord/Twitter bot and the path is a video ID, serve OG tags
  if (isDiscord && /^[a-f0-9]{8}$/.test(req.params.id)) {
    try {
      const result = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
      const video = result.rows[0];
      
      if (!video) return res.status(404).send('Video not found');
      if (new Date(video.expires_at) < new Date()) return res.status(410).send('Video expired');
      
      // Get transcoding status from Bunny
      // Bunny status codes: 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error
      let transcodingStatus = 0;
      try {
        const statusRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
          headers: { 'AccessKey': BUNNY_API_KEY }
        });
        if (statusRes.ok) {
          const bunnyVideo = await statusRes.json();
          transcodingStatus = bunnyVideo.status !== undefined ? bunnyVideo.status : 4;
        }
      } catch (e) {
        console.error('Failed to get Bunny status:', e);
      }

      // Only show embed if video is finished (status 4)
      if (transcodingStatus !== 4) {
        return res.status(503).send('Video still processing');
      }
      
      const pageUrl = `${FRONTEND_URL}/${video.id}`;
      const serverUrl = `${req.protocol}://${req.get('host')}`;
      const videoMp4 = `${serverUrl}/video-stream/${video.id}`;
      const thumbnailUrl = `${serverUrl}/thumb/${video.id}`;
      const embedTitle = `${video.original_name || 'Video'} | Streamable`;
      const publishedAt = new Date(video.created_at).toISOString();
      const cspNonce = createCspNonce();
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${escapeHtml(embedTitle)}">
  <meta property="og:description" content="Watch this video on CUTR">
  <meta property="og:type" content="video.other">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="Streamable">
  <meta property="og:image" content="${escapeHtml(thumbnailUrl)}">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="720">
  <meta property="og:video" content="${escapeHtml(videoMp4)}">
  <meta property="og:video:secure_url" content="${escapeHtml(videoMp4)}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="1280">
  <meta property="og:video:height" content="720">
  <meta property="article:published_time" content="${escapeHtml(publishedAt)}">
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="${escapeHtml(embedTitle)}">
  <meta name="twitter:description" content="Watch this video on CUTR">
  <meta name="twitter:image" content="${escapeHtml(thumbnailUrl)}">
  <meta name="twitter:player:stream" content="${escapeHtml(videoMp4)}">
  <meta name="twitter:player:stream:content_type" content="video/mp4">
  <meta name="twitter:player:width" content="1280">
  <meta name="twitter:player:height" content="720">
  <script nonce="${cspNonce}">window.location.href = ${escapeJsString(pageUrl)};</script>
</head>
<body></body>
</html>`;
      
      setOgContentSecurityPolicy(res, cspNonce);
      res.set('Content-Type', 'text/html');
      res.send(html);
      return;
    } catch (e) {
      console.error('OG error:', e);
    }
  }
  
  // Otherwise, continue to normal routing
  next();
});

// Video stream proxy - serves Bunny MP4 since CDN requires auth
app.get('/video-stream/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT bunny_video_id FROM videos WHERE id = $1', [req.params.id]);
    const video = result.rows[0];
    if (!video) return res.status(404).send('Not found');
    
    const videoUrl = `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/play_720p.mp4`;
    const bunnyRes = await fetch(videoUrl, {
      headers: { 'AccessKey': BUNNY_API_KEY, 'Referer': `https://${BUNNY_CDN_HOST}` }
    });
    
    if (!bunnyRes.ok) return res.status(404).send('Video not available');
    
    res.set('Content-Type', 'video/mp4');
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await bunnyRes.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    console.error('Video stream proxy error:', e);
    res.status(500).send('Error');
  }
});

// Thumbnail proxy - serves Bunny thumbnails since CDN requires auth
app.get('/thumb/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT bunny_video_id FROM videos WHERE id = $1', [req.params.id]);
    const video = result.rows[0];
    if (!video) return res.status(404).send('Not found');
    
    // Support ?t=N for specific thumbnail index
    const thumbIndex = req.query.t ? parseInt(req.query.t) : null;
    const thumbFile = thumbIndex ? `thumbnail_${thumbIndex}.jpg` : 'thumbnail.jpg';
    
    const thumbRes = await fetch(`https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/${thumbFile}`, {
      headers: { 'AccessKey': BUNNY_API_KEY, 'Referer': `https://${BUNNY_CDN_HOST}` }
    });
    
    if (!thumbRes.ok) {
      // Try the API thumbnail endpoint
      const apiThumbRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}/thumbnail`, {
        headers: { 'AccessKey': BUNNY_API_KEY }
      });
      if (!apiThumbRes.ok) return res.status(404).send('Thumbnail not available');
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      const buffer = Buffer.from(await apiThumbRes.arrayBuffer());
      return res.send(buffer);
    }
    
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await thumbRes.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    console.error('Thumbnail proxy error:', e);
    res.status(500).send('Error');
  }
});

// Embed player endpoint for Discord/Twitter
app.get('/embed/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const video = result.rows[0];
    
    if (!video) return res.status(404).send('Video not found');
    if (new Date(video.expires_at) < new Date()) return res.status(410).send('Video expired');
    
    // Get transcoding status from Bunny
    // Bunny status codes: 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error
    let transcodingStatus = 0;
    try {
      const statusRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
        headers: { 'AccessKey': BUNNY_API_KEY }
      });
      if (statusRes.ok) {
        const bunnyVideo = await statusRes.json();
        transcodingStatus = bunnyVideo.status !== undefined ? bunnyVideo.status : 4;
      }
    } catch (e) {
      console.error('Failed to get Bunny status:', e);
    }

    if (transcodingStatus !== 4) {
      return res.status(503).send('Video still processing');
    }
    
    const videoUrl = `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/playlist.m3u8`;
    const thumbnailUrl = `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/thumbnail.jpg`;
    const cspNonce = createCspNonce();
    
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(video.original_name || 'Video')}</title>
  <style nonce="${cspNonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .player-container { width: 100%; max-width: 1280px; aspect-ratio: 16/9; }
    video { width: 100%; height: 100%; }
  </style>
  <script nonce="${cspNonce}" src="${HLS_SCRIPT_URL}" integrity="${HLS_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>
</head>
<body>
  <div class="player-container">
    <video controls autoplay poster="${escapeHtml(thumbnailUrl)}"></video>
  </div>
  <script nonce="${cspNonce}">
    const video = document.querySelector('video');
    const videoSrc = ${escapeJsString(videoUrl)};
    
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(videoSrc);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoSrc;
    }
  </script>
</body>
</html>`;
    
    setEmbedContentSecurityPolicy(res, cspNonce);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    console.error('Embed error:', e);
    res.status(500).send('Failed to load embed');
  }
});

// Routes

// Register
// Allowed email domains (legit providers only)
const ALLOWED_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk',
  'protonmail.com', 'proton.me', 'pm.me',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'zoho.com',
  'mail.com',
  'gmx.com', 'gmx.net',
  'yandex.com', 'yandex.ru',
  'tutanota.com', 'tuta.io',
  'fastmail.com',
  'hey.com'
];

app.post('/api/register', authLimiter, async (req, res) => {
  const { email, password, claimVideoIds } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const passwordError = getPasswordValidationError(password, email);
  if (passwordError) return res.status(400).json({ error: passwordError });
  
  // Validate email domain
  const emailDomain = email.toLowerCase().split('@')[1];
  if (!emailDomain || !ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
    return res.status(400).json({ error: 'Please use a real email provider (Gmail, Outlook, ProtonMail, etc.)' });
  }

  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hashed]
    );
    const user = result.rows[0];
    
	    // Claim anonymous videos if provided
	    const normalizedClaimVideoIds = normalizeVideoIds(claimVideoIds);
	    if (normalizedClaimVideoIds.length > 0) {
	      const claimable = await pool.query(
	        `SELECT id FROM videos
	         WHERE id = ANY($1) AND user_id IS NULL AND expires_at > NOW()
	         ORDER BY created_at DESC
	         LIMIT $2`,
	        [normalizedClaimVideoIds, USER_UPLOAD_LIMIT]
	      );
	      const claimableIds = claimable.rows.map(video => video.id);
	      if (claimableIds.length > 0) {
	        await pool.query(
	          'UPDATE videos SET user_id = $1, expires_at = $2 WHERE id = ANY($3)',
	          [user.id, new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), claimableIds]
	        );
	      }
	    }
    
    const token = jwt.sign({ id: user.id, email, isAdmin: false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email, isAdmin: false } });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isAdmin = user.is_admin === true;
    const token = jwt.sign({ id: user.id, email, isAdmin }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email, isAdmin } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Admin login
app.post('/api/admin/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_admin = true', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, isAdmin: true }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, isAdmin: true } });
  } catch (e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: 'Admin login failed' });
  }
});

// Get current user
app.get('/api/me', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, is_admin, created_at FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.json(null);
    res.json({ id: user.id, email: user.email, isAdmin: user.is_admin === true, created_at: user.created_at });
  } catch (e) {
    console.error('Get current user error:', e);
    res.status(500).json({ error: 'Failed to get current user' });
  }
});

// Upload video to Bunny.net
app.post('/api/upload', auth, uploadLimiter, requireUserUploadSlot, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file' });
  
  const videoId = crypto.randomBytes(4).toString('hex'); // 8 char ID
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // 6 months
  
  try {
    // Create video entry in Bunny
    const createRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`, {
      method: 'POST',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: videoId })
    });
    
    if (!createRes.ok) throw new Error('Failed to create video');
    const bunnyVideo = await createRes.json();
    
    // Save to database immediately with transcoding status
    const originalNameBase = sanitizeText(path.parse(req.file.originalname).name, 200) || `video-${videoId}`;
    await pool.query(
      `INSERT INTO videos (id, user_id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [videoId, req.user.id, bunnyVideo.guid, originalNameBase, req.file.size, expiresAt.toISOString(), 100, '', true]
    );
    
    // Upload file to Bunny
    const fileBuffer = fs.readFileSync(req.file.path);
    const uploadRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: fileBuffer
    });
    
    // Clean up temp file
    fs.unlinkSync(req.file.path);
    
    if (!uploadRes.ok) throw new Error('Failed to upload video');
    
    res.json({
      success: true,
      id: videoId,
      bunnyId: bunnyVideo.guid,
      url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
      expiresAt: expiresAt.toISOString(),
      originalName: originalNameBase,
      transcodingStatus: 'processing'
    });
  } catch (e) {
    console.error('Upload error:', e);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

// Upload without account (14 days)
app.post('/api/upload-anonymous', uploadLimiter, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file' });
  
  const videoId = crypto.randomBytes(4).toString('hex'); // 8 char ID
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
  
  try {
    const createRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`, {
      method: 'POST',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: videoId })
    });
    
    if (!createRes.ok) throw new Error('Failed to create video');
    const bunnyVideo = await createRes.json();
    
    // Save to database immediately
    const originalNameBase = sanitizeText(path.parse(req.file.originalname).name, 200) || `video-${videoId}`;
    await pool.query(
      `INSERT INTO videos (id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [videoId, bunnyVideo.guid, originalNameBase, req.file.size, expiresAt.toISOString(), 100, '', true]
    );
    
    // Upload file to Bunny
    const fileBuffer = fs.readFileSync(req.file.path);
    const uploadRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: fileBuffer
    });
    
    fs.unlinkSync(req.file.path);
    
    if (!uploadRes.ok) throw new Error('Failed to upload video');
    
    res.json({
      success: true,
      id: videoId,
      bunnyId: bunnyVideo.guid,
      url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
      expiresAt: expiresAt.toISOString(),
      originalName: originalNameBase,
      transcodingStatus: 'processing'
    });
  } catch (e) {
    console.error('Upload anonymous error:', e);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

// Import YouTube URL to Bunny (works signed-in or anonymous)
app.post('/api/upload-youtube', uploadLimiter, async (req, res) => {
  const { url } = req.body || {};
  const normalizedUrl = normalizeYoutubeUrl(url);
  if (!normalizedUrl) {
    return res.status(400).json({ error: 'URL must be a valid YouTube link' });
  }

  let tempFilePath = '';
  try {
    const userId = getUserIdFromAuthHeader(req);
    if (userId) {
      const activeVideoCount = await getActiveUserVideoCount(userId);
      if (activeVideoCount >= USER_UPLOAD_LIMIT) {
        return res.json({
          success: false,
          error: `Upload limit reached. Signed-in accounts include ${USER_UPLOAD_LIMIT} active videos. Delete an old video or buy more uploads when upgrades launch.`
        });
      }
    }
    const videoId = crypto.randomBytes(4).toString('hex');
    const expiresAt = new Date(Date.now() + (userId ? 180 : 14) * 24 * 60 * 60 * 1000);

    const info = await getYoutubeInfo(normalizedUrl);
    const title = sanitizeText(info.title || `youtube-${videoId}`, 200);

    const tmpDir = os.tmpdir();
    const outputTemplate = path.join(tmpDir, `${videoId}-youtube.%(ext)s`);
    await downloadYoutubeVideo(normalizedUrl, outputTemplate);

    tempFilePath = findDownloadedFile(tmpDir, videoId);
    if (!tempFilePath) {
      const files = fs.readdirSync(tmpDir).filter(f => f.includes(videoId));
      throw new Error(`yt-dlp did not create expected file. Temp files found: ${files.join(', ') || 'none'}`);
    }

    const fileStat = fs.statSync(tempFilePath);
    if (!fileStat.size) {
      throw new Error('Downloaded video is empty');
    }

    const createRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`, {
      method: 'POST',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: videoId })
    });
    if (!createRes.ok) throw new Error('Failed to create Bunny video');
    const bunnyVideo = await createRes.json();

    await pool.query(
      `INSERT INTO videos (id, user_id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [videoId, userId, bunnyVideo.guid, title, fileStat.size, expiresAt.toISOString(), 100, '', true]
    );

    const fileStream = fs.createReadStream(tempFilePath);
    const uploadRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: fileStream,
      duplex: 'half'
    });
    if (!uploadRes.ok) {
      const uploadErrorText = await uploadRes.text();
      throw new Error(`Failed to upload Bunny video: ${uploadRes.status} ${uploadErrorText}`);
    }

    res.json({
      id: videoId,
      bunnyId: bunnyVideo.guid,
      url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
      expiresAt: expiresAt.toISOString(),
      originalName: title,
      transcodingStatus: 'processing'
    });
  } catch (e) {
    console.error('YouTube import error:', e);
    const message = getErrorMessage(e, 'Failed to import YouTube video');
    if (message.includes('403') || message.toLowerCase().includes('forbidden')) {
      return res.json({
        success: false,
        error: 'YouTube blocked this import request (403). Try another video, or upload the file directly.'
      });
    }
    if (message.toLowerCase().includes('file is larger than max-filesize')) {
      return res.json({
        success: false,
        error: 'That YouTube video is over the 100MB import limit. Try a shorter video or upload a smaller file directly.'
      });
    }
    return res.json({
      success: false,
      error: `YouTube import failed: ${message}`
    });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
});

// Get video info
app.get('/api/video/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const video = result.rows[0];
    
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (new Date(video.expires_at) < new Date()) return res.status(410).json({ error: 'Video expired' });
    
    // Get transcoding status from Bunny
    // Bunny status codes: 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error
    let transcodingStatus = 0;
    try {
      const statusRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
        headers: { 'AccessKey': BUNNY_API_KEY }
      });
      if (statusRes.ok) {
        const bunnyVideo = await statusRes.json();
        transcodingStatus = bunnyVideo.status !== undefined ? bunnyVideo.status : 4;
      }
    } catch (e) {
      console.error('Failed to get Bunny status:', e);
    }
    
    res.json({
      id: video.id,
      bunnyId: video.bunny_video_id,
      url: `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/playlist.m3u8`,
      embedUrl: `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${video.bunny_video_id}`,
      originalName: video.original_name,
      size: parseInt(video.size),
      expiresAt: video.expires_at,
      createdAt: video.created_at,
      volume: video.volume || 100,
      description: video.description || '',
      autoplay: video.autoplay !== false,
      transcodingStatus
    });
  } catch (e) {
    console.error('Get video error:', e);
    res.status(500).json({ error: 'Failed to get video' });
  }
});

// Get user's videos
app.get('/api/my-videos', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    
    // Verify each video still exists in Bunny, remove stale DB records
    const validVideos = [];
    for (const v of result.rows) {
      try {
        const statusRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${v.bunny_video_id}`, {
          headers: { 'AccessKey': BUNNY_API_KEY }
        });
        if (statusRes.ok) {
          validVideos.push(v);
        } else {
          await pool.query('DELETE FROM videos WHERE id = $1', [v.id]);
        }
      } catch {
        validVideos.push(v);
      }
    }
    
    const videos = validVideos.map(v => ({
      id: v.id,
      bunnyId: v.bunny_video_id,
      url: `https://${BUNNY_CDN_HOST}/${v.bunny_video_id}/playlist.m3u8`,
      originalName: v.original_name,
      size: parseInt(v.size),
      expiresAt: v.expires_at,
      createdAt: v.created_at,
      volume: v.volume || 100,
      description: v.description || '',
      autoplay: v.autoplay !== false
    }));
    res.json(videos);
  } catch (e) {
    console.error('Get my videos error:', e);
    res.status(500).json({ error: 'Failed to get videos' });
  }
});

// Get thumbnail options for a video (signed-up users only)
app.get('/api/video/:id/thumbnails', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM videos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    const video = result.rows[0];
    if (!video) return res.status(404).json({ error: 'Video not found' });

    // Get thumbnail count and duration from Bunny
    const bunnyRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
      headers: { 'AccessKey': BUNNY_API_KEY }
    });
    if (!bunnyRes.ok) return res.status(500).json({ error: 'Failed to get video info' });
    const bunnyVideo = await bunnyRes.json();

    const count = Math.min(bunnyVideo.thumbnailCount || 0, 5);
    const duration = bunnyVideo.length || 0;
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const thumbnails = [];
    for (let i = 1; i <= count; i++) {
      // Map thumbnail index to approximate timestamp in the video
      const time = Math.round((duration / (count + 1)) * i);
      thumbnails.push({
        id: i,
        time,
        url: `${serverUrl}/thumb/${req.params.id}?t=${i}`
      });
    }
    res.json({ thumbnails });
  } catch (e) {
    console.error('Get thumbnails error:', e);
    res.status(500).json({ error: 'Failed to get thumbnails' });
  }
});

// Set thumbnail for a video (signed-up users only)
app.post('/api/video/:id/thumbnail', auth, async (req, res) => {
  try {
    const { time } = req.body;
    const result = await pool.query('SELECT * FROM videos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    const video = result.rows[0];
    if (!video) return res.status(404).json({ error: 'Video not found' });

    // Fetch the specific thumbnail image from CDN
    const thumbFile = `thumbnail_${time}.jpg`;
    const thumbRes = await fetch(`https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/${thumbFile}`, {
      headers: { 'AccessKey': BUNNY_API_KEY, 'Referer': `https://${BUNNY_CDN_HOST}` }
    });
    
    if (!thumbRes.ok) {
      console.error('Failed to fetch thumbnail:', thumbRes.status, thumbFile);
      return res.status(400).json({ error: 'Thumbnail not available' });
    }
    
    const imageBuffer = Buffer.from(await thumbRes.arrayBuffer());
    
    // Upload as custom thumbnail via Set Thumbnail endpoint
    const bunnyRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}/thumbnail`, {
      method: 'POST',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'image/jpeg'
      },
      body: imageBuffer
    });
    if (!bunnyRes.ok) {
      const errText = await bunnyRes.text();
      console.error('Bunny set thumb response:', bunnyRes.status, errText);
      return res.status(500).json({ error: 'Failed to set thumbnail' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Set thumbnail error:', e);
    res.status(500).json({ error: 'Failed to set thumbnail' });
  }
});

// Update video settings (signed-up users only)
app.patch('/api/video/:id/settings', auth, async (req, res) => {
  try {
    const { volume, description, autoplay, originalName } = req.body;

    const hasVolume = volume !== undefined;
    const hasDescription = description !== undefined;
    const hasAutoplay = autoplay !== undefined;
    const hasOriginalName = originalName !== undefined;

    if (!hasVolume && !hasDescription && !hasAutoplay && !hasOriginalName) {
      return res.json({ success: true });
    }

    const normalizedVolume = hasVolume ? Math.max(0, Math.min(100, Number(volume))) : null;
    if (hasVolume && !Number.isFinite(normalizedVolume)) {
      return res.status(400).json({ error: 'Volume must be a number' });
    }

    const normalizedAutoplay = hasAutoplay ? Boolean(autoplay) : null;
    
    const result = await pool.query(
      `UPDATE videos
       SET volume = CASE WHEN $1 THEN $2 ELSE volume END,
           description = CASE WHEN $3 THEN $4 ELSE description END,
           autoplay = CASE WHEN $5 THEN $6 ELSE autoplay END,
           original_name = CASE WHEN $7 THEN $8 ELSE original_name END
       WHERE id = $9 AND user_id = $10`,
      [
        hasVolume,
        normalizedVolume,
        hasDescription,
        hasDescription ? sanitizeText(description, 500) : null,
        hasAutoplay,
        normalizedAutoplay,
        hasOriginalName,
        hasOriginalName ? sanitizeText(originalName, 200) : null,
        req.params.id,
        req.user.id
      ]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error('Update settings error:', e);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Delete video (signed-up users only)
app.delete('/api/video/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Video not found' });
    
    const video = result.rows[0];
    
    // Delete from Bunny.net
    try {
      const deleteRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
        method: 'DELETE',
        headers: { 'AccessKey': BUNNY_API_KEY }
      });
      if (!deleteRes.ok) {
        console.error('Failed to delete from Bunny:', await deleteRes.text());
      }
    } catch (e) {
      console.error('Error deleting from Bunny:', e);
    }
    
    // Remove from database
    await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
    
    res.json({ success: true });
  } catch (e) {
    console.error('Delete video error:', e);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Trim video (signed-up users only)
app.post('/api/video/:id/trim', auth, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const video = result.rows[0];
    const { startTime, endTime } = req.body;
    
    // Delete old video from Bunny
    await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
      method: 'DELETE',
      headers: { 'AccessKey': BUNNY_API_KEY }
    });
    
    // Create new video in Bunny
    const createRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`, {
      method: 'POST',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: video.id + '_trimmed' })
    });
    
    if (!createRes.ok) throw new Error('Failed to create video');
    const bunnyVideo = await createRes.json();
    
    // Upload trimmed video
    const fileBuffer = fs.readFileSync(req.file.path);
    const uploadRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: fileBuffer
    });
    
    fs.unlinkSync(req.file.path);
    
    if (!uploadRes.ok) throw new Error('Failed to upload trimmed video');
    
    // Update video record
    await pool.query(
      `UPDATE videos SET bunny_video_id = $1, size = $2, trimmed = true, trim_start = $3, trim_end = $4 WHERE id = $5`,
      [bunnyVideo.guid, req.file.size, startTime, endTime, video.id]
    );
    
    res.json({
      id: video.id,
      bunnyId: bunnyVideo.guid,
      url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
      originalName: video.original_name
    });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Trim video error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get multiple videos by IDs (for anonymous dashboard)
app.post('/api/videos/batch', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Invalid request' });
  const normalizedIds = normalizeVideoIds(ids, USER_UPLOAD_LIMIT);
  if (normalizedIds.length === 0) return res.json([]);
  
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE id = ANY($1) AND expires_at > NOW()',
      [normalizedIds]
    );
    
    // Verify each video still exists in Bunny, remove stale DB records
    const validVideos = [];
    for (const v of result.rows) {
      try {
        const statusRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${v.bunny_video_id}`, {
          headers: { 'AccessKey': BUNNY_API_KEY }
        });
        if (statusRes.ok) {
          validVideos.push(v);
        } else {
          // Video deleted from Bunny — clean up DB
          await pool.query('DELETE FROM videos WHERE id = $1', [v.id]);
        }
      } catch {
        validVideos.push(v); // Keep on network error to avoid accidental deletion
      }
    }
    
    const videos = validVideos.map(v => ({
      id: v.id,
      bunnyId: v.bunny_video_id,
      url: `https://${BUNNY_CDN_HOST}/${v.bunny_video_id}/playlist.m3u8`,
      originalName: v.original_name,
      size: parseInt(v.size),
      expiresAt: v.expires_at,
      createdAt: v.created_at,
      volume: v.volume || 100,
      description: v.description || '',
      autoplay: v.autoplay !== false
    }));
    
    res.json(videos);
  } catch (e) {
    console.error('Batch videos error:', e);
    res.status(500).json({ error: 'Failed to get videos' });
  }
});

// Delete expired videos background job
setInterval(async () => {
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE expires_at < NOW()'
    );
    
    for (const video of result.rows) {
      try {
        await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`, {
          method: 'DELETE',
          headers: { 'AccessKey': BUNNY_API_KEY }
        });
        await pool.query('DELETE FROM videos WHERE id = $1', [video.id]);
        console.log(`Deleted expired video: ${video.id}`);
      } catch (e) {
        console.error(`Failed to delete video ${video.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Error in expired videos cleanup:', e);
  }
}, 60 * 60 * 1000); // Check every hour

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const staticDir = path.join(__dirname, '../client/dist');
  app.use(express.static(staticDir, {
    index: false,
    setHeaders: (res) => {
      setSpaContentSecurityPolicy(res);
    }
  }));
  app.get('*', (req, res) => {
    const userAgent = req.get('user-agent') || '';
    const isSocialBot = userAgent.includes('Discordbot') || userAgent.includes('Twitterbot');
    if (isSocialBot) {
      const pageUrl = `${FRONTEND_URL}${req.path === '/' ? '' : req.path}`;
      setContentSecurityPolicy(res, {
        'default-src': ["'none'"],
        'base-uri': ["'none'"],
        'img-src': ['https:', 'data:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'none'"],
        'upgrade-insecure-requests': []
      });
      return res.type('html').send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="CUTR">
  <meta property="og:description" content="Just a better Streamable.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="CUTR">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="CUTR">
  <meta name="twitter:description" content="Just a better Streamable.">
</head>
<body></body>
</html>`);
    }
    setSpaContentSecurityPolicy(res);
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

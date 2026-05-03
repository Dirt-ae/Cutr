import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Bunny.net config
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST;

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
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
    
    console.log('Database initialized');
  } catch (e) {
    console.error('Failed to initialize database:', e);
  }
}

initDB();

// Middleware
app.use(cors());
app.use(express.json());

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
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${video.original_name}">
  <meta property="og:description" content="Watch this video on CUTR">
  <meta property="og:type" content="video.other">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${thumbnailUrl}">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="720">
  <meta property="og:video" content="${videoMp4}">
  <meta property="og:video:secure_url" content="${videoMp4}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="1280">
  <meta property="og:video:height" content="720">
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="${video.original_name}">
  <meta name="twitter:description" content="Watch this video on CUTR">
  <meta name="twitter:image" content="${thumbnailUrl}">
  <meta name="twitter:player:stream" content="${videoMp4}">
  <meta name="twitter:player:stream:content_type" content="video/mp4">
  <meta name="twitter:player:width" content="1280">
  <meta name="twitter:player:height" content="720">
  <script>window.location.href = "${pageUrl}";</script>
</head>
<body></body>
</html>`;
      
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
    
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${video.original_name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .player-container { width: 100%; max-width: 1280px; aspect-ratio: 16/9; }
    video { width: 100%; height: 100%; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
  <div class="player-container">
    <video controls autoplay poster="${thumbnailUrl}"></video>
  </div>
  <script>
    const video = document.querySelector('video');
    const videoSrc = '${videoUrl}';
    
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
    
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hashed]
    );
    const user = result.rows[0];
    
    // Claim anonymous videos if provided
    if (claimVideoIds && Array.isArray(claimVideoIds)) {
      await pool.query(
        'UPDATE videos SET user_id = $1, expires_at = $2 WHERE id = ANY($3) AND user_id IS NULL',
        [user.id, new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), claimVideoIds]
      );
    }
    
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email } });
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
    
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/me', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.json(null);
    res.json({ id: user.id, email: user.email, created_at: user.created_at });
  } catch (e) {
    console.error('Get current user error:', e);
    res.status(500).json({ error: 'Failed to get current user' });
  }
});

// Upload video to Bunny.net
app.post('/api/upload', auth, uploadLimiter, upload.single('video'), async (req, res) => {
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
    const originalNameBase = path.parse(req.file.originalname).name;
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
    const originalNameBase = path.parse(req.file.originalname).name;
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
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (volume !== undefined) {
      updates.push(`volume = $${paramCount++}`);
      values.push(Math.max(0, Math.min(100, volume)));
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description.slice(0, 500));
    }
    if (autoplay !== undefined) {
      updates.push(`autoplay = $${paramCount++}`);
      values.push(autoplay);
    }
    if (originalName !== undefined) {
      updates.push(`original_name = $${paramCount++}`);
      values.push(originalName.slice(0, 200));
    }
    
    if (updates.length === 0) {
      return res.json({ success: true });
    }
    
    values.push(req.params.id, req.user.id);
    
    const result = await pool.query(
      `UPDATE videos SET ${updates.join(', ')} WHERE id = $${paramCount++} AND user_id = $${paramCount}`,
      values
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
  
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE id = ANY($1) AND expires_at > NOW()',
      [ids]
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
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

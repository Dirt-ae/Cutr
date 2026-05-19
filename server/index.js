import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile, execFileSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";
import pg from "pg";
import rateLimit from "express-rate-limit";
import youtubeDlExec from "youtube-dl-exec";
import { startBinaryDownloads } from "./ensure-binaries.js";
import { createDiscordService } from "./discordBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const youtubeImportJobs = new Map();

let ffmpegStaticPath = null;
try {
  const ffmpegStatic = await import("ffmpeg-static");
  ffmpegStaticPath = ffmpegStatic.default;
} catch {
  // Optional dependency. Railway/Nixpacks provides ffmpeg through PATH instead.
}

const commandExists = (command, args = ["-version"]) => {
  try {
    execFileSync(command, args, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

const isLikelyPythonScript = (filePath) => {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(128);
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const header = buffer.toString("utf8");
    return header.includes("python") || header.includes("Python");
  } catch {
    return false;
  }
};

const isExecutableFile = (filePath) => {
  if (!filePath || !fs.existsSync(filePath) || isLikelyPythonScript(filePath))
    return false;
  return commandExists(filePath, ["--version"]);
};

const getFfmpegPath = () => {
  const configuredPath = process.env.FFMPEG_PATH?.trim();
  if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;

  const manualFfmpeg = path.join(
    __dirname,
    "bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  if (fs.existsSync(manualFfmpeg)) return manualFfmpeg;

  if (ffmpegStaticPath && fs.existsSync(ffmpegStaticPath))
    return ffmpegStaticPath;

  return commandExists("ffmpeg") ? "ffmpeg" : null;
};

const getFfprobePath = () => {
  const configuredPath = process.env.FFPROBE_PATH?.trim();
  if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;

  const manualFfprobe = path.join(
    __dirname,
    "bin",
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  );
  if (fs.existsSync(manualFfprobe)) return manualFfprobe;

  return commandExists("ffprobe") ? "ffprobe" : null;
};

// Limit concurrent yt-dlp processes to reduce DoS risk.
// (yt-dlp can be CPU/network intensive and may spawn additional work internally.)
const YTDLP_MAX_CONCURRENT_RAW =
  process.env.YTDLP_MAX_CONCURRENT?.trim() || "2";
const YTDLP_MAX_CONCURRENT = Number.parseInt(YTDLP_MAX_CONCURRENT_RAW, 10);
if (
  !/^\d+$/.test(YTDLP_MAX_CONCURRENT_RAW) ||
  YTDLP_MAX_CONCURRENT < 1 ||
  YTDLP_MAX_CONCURRENT > 4
) {
  throw new Error("YTDLP_MAX_CONCURRENT must be an integer between 1 and 4");
}
let ytdlpActive = 0;
const ytdlpQueue = [];
const withYtDlpSlot = async (fn) => {
  if (ytdlpActive >= YTDLP_MAX_CONCURRENT) {
    await new Promise((resolve) => ytdlpQueue.push(resolve));
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
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const [key, ...valParts] = line.split("=");
    const normalizedKey = key?.trim();
    if (
      normalizedKey &&
      valParts.length &&
      process.env[normalizedKey] === undefined
    ) {
      process.env[normalizedKey] = valParts.join("=").trim();
    }
  });
}

const app = express();
app.set("trust proxy", 1);
const PORT =
  process.env.PORT || (process.env.NODE_ENV === "production" ? 8080 : 3001);
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

const getRequiredEnv = (key) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const JWT_SECRET = getRequiredEnv("JWT_SECRET");
const ADMIN_EMAIL = getRequiredEnv("ADMIN_EMAIL");
const ADMIN_PASSWORD = getRequiredEnv("ADMIN_PASSWORD");
const BCRYPT_ROUNDS_RAW = process.env.BCRYPT_ROUNDS?.trim() || "12";
const BCRYPT_ROUNDS = Number.parseInt(BCRYPT_ROUNDS_RAW, 10);

if (
  !/^\d+$/.test(BCRYPT_ROUNDS_RAW) ||
  BCRYPT_ROUNDS < 10 ||
  BCRYPT_ROUNDS > 15
) {
  throw new Error("BCRYPT_ROUNDS must be an integer between 10 and 15");
}

if (
  JWT_SECRET.length < 32 ||
  JWT_SECRET === "replace-with-at-least-32-random-bytes"
) {
  throw new Error(
    "JWT_SECRET must be at least 32 characters and must not use the example value",
  );
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) {
  throw new Error("ADMIN_EMAIL must be a valid email address");
}

const adminPasswordError = getPasswordValidationError(
  ADMIN_PASSWORD,
  ADMIN_EMAIL,
);
if (adminPasswordError) {
  throw new Error(`ADMIN_PASSWORD is not strong enough: ${adminPasswordError}`);
}

// Bunny.net config
const BUNNY_API_KEY = getRequiredEnv("BUNNY_API_KEY");
const BUNNY_LIBRARY_ID = getRequiredEnv("BUNNY_LIBRARY_ID");
const BUNNY_CDN_HOST = getRequiredEnv("BUNNY_CDN_HOST");
const USER_UPLOAD_LIMIT = 5;
const getYtDlpPath = () => {
  const standaloneName =
    process.platform === "win32"
      ? "yt-dlp-standalone.exe"
      : "yt-dlp-standalone";
  const standalonePath = path.join(__dirname, "bin", standaloneName);
  if (isExecutableFile(standalonePath)) {
    return standalonePath;
  }

  if (commandExists("yt-dlp", ["--version"])) {
    return "yt-dlp";
  }

  const p = youtubeDlExec?.constants?.YOUTUBE_DL_PATH;
  if (!isExecutableFile(p)) {
    throw new Error(
      "yt-dlp binary not available. YouTube imports are disabled.",
    );
  }
  return p;
};
const HLS_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js";
const HLS_SCRIPT_INTEGRITY =
  "sha384-5E8B0pTlZZJMabWpC0fyYf6OUpe15jJij34BqBAh4NXoHAlLNOjCPRrwtOXOQFAn";

// Frontend URL for OG tags (Netlify)
const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://cutrr.xyz";
const FRONTEND_ORIGINS = [
  FRONTEND_URL,
  "https://cutrr.xyz",
  "https://www.cutrr.xyz",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.FRONTEND_ORIGINS || "").split(","),
]
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim() || "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim() || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim() || "";
const DISCORD_REDIRECT_URI_OVERRIDE =
  process.env.DISCORD_REDIRECT_URI?.trim() || "";

const getRequestPublicOrigin = (req) => {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  if (forwardedHost) {
    const forwardedProto =
      String(req.headers["x-forwarded-proto"] || "https")
        .split(",")[0]
        .trim() || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }
  return `${req.protocol}://${req.get("host")}`;
};

const getFrontendOrigin = (req) => {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  if (forwardedHost) return getRequestPublicOrigin(req);
  return FRONTEND_URL;
};

const getDiscordRedirectUri = (frontendOrigin = FRONTEND_URL) => {
  const origin = frontendOrigin.replace(/\/+$/, "");
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
    origin,
  );
  if (DISCORD_REDIRECT_URI_OVERRIDE && !isLocalOrigin)
    return DISCORD_REDIRECT_URI_OVERRIDE;
  return `${origin}/api/discord/callback`;
};

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

// PostgreSQL connection
const pool = new pg.Pool({
  connectionString: getRequiredEnv("DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
});

const discordService = createDiscordService(pool, {
  botToken: DISCORD_BOT_TOKEN,
  frontendUrl: FRONTEND_URL,
  bunnyCdnHost: BUNNY_CDN_HOST,
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
    await pool.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false",
    );

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
        is_private BOOLEAN DEFAULT false,
        private_token VARCHAR(64),
        trimmed BOOLEAN DEFAULT false,
        trim_start VARCHAR(20),
        trim_end VARCHAR(20)
      )
    `);

    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_videos_expires_at ON videos(expires_at)",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS private_token VARCHAR(64)",
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS discord_forms (
        id SERIAL PRIMARY KEY,
        owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        slug VARCHAR(80) UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        panel_channel_id VARCHAR(32),
        accepted_role_id VARCHAR(32),
        ping_role_id VARCHAR(32),
        ping_role_ids JSONB DEFAULT '[]'::jsonb,
        reviewer_role_id VARCHAR(32),
        voting_enabled BOOLEAN DEFAULT true,
        accept_emoji VARCHAR(80) DEFAULT '✅',
        deny_emoji VARCHAR(80) DEFAULT '❌',
        reapply_emoji VARCHAR(80) DEFAULT '🔁',
        accept_threshold INTEGER DEFAULT 3,
        deny_threshold INTEGER DEFAULT 3,
        reapply_threshold INTEGER DEFAULT 3,
        deny_cooldown_days INTEGER DEFAULT 30,
        reapply_cooldown_days INTEGER DEFAULT 14,
        questions JSONB DEFAULT '[]'::jsonb,
        is_open BOOLEAN DEFAULT true,
        review_panel JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_forms_owner ON discord_forms(owner_user_id)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_forms_slug ON discord_forms(slug)",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS panel_channel_id VARCHAR(32)",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS reviewer_role_id VARCHAR(32)",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS ping_role_ids JSONB DEFAULT '[]'::jsonb",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS voting_enabled BOOLEAN DEFAULT true",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS panel_message_id VARCHAR(32)",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS requires_video BOOLEAN DEFAULT true",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS require_discord BOOLEAN DEFAULT true",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS success_message TEXT DEFAULT ''",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS open_at TIMESTAMP",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS close_at TIMESTAMP",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS submission_limit INTEGER DEFAULT 0",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS one_submission_per_user BOOLEAN DEFAULT true",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS max_file_size_mb INTEGER DEFAULT 100",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS banner_url TEXT DEFAULT ''",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS accent_color VARCHAR(32) DEFAULT ''",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS anti_spam_cooldown_hours INTEGER DEFAULT 0",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS review_panel JSONB DEFAULT '{}'::jsonb",
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS discord_form_submissions (
        id SERIAL PRIMARY KEY,
        form_id INTEGER REFERENCES discord_forms(id) ON DELETE CASCADE,
        video_id VARCHAR(8) REFERENCES videos(id) ON DELETE SET NULL,
        discord_user_id VARCHAR(32) NOT NULL,
        discord_username VARCHAR(120) DEFAULT '',
        discord_avatar VARCHAR(120) DEFAULT '',
        answers JSONB DEFAULT '[]'::jsonb,
        status VARCHAR(20) DEFAULT 'pending',
        discord_message_id VARCHAR(32),
        cooldown_until TIMESTAMP,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        decided_at TIMESTAMP,
        last_reminder_at TIMESTAMP
      )
    `);
    await pool.query(
      "ALTER TABLE discord_form_submissions ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMP",
    );
    await pool.query(
      "ALTER TABLE discord_form_submissions ADD COLUMN IF NOT EXISTS reviewer_note TEXT DEFAULT ''",
    );
    await pool.query(
      "ALTER TABLE discord_form_submissions ADD COLUMN IF NOT EXISTS discord_avatar VARCHAR(120) DEFAULT ''",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_submissions_form ON discord_form_submissions(form_id)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_submissions_message ON discord_form_submissions(discord_message_id)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_submissions_discord_user ON discord_form_submissions(discord_user_id)",
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS discord_form_cooldowns (
        id SERIAL PRIMARY KEY,
        form_id INTEGER REFERENCES discord_forms(id) ON DELETE CASCADE,
        discord_user_id VARCHAR(32) NOT NULL,
        reason VARCHAR(20) NOT NULL,
        cooldown_until TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS video_reports (
        id SERIAL PRIMARY KEY,
        video_id VARCHAR(8) REFERENCES videos(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        reporter_ip VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_video_reports_video ON video_reports(video_id)",
    );

    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
    await pool.query(
      `INSERT INTO users (email, password, is_admin)
       VALUES ($1, $2, true)
       ON CONFLICT (email)
       DO UPDATE SET password = EXCLUDED.password, is_admin = true`,
      [ADMIN_EMAIL, adminHash],
    );

    console.log("Database initialized");
  } catch (e) {
    console.error("Failed to initialize database:", e);
  }
}

initDB();
startBinaryDownloads(); // non-blocking background download of yt-dlp/ffmpeg binaries
discordService.start().catch((e) => {
  console.error("Discord bot failed to start:", e.message);
});

setInterval(
  () => {
    discordService.sendPendingVoteReminders().catch((e) => {
      console.error("Discord pending vote reminder job failed:", e);
    });
  },
  60 * 60 * 1000,
);

// Middleware
const normalizeOrigin = (value) => {
  if (!value) return "";
  try {
    const parsed = new URL(value.trim());
    return parsed.origin;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
};

const allowedOrigins = [
  ...FRONTEND_ORIGINS,
  process.env.FRONTEND_URL,
]
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // Allow non-browser clients (no Origin header)
    if (!origin) return cb(null, true);
    // If not configured, default to allow all (legacy behavior)
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(normalizeOrigin(origin))) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Discord-Session"],
  maxAge: 86400,
};

// Ensure preflight always gets CORS headers.
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    if (!req.secure && forwardedProto !== "https") {
      return res.status(400).json({ error: "HTTPS required" });
    }
  }
  next();
});

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  message: { error: "Too many requests, please try again later" },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,
  message: { error: "Upload limit reached, try again later" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: "Too many login attempts, try again later" },
});

app.use("/api/", generalLimiter);

// Global error handler
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err.message, err.stack);
  
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 100MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS error: Origin not allowed" });
  }

  const status = err.status || 500;
  res.status(status).json({ 
    error: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
  });
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer for file uploads (temp storage)
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
];
const ALLOWED_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      ALLOWED_VIDEO_TYPES.includes(file.mimetype) &&
      ALLOWED_EXTENSIONS.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only video files allowed (mp4, webm, mov, avi, mkv). Max 100MB.",
        ),
        false,
      );
    }
  },
});

const uploadVideo = (req, res, next) => {
  upload.single("video")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 100MB." });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (req.file?.size > MAX_FILE_SIZE) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(413).json({ error: "File too large. Maximum size is 100MB." });
    }
    next();
  });
};

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

const deleteVideoRecord = async (video) => {
  try {
    const deleteRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
      {
        method: "DELETE",
        headers: { AccessKey: BUNNY_API_KEY },
      },
    );
    if (!deleteRes.ok) {
      console.error("Failed to delete from Bunny:", await deleteRes.text());
    }
  } catch (e) {
    console.error("Error deleting from Bunny:", e);
  }

  await pool.query("DELETE FROM videos WHERE id = $1", [video.id]);
};

const createUniqueVideoId = async (client = pool) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = crypto.randomBytes(4).toString("hex");
    const existing = await client.query("SELECT 1 FROM videos WHERE id = $1", [
      candidate,
    ]);
    if (existing.rowCount === 0) return candidate;
  }
  throw new Error("Failed to generate unique video id");
};

const canAccessVideo = (req, video) =>
  !video.is_private ||
  (video.private_token && req.query.token === video.private_token);

const normalizeYoutubeUrl = (value) => {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;

    const host = parsed.hostname.toLowerCase();
    let videoId = "";

    if (host === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (parsed.pathname === "/watch")
        videoId = parsed.searchParams.get("v") || "";
      if (
        parsed.pathname.startsWith("/shorts/") ||
        parsed.pathname.startsWith("/embed/")
      ) {
        videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
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
      ...options,
    });
    return stdout;
  });
};

const runYtDlpWithProgress = async (args, onProgress, options = {}) => {
  return await withYtDlpSlot(async () => {
    return new Promise((resolve, reject) => {
      const child = spawn(getYtDlpPath(), args, {
        windowsHide: true,
        ...options,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;

        if (onProgress) {
          const lines = chunk.split(/[\r\n]+/);
          for (const line of lines) {
            // yt-dlp progress line example: [download]  10.5% of 100.00MiB at 10.00MiB/s ETA 00:09
            if (line.includes("[download]") && line.includes("%")) {
              const match = line.match(/(\d+\.?\d*)%/);
              if (match) {
                onProgress(parseFloat(match[1]));
              }
            }
          }
        }
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  });
};

const getYoutubeInfo = async (url) => {
  const stdout = await runYtDlp(
    [
      "--no-config",
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      "--",
      url,
    ],
    { timeout: 60 * 1000 },
  );
  try {
    return JSON.parse(stdout);
  } catch (e) {
    const preview = String(stdout || "").slice(0, 500);
    throw new Error(
      `yt-dlp returned invalid JSON: ${getErrorMessage(e)} (stdout preview: ${preview})`,
    );
  }
};

const downloadYoutubeVideo = (
  url,
  outputPath,
  { audioVideoOnly = false, onProgress = null } = {},
) => {
  const currentFfmpegPath = getFfmpegPath();
  const args = [
    "--no-config",
    "--output",
    outputPath,
    "--no-playlist",
    "--no-warnings",
    "--max-filesize",
    "100M",
  ];
  if (currentFfmpegPath) {
    args.push("--ffmpeg-location", currentFfmpegPath);
    // YouTube often stores 1080p as separate video/audio streams, so merge when ffmpeg is available.
    // ALWAYS require audio - never fall back to video-only
    const format =
      "bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080][acodec!=none][vcodec!=none]";
    args.push("--format", format);
    args.push("--merge-output-format", "mp4");
  } else {
    // Fallback: single pre-merged file (no ffmpeg) - MUST have audio
    console.warn(
      "ffmpeg not available; falling back to the best pre-merged YouTube format",
    );
    args.push("--format", "best[height<=1080][acodec!=none][vcodec!=none]");
  }
  args.push("--", url);
  if (onProgress) {
    return runYtDlpWithProgress(args, onProgress, { timeout: 10 * 60 * 1000 });
  }
  return runYtDlp(args, { timeout: 10 * 60 * 1000 });
};

const getMediaStreamSummary = async (filePath) => {
  const ffprobePath = getFfprobePath();
  if (!ffprobePath) return "ffprobe unavailable";

  try {
    const stdout = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,width,height",
        "-of",
        "json",
        filePath,
      ],
      {
        windowsHide: true,
        timeout: 30 * 1000,
        maxBuffer: 1024 * 1024,
      },
    ).then((result) => result.stdout);
    return stdout.trim() || "no streams reported";
  } catch (e) {
    return `ffprobe failed: ${getErrorMessage(e)}`;
  }
};

const hasStreamType = async (filePath, streamType) => {
  const ffprobePath = getFfprobePath();
  if (!ffprobePath) {
    console.warn("ffprobe not available; skipping stream validation");
    return true;
  }

  const stdout = await execFileAsync(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      streamType,
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      filePath,
    ],
    {
      windowsHide: true,
      timeout: 30 * 1000,
      maxBuffer: 1024 * 1024,
    },
  ).then((result) => result.stdout);

  return stdout.trim().length > 0;
};

const hasAudioStream = (filePath) => hasStreamType(filePath, "a");
const hasVideoStream = (filePath) => hasStreamType(filePath, "v");

const mergeSeparateYoutubeStreams = async (tmpDir, videoId) => {
  const currentFfmpegPath = getFfmpegPath();
  if (!currentFfmpegPath) return null;

  const entries = fs
    .readdirSync(tmpDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.startsWith(`${videoId}-youtube`))
    .map((e) => {
      const filePath = path.join(tmpDir, e.name);
      return { path: filePath, name: e.name, size: fs.statSync(filePath).size };
    })
    .filter((file) => file.size > 0)
    .sort((a, b) => b.size - a.size);

  console.log(
    "YouTube temp files:",
    entries.map((file) => `${file.name} (${file.size} bytes)`).join(", "),
  );

  let videoFile = null;
  let audioFile = null;
  for (const entry of entries) {
    const [hasVideo, hasAudio] = await Promise.all([
      hasVideoStream(entry.path),
      hasAudioStream(entry.path),
    ]);
    if (hasVideo && !videoFile) videoFile = entry.path;
    if (hasAudio && !audioFile) audioFile = entry.path;
    if (videoFile && audioFile) break;
  }

  if (!videoFile || !audioFile) return null;
  if (videoFile === audioFile) return videoFile;

  const mergedPath = path.join(tmpDir, `${videoId}-youtube-manual-merge.mp4`);
  await execFileAsync(
    currentFfmpegPath,
    [
      "-y",
      "-i",
      videoFile,
      "-i",
      audioFile,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      mergedPath,
    ],
    {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return mergedPath;
};

const normalizeVideoAudioForUpload = async (filePath, tmpDir, videoId) => {
  const currentFfmpegPath = getFfmpegPath();
  if (!currentFfmpegPath) {
    console.warn("ffmpeg not available; uploading original YouTube file");
    return filePath;
  }

  const normalizedPath = path.join(tmpDir, `${videoId}-youtube-normalized.mp4`);
  await execFileAsync(
    currentFfmpegPath,
    [
      "-y",
      "-i",
      filePath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      normalizedPath,
    ],
    {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return normalizedPath;
};

const findDownloadedFile = (dir, videoId) => {
  try {
    const allowedDownloadedExtensions = new Set([
      ".mp4",
      ".webm",
      ".mkv",
      ".mov",
    ]);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const matches = entries
      .filter((e) => e.isFile() && e.name.startsWith(`${videoId}-youtube.`))
      .map((e) => {
        const filePath = path.join(dir, e.name);
        return {
          name: e.name,
          path: filePath,
          ext: path.extname(e.name).toLowerCase(),
          size: fs.statSync(filePath).size,
        };
      })
      .filter(
        (file) => file.size > 0 && allowedDownloadedExtensions.has(file.ext),
      );
    if (!matches.length) return null;

    matches.sort((a, b) => {
      if (a.ext === ".mp4" && b.ext !== ".mp4") return -1;
      if (b.ext === ".mp4" && a.ext !== ".mp4") return 1;
      return b.size - a.size;
    });
    return matches[0].path;
  } catch {
    return null;
  }
};

const cleanupYoutubeTempFiles = (dir, videoId) => {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(`${videoId}-youtube.`))
        continue;
      fs.rmSync(path.join(dir, entry.name), { force: true });
    }
  } catch (e) {
    console.error("Failed to clean YouTube temp files:", e);
  }
};

const getUserIdFromAuthHeader = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.split(" ")[1];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.id;
  } catch {
    const error = new Error("Invalid token");
    error.statusCode = 401;
    throw error;
  }
};

const getErrorMessage = (error, fallback = "Request failed") => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const getActiveUserVideoCount = async (userId) => {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM videos WHERE user_id = $1 AND expires_at > NOW()",
    [userId],
  );
  return result.rows[0]?.count || 0;
};

const requireUserUploadSlot = async (req, res, next) => {
  try {
    const count = await getActiveUserVideoCount(req.user.id);
    if (count >= USER_UPLOAD_LIMIT) {
      return res.status(403).json({
        error: `Upload limit reached. Signed-in accounts include ${USER_UPLOAD_LIMIT} active videos. Delete an old video or buy more uploads when upgrades launch.`,
      });
    }
    next();
  } catch (e) {
    console.error("Upload slot check error:", e);
    res.status(500).json({ error: "Failed to check upload limit" });
  }
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeJsString = (value = "") => JSON.stringify(String(value));

const sanitizeText = (value, maxLength) => {
  if (value === undefined || value === null) return "";
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  return typeof maxLength === "number" ? cleaned.slice(0, maxLength) : cleaned;
};

const getSafeDownloadName = (value, fallback = "cutr-video") => {
  const base =
    sanitizeText(value, 120)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
      .replace(/\s+/g, " ")
      .trim() || fallback;
  return `${base.replace(/\.+$/g, "") || fallback}.mp4`;
};

const slugify = (value) => {
  const base = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `form-${crypto.randomBytes(3).toString("hex")}`;
};

const normalizeSnowflake = (value, required = false) => {
  const cleaned = sanitizeText(value, 32);
  if (!cleaned) return required ? null : "";
  return /^\d{15,22}$/.test(cleaned) ? cleaned : null;
};

const normalizeQuestions = (questions) => {
  if (!Array.isArray(questions)) return [];
  return questions.slice(0, 20).map((question, index) => {
    const type = ["text", "textarea", "true_false", "select"].includes(
      question?.type,
    )
      ? question.type
      : "text";
    const optionSource = Array.isArray(question?.options)
      ? question.options
      : typeof question?.options === "string"
        ? question.options.split(/,|\n/)
        : [];
    const options = optionSource
      .map((item) => sanitizeText(item, 80))
      .filter(Boolean)
      .slice(0, 8);
    return {
      id: sanitizeText(question?.id, 40) || `q_${index + 1}`,
      label: sanitizeText(question?.label, 140) || `Question ${index + 1}`,
      type,
      required: question?.required !== false,
      options: type === "select" ? options : [],
    };
  });
};

const normalizeFormPayload = (body = {}) => {
  const guildId = normalizeSnowflake(body.guildId, false);
  const channelId = normalizeSnowflake(body.channelId, false);
  const panelChannelId = normalizeSnowflake(body.panelChannelId, false);
  const acceptedRoleId = normalizeSnowflake(body.acceptedRoleId, false);
  const pingRoleId = normalizeSnowflake(body.pingRoleId, false);
  const pingRoleIds = Array.isArray(body.pingRoleIds)
    ? [...new Set(body.pingRoleIds.map((value) => normalizeSnowflake(value, false)).filter(Boolean))].slice(0, 10)
    : pingRoleId
      ? [pingRoleId]
      : [];
  const reviewerRoleId = normalizeSnowflake(body.reviewerRoleId, false);
  const minThreshold = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    return Number.isFinite(parsed)
      ? Math.max(1, Math.min(25, parsed))
      : fallback;
  };
  const cooldownDays = (value, fallback, min = 1) => {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    return Number.isFinite(parsed)
      ? Math.max(min, Math.min(365, parsed))
      : fallback;
  };
  const boundedInt = (value, fallback, min, max) => {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    return Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : fallback;
  };
  const dateValue = (value) => {
    const raw = sanitizeText(value, 80);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  const urlValue = (value) => {
    const raw = sanitizeText(value, 1000);
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  };
  const accentColor = sanitizeText(body.accentColor, 32);
  const reviewPanelDefaults = {
    messageText: "New application for **{{formName}}** submitted by {{applicantName}}.",
    embedTitle: "{{videoTitle}}",
    embedDescription: "[Open submitted video]({{videoUrl}})",
    accentColor: "#ffffff",
    imageUrl: "",
    thumbnailUrl: "",
    thumbnailSource: "custom",
    showLargeImage: false,
    showThumbnail: false,
    footerText: "React to vote: accept, deny, or reapply.",
    showApplicant: true,
    showAnswers: true,
    showVideoLink: true,
  };
  const normalizeReviewPanel = (value) => {
    const source =
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const color = sanitizeText(source.accentColor, 32);
    const imageUrl = urlValue(source.imageUrl);
    const thumbnailUrl = urlValue(source.thumbnailUrl);
    const legacyPlacement = source.imagePlacement;
    const showLargeImage =
      typeof source.showLargeImage === "boolean"
        ? source.showLargeImage
        : legacyPlacement === "image" || (!legacyPlacement && Boolean(imageUrl));
    const showThumbnail =
      typeof source.showThumbnail === "boolean"
        ? source.showThumbnail
        : legacyPlacement === "thumbnail";
    return {
      messageText:
        sanitizeText(source.messageText, 2000) || reviewPanelDefaults.messageText,
      embedTitle:
        sanitizeText(source.embedTitle, 256) || reviewPanelDefaults.embedTitle,
      embedDescription:
        sanitizeText(source.embedDescription, 4096) ||
        reviewPanelDefaults.embedDescription,
      accentColor: /^#[0-9a-f]{6}$/i.test(color)
        ? color
        : reviewPanelDefaults.accentColor,
      imageUrl,
      thumbnailUrl,
      thumbnailSource:
        source.thumbnailSource === "applicant_avatar"
          ? "applicant_avatar"
          : "custom",
      showLargeImage,
      showThumbnail,
      footerText:
        sanitizeText(source.footerText, 2048) || reviewPanelDefaults.footerText,
      showApplicant: source.showApplicant !== false,
      showAnswers: source.showAnswers !== false,
      showVideoLink: source.showVideoLink !== false,
    };
  };

  return {
    name: sanitizeText(body.name, 120),
    slug: slugify(body.slug || body.name),
    description: sanitizeText(body.description, 800),
    guildId,
    channelId,
    panelChannelId,
    acceptedRoleId,
    pingRoleId,
    pingRoleIds,
    reviewerRoleId,
    votingEnabled: body.votingEnabled !== false,
    acceptEmoji: sanitizeText(body.acceptEmoji, 80) || "✅",
    denyEmoji: sanitizeText(body.denyEmoji, 80) || "❌",
    reapplyEmoji: sanitizeText(body.reapplyEmoji, 80) || "🔁",
    acceptThreshold: minThreshold(body.acceptThreshold, 3),
    denyThreshold: minThreshold(body.denyThreshold, 3),
    reapplyThreshold: minThreshold(body.reapplyThreshold, 3),
    denyCooldownDays: cooldownDays(body.denyCooldownDays, 30),
    reapplyCooldownDays: cooldownDays(body.reapplyCooldownDays, 14),
    questions: normalizeQuestions(body.questions),
    isOpen: body.isOpen !== false,
    requiresVideo: true,
    requireDiscord: true,
    successMessage: sanitizeText(body.successMessage, 800),
    openAt: dateValue(body.openAt),
    closeAt: dateValue(body.closeAt),
    submissionLimit: boundedInt(body.submissionLimit, 0, 0, 10000),
    oneSubmissionPerUser: body.oneSubmissionPerUser !== false,
    maxFileSizeMb: boundedInt(body.maxFileSizeMb, 100, 1, 100),
    bannerUrl: urlValue(body.bannerUrl),
    accentColor: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : "",
    antiSpamCooldownHours: boundedInt(
      body.antiSpamCooldownHours,
      0,
      0,
      8760,
    ),
    reviewPanel: normalizeReviewPanel(body.reviewPanel),
  };
};

const mapDiscordForm = (row) => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  name: row.name,
  slug: row.slug,
  description: row.description || "",
  guildId: row.guild_id,
  channelId: row.channel_id,
  panelChannelId: row.panel_channel_id || "",
  acceptedRoleId: row.accepted_role_id || "",
  pingRoleId: row.ping_role_id || "",
  pingRoleIds: Array.isArray(row.ping_role_ids) && row.ping_role_ids.length
    ? row.ping_role_ids
    : row.ping_role_id
      ? [row.ping_role_id]
      : [],
  reviewerRoleId: row.reviewer_role_id || "",
  votingEnabled: row.voting_enabled !== false,
  panelMessageId: row.panel_message_id || "",
  acceptEmoji: row.accept_emoji || "✅",
  denyEmoji: row.deny_emoji || "❌",
  reapplyEmoji: row.reapply_emoji || "🔁",
  acceptThreshold: row.accept_threshold || 3,
  denyThreshold: row.deny_threshold || 3,
  reapplyThreshold: row.reapply_threshold || 3,
  denyCooldownDays: row.deny_cooldown_days || 30,
  reapplyCooldownDays: row.reapply_cooldown_days || 14,
  questions: normalizeQuestions(row.questions),
  isOpen: row.is_open !== false,
  requiresVideo: true,
  requireDiscord: true,
  successMessage: row.success_message || "",
  openAt: row.open_at,
  closeAt: row.close_at,
  submissionLimit: row.submission_limit || 0,
  oneSubmissionPerUser: row.one_submission_per_user !== false,
  maxFileSizeMb: row.max_file_size_mb || 100,
  bannerUrl: row.banner_url || "",
  accentColor: row.accent_color || "",
  antiSpamCooldownHours: row.anti_spam_cooldown_hours || 0,
  reviewPanel:
    row.review_panel && typeof row.review_panel === "object"
      ? normalizeFormPayload({ reviewPanel: row.review_panel }).reviewPanel
      : normalizeFormPayload({}).reviewPanel,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getFormAvailability = (form, submissionCount = 0) => {
  const now = new Date();
  if (form.isOpen === false)
    return { isAcceptingSubmissions: false, closedReason: "This form is closed." };
  if (form.openAt && new Date(form.openAt) > now) {
    return {
      isAcceptingSubmissions: false,
      closedReason: `This form opens ${new Date(form.openAt).toLocaleString()}.`,
    };
  }
  if (form.closeAt && new Date(form.closeAt) <= now) {
    return { isAcceptingSubmissions: false, closedReason: "This form has closed." };
  }
  if (form.submissionLimit > 0 && submissionCount >= form.submissionLimit) {
    return {
      isAcceptingSubmissions: false,
      closedReason: "This form has reached its submission limit.",
    };
  }
  return { isAcceptingSubmissions: true, closedReason: "" };
};

const getDiscordSession = (req) => {
  const raw = sanitizeText(
    req.body?.discordSession || req.headers["x-discord-session"],
    2000,
  );
  if (!raw) return null;
  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    if (!payload?.discordId) return null;
    return {
      discordId: String(payload.discordId),
      username: sanitizeText(payload.username, 120),
      accessToken: payload.accessToken ? String(payload.accessToken) : "",
    };
  } catch {
    return null;
  }
};

const requireDiscordSession = (req, res, next) => {
  const session = getDiscordSession(req);
  if (!session)
    return res.status(401).json({ error: "Connect Discord first." });
  req.discord = session;
  next();
};

const fetchDiscordUserGuilds = async (accessToken) => {
  if (!accessToken) return [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const request = async () => {
    return await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  };

  let res = await request();
  // Discord can occasionally 429/5xx; do one small retry to avoid forcing manual refresh.
  if (res.status === 429 || res.status >= 500) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Math.min(5000, Math.max(250, Number(retryAfterHeader) * 1000))
      : 600;
    await sleep(retryAfterMs);
    res = await request();
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const hint = bodyText ? ` (${bodyText.slice(0, 200)})` : "";
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Discord session expired. Reconnect Discord and try again.",
      );
    }
    if (res.status === 429) {
      let retryAfterSeconds = 1;
      try {
        const parsed = JSON.parse(bodyText || "{}");
        retryAfterSeconds = Number(parsed.retry_after || 1) || 1;
      } catch {}
      const err = new Error(
        `Discord rate limited. Try again in ${retryAfterSeconds.toFixed(1)}s.`,
      );
      err.statusCode = 429;
      err.retryAfterSeconds = retryAfterSeconds;
      throw err;
    }
    const err = new Error(
      `Failed to load Discord servers (Discord API ${res.status})${hint}`,
    );
    err.statusCode = res.status >= 500 ? 502 : 500;
    throw err;
  }

  return await res.json();
};

const getDiscordBotInviteUrl = (guildId = "") => {
  if (!DISCORD_CLIENT_ID) return "";
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", DISCORD_CLIENT_ID);
  url.searchParams.set("permissions", "8");
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("scope", "bot applications.commands");
  if (guildId) {
    url.searchParams.set("guild_id", guildId);
    url.searchParams.set("disable_guild_select", "true");
  }
  return url.toString();
};

const uploadFileToBunny = async ({ file, userId = null, expiresAt, title }) => {
  const videoId = crypto.randomBytes(4).toString("hex");
  let bunnyVideoId = "";
  let savedToDatabase = false;

  try {
    const createRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
      {
        method: "POST",
        headers: {
          AccessKey: BUNNY_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: videoId }),
      },
    );
    if (!createRes.ok) throw new Error("Failed to create video");
    const bunnyVideo = await createRes.json();
    bunnyVideoId = bunnyVideo.guid;

    const originalNameBase =
      sanitizeText(title || path.parse(file.originalname).name, 200) ||
      `video-${videoId}`;
    await pool.query(
      `INSERT INTO videos (id, user_id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        videoId,
        userId,
        bunnyVideoId,
        originalNameBase,
        file.size,
        expiresAt.toISOString(),
        15,
        "",
        true,
      ],
    );
    savedToDatabase = true;

    const fileBuffer = fs.readFileSync(file.path);
    const uploadRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
      {
        method: "PUT",
        headers: {
          AccessKey: BUNNY_API_KEY,
          "Content-Type": "application/octet-stream",
        },
        body: fileBuffer,
      },
    );
    if (!uploadRes.ok) throw new Error("Failed to upload video");

    return {
      id: videoId,
      bunnyId: bunnyVideoId,
      url: `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/playlist.m3u8`,
      thumbnailUrl: `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/thumbnail.jpg`,
      expiresAt: expiresAt.toISOString(),
      originalName: originalNameBase,
      size: file.size,
      transcodingStatus: "processing",
    };
  } catch (e) {
    if (bunnyVideoId && !savedToDatabase) {
      try {
        await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
          {
            method: "DELETE",
            headers: { AccessKey: BUNNY_API_KEY },
          },
        );
      } catch (cleanupError) {
        console.error("Failed to clean failed Bunny upload:", cleanupError);
      }
    }
    throw e;
  } finally {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
};

const isVideoId = (value) =>
  typeof value === "string" && /^[a-f0-9]{8}$/.test(value);

const normalizeVideoIds = (ids, maxCount = USER_UPLOAD_LIMIT) => {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(isVideoId))].slice(0, maxCount);
};

const createCspNonce = () => crypto.randomBytes(16).toString("base64");

const setContentSecurityPolicy = (res, directives) => {
  const value = Object.entries(directives)
    .map(([directive, sources]) =>
      sources.length ? `${directive} ${sources.join(" ")}` : directive,
    )
    .join("; ");
  res.set("Content-Security-Policy", value);
};

const setOgContentSecurityPolicy = (res, nonce) => {
  setContentSecurityPolicy(res, {
    "default-src": ["'none'"],
    "base-uri": ["'none'"],
    "script-src": [`'nonce-${nonce}'`],
    "img-src": ["https:", "data:"],
    "media-src": ["https:"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'none'"],
    "upgrade-insecure-requests": [],
  });
};

const setEmbedContentSecurityPolicy = (res, nonce) => {
  const bunnyCdnSource = BUNNY_CDN_HOST
    ? `https://${BUNNY_CDN_HOST}`
    : "https:";
  setContentSecurityPolicy(res, {
    "default-src": ["'none'"],
    "base-uri": ["'none'"],
    "script-src": [`'nonce-${nonce}'`, "https://cdn.jsdelivr.net"],
    "style-src": [`'nonce-${nonce}'`],
    "img-src": [bunnyCdnSource, "data:"],
    "media-src": [bunnyCdnSource, "blob:"],
    "connect-src": [bunnyCdnSource, "https://cdn.jsdelivr.net"],
    "worker-src": ["blob:"],
    "object-src": ["'none'"],
    "form-action": ["'none'"],
    "upgrade-insecure-requests": [],
  });
};

const setSpaContentSecurityPolicy = (res) => {
  setContentSecurityPolicy(res, {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", "https:"],
    "frame-src": ["'self'", "https://iframe.mediadelivery.net"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "upgrade-insecure-requests": [],
  });
};

const getBunnyMp4Response = async (bunnyVideoId, rangeHeader = "") => {
  const mp4Files = [
    "play_1080p.mp4",
    "play_720p.mp4",
    "play_480p.mp4",
    "play_360p.mp4",
    "play_240p.mp4",
    "play.mp4",
  ];
  for (const fileName of mp4Files) {
    const bunnyRes = await fetch(
      `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/${fileName}`,
      {
        headers: {
          AccessKey: BUNNY_API_KEY,
          Referer: `https://${BUNNY_CDN_HOST}`,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
      },
    );
    if (bunnyRes.ok) {
      return {
        response: bunnyRes,
        width: fileName.includes("1080") ? 1920 : 1280,
        height: fileName.includes("1080") ? 1080 : 720,
      };
    }
  }

  return null;
};

function getPasswordValidationError(password, email = "") {
  if (typeof password !== "string") return "Password is required";
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be no more than ${PASSWORD_MAX_LENGTH} characters`;
  if (/\s/.test(password)) return "Password cannot contain spaces";

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3)
    return "Password must include at least three of: lowercase, uppercase, number, symbol";

  const emailPrefix = String(email).split("@")[0]?.toLowerCase();
  if (
    emailPrefix &&
    emailPrefix.length >= 4 &&
    password.toLowerCase().includes(emailPrefix)
  ) {
    return "Password cannot contain your email name";
  }

  const commonPasswords = new Set([
    "password",
    "password123",
    "qwerty123",
    "letmein123",
    "admin123",
    "welcome123",
    "changeme123",
  ]);
  if (commonPasswords.has(password.toLowerCase()))
    return "Password is too common";

  return null;
}

// Discord Open Graph support - detect Discord user agent
app.get("/:id", async (req, res, next) => {
  const userAgent = req.get("user-agent") || "";
  const isDiscord =
    userAgent.includes("Discordbot") || userAgent.includes("Twitterbot");

  // If it's Discord/Twitter bot and the path is a video ID, serve OG tags
  if (isDiscord && /^[a-f0-9]{8}$/.test(req.params.id)) {
    try {
      const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
        req.params.id,
      ]);
      const video = result.rows[0];

      if (!video) return res.status(404).send("Video not found");
      if (!canAccessVideo(req, video))
        return res.status(404).send("Video not found");
      if (new Date(video.expires_at) < new Date())
        return res.status(410).send("Video expired");

      // Get transcoding status from Bunny
      // Bunny status codes: 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error
      let transcodingStatus = 0;
      let bunnyVideo = null;
      try {
        const statusRes = await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
          {
            headers: { AccessKey: BUNNY_API_KEY },
          },
        );
        if (statusRes.ok) {
          bunnyVideo = await statusRes.json();
          transcodingStatus =
            bunnyVideo.status !== undefined ? bunnyVideo.status : 4;
        }
      } catch (e) {
        console.error("Failed to get Bunny status:", e);
      }

      // Only show embed if video is finished (status 4)
      if (transcodingStatus !== 4) {
        return res.status(503).send("Video still processing");
      }

      const pageUrl = `${getFrontendOrigin(req)}/${video.id}`;
      const serverUrl = getRequestPublicOrigin(req);
      const videoMp4 = `${serverUrl}/video-stream/${video.id}`;
      const thumbnailUrl = `${serverUrl}/thumb/${video.id}`;
      const embedTitle = `${video.original_name || "Video"} | Cutr`;
      const publishedAt = new Date(video.created_at).toISOString();
      const embedWidth = Number(bunnyVideo?.width) || 1920;
      const embedHeight = Number(bunnyVideo?.height) || 1080;
      const cspNonce = createCspNonce();

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${escapeHtml(embedTitle)}">
  <meta property="og:description" content="Watch this video on CUTR">
  <meta property="og:type" content="video">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="Cutr">
  <meta property="og:image" content="${escapeHtml(thumbnailUrl)}">
  <meta property="og:image:width" content="${embedWidth}">
  <meta property="og:image:height" content="${embedHeight}">
  <meta property="og:video" content="${escapeHtml(videoMp4)}">
  <meta property="og:video:secure_url" content="${escapeHtml(videoMp4)}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="${embedWidth}">
  <meta property="og:video:height" content="${embedHeight}">
  <link rel="alternate" type="video/mp4" href="${escapeHtml(videoMp4)}">
  <meta property="article:published_time" content="${escapeHtml(publishedAt)}">
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="${escapeHtml(embedTitle)}">
  <meta name="twitter:description" content="Watch this video on CUTR">
  <meta name="twitter:image" content="${escapeHtml(thumbnailUrl)}">
  <meta name="twitter:player:stream" content="${escapeHtml(videoMp4)}">
  <meta name="twitter:player:stream:content_type" content="video/mp4">
  <meta name="twitter:player:width" content="${embedWidth}">
  <meta name="twitter:player:height" content="${embedHeight}">
  <script nonce="${cspNonce}">window.location.href = ${escapeJsString(pageUrl)};</script>
</head>
<body></body>
</html>`;

      setOgContentSecurityPolicy(res, cspNonce);
      res.set("Content-Type", "text/html");
      res.send(html);
      return;
    } catch (e) {
      console.error("OG error:", e);
    }
  }

  // Otherwise, continue to normal routing
  next();
});

// Video stream proxy - serves Bunny MP4 since CDN requires auth
app.get("/video-stream/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT bunny_video_id, is_private, private_token FROM videos WHERE id = $1",
      [req.params.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).send("Not found");
    if (!canAccessVideo(req, video)) return res.status(404).send("Not found");

    const mp4 = await getBunnyMp4Response(
      video.bunny_video_id,
      req.headers.range || "",
    );
    if (!mp4) return res.status(404).send("Video not available");

    const buffer = Buffer.from(await mp4.response.arrayBuffer());
    const contentRange = mp4.response.headers.get("content-range");
    const acceptRanges = mp4.response.headers.get("accept-ranges");
    res.set("Content-Type", "video/mp4");
    res.set("Content-Length", String(buffer.length));
    if (contentRange) res.set("Content-Range", contentRange);
    res.set("Accept-Ranges", acceptRanges || "bytes");
    res.set("X-Video-Width", String(mp4.width));
    res.set("X-Video-Height", String(mp4.height));
    res.set("Cache-Control", "public, max-age=86400");
    res.status(mp4.response.status === 206 ? 206 : 200).send(buffer);
  } catch (e) {
    console.error("Video stream proxy error:", e);
    res.status(500).send("Error");
  }
});

const sendVideoDownload = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT bunny_video_id, original_name, is_private, private_token FROM videos WHERE id = $1",
      [req.params.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).send("Not found");
    if (!canAccessVideo(req, video)) return res.status(404).send("Not found");

    const mp4 = await getBunnyMp4Response(video.bunny_video_id);
    if (!mp4) return res.status(404).send("Video not available");

    const buffer = Buffer.from(await mp4.response.arrayBuffer());
    const fileName = getSafeDownloadName(video.original_name, req.params.id);
    res.set("Content-Type", "video/mp4");
    res.set("Content-Length", String(buffer.length));
    res.set("Content-Disposition", `attachment; filename="${fileName}"`);
    res.set("Cache-Control", "private, max-age=300");
    res.send(buffer);
  } catch (e) {
    console.error("Video download proxy error:", e);
    res.status(500).send("Error");
  }
};

// Download proxy - returns Bunny MP4 as an attachment.
app.get("/download/:id", sendVideoDownload);
app.get("/api/video/:id/download", sendVideoDownload);

// Thumbnail proxy - serves Bunny thumbnails since CDN requires auth
app.get("/thumb/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT bunny_video_id, is_private, private_token FROM videos WHERE id = $1",
      [req.params.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).send("Not found");
    if (!canAccessVideo(req, video)) return res.status(404).send("Not found");

    // Support ?t=N for specific thumbnail index
    const thumbIndex = req.query.t ? parseInt(req.query.t) : null;
    const thumbFile = thumbIndex
      ? `thumbnail_${thumbIndex}.jpg`
      : "thumbnail.jpg";

    const thumbRes = await fetch(
      `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/${thumbFile}`,
      {
        headers: {
          AccessKey: BUNNY_API_KEY,
          Referer: `https://${BUNNY_CDN_HOST}`,
        },
      },
    );

    if (!thumbRes.ok) {
      // Try the API thumbnail endpoint
      const apiThumbRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}/thumbnail`,
        {
          headers: { AccessKey: BUNNY_API_KEY },
        },
      );
      if (!apiThumbRes.ok)
        return res.status(404).send("Thumbnail not available");
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400");
      const buffer = Buffer.from(await apiThumbRes.arrayBuffer());
      return res.send(buffer);
    }

    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await thumbRes.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    console.error("Thumbnail proxy error:", e);
    res.status(500).send("Error");
  }
});

// Embed player endpoint for Discord/Twitter
app.get("/embed/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = result.rows[0];

    if (!video) return res.status(404).send("Video not found");
    if (!canAccessVideo(req, video))
      return res.status(404).send("Video not found");
    if (new Date(video.expires_at) < new Date())
      return res.status(410).send("Video expired");

    // Get transcoding status from Bunny
    // Bunny status codes: 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error
    let transcodingStatus = 0;
    try {
      const statusRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
        {
          headers: { AccessKey: BUNNY_API_KEY },
        },
      );
      if (statusRes.ok) {
        const bunnyVideo = await statusRes.json();
        transcodingStatus =
          bunnyVideo.status !== undefined ? bunnyVideo.status : 4;
      }
    } catch (e) {
      console.error("Failed to get Bunny status:", e);
    }

    if (transcodingStatus !== 4) {
      return res.status(503).send("Video still processing");
    }

    const videoUrl = `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/playlist.m3u8`;
    const thumbnailUrl = `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/thumbnail.jpg`;
    const autoplay = req.query.autoplay !== "false";
    const volume = Number.parseInt(
      String(req.query.volume || video.volume || 100),
      10,
    );
    const safeVolume = Number.isFinite(volume)
      ? Math.min(100, Math.max(0, volume))
      : 15;
    const cspNonce = createCspNonce();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(video.original_name || "Video")}</title>
  <style nonce="${cspNonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    body { display: flex; align-items: center; justify-content: center; }
    .player-container { width: 100%; height: 100%; background: #000; }
    video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
  </style>
  <script nonce="${cspNonce}" src="${HLS_SCRIPT_URL}" integrity="${HLS_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>
</head>
<body>
  <div class="player-container">
    <video controls ${autoplay ? "autoplay" : ""} playsinline preload="auto" poster="${escapeHtml(thumbnailUrl)}"></video>
  </div>
  <script nonce="${cspNonce}">
    const video = document.querySelector('video');
    const videoSrc = ${escapeJsString(videoUrl)};
    video.volume = ${safeVolume} / 100;
    video.muted = false;

    if (Hls.isSupported()) {
      const hls = new Hls({
        capLevelToPlayerSize: false,
        startLevel: -1
      });
      hls.loadSource(videoSrc);
      hls.attachMedia(video);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () {
        if (hls.audioTracks && hls.audioTracks.length > 0) {
          hls.audioTrack = 0;
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        ${autoplay ? "video.play().catch(function () {});" : ""}
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoSrc;
      ${autoplay ? "video.play().catch(function () {});" : ""}
    }
  </script>
</body>
</html>`;

    setEmbedContentSecurityPolicy(res, cspNonce);
    res.set("Content-Type", "text/html");
    res.send(html);
  } catch (e) {
    console.error("Embed error:", e);
    res.status(500).send("Failed to load embed");
  }
});

// Video Reporting
app.post("/api/videos/:id/report", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.length < 5) {
      return res.status(400).json({ error: "Please provide a valid reason for reporting." });
    }

    // Check if video exists
    const videoRes = await pool.query("SELECT id FROM videos WHERE id = $1", [id]);
    if (videoRes.rows.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    await pool.query(
      "INSERT INTO video_reports (video_id, reason, reporter_ip) VALUES ($1, $2, $3)",
      [id, reason, req.ip]
    );

    res.json({ success: true, message: "Video reported successfully. Thank you for keeping Cutr safe!" });
  } catch (err) {
    console.error("REPORT ERROR:", err);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// Auth Routes

// Register
// Allowed email domains (legit providers only)
const ALLOWED_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
];

app.post("/api/register", authLimiter, async (req, res) => {
  const { email, password, claimVideoIds } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  const passwordError = getPasswordValidationError(password, email);
  if (passwordError) return res.status(400).json({ error: passwordError });

  // Validate email domain
  const emailDomain = email.toLowerCase().split("@")[1];
  if (!emailDomain || !ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
    return res.status(400).json({
      error:
        "Please use a real email provider (Gmail, Outlook, ProtonMail, etc.)",
    });
  }

  try {
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
      [email, hashed],
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
        [normalizedClaimVideoIds, USER_UPLOAD_LIMIT],
      );
      const claimableIds = claimable.rows.map((video) => video.id);
      if (claimableIds.length > 0) {
        await pool.query(
          "UPDATE videos SET user_id = $1, expires_at = $2 WHERE id = ANY($3)",
          [
            user.id,
            new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
            claimableIds,
          ],
        );
      }
    }

    const token = jwt.sign({ id: user.id, email, isAdmin: false }, JWT_SECRET, {
      expiresIn: "30d",
    });
    res.json({ token, user: { id: user.id, email, isAdmin: false } });
  } catch (e) {
    console.error("Register error:", e);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
app.post("/api/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isAdmin = user.is_admin === true;
    const token = jwt.sign({ id: user.id, email, isAdmin }, JWT_SECRET, {
      expiresIn: "30d",
    });
    res.json({ token, user: { id: user.id, email, isAdmin } });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

// Admin login
app.post("/api/admin/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_admin = true",
      [email],
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: true },
      JWT_SECRET,
      { expiresIn: "30d" },
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, isAdmin: true },
    });
  } catch (e) {
    console.error("Admin login error:", e);
    res.status(500).json({ error: "Admin login failed" });
  }
});

// Get current user
app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, is_admin, created_at FROM users WHERE id = $1",
      [req.user.id],
    );
    const user = result.rows[0];
    if (!user) return res.json(null);
    res.json({
      id: user.id,
      email: user.email,
      isAdmin: user.is_admin === true,
      created_at: user.created_at,
    });
  } catch (e) {
    console.error("Get current user error:", e);
    res.status(500).json({ error: "Failed to get current user" });
  }
});

app.get("/api/admin/overview", auth, adminOnly, async (req, res) => {
  try {
    const [statsResult, usersResult, formsResult] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM videos WHERE expires_at > NOW()) AS active_videos,
          (SELECT COUNT(*)::int FROM discord_forms) AS total_forms,
          (
            SELECT COUNT(*)::int
            FROM discord_form_submissions
            WHERE status = 'pending'
          ) AS pending_submissions
      `),
      pool.query(
        `SELECT u.id, u.email, u.is_admin, u.created_at,
                COUNT(v.id)::int AS video_count
         FROM users u
         LEFT JOIN videos v
           ON v.user_id = u.id
          AND v.expires_at > NOW()
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT 6`,
      ),
      pool.query(
        `SELECT f.id, f.name, f.slug, f.is_open, f.created_at,
                owner.email AS owner_email,
                COUNT(s.id)::int AS submission_count,
                COUNT(s.id) FILTER (WHERE s.status = 'pending')::int AS pending_count
         FROM discord_forms f
         LEFT JOIN users owner ON owner.id = f.owner_user_id
         LEFT JOIN discord_form_submissions s ON s.form_id = f.id
         GROUP BY f.id, owner.email
         ORDER BY f.created_at DESC
         LIMIT 6`,
      ),
    ]);

    const stats = statsResult.rows[0] || {
      total_users: 0,
      active_videos: 0,
      total_forms: 0,
      pending_submissions: 0,
    };

    res.json({
      stats: {
        totalUsers: stats.total_users || 0,
        activeVideos: stats.active_videos || 0,
        totalForms: stats.total_forms || 0,
        pendingSubmissions: stats.pending_submissions || 0,
      },
      recentUsers: usersResult.rows.map((row) => ({
        id: row.id,
        email: row.email,
        isAdmin: row.is_admin === true,
        createdAt: row.created_at,
        videoCount: row.video_count || 0,
      })),
      forms: formsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        isOpen: row.is_open !== false,
        createdAt: row.created_at,
        ownerEmail: row.owner_email || "Unknown",
        submissionCount: row.submission_count || 0,
        pendingCount: row.pending_count || 0,
      })),
    });
  } catch (e) {
    console.error("Admin overview error:", e);
    res.status(500).json({ error: "Failed to load admin overview" });
  }
});

app.get("/api/admin/videos", auth, adminOnly, async (req, res) => {
  const search = sanitizeText(req.query.search, 120).trim();
  const type = req.query.type || "all"; // all, registered, anonymous
  const minSize = parseInt(req.query.minSize) || 0;
  const maxSize = parseInt(req.query.maxSize) || 0;
  const sortBy = req.query.sortBy || "newest"; // newest, oldest, largest, smallest

  let sql = `
    SELECT v.*,
           u.email AS owner_email,
           u.created_at AS owner_created_at,
           u.is_admin AS owner_is_admin
    FROM videos v
    LEFT JOIN users u ON u.id = v.user_id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (v.id ILIKE $${params.length} OR COALESCE(v.original_name, '') ILIKE $${params.length} OR COALESCE(u.email, '') ILIKE $${params.length} OR COALESCE(v.description, '') ILIKE $${params.length})`;
  }

  if (type === "registered") {
    sql += " AND v.user_id IS NOT NULL";
  } else if (type === "anonymous") {
    sql += " AND v.user_id IS NULL";
  }

  if (minSize > 0) {
    params.push(minSize * 1024 * 1024);
    sql += ` AND v.size >= $${params.length}`;
  }
  if (maxSize > 0) {
    params.push(maxSize * 1024 * 1024);
    sql += ` AND v.size <= $${params.length}`;
  }

  switch (sortBy) {
    case "oldest":
      sql += " ORDER BY v.created_at ASC";
      break;
    case "largest":
      sql += " ORDER BY v.size DESC";
      break;
    case "smallest":
      sql += " ORDER BY v.size ASC";
      break;
    case "newest":
    default:
      sql += " ORDER BY v.created_at DESC";
      break;
  }

  sql += " LIMIT 100";

  try {
    const result = await pool.query(sql, params);
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        bunnyId: row.bunny_video_id,
        originalName: row.original_name,
        description: row.description || "",
        size: Number.parseInt(row.size, 10) || 0,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        volume: row.volume || 100,
        autoplay: row.autoplay !== false,
        owner: row.user_id
          ? {
              id: row.user_id,
              email: row.owner_email,
              createdAt: row.owner_created_at,
              isAdmin: row.owner_is_admin === true,
            }
          : null,
      })),
    );
  } catch (e) {
    console.error("Admin videos error:", e);
    res.status(500).json({ error: "Failed to load videos" });
  }
});

app.post("/api/admin/videos/bulk-delete", auth, adminOnly, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "No video IDs provided" });
  }

  try {
    // Get bunny IDs first for cleanup
    const result = await pool.query(
      "SELECT id, bunny_video_id FROM videos WHERE id = ANY($1)",
      [ids],
    );
    const videos = result.rows;

    if (videos.length === 0) {
      return res.status(404).json({ error: "No matching videos found" });
    }

    // Delete from Bunny in parallel
    await Promise.allSettled(
      videos.map(async (v) => {
        try {
          await fetch(
            `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${v.bunny_video_id}`,
            {
              method: "DELETE",
              headers: { AccessKey: BUNNY_API_KEY },
            },
          );
        } catch (e) {
          console.error(`Failed to delete bunny video ${v.bunny_video_id}:`, e);
        }
      }),
    );

    // Delete from DB
    await pool.query("DELETE FROM videos WHERE id = ANY($1)", [
      videos.map((v) => v.id),
    ]);

    res.json({
      success: true,
      deletedCount: videos.length,
    });
  } catch (e) {
    console.error("Bulk delete error:", e);
    res.status(500).json({ error: "Bulk deletion failed" });
  }
});

// Admin: Get Reports
app.get("/api/admin/reports", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, v.original_name as video_name, v.bunny_video_id 
      FROM video_reports r
      LEFT JOIN videos v ON r.video_id = v.id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("ADMIN REPORTS ERROR:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

// Admin: Delete Report
app.delete("/api/admin/reports/:id", auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM video_reports WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("ADMIN DELETE REPORT ERROR:", err);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  const search = sanitizeText(req.query.search, 120).trim();
  
  try {
    const query = `
      SELECT u.id, u.email, u.is_admin, u.created_at,
             COUNT(v.id)::int AS video_count,
             SUM(COALESCE(v.size, 0))::bigint AS total_storage
      FROM users u
      LEFT JOIN videos v ON v.user_id = u.id
      WHERE $1 = '' OR u.email ILIKE $2 OR u.id::text ILIKE $2
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 100
    `;
    const result = await pool.query(query, [search, `%${search}%`]);
    res.json(result.rows.map(row => ({
      id: row.id,
      email: row.email,
      isAdmin: row.is_admin === true,
      createdAt: row.created_at,
      videoCount: row.video_count || 0,
      totalStorage: row.total_storage || 0
    })));
  } catch (e) {
    console.error("Admin users error:", e);
    res.status(500).json({ error: "Failed to load users" });
  }
});

app.post("/api/admin/users/:id/toggle-admin", auth, adminOnly, async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot demote yourself" });
  }

  try {
    const result = await pool.query(
      "UPDATE users SET is_admin = NOT is_admin WHERE id = $1 RETURNING is_admin",
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, isAdmin: result.rows[0].is_admin });
  } catch (e) {
    console.error("Toggle admin error:", e);
    res.status(500).json({ error: "Failed to update user role" });
  }
});

app.delete("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete yourself" });
  }

  try {
    // Delete their videos from Bunny first
    const videos = await pool.query("SELECT bunny_video_id FROM videos WHERE user_id = $1", [id]);
    await Promise.allSettled(
      videos.rows.map(v => 
        fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${v.bunny_video_id}`, {
          method: "DELETE",
          headers: { AccessKey: BUNNY_API_KEY }
        })
      )
    );

    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (e) {
    console.error("Delete user error:", e);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

app.get("/api/discord/login-url", (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res
      .status(503)
      .json({ error: "Discord OAuth is not configured on the server." });
  }
  const returnTo = sanitizeText(req.query.returnTo, 300) || "/forms";
  const safeReturnTo =
    returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "/forms";
  const requestedFrontendOrigin = sanitizeText(req.query.frontendOrigin, 300);
  const allowedFrontendOrigins = new Set(FRONTEND_ORIGINS);
  const frontendOrigin = allowedFrontendOrigins.has(requestedFrontendOrigin)
    ? requestedFrontendOrigin
    : FRONTEND_URL.replace(/\/+$/, "");
  const discordRedirectUri = getDiscordRedirectUri(frontendOrigin);
  const state = Buffer.from(
    JSON.stringify({
      returnTo: safeReturnTo,
      frontendOrigin,
      discordRedirectUri,
    }),
  ).toString("base64url");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", discordRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  res.json({ url: url.toString() });
});

app.get("/api/discord/callback", async (req, res) => {
  try {
    const code = sanitizeText(req.query.code, 300);
    const state = sanitizeText(req.query.state, 1000);
    if (!code || !state)
      return res.status(400).send("Missing Discord OAuth code.");

    let returnTo = "/forms";
    let frontendOrigin = FRONTEND_URL.replace(/\/+$/, "");
    let discordRedirectUri = getDiscordRedirectUri(frontendOrigin);
    try {
      const parsedState = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      );
      if (
        typeof parsedState.returnTo === "string" &&
        parsedState.returnTo.startsWith("/") &&
        !parsedState.returnTo.startsWith("//")
      ) {
        returnTo = parsedState.returnTo;
      }
      if (typeof parsedState.frontendOrigin === "string") {
        const allowedFrontendOrigins = new Set(FRONTEND_ORIGINS);
        if (allowedFrontendOrigins.has(parsedState.frontendOrigin)) {
          frontendOrigin = parsedState.frontendOrigin;
        }
      }
      if (typeof parsedState.discordRedirectUri === "string") {
        const expectedRedirectUri = getDiscordRedirectUri(frontendOrigin);
        if (parsedState.discordRedirectUri === expectedRedirectUri) {
          discordRedirectUri = parsedState.discordRedirectUri;
        }
      }
    } catch {}

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const details = await tokenRes.text().catch(() => "");
      console.error("Discord OAuth token exchange failed:", {
        status: tokenRes.status,
        body: details.slice(0, 500),
        redirectUri: discordRedirectUri,
      });
      throw new Error("Discord OAuth token exchange failed");
    }
    const tokenData = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error("Failed to fetch Discord user");
    const discordUser = await userRes.json();
    const username =
      discordUser.global_name || discordUser.username || "Discord user";
    const discordSession = jwt.sign(
      {
        discordId: discordUser.id,
        username,
        avatar: discordUser.avatar,
        accessToken: tokenData.access_token,
      },
      JWT_SECRET,
      { expiresIn: Math.min(Number(tokenData.expires_in || 43200), 43200) },
    );

    const fragment = new URLSearchParams({
      discordSession,
      discordUser: JSON.stringify({
        id: discordUser.id,
        username,
        avatar: discordUser.avatar || null,
      }),
      returnTo,
    }).toString();
    res.redirect(`${frontendOrigin}/discord/callback#${fragment}`);
  } catch (e) {
    console.error("Discord OAuth callback error:", e);
    res
      .status(500)
      .send("Discord login failed. Check the server OAuth settings.");
  }
});

app.get(
  "/api/discord/guilds",
  auth,
  async (req, res) => {
    const session = getDiscordSession(req);
    if (!session) {
      return res.json({
        guilds: [],
        botInviteUrl: getDiscordBotInviteUrl(),
        discordExpired: true,
        error: "Discord connection expired. Connect Discord again.",
      });
    }
    try {
      const userGuilds = await fetchDiscordUserGuilds(session.accessToken);
      const guilds = (
        await discordService.listManageableGuilds(userGuilds)
      ).map((guild) => ({
        ...guild,
        inviteUrl: guild.botPresent ? "" : getDiscordBotInviteUrl(guild.id),
      }));
      res.json({ guilds, botInviteUrl: getDiscordBotInviteUrl() });
    } catch (e) {
      console.error("Discord guild list error:", e);
      if (e.message?.includes("Discord session expired")) {
        return res.json({
          guilds: [],
          botInviteUrl: getDiscordBotInviteUrl(),
          discordExpired: true,
          error: "Discord connection expired. Connect Discord again.",
        });
      }
      if (e.statusCode === 429 && e.retryAfterSeconds) {
        res.setHeader("Retry-After", String(e.retryAfterSeconds));
      }
      res
        .status(e.statusCode || 500)
        .json({ error: e.message || "Failed to load Discord servers" });
    }
  },
);

app.get(
  "/api/discord/guilds/:guildId/setup",
  auth,
  requireDiscordSession,
  async (req, res) => {
    const guildId = normalizeSnowflake(req.params.guildId, true);
    if (!guildId)
      return res.status(400).json({ error: "Invalid Discord server ID" });

    try {
      const userGuilds = await fetchDiscordUserGuilds(req.discord.accessToken);
      const allowedGuilds =
        await discordService.listManageableGuilds(userGuilds);
      const selectedGuild = allowedGuilds.find((guild) => guild.id === guildId);
      if (!selectedGuild) {
        return res.status(403).json({
          error: "You need Manage Server permission for that server.",
        });
      }
      if (!selectedGuild.botPresent) {
        return res.status(409).json({
          error:
            "Invite the Discord bot to this server before choosing channels and roles.",
          inviteUrl: getDiscordBotInviteUrl(guildId),
        });
      }

      const setup = await discordService.getGuildSetup(guildId);
      res.json(setup);
    } catch (e) {
      console.error("Discord guild setup error:", e);
      if (e.statusCode === 429 && e.retryAfterSeconds) {
        res.setHeader("Retry-After", String(e.retryAfterSeconds));
      }
      res
        .status(e.statusCode || 500)
        .json({ error: e.message || "Failed to load Discord server setup" });
    }
  },
);

app.get("/api/forms/mine", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*,
              COUNT(s.id)::int AS submission_count,
              COUNT(s.id) FILTER (WHERE s.status = 'pending')::int AS pending_count
       FROM discord_forms f
       LEFT JOIN discord_form_submissions s ON s.form_id = f.id
       WHERE f.owner_user_id = $1
       GROUP BY f.id
       ORDER BY f.created_at DESC`,
      [req.user.id],
    );
    res.json(
      result.rows.map((row) => ({
        ...mapDiscordForm(row),
        submissionCount: row.submission_count || 0,
        pendingCount: row.pending_count || 0,
      })),
    );
  } catch (e) {
    console.error("Get forms error:", e);
    res.status(500).json({ error: "Failed to load forms" });
  }
});

app.post("/api/forms", auth, async (req, res) => {
  const form = normalizeFormPayload(req.body);
  if (!form.name)
    return res.status(400).json({ error: "Form name is required" });
  if (form.guildId === null)
    return res.status(400).json({ error: "Discord server ID must be valid" });
  if (form.channelId === null)
    return res.status(400).json({ error: "Discord channel ID must be valid" });
  if (form.acceptedRoleId === null)
    return res
      .status(400)
      .json({ error: "Accepted role ID must be a Discord ID" });
  if (form.pingRoleId === null)
    return res.status(400).json({ error: "Ping role ID must be a Discord ID" });
  if (form.reviewerRoleId === null)
    return res
      .status(400)
      .json({ error: "Reviewer role ID must be a Discord ID" });

  try {
    const result = await pool.query(
      `INSERT INTO discord_forms
       (owner_user_id, name, slug, description, guild_id, channel_id, panel_channel_id, accepted_role_id, ping_role_id, reviewer_role_id,
        ping_role_ids, voting_enabled, accept_emoji, deny_emoji, reapply_emoji, accept_threshold, deny_threshold, reapply_threshold,
        deny_cooldown_days, reapply_cooldown_days, questions, is_open, requires_video, require_discord, success_message,
        open_at, close_at, submission_limit, one_submission_per_user, max_file_size_mb, banner_url, accent_color, anti_spam_cooldown_hours, review_panel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
       RETURNING *`,
      [
        req.user.id,
        form.name,
        form.slug,
        form.description,
        form.guildId,
        form.channelId,
        form.panelChannelId || null,
        form.acceptedRoleId || null,
        form.pingRoleId || null,
        form.reviewerRoleId || null,
        JSON.stringify(form.pingRoleIds),
        form.votingEnabled,
        form.acceptEmoji,
        form.denyEmoji,
        form.reapplyEmoji,
        form.acceptThreshold,
        form.denyThreshold,
        form.reapplyThreshold,
        form.denyCooldownDays,
        form.reapplyCooldownDays,
        JSON.stringify(form.questions),
        form.isOpen,
        form.requiresVideo,
        form.requireDiscord,
        form.successMessage,
        form.openAt,
        form.closeAt,
        form.submissionLimit,
        form.oneSubmissionPerUser,
        form.maxFileSizeMb,
        form.bannerUrl,
        form.accentColor,
        form.antiSpamCooldownHours,
        JSON.stringify(form.reviewPanel),
      ],
    );
    res.status(201).json(mapDiscordForm(result.rows[0]));
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "That form link is already taken" });
    console.error("Create form error:", e);
    res.status(500).json({ error: "Failed to create form" });
  }
});

app.patch("/api/forms/:id", auth, async (req, res) => {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(formId))
    return res.status(400).json({ error: "Invalid form ID" });
  const form = normalizeFormPayload(req.body);
  if (!form.name)
    return res.status(400).json({ error: "Form name is required" });
  if (form.guildId === null || form.channelId === null)
    return res
      .status(400)
      .json({ error: "Discord server and channel IDs must be valid" });
  if (form.reviewerRoleId === null)
    return res
      .status(400)
      .json({ error: "Reviewer role ID must be a Discord ID" });

  try {
    const result = await pool.query(
      `UPDATE discord_forms
       SET name = $1, slug = $2, description = $3, guild_id = $4, channel_id = $5, panel_channel_id = $6,
           accepted_role_id = $7, ping_role_id = $8, reviewer_role_id = $9, ping_role_ids = $10, voting_enabled = $11, accept_emoji = $12, deny_emoji = $13, reapply_emoji = $14,
           accept_threshold = $15, deny_threshold = $16, reapply_threshold = $17,
           deny_cooldown_days = $18, reapply_cooldown_days = $19, questions = $20, is_open = $21,
           requires_video = $22, require_discord = $23, success_message = $24, open_at = $25, close_at = $26,
           submission_limit = $27, one_submission_per_user = $28, max_file_size_mb = $29, banner_url = $30,
           accent_color = $31, anti_spam_cooldown_hours = $32, review_panel = $33,
           updated_at = NOW()
       WHERE id = $34 AND owner_user_id = $35
       RETURNING *`,
      [
        form.name,
        form.slug,
        form.description,
        form.guildId,
        form.channelId,
        form.panelChannelId || null,
        form.acceptedRoleId || null,
        form.pingRoleId || null,
        form.reviewerRoleId || null,
        JSON.stringify(form.pingRoleIds),
        form.votingEnabled,
        form.acceptEmoji,
        form.denyEmoji,
        form.reapplyEmoji,
        form.acceptThreshold,
        form.denyThreshold,
        form.reapplyThreshold,
        form.denyCooldownDays,
        form.reapplyCooldownDays,
        JSON.stringify(form.questions),
        form.isOpen,
        form.requiresVideo,
        form.requireDiscord,
        form.successMessage,
        form.openAt,
        form.closeAt,
        form.submissionLimit,
        form.oneSubmissionPerUser,
        form.maxFileSizeMb,
        form.bannerUrl,
        form.accentColor,
        form.antiSpamCooldownHours,
        JSON.stringify(form.reviewPanel),
        formId,
        req.user.id,
      ],
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Form not found" });

    const updatedForm = result.rows[0];
    
    // Auto-update Discord panel message if it exists
    if (updatedForm.panel_message_id && updatedForm.panel_channel_id) {
      try {
        const applicationUrl = `${FRONTEND_URL.replace(/\/+$/, "")}/apply/${updatedForm.slug}`;
        await discordService.updateFormPanelMessage({
          form: updatedForm,
          applicationUrl
        });
      } catch (discordError) {
        console.warn("Failed to auto-update Discord panel message:", discordError.message);
      }
    }

    res.json(mapDiscordForm(updatedForm));
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "That form link is already taken" });
    console.error("Update form error:", e);
    res.status(500).json({ error: "Failed to update form" });
  }
});

app.post("/api/forms/:id/send-link", auth, async (req, res) => {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(formId))
    return res.status(400).json({ error: "Invalid form ID" });

  try {
    const result = await pool.query(
      "SELECT * FROM discord_forms WHERE id = $1 AND owner_user_id = $2",
      [formId, req.user.id],
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "Form not found" });

    const form = mapDiscordForm(row);
    if (!form.channelId)
      return res.status(400).json({
        error: "Choose a Discord channel before sending the application link.",
      });

    const applicationUrl = `${FRONTEND_URL.replace(/\/+$/, "")}/apply/${form.slug}`;
    const messageId = await discordService.sendFormLinkMessage({
      form: row,
      applicationUrl,
    });

    await pool.query(
      "UPDATE discord_forms SET panel_message_id = $1, updated_at = NOW() WHERE id = $2 AND owner_user_id = $3",
      [messageId, formId, req.user.id],
    );

    res.json({ success: true, messageId, applicationUrl });
  } catch (e) {
    console.error("Send form link error:", e);
    res
      .status(500)
      .json({ error: e.message || "Failed to send application link" });
  }
});

app.post("/api/forms/:id/duplicate", auth, async (req, res) => {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(formId))
    return res.status(400).json({ error: "Invalid form ID" });

  try {
    const sourceResult = await pool.query(
      "SELECT * FROM discord_forms WHERE id = $1 AND owner_user_id = $2",
      [formId, req.user.id],
    );
    const source = sourceResult.rows[0];
    if (!source) return res.status(404).json({ error: "Form not found" });

    const copyName = `Copy of ${source.name}`.slice(0, 120);
    const baseSlug = slugify(`${source.slug}-copy`) || slugify(copyName);
    let copySlug = baseSlug;
    for (let index = 2; index < 100; index += 1) {
      const exists = await pool.query("SELECT 1 FROM discord_forms WHERE slug = $1", [
        copySlug,
      ]);
      if (exists.rowCount === 0) break;
      copySlug = `${baseSlug}-${index}`;
    }

    const result = await pool.query(
      `INSERT INTO discord_forms
       (owner_user_id, name, slug, description, guild_id, channel_id, panel_channel_id, accepted_role_id, ping_role_id, reviewer_role_id,
        ping_role_ids, voting_enabled, accept_emoji, deny_emoji, reapply_emoji, accept_threshold, deny_threshold, reapply_threshold,
        deny_cooldown_days, reapply_cooldown_days, questions, is_open, requires_video, require_discord, success_message,
        open_at, close_at, submission_limit, one_submission_per_user, max_file_size_mb, banner_url, accent_color, anti_spam_cooldown_hours, review_panel)
       SELECT owner_user_id, $1, $2, description, guild_id, channel_id, panel_channel_id, accepted_role_id, ping_role_id, reviewer_role_id,
              ping_role_ids, voting_enabled, accept_emoji, deny_emoji, reapply_emoji, accept_threshold, deny_threshold, reapply_threshold,
              deny_cooldown_days, reapply_cooldown_days, questions, false, requires_video, require_discord, success_message,
              open_at, close_at, submission_limit, one_submission_per_user, max_file_size_mb, banner_url, accent_color, anti_spam_cooldown_hours, review_panel
       FROM discord_forms
       WHERE id = $3 AND owner_user_id = $4
       RETURNING *`,
      [copyName, copySlug, formId, req.user.id],
    );

    res.status(201).json(mapDiscordForm(result.rows[0]));
  } catch (e) {
    console.error("Duplicate form error:", e);
    res.status(500).json({ error: "Failed to duplicate form" });
  }
});

app.get("/api/forms/:id/submissions", auth, async (req, res) => {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(formId))
    return res.status(400).json({ error: "Invalid form ID" });

  try {
    const owner = await pool.query(
      "SELECT id FROM discord_forms WHERE id = $1 AND owner_user_id = $2",
      [formId, req.user.id],
    );
    if (owner.rowCount === 0) return res.status(404).json({ error: "Form not found" });

    const result = await pool.query(
      `SELECT s.*, v.original_name, v.bunny_video_id
       FROM discord_form_submissions s
       LEFT JOIN videos v ON v.id = s.video_id
       WHERE s.form_id = $1
       ORDER BY s.submitted_at DESC`,
      [formId],
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        formId: row.form_id,
        videoId: row.video_id || "",
        videoUrl: row.video_id ? `${FRONTEND_URL.replace(/\/+$/, "")}/${row.video_id}` : "",
        originalName: row.original_name || "",
        discordUserId: row.discord_user_id,
        discordUsername: row.discord_username || "",
        answers: Array.isArray(row.answers) ? row.answers : [],
        status: row.status || "pending",
        reviewerNote: row.reviewer_note || "",
        submittedAt: row.submitted_at,
        decidedAt: row.decided_at,
      })),
    );
  } catch (e) {
    console.error("Get submissions error:", e);
    res.status(500).json({ error: "Failed to load submissions" });
  }
});

app.patch("/api/forms/:id/submissions/:submissionId", auth, async (req, res) => {
  const formId = Number.parseInt(req.params.id, 10);
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isInteger(formId) || !Number.isInteger(submissionId))
    return res.status(400).json({ error: "Invalid submission ID" });

  const status = sanitizeText(req.body.status, 20);
  const allowedStatuses = new Set(["pending", "accept", "deny", "reapply"]);
  if (!allowedStatuses.has(status))
    return res.status(400).json({ error: "Invalid decision" });

  try {
    const formResult = await pool.query(
      "SELECT * FROM discord_forms WHERE id = $1 AND owner_user_id = $2",
      [formId, req.user.id],
    );
    const form = mapDiscordForm(formResult.rows[0] || {});
    if (!formResult.rows[0])
      return res.status(404).json({ error: "Form not found" });

    const note = sanitizeText(req.body.reviewerNote, 1000);
    const result = await pool.query(
      `UPDATE discord_form_submissions
       SET status = $1, reviewer_note = $2, decided_at = CASE WHEN $1 = 'pending' THEN NULL ELSE NOW() END
       WHERE id = $3 AND form_id = $4
       RETURNING *`,
      [status, note, submissionId, formId],
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Submission not found" });

    const updated = result.rows[0];
    let roleGranted = false;
    let roleGrantError = "";
    if (status === "accept" && updated.discord_user_id && form.acceptedRoleId) {
      try {
        roleGranted = await discordService.grantAcceptedRole({
          guildId: form.guildId,
          discordUserId: updated.discord_user_id,
          acceptedRoleId: form.acceptedRoleId,
          formName: form.name,
        });
      } catch (error) {
        roleGrantError =
          error?.code === 50013 || error?.status === 403
            ? "Accepted, but Discord could not grant the role. Give the bot Manage Roles and move the bot role above the accepted role."
            : "Accepted, but Discord could not grant the configured role.";
        console.error("Grant accepted role error:", error);
      }
    }

    if (["deny", "reapply"].includes(status) && updated.discord_user_id) {
      const days =
        status === "deny" ? form.denyCooldownDays : form.reapplyCooldownDays;
      await pool.query(
        `INSERT INTO discord_form_cooldowns (form_id, discord_user_id, reason, cooldown_until)
         VALUES ($1, $2, $3, NOW() + ($4::text || ' days')::interval)`,
        [formId, updated.discord_user_id, status, days],
      );
    }

    res.json({
      id: updated.id,
      status: updated.status,
      reviewerNote: updated.reviewer_note || "",
      decidedAt: updated.decided_at,
      roleGranted,
      roleGrantError,
    });
  } catch (e) {
    console.error("Update submission error:", e);
    res.status(500).json({ error: "Failed to update submission" });
  }
});

app.get("/api/forms/:slug", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, COUNT(s.id)::int AS submission_count
       FROM discord_forms f
       LEFT JOIN discord_form_submissions s ON s.form_id = f.id
       WHERE f.slug = $1
       GROUP BY f.id`,
      [slugify(req.params.slug)],
    );
    const form = result.rows[0];
    if (!form) return res.status(404).json({ error: "Form not found" });
    const mappedForm = mapDiscordForm(form);
    const availability = getFormAvailability(
      mappedForm,
      form.submission_count || 0,
    );
    const botReady = mappedForm.guildId
      ? await discordService.isBotInGuild(mappedForm.guildId)
      : discordService.isReady();
    res.json({
      ...mappedForm,
      ...availability,
      submissionCount: form.submission_count || 0,
      botReady,
      discordOAuthReady: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
    });
  } catch (e) {
    console.error("Get public form error:", e);
    res.status(500).json({ error: "Failed to load form" });
  }
});

app.post("/api/forms/:slug/submit", uploadLimiter, async (req, res) => {
  try {
    const formResult = await pool.query(
      `SELECT f.*, COUNT(s.id)::int AS submission_count
       FROM discord_forms f
       LEFT JOIN discord_form_submissions s ON s.form_id = f.id
       WHERE f.slug = $1
       GROUP BY f.id`,
      [slugify(req.params.slug)],
    );
    const formRow = formResult.rows[0];
    if (!formRow)
      return res.status(404).json({ error: "Form not found" });
    const form = mapDiscordForm(formRow);
    const availability = getFormAvailability(
      form,
      formRow.submission_count || 0,
    );
    if (!availability.isAcceptingSubmissions) {
      return res.status(403).json({ error: availability.closedReason });
    }

    if (!form.channelId) {
      return res.status(400).json({
        error:
          "This form does not have a review channel configured. Please contact the form owner.",
      });
    }

    const discordSession = getDiscordSession(req);
    const fallbackDiscordId = normalizeSnowflake(req.body.discordUserId, true);
    const discordUserId =
      discordSession?.discordId ||
      fallbackDiscordId ||
      (form.requireDiscord ? "" : `anon_${crypto.randomBytes(8).toString("hex")}`);
    const discordUsername =
      discordSession?.username ||
      sanitizeText(req.body.discordUsername, 120) ||
      "Anonymous applicant";
    const discordAvatar =
      sanitizeText(discordSession?.avatar, 120) ||
      sanitizeText(req.body.discordAvatar, 120);
    if (form.requireDiscord && !discordUserId)
      return res
        .status(401)
        .json({ error: "Connect Discord before submitting." });

    if (discordUserId) {
      const cooldownResult = await pool.query(
        `SELECT cooldown_until, reason
         FROM discord_form_cooldowns
         WHERE form_id = $1 AND discord_user_id = $2 AND cooldown_until > NOW()
         ORDER BY cooldown_until DESC
         LIMIT 1`,
        [form.id, discordUserId],
      );
      if (cooldownResult.rows[0]) {
        return res.status(429).json({
          error: "You are still on cooldown for this form.",
          cooldownUntil: cooldownResult.rows[0].cooldown_until,
          reason: cooldownResult.rows[0].reason,
        });
      }

      if (form.oneSubmissionPerUser) {
        const duplicateResult = await pool.query(
          "SELECT submitted_at FROM discord_form_submissions WHERE form_id = $1 AND discord_user_id = $2 LIMIT 1",
          [form.id, discordUserId],
        );
        if (duplicateResult.rows[0]) {
          return res.status(409).json({
            error: "You have already submitted this form.",
          });
        }
      }

      if (form.antiSpamCooldownHours > 0) {
        const recentResult = await pool.query(
          `SELECT submitted_at
           FROM discord_form_submissions
           WHERE form_id = $1 AND discord_user_id = $2
             AND submitted_at > NOW() - ($3::text || ' hours')::interval
           LIMIT 1`,
          [form.id, discordUserId, form.antiSpamCooldownHours],
        );
        if (recentResult.rows[0]) {
          return res.status(429).json({
            error: "Please wait before submitting this form again.",
          });
        }
      }
    }

    const rawAnswers = (() => {
      try {
        return JSON.parse(req.body.answers || "[]");
      } catch {
        return [];
      }
    })();
    const answersById = new Map(
      Array.isArray(rawAnswers)
        ? rawAnswers.map((item) => [String(item.id), item.value])
        : [],
    );
    const answers = form.questions.map((question) => ({
      id: question.id,
      label: question.label,
      value: sanitizeText(answersById.get(question.id), 600),
    }));
    const missingRequired = form.questions.find(
      (question) =>
        question.required && !sanitizeText(answersById.get(question.id), 600),
    );
    if (missingRequired)
      return res
        .status(400)
        .json({ error: `Missing answer: ${missingRequired.label}` });

    const videoId = sanitizeText(req.body.videoId, 16);
    if (form.requiresVideo && (!videoId || !/^[a-f0-9]{8}$/.test(videoId))) {
      return res.status(400).json({
        error: "A valid video ID is required. Please upload your video first.",
      });
    }

    let video = null;
    if (videoId) {
      if (!/^[a-f0-9]{8}$/.test(videoId)) {
        return res.status(400).json({ error: "Invalid video ID." });
      }
      const videoResult = await pool.query("SELECT * FROM videos WHERE id = $1", [
        videoId,
      ]);
      const videoRow = videoResult.rows[0];
      if (!videoRow)
        return res
          .status(404)
          .json({ error: "Video not found. Please upload again." });
      if (new Date(videoRow.expires_at) < new Date())
        return res
          .status(410)
          .json({ error: "Video has expired. Please upload again." });

      video = {
        id: videoRow.id,
        bunnyId: videoRow.bunny_video_id,
        url: `https://${BUNNY_CDN_HOST}/${videoRow.bunny_video_id}/playlist.m3u8`,
        thumbnailUrl: `https://${BUNNY_CDN_HOST}/${videoRow.bunny_video_id}/thumbnail.jpg`,
        originalName: videoRow.original_name,
        size: parseInt(videoRow.size),
      };
    }

    const submissionResult = await pool.query(
      `INSERT INTO discord_form_submissions
       (form_id, video_id, discord_user_id, discord_username, discord_avatar, answers)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        form.id,
        video?.id || null,
        discordUserId,
        discordUsername,
        discordAvatar,
        JSON.stringify(answers),
      ],
    );

    try {
      await discordService.sendSubmissionMessage({
        form,
        submission: { ...submissionResult.rows[0], answers },
        video,
      });
    } catch (discordError) {
      console.error("Discord message failed (submission saved):", discordError);
      return res.status(500).json({
        error: `Application saved but Discord notification failed: ${discordError.message}`,
      });
    }

    res.status(201).json({
      success: true,
      video,
      submissionId: submissionResult.rows[0].id,
      successMessage: form.successMessage,
    });
  } catch (e) {
    console.error("Submit form error:", e);
    res
      .status(500)
      .json({ error: e.message || "Failed to submit application" });
  }
});

app.delete("/api/forms/:id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM discord_forms WHERE id = $1 AND owner_user_id = $2 RETURNING id",
      [req.params.id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Form not found or you do not own it" });
    }
    res.json({ success: true });
  } catch (e) {
    console.error("Delete form error:", e);
    res.status(500).json({ error: "Failed to delete form" });
  }
});

// Upload video to Bunny.net
app.post(
  "/api/upload",
  auth,
  uploadLimiter,
  requireUserUploadSlot,
  uploadVideo,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No video file" });

    const videoId = crypto.randomBytes(4).toString("hex"); // 8 char ID
    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // 6 months

    try {
      // Create video entry in Bunny
      const createRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
        {
          method: "POST",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: videoId }),
        },
      );

      if (!createRes.ok) throw new Error("Failed to create video");
      const bunnyVideo = await createRes.json();

      // Save to database immediately with transcoding status
      const originalNameBase =
        sanitizeText(path.parse(req.file.originalname).name, 200) ||
        `video-${videoId}`;
      await pool.query(
        `INSERT INTO videos (id, user_id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          videoId,
          req.user.id,
          bunnyVideo.guid,
          originalNameBase,
          req.file.size,
          expiresAt.toISOString(),
          100,
          "",
          true,
        ],
      );

      // Upload file to Bunny
      const fileBuffer = fs.readFileSync(req.file.path);
      const uploadRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`,
        {
          method: "PUT",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/octet-stream",
          },
          body: fileBuffer,
        },
      );

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      if (!uploadRes.ok) throw new Error("Failed to upload video");

      res.json({
        success: true,
        id: videoId,
        bunnyId: bunnyVideo.guid,
        url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
        expiresAt: expiresAt.toISOString(),
        originalName: originalNameBase,
        transcodingStatus: "processing",
      });
    } catch (e) {
      console.error("Upload error:", e);
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      res.status(500).json({ error: e.message });
    }
  },
);

// Upload without account (14 days)
app.post(
  "/api/upload-anonymous",
  uploadLimiter,
  uploadVideo,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No video file" });

    const videoId = crypto.randomBytes(4).toString("hex"); // 8 char ID
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    try {
      const createRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
        {
          method: "POST",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: videoId }),
        },
      );

      if (!createRes.ok) throw new Error("Failed to create video");
      const bunnyVideo = await createRes.json();

      // Save to database immediately
      const originalNameBase =
        sanitizeText(path.parse(req.file.originalname).name, 200) ||
        `video-${videoId}`;
      await pool.query(
        `INSERT INTO videos (id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          videoId,
          bunnyVideo.guid,
          originalNameBase,
          req.file.size,
          expiresAt.toISOString(),
          100,
          "",
          true,
        ],
      );

      // Upload file to Bunny
      const fileBuffer = fs.readFileSync(req.file.path);
      const uploadRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`,
        {
          method: "PUT",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/octet-stream",
          },
          body: fileBuffer,
        },
      );

      fs.unlinkSync(req.file.path);

      if (!uploadRes.ok) throw new Error("Failed to upload video");

      res.json({
        success: true,
        id: videoId,
        bunnyId: bunnyVideo.guid,
        url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
        expiresAt: expiresAt.toISOString(),
        originalName: originalNameBase,
        transcodingStatus: "processing",
      });
    } catch (e) {
      console.error("Upload anonymous error:", e);
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      res.status(500).json({ error: e.message });
    }
  },
);

// Import YouTube URL to Bunny (works signed-in or anonymous)
app.get("/api/youtube-import-status/:jobId", (req, res) => {
  const job = youtubeImportJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.post("/api/upload-youtube", uploadLimiter, async (req, res) => {
  const { url } = req.body || {};
  const normalizedUrl = normalizeYoutubeUrl(url);
  if (!normalizedUrl) {
    return res.status(400).json({ error: "URL must be a valid YouTube link" });
  }

  const userId = getUserIdFromAuthHeader(req);
  if (userId) {
    const activeVideoCount = await getActiveUserVideoCount(userId);
    if (activeVideoCount >= USER_UPLOAD_LIMIT) {
      return res.json({
        success: false,
        error: `Upload limit reached. Signed-in accounts include ${USER_UPLOAD_LIMIT} active videos. Delete an old video or buy more uploads when upgrades launch.`,
      });
    }
  }

  const jobId = crypto.randomBytes(8).toString("hex");
  youtubeImportJobs.set(jobId, {
    status: "starting",
    progress: 0,
    label: "Starting import...",
  });

  // Background process
  (async () => {
    let tempFilePath = "";
    let tmpDir = "";
    let bunnyVideoId = "";
    let savedToDatabase = false;
    let videoId = "";
    try {
      videoId = crypto.randomBytes(4).toString("hex");
      const expiresAt = new Date(
        Date.now() + (userId ? 180 : 14) * 24 * 60 * 60 * 1000,
      );

      youtubeImportJobs.set(jobId, {
        status: "fetching_info",
        progress: 5,
        label: "Fetching video info...",
      });
      const info = await getYoutubeInfo(normalizedUrl);
      const title = sanitizeText(info.title || `youtube-${videoId}`, 200);

      youtubeImportJobs.set(jobId, {
        status: "downloading",
        progress: 10,
        label: "Starting download...",
      });

      tmpDir = os.tmpdir();
      const outputTemplate = path.join(tmpDir, `${videoId}-youtube.%(ext)s`);
      await downloadYoutubeVideo(normalizedUrl, outputTemplate, {
        onProgress: (p) => {
          youtubeImportJobs.set(jobId, {
            status: "downloading",
            progress: 10 + p * 0.7, // 10% to 80%
            label: `Downloading: ${p.toFixed(1)}%`,
          });
        },
      });

      tempFilePath = findDownloadedFile(tmpDir, videoId);
      if (!tempFilePath) {
        const files = fs.readdirSync(tmpDir).filter((f) => f.includes(videoId));
        throw new Error(
          `yt-dlp did not create expected file. Temp files found: ${files.join(", ") || "none"}`,
        );
      }

      let fileStat = fs.statSync(tempFilePath);
      if (!fileStat.size) {
        throw new Error("Downloaded video is empty");
      }
      if (fileStat.size > MAX_FILE_SIZE) {
        throw new Error(
          "Downloaded video exceeds the 100MB import limit after merging",
        );
      }

      const streamSummary = await getMediaStreamSummary(tempFilePath);
      console.log("YouTube downloaded stream summary:", streamSummary);
      if (!(await hasAudioStream(tempFilePath))) {
        youtubeImportJobs.set(jobId, {
          status: "preparing",
          progress: 80,
          label: "Merging audio...",
        });
        const mergedPath = await mergeSeparateYoutubeStreams(tmpDir, videoId);
        if (!mergedPath) {
          throw new Error(
            "yt-dlp downloaded video-only output and no separate audio file was found to merge.",
          );
        }
        tempFilePath = mergedPath;
        console.log(
          "YouTube manually merged stream summary:",
          await getMediaStreamSummary(tempFilePath),
        );
        if (!(await hasAudioStream(tempFilePath))) {
          throw new Error(
            "Manual YouTube audio merge produced no audio stream.",
          );
        }
        fileStat = fs.statSync(tempFilePath);
      }

      youtubeImportJobs.set(jobId, {
        status: "preparing",
        progress: 80,
        label: "Preparing audio...",
      });
      tempFilePath = await normalizeVideoAudioForUpload(
        tempFilePath,
        tmpDir,
        videoId,
      );
      console.log(
        "YouTube normalized stream summary:",
        await getMediaStreamSummary(tempFilePath),
      );
      if (!(await hasAudioStream(tempFilePath))) {
        throw new Error("Prepared upload file has no audio stream.");
      }
      fileStat = fs.statSync(tempFilePath);
      if (fileStat.size > MAX_FILE_SIZE) {
        throw new Error(
          "Downloaded video exceeds the 100MB import limit after preparing audio",
        );
      }

      youtubeImportJobs.set(jobId, {
        status: "creating",
        progress: 82,
        label: "Creating video...",
      });

      const createRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
        {
          method: "POST",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: videoId }),
        },
      );
      if (!createRes.ok) throw new Error("Failed to create Bunny video");
      const bunnyVideo = await createRes.json();
      bunnyVideoId = bunnyVideo.guid;

      youtubeImportJobs.set(jobId, {
        status: "uploading",
        progress: 85,
        label: "Uploading...",
      });

      const fileStream = fs.createReadStream(tempFilePath);
      const uploadRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
        {
          method: "PUT",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/octet-stream",
          },
          body: fileStream,
          duplex: "half",
        },
      );
      if (!uploadRes.ok) {
        const uploadErrorText = await uploadRes.text();
        throw new Error(
          `Failed to upload Bunny video: ${uploadRes.status} ${uploadErrorText}`,
        );
      }

      await pool.query(
        `INSERT INTO videos (id, user_id, bunny_video_id, original_name, size, expires_at, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          videoId,
          userId,
          bunnyVideoId,
          title,
          fileStat.size,
          expiresAt.toISOString(),
          100,
          "",
          true,
        ],
      );
      savedToDatabase = true;

      // Poll Bunny for transcoding completion
      youtubeImportJobs.set(jobId, {
        status: "transcoding",
        progress: 90,
        label: "Transcoding video...",
      });

      let transcodingComplete = false;
      let pollAttempts = 0;
      const maxPollAttempts = 120; // 2 minutes max (120 * 1 second)

      while (!transcodingComplete && pollAttempts < maxPollAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        pollAttempts++;

        try {
          const statusRes = await fetch(
            `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
            {
              headers: { AccessKey: BUNNY_API_KEY },
            },
          );

          if (statusRes.ok) {
            const bunnyVideo = await statusRes.json();
            const status = bunnyVideo.status; // 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error

            if (status === 4) {
              transcodingComplete = true;
            } else if (status === 5) {
              throw new Error("Bunny transcoding failed");
            } else {
              // Update progress based on status
              const progressMap = { 0: 90, 1: 91, 2: 93, 3: 95, 4: 100 };
              youtubeImportJobs.set(jobId, {
                status: "transcoding",
                progress: progressMap[status] || 90,
                label: "Transcoding video...",
              });
            }
          }
        } catch (pollError) {
          console.error("Error polling Bunny status:", pollError);
          // Continue polling even if one request fails
        }
      }

      youtubeImportJobs.set(jobId, {
        status: "completed",
        progress: 100,
        result: {
          success: true,
          id: videoId,
          bunnyId: bunnyVideoId,
          url: `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/playlist.m3u8`,
          expiresAt: expiresAt.toISOString(),
          originalName: title,
          transcodingStatus: "finished",
        },
      });
      setTimeout(() => youtubeImportJobs.delete(jobId), 3600000);
    } catch (e) {
      console.error("YouTube import error:", e);
      if (bunnyVideoId && !savedToDatabase) {
        try {
          await fetch(
            `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
            {
              method: "DELETE",
              headers: { AccessKey: BUNNY_API_KEY },
            },
          );
        } catch (cleanupError) {
          console.error(
            "Failed to clean failed Bunny YouTube import:",
            cleanupError,
          );
        }
      }
      const message = getErrorMessage(e, "Failed to import YouTube video");
      let errorText = `YouTube import failed: ${message}`;

      if (e.statusCode === 401) {
        errorText = "Your session expired. Please log in again.";
      } else if (
        message.includes("403") ||
        message.toLowerCase().includes("forbidden")
      ) {
        errorText =
          "YouTube blocked this import request (403). Try another video.";
      } else if (
        message.toLowerCase().includes("file is larger than max-filesize") ||
        message.toLowerCase().includes("100mb import limit")
      ) {
        errorText = "That YouTube video is over the 100MB import limit.";
      }

      youtubeImportJobs.set(jobId, {
        status: "failed",
        progress: 0,
        error: errorText,
      });
      setTimeout(() => youtubeImportJobs.delete(jobId), 3600000);
    } finally {
      if (tmpDir && videoId) {
        cleanupYoutubeTempFiles(tmpDir, videoId);
      }
    }
  })();

  res.json({
    success: true,
    jobId,
  });
});

// Get video info
app.get("/api/video/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = result.rows[0];

    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!canAccessVideo(req, video))
      return res.status(404).json({ error: "Video not found" });
    if (new Date(video.expires_at) < new Date())
      return res.status(410).json({ error: "Video expired" });

    // Get transcoding status from Bunny
    // Bunny status codes: 0=created, 1=uploading, 2=processing, 3=transcoding, 4=finished, 5=error
    let transcodingStatus = 0;
    let transcodingStatusUnknown = false;
    try {
      const fetchStatus = async () => {
        return await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
          {
            headers: { AccessKey: BUNNY_API_KEY },
          },
        );
      };

      let statusRes = await fetchStatus();
      if (statusRes.status === 429 || statusRes.status >= 500) {
        const retryAfterHeader = statusRes.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Math.min(5000, Math.max(250, Number(retryAfterHeader) * 1000))
          : 600;
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
        statusRes = await fetchStatus();
      }

      if (statusRes.ok) {
        const bunnyVideo = await statusRes.json();
        transcodingStatus =
          bunnyVideo.status !== undefined ? bunnyVideo.status : 4;
      } else {
        transcodingStatusUnknown = true;
      }
    } catch (e) {
      console.error("Failed to get Bunny status:", e);
      transcodingStatusUnknown = true;
    }

    res.json({
      id: video.id,
      bunnyId: video.bunny_video_id,
      url: `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/playlist.m3u8`,
      embedUrl: `/embed/${video.id}`,
      originalName: video.original_name,
      size: parseInt(video.size),
      expiresAt: video.expires_at,
      createdAt: video.created_at,
      volume: video.volume || 100,
      description: video.description || "",
      autoplay: video.autoplay !== false,
      isPrivate: video.is_private === true,
      transcodingStatus,
      transcodingStatusUnknown,
    });
  } catch (e) {
    console.error("Get video error:", e);
    res.status(500).json({ error: "Failed to get video" });
  }
});

// Get user's videos
app.get("/api/my-videos", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM videos WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id],
    );

    // Verify each video still exists in Bunny, remove stale DB records
    const validVideos = [];
    for (const v of result.rows) {
      try {
        const statusRes = await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${v.bunny_video_id}`,
          {
            headers: { AccessKey: BUNNY_API_KEY },
          },
        );
        if (statusRes.ok) {
          validVideos.push(v);
        } else {
          await pool.query("DELETE FROM videos WHERE id = $1", [v.id]);
        }
      } catch {
        validVideos.push(v);
      }
    }

    const videos = validVideos.map((v) => ({
      id: v.id,
      bunnyId: v.bunny_video_id,
      url: `https://${BUNNY_CDN_HOST}/${v.bunny_video_id}/playlist.m3u8`,
      originalName: v.original_name,
      size: parseInt(v.size),
      expiresAt: v.expires_at,
      createdAt: v.created_at,
      volume: v.volume || 100,
      description: v.description || "",
      autoplay: v.autoplay !== false,
      isPrivate: v.is_private === true,
      privateToken: v.private_token || "",
    }));
    res.json(videos);
  } catch (e) {
    console.error("Get my videos error:", e);
    res.status(500).json({ error: "Failed to get videos" });
  }
});

// Get thumbnail options for a video (signed-up users only)
app.get("/api/video/:id/thumbnails", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM videos WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).json({ error: "Video not found" });

    // Get thumbnail count and duration from Bunny
    const bunnyRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
      {
        headers: { AccessKey: BUNNY_API_KEY },
      },
    );
    if (!bunnyRes.ok)
      return res.status(500).json({ error: "Failed to get video info" });
    const bunnyVideo = await bunnyRes.json();

    const count = Math.min(bunnyVideo.thumbnailCount || 0, 5);
    const duration = bunnyVideo.length || 0;
    const serverUrl = `${req.protocol}://${req.get("host")}`;
    const thumbnails = [];
    for (let i = 1; i <= count; i++) {
      // Map thumbnail index to approximate timestamp in the video
      const time = Math.round((duration / (count + 1)) * i);
      thumbnails.push({
        id: i,
        time,
        url: `${serverUrl}/thumb/${req.params.id}?t=${i}`,
      });
    }
    res.json({ thumbnails });
  } catch (e) {
    console.error("Get thumbnails error:", e);
    res.status(500).json({ error: "Failed to get thumbnails" });
  }
});

// Set thumbnail for a video (signed-up users only)
app.post("/api/video/:id/thumbnail", auth, async (req, res) => {
  try {
    const { time } = req.body;
    const result = await pool.query(
      "SELECT * FROM videos WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).json({ error: "Video not found" });

    // Fetch the specific thumbnail image from CDN
    const thumbFile = `thumbnail_${time}.jpg`;
    const thumbRes = await fetch(
      `https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/${thumbFile}`,
      {
        headers: {
          AccessKey: BUNNY_API_KEY,
          Referer: `https://${BUNNY_CDN_HOST}`,
        },
      },
    );

    if (!thumbRes.ok) {
      console.error("Failed to fetch thumbnail:", thumbRes.status, thumbFile);
      return res.status(400).json({ error: "Thumbnail not available" });
    }

    const imageBuffer = Buffer.from(await thumbRes.arrayBuffer());

    // Upload as custom thumbnail via Set Thumbnail endpoint
    const bunnyRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}/thumbnail`,
      {
        method: "POST",
        headers: {
          AccessKey: BUNNY_API_KEY,
          "Content-Type": "image/jpeg",
        },
        body: imageBuffer,
      },
    );
    if (!bunnyRes.ok) {
      const errText = await bunnyRes.text();
      console.error("Bunny set thumb response:", bunnyRes.status, errText);
      return res.status(500).json({ error: "Failed to set thumbnail" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("Set thumbnail error:", e);
    res.status(500).json({ error: "Failed to set thumbnail" });
  }
});

// Update video settings (signed-up users only)
app.patch("/api/video/:id/settings", auth, async (req, res) => {
  try {
    const { volume, description, autoplay, originalName } = req.body;

    const hasVolume = volume !== undefined;
    const hasDescription = description !== undefined;
    const hasAutoplay = autoplay !== undefined;
    const hasOriginalName = originalName !== undefined;

    if (!hasVolume && !hasDescription && !hasAutoplay && !hasOriginalName) {
      return res.json({ success: true });
    }

    const normalizedVolume = hasVolume
      ? Math.max(0, Math.min(100, Number(volume)))
      : null;
    if (hasVolume && !Number.isFinite(normalizedVolume)) {
      return res.status(400).json({ error: "Volume must be a number" });
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
        req.user.id,
      ],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("Update settings error:", e);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

app.patch("/api/video/:id/privacy", auth, async (req, res) => {
  try {
    const isPrivate = req.body?.isPrivate === true;
    const privateToken = isPrivate
      ? crypto.randomBytes(24).toString("hex")
      : null;
    const result = await pool.query(
      `UPDATE videos
       SET is_private = $1,
           private_token = CASE WHEN $1 THEN COALESCE(private_token, $2) ELSE NULL END
       WHERE id = $3 AND user_id = $4
       RETURNING is_private, private_token`,
      [isPrivate, privateToken, req.params.id, req.user.id],
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Video not found" });
    res.json({
      isPrivate: result.rows[0].is_private === true,
      privateToken: result.rows[0].private_token || "",
    });
  } catch (e) {
    console.error("Update privacy error:", e);
    res.status(500).json({ error: "Failed to update privacy" });
  }
});

app.post("/api/video/:id/reset-link", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM videos WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Video not found" });
    }

    const nextId = await createUniqueVideoId(client);
    await client.query(
      "UPDATE discord_form_submissions SET video_id = $1 WHERE video_id = $2",
      [nextId, req.params.id],
    );
    await client.query(
      "UPDATE video_reports SET video_id = $1 WHERE video_id = $2",
      [nextId, req.params.id],
    );
    await client.query("UPDATE videos SET id = $1 WHERE id = $2", [
      nextId,
      req.params.id,
    ]);
    await client.query("COMMIT");
    res.json({ id: nextId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Reset link error:", e);
    res.status(500).json({ error: "Failed to reset link" });
  } finally {
    client.release();
  }
});

// Delete video (signed-up users only)
app.delete("/api/video/:id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM videos WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Video not found" });

    const video = result.rows[0];
    await deleteVideoRecord(video);

    res.json({ success: true });
  } catch (e) {
    console.error("Delete video error:", e);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

app.delete("/api/admin/video/:id", auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    await deleteVideoRecord(result.rows[0]);
    res.json({ success: true });
  } catch (e) {
    console.error("Admin delete video error:", e);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

// Trim video (signed-up users only)
app.post(
  "/api/video/:id/trim",
  auth,
  uploadVideo,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file provided" });

    try {
      const result = await pool.query(
        "SELECT * FROM videos WHERE id = $1 AND user_id = $2",
        [req.params.id, req.user.id],
      );

      if (result.rows.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: "Video not found" });
      }

      const video = result.rows[0];
      const { startTime, endTime } = req.body;

      // Delete old video from Bunny
      await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
        {
          method: "DELETE",
          headers: { AccessKey: BUNNY_API_KEY },
        },
      );

      // Create new video in Bunny
      const createRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
        {
          method: "POST",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: video.id + "_trimmed" }),
        },
      );

      if (!createRes.ok) throw new Error("Failed to create video");
      const bunnyVideo = await createRes.json();

      // Upload trimmed video
      const fileBuffer = fs.readFileSync(req.file.path);
      const uploadRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`,
        {
          method: "PUT",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/octet-stream",
          },
          body: fileBuffer,
        },
      );

      fs.unlinkSync(req.file.path);

      if (!uploadRes.ok) throw new Error("Failed to upload trimmed video");

      // Update video record
      await pool.query(
        `UPDATE videos SET bunny_video_id = $1, size = $2, trimmed = true, trim_start = $3, trim_end = $4 WHERE id = $5`,
        [bunnyVideo.guid, req.file.size, startTime, endTime, video.id],
      );

      res.json({
        id: video.id,
        bunnyId: bunnyVideo.guid,
        url: `https://${BUNNY_CDN_HOST}/${bunnyVideo.guid}/playlist.m3u8`,
        originalName: video.original_name,
      });
    } catch (e) {
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      console.error("Trim video error:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// Get multiple videos by IDs (for anonymous dashboard)
app.post("/api/videos/batch", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids))
    return res.status(400).json({ error: "Invalid request" });
  const normalizedIds = normalizeVideoIds(ids, USER_UPLOAD_LIMIT);
  if (normalizedIds.length === 0) return res.json([]);

  try {
    const result = await pool.query(
      "SELECT * FROM videos WHERE id = ANY($1) AND expires_at > NOW() AND is_private = false",
      [normalizedIds],
    );

    // Verify each video still exists in Bunny, remove stale DB records
    const validVideos = [];
    for (const v of result.rows) {
      try {
        const statusRes = await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${v.bunny_video_id}`,
          {
            headers: { AccessKey: BUNNY_API_KEY },
          },
        );
        if (statusRes.ok) {
          validVideos.push(v);
        } else {
          // Video deleted from Bunny — clean up DB
          await pool.query("DELETE FROM videos WHERE id = $1", [v.id]);
        }
      } catch {
        validVideos.push(v); // Keep on network error to avoid accidental deletion
      }
    }

    const videos = validVideos.map((v) => ({
      id: v.id,
      bunnyId: v.bunny_video_id,
      url: `https://${BUNNY_CDN_HOST}/${v.bunny_video_id}/playlist.m3u8`,
      originalName: v.original_name,
      size: parseInt(v.size),
      expiresAt: v.expires_at,
      createdAt: v.created_at,
      volume: v.volume || 100,
      description: v.description || "",
      autoplay: v.autoplay !== false,
    }));

    res.json(videos);
  } catch (e) {
    console.error("Batch videos error:", e);
    res.status(500).json({ error: "Failed to get videos" });
  }
});

// Delete expired videos background job
setInterval(
  async () => {
    try {
      const result = await pool.query(
        "SELECT * FROM videos WHERE expires_at < NOW()",
      );

      for (const video of result.rows) {
        try {
          await fetch(
            `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
            {
              method: "DELETE",
              headers: { AccessKey: BUNNY_API_KEY },
            },
          );
          await pool.query("DELETE FROM videos WHERE id = $1", [video.id]);
          console.log(`Deleted expired video: ${video.id}`);
        } catch (e) {
          console.error(`Failed to delete video ${video.id}:`, e.message);
        }
      }
    } catch (e) {
      console.error("Error in expired videos cleanup:", e);
    }
  },
  60 * 60 * 1000,
); // Check every hour

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  const staticDir = path.join(__dirname, "../client/dist");
  const hasStaticClient = fs.existsSync(path.join(staticDir, "index.html"));
  if (hasStaticClient) {
    app.use(
      express.static(staticDir, {
        index: false,
        setHeaders: (res) => {
          setSpaContentSecurityPolicy(res);
        },
      }),
    );
  }
  app.get("*", (req, res) => {
    const userAgent = req.get("user-agent") || "";
    const isSocialBot =
      userAgent.includes("Discordbot") || userAgent.includes("Twitterbot");
    if (isSocialBot) {
      const pageUrl = `${getFrontendOrigin(req)}${req.path === "/" ? "" : req.path}`;
      setContentSecurityPolicy(res, {
        "default-src": ["'none'"],
        "base-uri": ["'none'"],
        "img-src": ["https:", "data:"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'none'"],
        "upgrade-insecure-requests": [],
      });
      return res.type("html").send(`<!DOCTYPE html>
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
    if (!hasStaticClient) {
      return res.json({ ok: true, service: "cutr-server" });
    }
    setSpaContentSecurityPolicy(res);
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

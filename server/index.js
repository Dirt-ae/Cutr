import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import rateLimit from "express-rate-limit";
import { createDiscordService } from "./discordBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const ANONYMOUS_DASHBOARD_LIMIT = 1000;
const DISCORD_SUPPORT_URL =
  process.env.DISCORD_SUPPORT_URL?.trim() || "https://discord.gg/JAbzJX4Jce";
const HLS_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js";
const HLS_SCRIPT_INTEGRITY =
  "sha384-5E8B0pTlZZJMabWpC0fyYf6OUpe15jJij34BqBAh4NXoHAlLNOjCPRrwtOXOQFAn";

const BYETHOST_FRONTEND_URL = "https://cutrr.byethost32.com";

const normalizePublicUrl = (value, fallback = "", preferredHostPattern = null) => {
  const candidates = String(value || "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const orderedCandidates = preferredHostPattern
    ? [
        ...candidates.filter((candidate) => preferredHostPattern.test(candidate)),
        ...candidates.filter((candidate) => !preferredHostPattern.test(candidate)),
      ]
    : candidates;
  for (const candidate of orderedCandidates) {
    try {
      const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
      if (["http:", "https:"].includes(url.protocol) && url.hostname) {
        return url.toString().replace(/\/+$/, "");
      }
    } catch {}
  }
  return fallback;
};

// Frontend URL for app pages.
const CANONICAL_FRONTEND_URL = "https://cutrr.xyz";
const FRONTEND_URL = normalizePublicUrl(
  process.env.FRONTEND_URL,
  CANONICAL_FRONTEND_URL,
  /cutrr\.xyz/i,
);
const DISCORD_EMBED_URL =
  normalizePublicUrl(
    process.env.DISCORD_EMBED_URL ||
      process.env.PUBLIC_API_URL ||
      process.env.API_URL ||
      process.env.BACKEND_URL ||
      process.env.SERVER_URL ||
      process.env.RENDER_EXTERNAL_URL,
    "",
  ) ||
  FRONTEND_URL;
const FRONTEND_ORIGINS = [
  FRONTEND_URL,
  BYETHOST_FRONTEND_URL,
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

app.get("/healthz/db", async (req, res) => {
  try {
    await queryWithRetry("SELECT 1 AS ok");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({
      ok: false,
      database: "unavailable",
      error: error.message || "Database connection failed",
    });
  }
});

// PostgreSQL connection
const getDbPoolConfig = () => {
  const connectionString = getRequiredEnv("DATABASE_URL");
  const sslDisabled = String(process.env.DATABASE_SSL || "").toLowerCase() === "false";
  if (/^postgres(ql)?:\/\/postgres:[^@]+@db\.[^.]+\.supabase\.co/i.test(connectionString)) {
    console.warn(
      "DATABASE_URL uses Supabase direct host db.*.supabase.co, which is IPv6-only. Render needs the IPv4 pooler URL from Supabase Dashboard → Connect → Session pooler.",
    );
  }
  return {
    connectionString,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX || "10", 10),
  };
};

const pool = new pg.Pool(getDbPoolConfig());

const isTransientDbError = (error) =>
  error?.code === "XX000" ||
  /control plane request failed|timeout|terminated unexpectedly|connection/i.test(
    String(error?.message || ""),
  );

const queryWithRetry = async (text, params = [], retries = 1) => {
  try {
    return await pool.query(text, params);
  } catch (error) {
    if (retries > 0 && isTransientDbError(error)) {
      await wait(350);
      return queryWithRetry(text, params, retries - 1);
    }
    throw error;
  }
};

const PUBLIC_VIDEO_URL =
  normalizePublicUrl(process.env.PUBLIC_VIDEO_URL, "") || "https://cutrr.xyz";
const discordService = createDiscordService(pool, {
  botToken: DISCORD_BOT_TOKEN,
  frontendUrl: FRONTEND_URL,
  embedUrl: DISCORD_EMBED_URL,
  bunnyCdnHost: BUNNY_CDN_HOST,
  videoBaseUrl: PUBLIC_VIDEO_URL,
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
        active_video_limit INTEGER DEFAULT 5,
        active_video_unlimited BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false",
    );
    await pool.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_video_limit INTEGER DEFAULT 5",
    );
    await pool.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_video_unlimited BOOLEAN DEFAULT false",
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
        uploaded_at_utc TIMESTAMPTZ,
        upload_timezone VARCHAR(100),
        volume INTEGER DEFAULT 100,
        description TEXT,
        autoplay BOOLEAN DEFAULT true,
        visibility VARCHAR(20) DEFAULT 'public',
        is_private BOOLEAN DEFAULT false,
        private_token VARCHAR(64),
        thumbnail_index INTEGER,
        allow_downloading BOOLEAN DEFAULT true,
        allow_sharing BOOLEAN DEFAULT true,
        domain_privacy BOOLEAN DEFAULT false,
        allowed_domains TEXT DEFAULT '',
        password_protection BOOLEAN DEFAULT false,
        video_password_hash VARCHAR(255),
        allow_time_comments BOOLEAN DEFAULT false,
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
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public'",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS private_token VARCHAR(64)",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_index INTEGER",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS allow_downloading BOOLEAN DEFAULT true",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS allow_sharing BOOLEAN DEFAULT true",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS domain_privacy BOOLEAN DEFAULT false",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS allowed_domains TEXT DEFAULT ''",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS password_protection BOOLEAN DEFAULT false",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_password_hash VARCHAR(255)",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS upload_timezone VARCHAR(100)",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS uploaded_at_utc TIMESTAMPTZ",
    );
    await pool.query(
      "ALTER TABLE videos ADD COLUMN IF NOT EXISTS allow_time_comments BOOLEAN DEFAULT false",
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS video_time_comments (
        id SERIAL PRIMARY KEY,
        video_id VARCHAR(8) REFERENCES videos(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        time_seconds NUMERIC(10, 1) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(
      "ALTER TABLE video_time_comments ALTER COLUMN time_seconds TYPE NUMERIC(10, 1) USING ROUND(time_seconds::numeric, 1)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_video_time_comments_video_time ON video_time_comments(video_id, time_seconds)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_video_time_comments_video_created ON video_time_comments(video_id, created_at)",
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
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS judging_enabled BOOLEAN DEFAULT false",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS judge_role_id VARCHAR(32)",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS judge_role_ids JSONB DEFAULT '[]'::jsonb",
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS judge_count_threshold INTEGER DEFAULT 1",
    );
    // Backfill the multi-role column from any legacy single-role value.
    await pool.query(
      `UPDATE discord_forms
       SET judge_role_ids = jsonb_build_array(judge_role_id)
       WHERE judge_role_id IS NOT NULL AND judge_role_id <> ''
         AND (judge_role_ids IS NULL OR judge_role_ids = '[]'::jsonb)`,
    );
    await pool.query(
      "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS acceptance_threshold NUMERIC(4, 1) DEFAULT 7",
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
      CREATE TABLE IF NOT EXISTS discord_form_scores (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES discord_form_submissions(id) ON DELETE CASCADE,
        form_id INTEGER NOT NULL REFERENCES discord_forms(id) ON DELETE CASCADE,
        judge_discord_id VARCHAR(32) NOT NULL,
        judge_username VARCHAR(120) DEFAULT '',
        concept INTEGER NOT NULL DEFAULT 0,
        individuality INTEGER NOT NULL DEFAULT 0,
        execution INTEGER NOT NULL DEFAULT 0,
        style_implementation INTEGER NOT NULL DEFAULT 0,
        overall INTEGER NOT NULL DEFAULT 0,
        average NUMERIC(4, 2) NOT NULL DEFAULT 0,
        published BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (submission_id, judge_discord_id)
      )
    `);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_scores_submission ON discord_form_scores(submission_id)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discord_scores_form ON discord_form_scores(form_id)",
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        title VARCHAR(140) NOT NULL,
        url TEXT NOT NULL,
        category VARCHAR(80) NOT NULL,
        description TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        is_published BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(
      "ALTER TABLE resources ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0",
    );
    await pool.query(
      "ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_resources_public_order ON resources (category, sort_order, title)",
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
  "video/avi",
  "video/mp4",
  "video/mkv",
  "video/msvideo",
  "video/ogg",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
];
const ALLOWED_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
const isAllowedVideoFile = (file) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext) && ALLOWED_VIDEO_TYPES.includes(mime);
};

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (isAllowedVideoFile(file)) {
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
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ])(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 100MB." });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "Upload failed" });
    }

    req.file =
      req.file ||
      (req.files?.video && req.files.video[0]) ||
      (req.files?.file && req.files.file[0]);

    if (!req.file) {
      return res.status(400).json({ error: "No video file" });
    }

    if (req.file.size > MAX_FILE_SIZE) {
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

const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return next();

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    // Treat invalid tokens as anonymous upload requests.
  }
  next();
};

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

const deleteVideoRecord = async (video) => {
  let bunnyOk = true;
  let bunnyError = null;
  if (video.bunny_video_id) {
    try {
      const deleteRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}`,
        {
          method: "DELETE",
          headers: { AccessKey: BUNNY_API_KEY },
        },
      );
      if (!deleteRes.ok) {
        bunnyOk = false;
        bunnyError = await deleteRes.text().catch(() => `HTTP ${deleteRes.status}`);
        console.error(`Failed to delete bunny video ${video.bunny_video_id}:`, bunnyError);
      }
    } catch (e) {
      bunnyOk = false;
      bunnyError = e.message;
      console.error("Error deleting from Bunny:", e);
    }
  }
  await pool.query("DELETE FROM videos WHERE id = $1", [video.id]);
  return { bunnyOk, bunnyError };
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

const getOptionalRequestUserId = (req) => {
  const authHeader = req.headers.authorization || "";
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token && req.query.authToken) token = String(req.query.authToken);
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET).id || null;
  } catch {
    return null;
  }
};

const isVideoOwnerRequest = (req, video) =>
  Boolean(video?.user_id && getOptionalRequestUserId(req) === video.user_id);

const canAccessVideo = (req, video) =>
  isVideoOwnerRequest(req, video) ||
  !video.is_private ||
  (video.private_token && req.query.token === video.private_token);

const getRequestDomain = (value = "") => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const canEmbedVideo = (req, video) => {
  if (!video.domain_privacy) return true;
  const domains = String(video.allowed_domains || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, ""))
    .filter(Boolean);
  if (!domains.length) return false;
  const requestDomain =
    getRequestDomain(req.get("origin")) || getRequestDomain(req.get("referer"));
  return domains.some(
    (domain) => requestDomain === domain || requestDomain.endsWith(`.${domain}`),
  );
};

const isFrontendRequest = (req) => {
  const requestDomain =
    getRequestDomain(req.get("origin")) || getRequestDomain(req.get("referer"));
  if (!requestDomain) return false;
  return FRONTEND_ORIGINS.some((origin) => {
    const frontendDomain = getRequestDomain(origin);
    return requestDomain === frontendDomain || requestDomain.endsWith(`.${frontendDomain}`);
  });
};

const canServeDomainRestrictedMedia = (req, video) =>
  !video?.domain_privacy ||
  isVideoOwnerRequest(req, video) ||
  isFrontendRequest(req) ||
  canEmbedVideo(req, video);

const hasValidVideoPassword = async (req, video, options = {}) => {
  if (!video.password_protection) return true;
  if (options.allowOwner === true && isVideoOwnerRequest(req, video)) return true;
  if (!video.video_password_hash) return false;
  const password = String(req.query.password || req.get("x-video-password") || "");
  if (!password) return false;
  return bcrypt.compare(password, video.video_password_hash);
};

const parseTimeSeconds = (value, maxSeconds = 24 * 60 * 60) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(0, Math.min(maxSeconds, Math.round(parsed * 10) / 10));
  return clamped;
};

const requireVideoAccess = async (req, res, video) => {
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return false;
  }
  if (!canAccessVideo(req, video)) {
    res.status(404).json({ error: "Video not found" });
    return false;
  }
  if (!(await hasValidVideoPassword(req, video))) {
    res.status(401).json({ error: "Password required" });
    return false;
  }
  if (new Date(video.expires_at) < new Date()) {
    res.status(410).json({ error: "Video expired" });
    return false;
  }
  return true;
};

const getVideoAccessParams = (video, extraParams = {}) => {
  const params = new URLSearchParams();
  if (video?.is_private && video?.private_token) {
    params.set("token", video.private_token);
  }
  if (extraParams.hlsAccessToken) {
    params.set("hlsToken", extraParams.hlsAccessToken);
  }
  if (extraParams.password) {
    params.set("password", extraParams.password);
  }
  return params;
};

const buildVideoAccessSuffix = (video, extraParams = {}) => {
  const query = getVideoAccessParams(video, extraParams).toString();
  return query ? `?${query}` : "";
};

const createHlsAccessToken = (req, video) => {
  if (!isVideoOwnerRequest(req, video)) return "";
  return jwt.sign({ videoId: video.id, scope: "hls" }, JWT_SECRET, { expiresIn: "2h" });
};

const hasValidHlsAccessToken = (req, video) => {
  const token = String(req.query.hlsToken || "");
  if (!token || !video?.id) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload?.scope === "hls" && payload?.videoId === video.id;
  } catch {
    return false;
  }
};

const getHlsPlaybackUrl = (req, video, extraParams = {}) =>
  `${getRequestPublicOrigin(req)}/hls/${video.id}/playlist.m3u8${buildVideoAccessSuffix(
    video,
    {
      ...extraParams,
      hlsAccessToken: extraParams.hlsAccessToken || createHlsAccessToken(req, video),
    },
  )}`;
const getOriginalPlaybackUrl = (req, video, extraParams = {}) =>
  `${getRequestPublicOrigin(req)}/video-stream/${video.id}${buildVideoAccessSuffix(video, extraParams)}`;

const serializeVideoResponse = (req, video, options = {}) => {
  const uploadedAtUtc = getVideoUploadedAt(video);
  const isOwner = isVideoOwnerRequest(req, video);
  return {
    id: video.id,
    bunnyId: video.bunny_video_id,
    url: getHlsPlaybackUrl(req, video, options),
    originalUrl: getOriginalPlaybackUrl(req, video, options),
    embedUrl: `/embed/${video.id}`,
    thumbnailUrl: `${getRequestPublicOrigin(req)}/thumb/${video.id}${buildVideoAccessSuffix(
      video,
      options,
    )}`,
    originalName: video.original_name,
    size: parseInt(video.size),
    expiresAt: serializeDbTimestamp(video.expires_at),
    createdAt: uploadedAtUtc,
    uploadedAtUtc,
    uploadTimezone: video.upload_timezone || null,
    uploadTimestamp: formatUploadTimestamp(uploadedAtUtc, video.upload_timezone),
    volume: video.volume || 100,
    description: video.description || "",
    autoplay: video.autoplay !== false,
    visibility: video.is_private === true ? "private" : video.visibility || "public",
    isPrivate: video.is_private === true,
    isOwner,
    privateToken: video.private_token || "",
    thumbnailIndex: video.thumbnail_index || null,
    allowDownloading: video.allow_downloading !== false,
    allowSharing: video.allow_sharing !== false,
    domainPrivacy: video.domain_privacy === true,
    allowedDomains: video.allowed_domains || "",
    passwordProtection: video.password_protection === true,
    allowTimeComments: video.allow_time_comments === true,
  };
};

const getBunnyHlsAssetUrl = (bunnyVideoId, assetPath = "playlist.m3u8") => {
  const safeAssetPath = String(assetPath || "playlist.m3u8")
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/${safeAssetPath}`;
};

const getHlsAccessErrorStatus = async (req, video) => {
  if (!video) return 404;
  if (hasValidHlsAccessToken(req, video)) {
    if (new Date(video.expires_at) < new Date()) return 410;
    if (!(await hasValidVideoPassword(req, video))) return 401;
    if (!canServeDomainRestrictedMedia(req, video)) return 403;
    return 0;
  }
  if (!canAccessVideo(req, video)) return 404;
  if (!(await hasValidVideoPassword(req, video))) return 401;
  if (new Date(video.expires_at) < new Date()) return 410;
  if (!canServeDomainRestrictedMedia(req, video)) return 403;
  return 0;
};

const buildProxiedHlsAssetUrl = (req, video, assetUrl) => {
  const parsedAssetUrl = new URL(assetUrl, getBunnyHlsAssetUrl(video.bunny_video_id));
  let assetPath = parsedAssetUrl.pathname.replace(/^\/+/, "");
  const videoPrefix = `${video.bunny_video_id}/`;
  if (assetPath.startsWith(videoPrefix)) assetPath = assetPath.slice(videoPrefix.length);

  const proxyParams = getVideoAccessParams(video, {
    hlsAccessToken: req.query.hlsToken,
    password: req.query.password,
  });
  parsedAssetUrl.searchParams.forEach((value, key) => proxyParams.append(key, value));
  const query = proxyParams.toString();
  return `${getRequestPublicOrigin(req)}/hls/${video.id}/${assetPath}${query ? `?${query}` : ""}`;
};

const rewriteHlsPlaylist = (req, video, playlistText, assetPath = "playlist.m3u8") => {
  const baseUrl = getBunnyHlsAssetUrl(
    video.bunny_video_id,
    assetPath.includes("/") ? assetPath.slice(0, assetPath.lastIndexOf("/") + 1) : "",
  );
  const rewriteUri = (value) =>
    buildProxiedHlsAssetUrl(req, video, new URL(value, baseUrl).toString());
  const rewrittenLines = String(playlistText || "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewriteUri(uri)}"`);
      }
      return rewriteUri(trimmed);
    });

  return rewrittenLines.join("\n");
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
  const result = await queryWithRetry(
    "SELECT COUNT(*)::int AS count FROM videos WHERE user_id = $1 AND expires_at > NOW()",
    [userId],
  );
  return result.rows[0]?.count || 0;
};

const normalizeActiveVideoLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return USER_UPLOAD_LIMIT;
  return Math.min(Math.max(parsed, 1), 10000);
};

const getUserUploadAllowance = async (userId) => {
  const result = await queryWithRetry(
    "SELECT active_video_limit, active_video_unlimited FROM users WHERE id = $1",
    [userId],
  );
  const user = result.rows[0] || {};
  return {
    limit: normalizeActiveVideoLimit(user.active_video_limit),
    unlimited: user.active_video_unlimited === true,
  };
};

const getUploadLimitFailureResponse = (error) => {
  console.error("Upload slot check error:", error);
  const message = String(error?.message || "");
  if (/tenant\/user|Tenant or user not found/i.test(message)) {
    return {
      status: 503,
      body: {
        error:
          "Supabase pooler host is wrong for this project. In Supabase Dashboard → Connect, copy the Session pooler URI exactly. New projects may use aws-1 or aws-2, not aws-0.",
        code: "DATABASE_POOLER_HOST_MISMATCH",
      },
    };
  }
  if (/ENETUNREACH|EHOSTUNREACH|network is unreachable|no route to host/i.test(message)) {
    return {
      status: 503,
      body: {
        error:
          "Render cannot reach Supabase on the direct db.*.supabase.co URL (IPv6). On Render, set DATABASE_URL to the Supabase pooler connection string from Dashboard → Connect → Session pooler.",
        code: "DATABASE_IPV6_UNREACHABLE",
      },
    };
  }
  if (/connect|timeout|terminated|ECONN|ENOTFOUND|password authentication failed/i.test(message)) {
    return {
      status: 503,
      body: {
        error:
          "Database connection failed. Check DATABASE_URL on Render, redeploy, then log in again.",
        code: "DATABASE_UNAVAILABLE",
      },
    };
  }
  return {
    status: 500,
    body: { error: "Failed to check upload limit", code: "UPLOAD_LIMIT_CHECK_FAILED" },
  };
};

const requireUserUploadSlot = async (req, res, next) => {
  try {
    const [count, allowance] = await Promise.all([
      getActiveUserVideoCount(req.user.id),
      getUserUploadAllowance(req.user.id),
    ]);
    if (!allowance.unlimited && count >= allowance.limit) {
      return res.status(403).json({
        error: `Active video limit reached. Your account includes ${allowance.limit} active videos. Join the Discord server and open a ticket to add more active videos or upgrade to unlimited.`,
        code: "ACTIVE_VIDEO_LIMIT_REACHED",
        discordUrl: DISCORD_SUPPORT_URL,
        activeVideoCount: count,
        activeVideoLimit: allowance.limit,
      });
    }
    next();
  } catch (e) {
    const failure = getUploadLimitFailureResponse(e);
    res.status(failure.status).json(failure.body);
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

const normalizeUploadTimezone = (value) => {
  const timezone = sanitizeText(value, 100);
  if (!timezone) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "";
  }
};

const normalizeResourceInput = (body = {}) => {
  const title = sanitizeText(body.title, 140);
  const rawUrl = sanitizeText(body.url, 500);
  const category = sanitizeText(body.category, 80);
  const description = sanitizeText(body.description, 600);
  const sortOrder = Number.parseInt(body.sortOrder ?? body.sort_order ?? 0, 10);

  if (!title) return { error: "Title is required" };
  if (!category) return { error: "Category is required" };
  if (!rawUrl) return { error: "URL is required" };

  let url = rawUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.hostname.includes(".")) {
      return { error: "Enter a valid website URL, like https://example.com" };
    }
    url = parsedUrl.toString();
  } catch {
    return { error: "Enter a valid website URL, like https://example.com" };
  }

  return {
    title,
    url,
    category,
    description,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    isPublished: body.isPublished ?? body.is_published ?? true,
  };
};

const normalizeHttpUrl = (value, maxLength = 1000) => {
  const rawUrl = sanitizeText(value, maxLength);
  if (!rawUrl) return "";
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const parsedUrl = new URL(withProtocol);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.hostname.includes(".")) {
      return "";
    }
    return parsedUrl.toString();
  } catch {
    return "";
  }
};

const isVideoLinkQuestion = (question) =>
  /\bvideo\b/i.test(question?.label || "") && /\blink|url\b/i.test(question?.label || "");

const mapResourceRow = (row) => ({
  id: row.id,
  title: row.title,
  url: row.url,
  category: row.category,
  description: row.description || "",
  sortOrder: row.sort_order || 0,
  isPublished: row.is_published !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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
  const judgeRoleIds = (() => {
    const fromArray = Array.isArray(body.judgeRoleIds)
      ? body.judgeRoleIds
      : [];
    const combined = [...fromArray, body.judgeRoleId];
    return [
      ...new Set(
        combined.map((value) => normalizeSnowflake(value, false)).filter(Boolean),
      ),
    ].slice(0, 15);
  })();
  const judgeRoleId = judgeRoleIds[0] || "";
  const acceptanceThreshold = (() => {
    const parsed = Number(body.acceptanceThreshold);
    if (!Number.isFinite(parsed)) return 7;
    return Math.min(10, Math.max(0, Math.round(parsed * 10) / 10));
  })();
  const judgeCountThreshold = (() => {
    const parsed = Number.parseInt(String(body.judgeCountThreshold), 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(25, parsed));
  })();
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
  const applicationPanelDefaults = {
    messageText: "",
    embedTitle: "{{formName}}",
    embedDescription: "{{applicationUrl}}\n\n{{formDescription}}",
    accentColor: "#ffffff",
    imageUrl: "",
    thumbnailUrl: "",
    showLargeImage: false,
    showThumbnail: false,
    footerText: "CUTRR applications",
  };
  const normalizeApplicationPanel = (value) => {
    const source =
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const color = sanitizeText(source.accentColor, 32);
    return {
      messageText:
        sanitizeText(source.messageText, 2000) ||
        applicationPanelDefaults.messageText,
      embedTitle:
        sanitizeText(source.embedTitle, 256) ||
        applicationPanelDefaults.embedTitle,
      embedDescription:
        sanitizeText(source.embedDescription, 4096) ||
        applicationPanelDefaults.embedDescription,
      accentColor: /^#[0-9a-f]{6}$/i.test(color)
        ? color
        : applicationPanelDefaults.accentColor,
      imageUrl: urlValue(source.imageUrl),
      thumbnailUrl: urlValue(source.thumbnailUrl),
      showLargeImage: Boolean(source.showLargeImage),
      showThumbnail: Boolean(source.showThumbnail),
      footerText:
        sanitizeText(source.footerText, 2048) ||
        applicationPanelDefaults.footerText,
    };
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
      applicationPanel: normalizeApplicationPanel(source.applicationPanel),
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
    judgeRoleId,
    judgeRoleIds,
    judgingEnabled: body.judgingEnabled === true,
    acceptanceThreshold,
    judgeCountThreshold,
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
    requiresVideo: body.requiresVideo !== false,
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
  judgeRoleId: row.judge_role_id || "",
  judgeRoleIds: Array.isArray(row.judge_role_ids) && row.judge_role_ids.length
    ? row.judge_role_ids.filter(Boolean)
    : row.judge_role_id
      ? [row.judge_role_id]
      : [],
  judgingEnabled: row.judging_enabled === true,
  acceptanceThreshold:
    row.acceptance_threshold === null || row.acceptance_threshold === undefined
      ? 7
      : Number(row.acceptance_threshold),
  judgeCountThreshold:
    row.judge_count_threshold === null ||
    row.judge_count_threshold === undefined
      ? 1
      : Math.max(1, Number(row.judge_count_threshold)),
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
  requiresVideo: row.requires_video !== false,
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
    return { isAcceptingSubmissions: false, closedReason: "This application is closed." };
  if (form.openAt && new Date(form.openAt) > now) {
    return {
      isAcceptingSubmissions: false,
      closedReason: `This form opens ${new Date(form.openAt).toLocaleString()}.`,
    };
  }
  if (form.closeAt && new Date(form.closeAt) <= now) {
    return { isAcceptingSubmissions: false, closedReason: "This application has closed." };
  }
  if (form.submissionLimit > 0 && submissionCount >= form.submissionLimit) {
    return {
      isAcceptingSubmissions: false,
      closedReason: "This application has reached its submission limit.",
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
      avatar: sanitizeText(payload.avatar, 120),
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

const fetchDiscordCurrentUser = async (accessToken) => {
  if (!accessToken) return null;
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const discordUser = await response.json();
  if (!discordUser?.id) return null;
  return {
    id: String(discordUser.id),
    username: sanitizeText(
      discordUser.global_name || discordUser.username || "Discord user",
      120,
    ),
    avatar: sanitizeText(discordUser.avatar, 120),
  };
};

const validateDiscordFormTargets = async (req, form) => {
  const session = getDiscordSession(req);
  if (!session) {
    return {
      status: 401,
      body: {
        error: "Connect Discord before saving this form.",
        discordExpired: true,
      },
    };
  }

  if (!form.guildId) {
    return { status: 400, body: { error: "Discord server is required" } };
  }
  if (!form.channelId) {
    return { status: 400, body: { error: "Review channel is required" } };
  }

  const userGuilds = await fetchDiscordUserGuilds(session.accessToken);
  const allowedGuilds = await discordService.listManageableGuilds(userGuilds);
  const selectedGuild = allowedGuilds.find((guild) => guild.id === form.guildId);

  if (!selectedGuild) {
    return {
      status: 403,
      body: { error: "You need Manage Server permission for that server." },
    };
  }

  if (!selectedGuild.botPresent && !selectedGuild.botPresenceUnknown) {
    return {
      status: 409,
      body: {
        error:
          "Invite the Discord bot to this server before choosing channels and roles.",
        inviteUrl: getDiscordBotInviteUrl(form.guildId),
      },
    };
  }

  let setup;
  try {
    setup = await discordService.getGuildSetup(form.guildId);
  } catch (e) {
    if (/DISCORD_BOT_TOKEN is not set/i.test(e.message || "")) {
      return {
        status: 503,
        body: {
          error:
            "Discord bot token is missing on the web server. Add DISCORD_BOT_TOKEN to Render (same token as PebbleHost) and set DISCORD_GATEWAY_ENABLED=false.",
        },
      };
    }
    throw e;
  }
  const channelIds = new Set((setup.channels || []).map((channel) => channel.id));
  const roleIds = new Set((setup.roles || []).map((role) => role.id));
  const roleChecks = [
    ["Accepted role", form.acceptedRoleId],
    ["Ping role", form.pingRoleId],
    ["Reviewer role", form.reviewerRoleId],
    ...form.pingRoleIds.map((roleId) => ["Ping role", roleId]),
  ];

  if (!channelIds.has(form.channelId)) {
    return {
      status: 400,
      body: { error: "Review channel must belong to the selected Discord server." },
    };
  }

  if (form.panelChannelId && !channelIds.has(form.panelChannelId)) {
    return {
      status: 400,
      body: { error: "Panel channel must belong to the selected Discord server." },
    };
  }

  for (const [label, roleId] of roleChecks) {
    if (roleId && !roleIds.has(roleId)) {
      return {
        status: 400,
        body: { error: `${label} must belong to the selected Discord server.` },
      };
    }
  }

  return null;
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

const validateUploadRequest = (originalName, size) => {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return "Only video files allowed (mp4, webm, mov, avi, mkv). Max 100MB.";
  }
  const parsedSize = Number(size);
  if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
    return "Invalid file size.";
  }
  if (parsedSize > MAX_FILE_SIZE) {
    return "File too large. Maximum size is 100MB.";
  }
  return null;
};

const cleanupFailedVideoUpload = async (videoId, bunnyVideoId, savedToDatabase) => {
  if (bunnyVideoId) {
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
  if (savedToDatabase && videoId) {
    try {
      await pool.query("DELETE FROM videos WHERE id = $1", [videoId]);
    } catch (cleanupError) {
      console.error("Failed to clean failed video record:", cleanupError);
    }
  }
};

const createBunnyTusAuth = (bunnyVideoId) => {
  const authorizationExpire = Math.floor(Date.now() / 1000) + 60 * 60 * 6;
  const authorizationSignature = crypto
    .createHash("sha256")
    .update(`${BUNNY_LIBRARY_ID}${BUNNY_API_KEY}${authorizationExpire}${bunnyVideoId}`)
    .digest("hex");

  return {
    endpoint: "https://video.bunnycdn.com/tusupload",
    authorizationSignature,
    authorizationExpire,
    libraryId: BUNNY_LIBRARY_ID,
    videoId: bunnyVideoId,
  };
};

const createVideoUploadRecord = async ({
  originalName,
  size,
  userId = null,
  expiresAt,
  title,
  volume = 100,
  uploadTimezone = "",
}) => {
  const videoId = crypto.randomBytes(4).toString("hex");
  const safeUploadTimezone = normalizeUploadTimezone(uploadTimezone);
  const uploadedAtUtc = new Date().toISOString();
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
        body: JSON.stringify({ title: videoId, thumbnailTime: 1000 }),
      },
    );
    if (!createRes.ok) throw new Error("Failed to create video");
    const bunnyVideo = await createRes.json();
    bunnyVideoId = bunnyVideo.guid;

    const originalNameBase =
      sanitizeText(title || path.parse(originalName || "").name, 200) ||
      `video-${videoId}`;

    await pool.query(
      `INSERT INTO videos (id, user_id, bunny_video_id, original_name, size, expires_at, uploaded_at_utc, upload_timezone, volume, description, autoplay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        videoId,
        userId,
        bunnyVideoId,
        originalNameBase,
        size,
        expiresAt.toISOString(),
        uploadedAtUtc,
        safeUploadTimezone || null,
        volume,
        "",
        true,
      ],
    );
    savedToDatabase = true;

    return {
      id: videoId,
      bunnyId: bunnyVideoId,
      bunny_video_id: bunnyVideoId,
      original_name: originalNameBase,
      size,
      expires_at: expiresAt.toISOString(),
      created_at: uploadedAtUtc,
      uploaded_at_utc: uploadedAtUtc,
      upload_timezone: safeUploadTimezone || null,
      volume,
      description: "",
      autoplay: true,
      is_private: false,
      transcodingStatus: "processing",
    };
  } catch (e) {
    await cleanupFailedVideoUpload(videoId, bunnyVideoId, savedToDatabase);
    throw e;
  }
};

const uploadFileToBunny = async ({
  file,
  userId = null,
  expiresAt,
  title,
  volume = 100,
  uploadTimezone = "",
}) => {
  let record = null;
  try {
    record = await createVideoUploadRecord({
      originalName: file.originalname,
      size: file.size,
      userId,
      expiresAt,
      title,
      volume,
      uploadTimezone,
    });

    const fileStream = fs.createReadStream(file.path);
    const uploadRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${record.bunny_video_id}`,
      {
        method: "PUT",
        headers: {
          AccessKey: BUNNY_API_KEY,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(file.size),
        },
        body: fileStream,
        duplex: "half",
      },
    );
    if (!uploadRes.ok) {
      const details = await uploadRes.text().catch(() => "");
      throw new Error(
        `Failed to upload video${details ? `: ${details.slice(0, 200)}` : ""}`,
      );
    }

    return record;
  } catch (e) {
    if (record?.bunny_video_id) {
      await cleanupFailedVideoUpload(record.id, record.bunny_video_id, true);
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
    "media-src": ["'self'", bunnyCdnSource, "blob:"],
    "connect-src": ["'self'", bunnyCdnSource, "https://cdn.jsdelivr.net"],
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

const getOriginalVideoContentType = (originalName = "") => {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "video/mp4";
};

const getBunnyMp4Response = async (bunnyVideoId, rangeHeader = "", originalName = "") => {
  const originalContentType = getOriginalVideoContentType(originalName);
  const mp4Files = [
    ...(originalContentType
      ? [{ name: "original", contentType: originalContentType, isOriginal: true }]
      : []),
    { name: "play_1080p.mp4", contentType: "video/mp4" },
    { name: "play_720p.mp4", contentType: "video/mp4" },
    { name: "play_480p.mp4", contentType: "video/mp4" },
    { name: "play_360p.mp4", contentType: "video/mp4" },
    { name: "play_240p.mp4", contentType: "video/mp4" },
    { name: "play.mp4", contentType: "video/mp4" },
  ];

  for (const file of mp4Files) {
    const bunnyRes = await fetch(
      `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/${file.name}`,
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
        width: file.name.includes("1080") ? 1920 : 1280,
        height: file.name.includes("1080") ? 1080 : 720,
        contentType: file.contentType,
        source: file.isOriginal ? "original" : "transcoded",
      };
    }
  }

  return null;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasBunnyHlsPlaylist = async (bunnyVideoId) => {
  const playlistRes = await fetch(
    `https://${BUNNY_CDN_HOST}/${bunnyVideoId}/playlist.m3u8`,
    {
      headers: {
        AccessKey: BUNNY_API_KEY,
        Referer: `https://${BUNNY_CDN_HOST}`,
      },
    },
  );
  if (!playlistRes.ok) return false;
  const playlist = await playlistRes.text().catch(() => "");
  return playlist.includes("#EXTM3U");
};

const fetchBunnyVideoDetails = async (bunnyVideoId) => {
  const fetchStatus = async () =>
    await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
      {
        headers: { AccessKey: BUNNY_API_KEY },
      },
    );

  let statusRes = await fetchStatus();
  if (statusRes.status === 429 || statusRes.status >= 500) {
    const retryAfterHeader = statusRes.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Math.min(5000, Math.max(250, Number(retryAfterHeader) * 1000))
      : 600;
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    statusRes = await fetchStatus();
  }

  if (!statusRes.ok) {
    const error = new Error(`Bunny status check failed (${statusRes.status})`);
    error.statusCode = statusRes.status;
    throw error;
  }

  return await statusRes.json();
};

const hasPlayableBunnyOutput = (bunnyVideo) => {
  const availableResolutions = String(bunnyVideo?.availableResolutions || "").trim();
  return (
    Boolean(availableResolutions && availableResolutions !== "0") ||
    bunnyVideo?.hasMP4Fallback === true
  );
};

const getBunnyOriginalResponse = async (bunnyVideoId, rangeHeader = "", originalName = "") => {
  const originalContentType = getOriginalVideoContentType(originalName);
  if (!originalContentType) return null;
  const bunnyRes = await fetch(`https://${BUNNY_CDN_HOST}/${bunnyVideoId}/original`, {
    headers: {
      AccessKey: BUNNY_API_KEY,
      Referer: `https://${BUNNY_CDN_HOST}`,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    },
  });
  if (!bunnyRes.ok) return null;
  return {
    response: bunnyRes,
    width: 0,
    height: 0,
    contentType: originalContentType,
    source: "original",
  };
};

const closeProbeResponse = async (probe) => {
  try {
    await probe?.response?.body?.cancel?.();
  } catch {}
};

const getBunnyReadiness = async (bunnyVideoId, originalName = "", options = {}) => {
  try {
    const requireMp4 = options.requireMp4 === true;
    const bunnyVideo = await fetchBunnyVideoDetails(bunnyVideoId);
    const status = Number(bunnyVideo?.status);
    const encodeProgress = Number(bunnyVideo?.encodeProgress) || 0;
    const messages = Array.isArray(bunnyVideo?.transcodingMessages)
      ? bunnyVideo.transcodingMessages
          .map((item) => item?.message || item?.value)
          .filter(Boolean)
      : [];

    if (status === 5 || status === 8) {
      return {
        state: "failed",
        status,
        encodeProgress,
        message: messages[0] || "Video processing failed.",
        bunnyVideo,
      };
    }

    const isEncodeComplete = status === 4 || encodeProgress >= 100;
    const readyProgress = isEncodeComplete ? Math.max(encodeProgress, 100) : encodeProgress;
    if (!requireMp4) {
      const original = await getBunnyOriginalResponse(bunnyVideoId, "bytes=0-0", originalName);
      if (original) {
        await closeProbeResponse(original);
        return {
          state: "ready",
          status: Number.isFinite(status) ? status : null,
          encodeProgress: 100,
          message: "Original video is ready.",
          bunnyVideo,
          source: "original",
        };
      }
    }

    if (status === 4 || (status === 3 && isEncodeComplete && hasPlayableBunnyOutput(bunnyVideo))) {
      const hasHlsPlaylist = await hasBunnyHlsPlaylist(bunnyVideoId);
      if (!requireMp4 && hasHlsPlaylist) {
        return {
          state: "ready",
          status,
          encodeProgress: readyProgress,
          message: "Video is ready.",
          bunnyVideo,
          source: "hls",
        };
      }

      const mp4 = await getBunnyMp4Response(bunnyVideoId, "bytes=0-0", originalName);
      if (mp4) {
        await closeProbeResponse(mp4);
        return {
          state: "ready",
          status,
          encodeProgress: readyProgress,
          message: "Video is ready.",
          bunnyVideo,
          source: hasHlsPlaylist ? "hls+mp4" : mp4.source,
        };
      }

      return {
        state: "processing",
        status,
        encodeProgress: Math.min(Math.max(encodeProgress, 99), 99),
        message: "Video is finalizing.",
        bunnyVideo,
      };
    }

    if (status === 3) {
      const hasHlsPlaylist = isEncodeComplete ? await hasBunnyHlsPlaylist(bunnyVideoId) : false;
      if (!requireMp4 && hasHlsPlaylist) {
        return {
          state: "ready",
          status,
          encodeProgress: readyProgress,
          message: "Video is ready.",
          bunnyVideo,
          source: "hls",
        };
      }

      const mp4 = isEncodeComplete
        ? await getBunnyMp4Response(bunnyVideoId, "bytes=0-0", originalName)
        : null;
      if (mp4 && isEncodeComplete) {
        await closeProbeResponse(mp4);
        return {
          state: "ready",
          status,
          encodeProgress: readyProgress,
          message: "Video is ready.",
          bunnyVideo,
          source: mp4.source,
        };
      }
    }

    if (requireMp4 && isEncodeComplete && bunnyVideo?.hasOriginal === true && getOriginalVideoContentType(originalName)) {
      const original = await getBunnyMp4Response(bunnyVideoId, "bytes=0-0", originalName);
      if (original?.source === "original") {
        await closeProbeResponse(original);
        return {
          state: "ready",
          status: Number.isFinite(status) ? status : null,
          encodeProgress: readyProgress,
          message: "Original video is ready.",
          bunnyVideo,
          source: "original",
        };
      }
    }

    return {
      state: Number.isFinite(status) ? "processing" : "unknown",
      status: Number.isFinite(status) ? status : null,
      encodeProgress,
      message: messages[0] || "Video is still processing.",
      bunnyVideo,
    };
  } catch (error) {
    console.error("Failed to get Bunny readiness:", error);
    return {
      state: "unknown",
      status: null,
      encodeProgress: 0,
      message: "Unable to check video processing status.",
      bunnyVideo: null,
    };
  }
};

const isBunnyReady = (readiness) => readiness?.state === "ready";
const isBunnyFailed = (readiness) => readiness?.state === "failed";

const formatUploadTimestamp = (value, timezone = "") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const safeTimezone = normalizeUploadTimezone(timezone);
  const timezoneOption = safeTimezone ? { timeZone: safeTimezone } : {};

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...timezoneOption,
  });

  const dateStr = date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    ...timezoneOption,
  });
  return `${dateStr} at ${timeStr}`;
};

const serializeDbTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  const raw = String(value);
  const normalized = /z$|[+-]\d{2}:?\d{2}$/i.test(raw) ? raw : `${raw}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
};

const getVideoUploadedAt = (video) =>
  serializeDbTimestamp(video?.uploaded_at_utc || video?.created_at);

const getThumbnailPlaceholderSvg = (label = "CUTRR") => {
  const safeLabel = escapeHtml(label || "CUTRR").slice(0, 24);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="${safeLabel}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#15161a"/>
          <stop offset="100%" stop-color="#07080b"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)"/>
      <circle cx="640" cy="360" r="92" fill="rgba(255,255,255,0.08)"/>
      <polygon points="615,312 615,408 692,360" fill="rgba(255,255,255,0.85)"/>
      <text x="640" y="528" fill="rgba(255,255,255,0.7)" font-family="Arial, Helvetica, sans-serif" font-size="42" text-anchor="middle">${safeLabel}</text>
    </svg>`,
  );
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

const isSocialPreviewBot = (userAgent = "") =>
  /Discordbot|Twitterbot|Slackbot|facebookexternalhit|LinkedInBot|TelegramBot/i.test(
    userAgent,
  );

const sendBotPreviewHtml = (
  res,
  {
    status = 200,
    title,
    description = "CUTRR video",
    pageUrl,
    thumbnailUrl = "",
    videoMetaTags = "",
    ogType = "video",
  },
) => {
  const cspNonce = createCspNonce();
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex, nofollow">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="CUTRR">
  ${thumbnailUrl ? `<meta property="og:image" content="${escapeHtml(thumbnailUrl)}">` : ""}
  ${videoMetaTags}
  <meta name="twitter:card" content="${videoMetaTags ? "player" : "summary"}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${thumbnailUrl ? `<meta name="twitter:image" content="${escapeHtml(thumbnailUrl)}">` : ""}
</head>
<body></body>
</html>`;

  setOgContentSecurityPolicy(res, cspNonce);
  res.status(status);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
};

// Discord Open Graph support - detect Discord user agent
app.get("/:id", async (req, res, next) => {
  const userAgent = req.get("user-agent") || "";
  const isDiscord = isSocialPreviewBot(userAgent);
  const isVideoPath = /^[a-f0-9]{8}$/.test(req.params.id);

  // If it's Discord/Twitter bot and the path is a video ID, serve OG tags
  if (isDiscord && isVideoPath) {
    const pageUrl = `${getFrontendOrigin(req)}/${req.params.id}`;
    try {
      const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
        req.params.id,
      ]);
      const video = result.rows[0];

      if (!video) {
        return sendBotPreviewHtml(res, {
          status: 404,
          title: "Video not found | CUTRR",
          description: "This CUTRR link is no longer available.",
          pageUrl,
          ogType: "website",
        });
      }
      if (!canAccessVideo(req, video)) {
        return sendBotPreviewHtml(res, {
          status: 404,
          title: "Video not found | CUTRR",
          description: "This CUTRR link is no longer available.",
          pageUrl,
          ogType: "website",
        });
      }
      if (!(await hasValidVideoPassword(req, video))) {
        return sendBotPreviewHtml(res, {
          status: 401,
          title: `${video.original_name || "Video"} | CUTRR`,
          description: "Password required to view this video.",
          pageUrl,
          ogType: "website",
        });
      }
      if (new Date(video.expires_at) < new Date()) {
        return sendBotPreviewHtml(res, {
          status: 410,
          title: `${video.original_name || "Video"} | CUTRR`,
          description: "This video has expired.",
          pageUrl,
          ogType: "website",
        });
      }

      const readiness = await getBunnyReadiness(video.bunny_video_id, video.original_name);
      if (!isBunnyReady(readiness)) {
        return sendBotPreviewHtml(res, {
          status: 503,
          title: `${video.original_name || "Video"} | CUTRR`,
          description: "Video is still processing on CUTRR.",
          pageUrl,
          ogType: "website",
        });
      }

      const serverUrl = getRequestPublicOrigin(req);
      const accessParams = new URLSearchParams();
      if (video.is_private && video.private_token) {
        accessParams.set("token", video.private_token);
      }
      const accessQuery = accessParams.toString();
      const accessSuffix = accessQuery ? `?${accessQuery}` : "";
      const videoMp4 = `${serverUrl}/video-stream/${video.id}${accessSuffix}`;
      const embedPlayerUrl = `${serverUrl}/embed/${video.id}${accessSuffix}`;
      const thumbnailUrl = `${serverUrl}/thumb/${video.id}${accessSuffix}`;
      const embedTitle = `${video.original_name || "Video"} | CUTRR`;
      const uploadedAtUtc = getVideoUploadedAt(video);
      const uploadTimestamp = uploadedAtUtc
        ? formatUploadTimestamp(uploadedAtUtc, video.upload_timezone)
        : "";
      const embedDescription = uploadTimestamp || "CUTRR video";
      const embedWidth = Number(readiness.bunnyVideo?.width) || 1920;
      const embedHeight = Number(readiness.bunnyVideo?.height) || 1080;
      const videoMetaTags =
        video.allow_sharing === false
          ? ""
          : `<meta property="og:video" content="${escapeHtml(videoMp4)}">
  <meta property="og:video:secure_url" content="${escapeHtml(videoMp4)}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="${embedWidth}">
  <meta property="og:video:height" content="${embedHeight}">
  <meta property="og:video:url" content="${escapeHtml(videoMp4)}">
  <link rel="alternate" type="video/mp4" href="${escapeHtml(videoMp4)}">
  <meta name="twitter:player" content="${escapeHtml(embedPlayerUrl)}">
  <meta name="twitter:player:width" content="${embedWidth}">
  <meta name="twitter:player:height" content="${embedHeight}">
  <meta name="twitter:player:stream" content="${escapeHtml(videoMp4)}">
  <meta name="twitter:player:stream:content_type" content="video/mp4">`;

      return sendBotPreviewHtml(res, {
        title: embedTitle,
        description: embedDescription,
        pageUrl,
        thumbnailUrl,
        videoMetaTags,
      });
    } catch (e) {
      console.error("OG error:", e);
      return sendBotPreviewHtml(res, {
        status: 503,
        title: "CUTRR video preview unavailable",
        description: "Try opening the link again in a moment.",
        pageUrl,
        ogType: "website",
      });
    }
  }

  if (isVideoPath) {
    const frontendUrl = new URL(req.params.id, FRONTEND_URL.replace(/\/+$/, "") + "/");
    if (req.url.includes("?")) {
      frontendUrl.search = req.url.slice(req.url.indexOf("?"));
    }
    return res.redirect(302, frontendUrl.toString());
  }

  // Otherwise, continue to normal routing
  next();
});

// Video stream proxy - serves Bunny MP4 since CDN requires auth
app.get("/hls/:id/playlist.m3u8", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = result.rows[0];
    const accessErrorStatus = await getHlsAccessErrorStatus(req, video);
    if (accessErrorStatus) return res.sendStatus(accessErrorStatus);

    const bunnyRes = await fetch(getBunnyHlsAssetUrl(video.bunny_video_id), {
      headers: {
        AccessKey: BUNNY_API_KEY,
        Referer: `https://${BUNNY_CDN_HOST}`,
      },
    });
    if (!bunnyRes.ok) return res.sendStatus(bunnyRes.status === 404 ? 404 : 502);

    const playlist = await bunnyRes.text();
    res.set("Content-Type", "application/vnd.apple.mpegurl");
    res.set("Cache-Control", "no-cache");
    res.send(rewriteHlsPlaylist(req, video, playlist));
  } catch (e) {
    console.error("HLS playlist proxy error:", e);
    res.status(500).send("Error");
  }
});

app.get("/hls/:id/*", async (req, res) => {
  try {
    const assetPath = req.params[0] || "";
    if (!assetPath || assetPath.includes("..")) return res.sendStatus(400);

    const result = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = result.rows[0];
    const accessErrorStatus = await getHlsAccessErrorStatus(req, video);
    if (accessErrorStatus) return res.sendStatus(accessErrorStatus);

    const bunnyRes = await fetch(getBunnyHlsAssetUrl(video.bunny_video_id, assetPath), {
      headers: {
        AccessKey: BUNNY_API_KEY,
        Referer: `https://${BUNNY_CDN_HOST}`,
      },
    });
    if (!bunnyRes.ok) return res.sendStatus(bunnyRes.status === 404 ? 404 : 502);

    const contentType =
      bunnyRes.headers.get("content-type") ||
      (assetPath.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
    res.set("Content-Type", contentType);
    res.set("Cache-Control", assetPath.endsWith(".m3u8") ? "no-cache" : "public, max-age=86400");

    if (assetPath.endsWith(".m3u8")) {
      const playlist = await bunnyRes.text();
      res.send(rewriteHlsPlaylist(req, video, playlist, assetPath));
      return;
    }

    const buffer = Buffer.from(await bunnyRes.arrayBuffer());
    res.set("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (e) {
    console.error("HLS asset proxy error:", e);
    res.status(500).send("Error");
  }
});

app.get("/video-stream/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT bunny_video_id, original_name, user_id, is_private, private_token, password_protection, video_password_hash FROM videos WHERE id = $1",
      [req.params.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).send("Not found");
    if (!canAccessVideo(req, video)) return res.status(404).send("Not found");
    if (!(await hasValidVideoPassword(req, video)))
      return res.status(401).send("Password required");

    let mp4 = await getBunnyOriginalResponse(
      video.bunny_video_id,
      req.headers.range || "",
      video.original_name,
    );
    if (!mp4) {
      for (let attempt = 0; attempt < 5 && !mp4; attempt += 1) {
        await wait(1000);
        mp4 = await getBunnyOriginalResponse(
          video.bunny_video_id,
          req.headers.range || "",
          video.original_name,
        );
      }
    }
    if (!mp4) {
      mp4 = await getBunnyMp4Response(
        video.bunny_video_id,
        req.headers.range || "",
        video.original_name,
      );
    }
    if (!mp4) return res.status(404).send("Video not available");

    const buffer = Buffer.from(await mp4.response.arrayBuffer());
    const contentRange = mp4.response.headers.get("content-range");
    const acceptRanges = mp4.response.headers.get("accept-ranges");
    res.set("Content-Type", mp4.contentType || "video/mp4");
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
      "SELECT bunny_video_id, original_name, user_id, is_private, private_token, allow_downloading, password_protection, video_password_hash FROM videos WHERE id = $1",
      [req.params.id],
    );
    const video = result.rows[0];
    if (!video) return res.status(404).send("Not found");
    if (!canAccessVideo(req, video)) return res.status(404).send("Not found");
    if (!(await hasValidVideoPassword(req, video)))
      return res.status(401).send("Password required");
    if (video.allow_downloading === false) return res.status(403).send("Download disabled");

    const mp4 = await getBunnyMp4Response(video.bunny_video_id, "", video.original_name);
    if (!mp4) return res.status(404).send("Video not available");

    const buffer = Buffer.from(await mp4.response.arrayBuffer());
    const fileName = getSafeDownloadName(video.original_name, req.params.id);
    res.set("Content-Type", mp4.contentType || "video/mp4");
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
      "SELECT bunny_video_id, user_id, is_private, private_token, password_protection, video_password_hash, thumbnail_index FROM videos WHERE id = $1",
      [req.params.id],
    );
    const video = result.rows[0];
    if (!video) {
      res.set("Content-Type", "image/svg+xml");
      res.set("Cache-Control", "no-cache");
      return res.status(404).send(getThumbnailPlaceholderSvg("CUTRR"));
    }
    if (!canAccessVideo(req, video)) {
      res.set("Content-Type", "image/svg+xml");
      res.set("Cache-Control", "no-cache");
      return res.status(404).send(getThumbnailPlaceholderSvg("CUTRR"));
    }
    if (!(await hasValidVideoPassword(req, video, { allowOwner: true }))) {
      res.set("Content-Type", "image/svg+xml");
      res.set("Cache-Control", "no-cache");
      return res.status(404).send(getThumbnailPlaceholderSvg("CUTRR"));
    }

    // Support ?t=N for specific thumbnail index
    const thumbIndex = req.query.t
      ? parseInt(req.query.t)
      : Number.isFinite(Number(video.thumbnail_index))
        ? Number(video.thumbnail_index)
        : null;
    const fetchStreamAsset = (fileName) =>
      fetch(`https://${BUNNY_CDN_HOST}/${video.bunny_video_id}/${fileName}`, {
        headers: {
          AccessKey: BUNNY_API_KEY,
          Referer: `https://${BUNNY_CDN_HOST}`,
        },
      });

    const sendAssetResponse = async (assetRes, fallbackType = "image/jpeg") => {
      const contentType = assetRes.headers.get("content-type") || fallbackType;
      res.set("Content-Type", contentType);
      res.set("Cache-Control", thumbIndex ? "public, max-age=86400" : "no-cache");
      const buffer = Buffer.from(await assetRes.arrayBuffer());
      return res.send(buffer);
    };

    const details = !thumbIndex
      ? await fetchBunnyVideoDetails(video.bunny_video_id).catch(() => null)
      : null;
    const bunnyThumbFile = String(details?.thumbnailFileName || "").trim();
    const candidateFiles = [
      thumbIndex ? `thumbnail_${thumbIndex}.jpg` : "",
      !thumbIndex ? bunnyThumbFile : "",
      !thumbIndex ? "thumbnail.jpg" : "",
      !thumbIndex ? "thumbnail_0.jpg" : "",
      !thumbIndex ? "thumbnail_1.jpg" : "",
      !thumbIndex ? "preview.webp" : "",
    ].filter(Boolean);
    const uniqueCandidateFiles = [...new Set(candidateFiles)];

    for (const candidateFile of uniqueCandidateFiles) {
      const candidateRes = await fetchStreamAsset(candidateFile);
      if (candidateRes.ok) {
        return sendAssetResponse(
          candidateRes,
          candidateFile.endsWith(".webp") ? "image/webp" : "image/jpeg",
        );
      }
    }

    // Try the API thumbnail endpoint as a final fallback.
    const apiThumbRes = await fetch(
      `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${video.bunny_video_id}/thumbnail`,
      {
        headers: { AccessKey: BUNNY_API_KEY },
      },
    );
    if (apiThumbRes.ok) {
      return sendAssetResponse(apiThumbRes);
    }

    res.set("Content-Type", "image/svg+xml");
    res.set("Cache-Control", thumbIndex ? "public, max-age=300" : "no-cache");
    return res.status(404).send(getThumbnailPlaceholderSvg(video.id));
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
    if (video.allow_sharing === false)
      return res.status(403).send("Sharing disabled");
    if (!canEmbedVideo(req, video)) return res.status(403).send("Embed domain blocked");
    if (!(await hasValidVideoPassword(req, video)))
      return res.status(401).send("Password required");
    if (new Date(video.expires_at) < new Date())
      return res.status(410).send("Video expired");

    const readiness = await getBunnyReadiness(video.bunny_video_id, video.original_name);
    if (!isBunnyReady(readiness)) {
      return res.status(503).send("Video still processing");
    }

    const accessParams = new URLSearchParams();
    if (req.query.token) accessParams.set("token", String(req.query.token));
    if (req.query.password) accessParams.set("password", String(req.query.password));
    const accessQuery = accessParams.toString();
    const accessSuffix = accessQuery ? `?${accessQuery}` : "";
    const videoUrl = getHlsPlaybackUrl(req, video, { password: req.query.password });
    const thumbnailUrl = `${getRequestPublicOrigin(req)}/thumb/${video.id}${accessSuffix}`;
    const autoplay = req.query.autoplay !== "false";
    const createdAtIso =
      getVideoUploadedAt(video) || new Date(video.created_at).toISOString();
    const uploadTimezone = normalizeUploadTimezone(video.upload_timezone);
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
    .container { width: 100%; height: 100%; max-width: 100vw; max-height: 100vh; display: flex; flex-direction: column; }
    .player-container { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; background: #000; }
    video { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; background: #000; }
    .player-footer { color: #ddd; font-size: 0.95rem; padding: 0.85rem 1rem; text-align: center; background: rgba(0,0,0,.65); }
  </style>
  <script nonce="${cspNonce}" src="${HLS_SCRIPT_URL}" integrity="${HLS_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>
</head>
<body>
  <div class="container">
    <div class="player-container">
      <video controls ${autoplay ? "autoplay" : ""} playsinline preload="auto" poster="${escapeHtml(thumbnailUrl)}"></video>
    </div>
    <div class="player-footer"><span id="upload-time">...</span></div>
  </div>
  <script nonce="${cspNonce}">
    const createdAt = new Date(${escapeJsString(createdAtIso)});
    const uploadTimezone = ${escapeJsString(uploadTimezone)};
    const timeEl = document.getElementById('upload-time');
    const dateOptions = uploadTimezone
      ? { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: uploadTimezone }
      : { month: 'numeric', day: 'numeric', year: 'numeric' };
    const timeOptions = uploadTimezone
      ? { hour: 'numeric', minute: '2-digit', timeZone: uploadTimezone }
      : { hour: 'numeric', minute: '2-digit' };
    const timeStr = createdAt.toLocaleDateString('en-US', dateOptions) + ' at ' + createdAt.toLocaleTimeString('en-US', timeOptions);
    timeEl.textContent = timeStr;

    const video = document.querySelector('video');
    const videoSrc = ${escapeJsString(videoUrl)};
    video.volume = ${safeVolume} / 100;
    video.muted = false;

    if (Hls.isSupported() && /\.m3u8(?:\?|$)/.test(videoSrc)) {
      const hls = new Hls({
        abrEwmaDefaultEstimate: 100000000,
        autoStartLoad: false,
        capLevelToPlayerSize: false,
        startLevel: -1
      });
      function lockHighestHlsLevel() {
        const highestLevel = hls.levels.length - 1;
        if (highestLevel < 0) return;
        hls.startLevel = highestLevel;
        hls.currentLevel = highestLevel;
        hls.loadLevel = highestLevel;
        hls.nextLevel = highestLevel;
      }
      hls.loadSource(videoSrc);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        lockHighestHlsLevel();
        hls.startLoad(-1);
        ${autoplay ? "video.play().catch(function () {});" : ""}
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, lockHighestHlsLevel);
    } else {
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
      `INSERT INTO users (email, password)
       VALUES ($1, $2)
       RETURNING id, email, active_video_limit, active_video_unlimited`,
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
    res.json({
      token,
      user: {
        id: user.id,
        email,
        isAdmin: false,
        activeVideoLimit: normalizeActiveVideoLimit(user.active_video_limit),
        activeVideoUnlimited: user.active_video_unlimited === true,
      },
    });
  } catch (e) {
    console.error("Register error:", e);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
app.post("/api/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await queryWithRetry("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [
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
    res.json({
      token,
      user: {
        id: user.id,
        email,
        isAdmin,
        activeVideoLimit: normalizeActiveVideoLimit(user.active_video_limit),
        activeVideoUnlimited: user.active_video_unlimited === true,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    if (isTransientDbError(e)) {
      return res.status(503).json({ error: "Server is waking up. Try again in a moment." });
    }
    res.status(500).json({ error: "Login failed" });
  }
});

// Admin login
app.post("/api/admin/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await queryWithRetry(
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
    const result = await queryWithRetry(
      "SELECT id, email, is_admin, active_video_limit, active_video_unlimited, created_at FROM users WHERE id = $1",
      [req.user.id],
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({
        error: "Session expired. Please log in again.",
        code: "USER_NOT_FOUND",
      });
    }
    res.json({
      id: user.id,
      email: user.email,
      isAdmin: user.is_admin === true,
      activeVideoLimit: normalizeActiveVideoLimit(user.active_video_limit),
      activeVideoUnlimited: user.active_video_unlimited === true,
      created_at: user.created_at,
    });
  } catch (e) {
    console.error("Get current user error:", e);
    if (isTransientDbError(e)) {
      return res.status(503).json({ error: "Server is waking up. Try again in a moment." });
    }
    res.status(500).json({ error: "Failed to get current user" });
  }
});

app.get("/api/resources", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM resources
      WHERE is_published = true
      ORDER BY LOWER(category), sort_order ASC, LOWER(title)
    `);
    res.json(rows.map(mapResourceRow));
  } catch (e) {
    console.error("Get resources error:", e);
    res.status(500).json({ error: "Failed to load resources" });
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
        `SELECT u.id, u.email, u.is_admin, u.active_video_limit,
                u.active_video_unlimited, u.created_at,
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
        activeVideoLimit: normalizeActiveVideoLimit(row.active_video_limit),
        activeVideoUnlimited: row.active_video_unlimited === true,
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

app.get("/api/admin/resources", auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM resources
      ORDER BY LOWER(category), sort_order ASC, LOWER(title)
    `);
    res.json(rows.map(mapResourceRow));
  } catch (e) {
    console.error("Admin resources error:", e);
    res.status(500).json({ error: "Failed to load resources" });
  }
});

app.post("/api/admin/resources", auth, adminOnly, async (req, res) => {
  const resource = normalizeResourceInput(req.body);
  if (resource.error) return res.status(400).json({ error: resource.error });

  try {
    const { rows } = await pool.query(
      `INSERT INTO resources (title, url, category, description, sort_order, is_published)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        resource.title,
        resource.url,
        resource.category,
        resource.description,
        resource.sortOrder,
        resource.isPublished !== false,
      ],
    );
    res.status(201).json(mapResourceRow(rows[0]));
  } catch (e) {
    console.error("Create resource error:", e);
    res.status(500).json({ error: "Failed to create resource" });
  }
});

app.patch("/api/admin/resources/:id", auth, adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid resource ID" });

  const resource = normalizeResourceInput(req.body);
  if (resource.error) return res.status(400).json({ error: resource.error });

  try {
    const { rows } = await pool.query(
      `UPDATE resources
       SET title = $1,
           url = $2,
           category = $3,
           description = $4,
           sort_order = $5,
           is_published = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        resource.title,
        resource.url,
        resource.category,
        resource.description,
        resource.sortOrder,
        resource.isPublished !== false,
        id,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: "Resource not found" });
    res.json(mapResourceRow(rows[0]));
  } catch (e) {
    console.error("Update resource error:", e);
    res.status(500).json({ error: "Failed to update resource" });
  }
});

app.delete("/api/admin/resources/:id", auth, adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid resource ID" });

  try {
    const result = await pool.query("DELETE FROM resources WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Resource not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("Delete resource error:", e);
    res.status(500).json({ error: "Failed to delete resource" });
  }
});

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  const search = sanitizeText(req.query.search, 120).trim();
  
  try {
    const query = `
      SELECT u.id, u.email, u.is_admin, u.active_video_limit,
             u.active_video_unlimited, u.created_at,
             COUNT(v.id)::int AS video_count,
             COUNT(v.id) FILTER (WHERE v.expires_at > NOW())::int AS active_video_count,
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
      activeVideoLimit: normalizeActiveVideoLimit(row.active_video_limit),
      activeVideoUnlimited: row.active_video_unlimited === true,
      createdAt: row.created_at,
      videoCount: row.video_count || 0,
      activeVideoCount: row.active_video_count || 0,
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

app.patch("/api/admin/users/:id/upload-allowance", auth, adminOnly, async (req, res) => {
  const { id } = req.params;
  const activeVideoUnlimited = req.body?.activeVideoUnlimited === true;
  const activeVideoLimit = normalizeActiveVideoLimit(req.body?.activeVideoLimit);

  try {
    const result = await pool.query(
      `UPDATE users
       SET active_video_limit = $1,
           active_video_unlimited = $2
       WHERE id = $3
       RETURNING id, active_video_limit, active_video_unlimited`,
      [activeVideoLimit, activeVideoUnlimited, id],
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      id: result.rows[0].id,
      activeVideoLimit: normalizeActiveVideoLimit(
        result.rows[0].active_video_limit,
      ),
      activeVideoUnlimited: result.rows[0].active_video_unlimited === true,
    });
  } catch (e) {
    console.error("Update upload allowance error:", e);
    res.status(500).json({ error: "Failed to update upload allowance" });
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

app.delete("/api/me", auth, async (req, res) => {
  try {
    const videos = await pool.query(
      "SELECT id, bunny_video_id FROM videos WHERE user_id = $1",
      [req.user.id],
    );

    for (const video of videos.rows) {
      await deleteVideoRecord(video);
    }

    const result = await pool.query("DELETE FROM users WHERE id = $1", [
      req.user.id,
    ]);
    if (result.rowCount === 0)
      return res.status(404).json({ error: "User not found" });

    res.json({ success: true });
  } catch (e) {
    console.error("Delete account error:", e);
    res.status(500).json({ error: "Failed to delete account" });
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
      res.json({
        guilds,
        totalGuilds: Array.isArray(userGuilds) ? userGuilds.length : 0,
        botInviteUrl: getDiscordBotInviteUrl(),
      });
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
      if (!selectedGuild.botPresent && !selectedGuild.botPresenceUnknown) {
        return res.status(409).json({
          error:
            "Invite the Discord bot to this server before choosing channels and roles.",
          inviteUrl: getDiscordBotInviteUrl(guildId),
        });
      }

      const setup = await discordService.getGuildSetup(guildId);
      res.json({
        ...setup,
        botVerified: true,
      });
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
    const targetError = await validateDiscordFormTargets(req, form);
    if (targetError) return res.status(targetError.status).json(targetError.body);

    const result = await pool.query(
      `INSERT INTO discord_forms
       (owner_user_id, name, slug, description, guild_id, channel_id, panel_channel_id, accepted_role_id, ping_role_id, reviewer_role_id,
        ping_role_ids, voting_enabled, accept_emoji, deny_emoji, reapply_emoji, accept_threshold, deny_threshold, reapply_threshold,
        deny_cooldown_days, reapply_cooldown_days, questions, is_open, requires_video, require_discord, success_message,
        open_at, close_at, submission_limit, one_submission_per_user, max_file_size_mb, banner_url, accent_color, anti_spam_cooldown_hours, review_panel,
        judging_enabled, judge_role_id, acceptance_threshold, judge_role_ids, judge_count_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)
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
        form.judgingEnabled,
        form.judgeRoleId || null,
        form.acceptanceThreshold,
        JSON.stringify(form.judgeRoleIds || []),
        form.judgeCountThreshold,
      ],
    );
    res.status(201).json(mapDiscordForm(result.rows[0]));
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "That form link is already taken" });
    if (e.message?.includes("Discord session expired")) {
      return res.status(401).json({
        error: "Discord connection expired. Connect Discord again.",
        discordExpired: true,
      });
    }
    if (e.statusCode === 429 && e.retryAfterSeconds) {
      res.setHeader("Retry-After", String(e.retryAfterSeconds));
      return res.status(429).json({
        error: e.message || "Discord rate limited. Try again soon.",
      });
    }
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
    const targetError = await validateDiscordFormTargets(req, form);
    if (targetError) return res.status(targetError.status).json(targetError.body);

    const result = await pool.query(
      `UPDATE discord_forms
       SET name = $1, slug = $2, description = $3, guild_id = $4, channel_id = $5, panel_channel_id = $6,
           accepted_role_id = $7, ping_role_id = $8, reviewer_role_id = $9, ping_role_ids = $10, voting_enabled = $11, accept_emoji = $12, deny_emoji = $13, reapply_emoji = $14,
           accept_threshold = $15, deny_threshold = $16, reapply_threshold = $17,
           deny_cooldown_days = $18, reapply_cooldown_days = $19, questions = $20, is_open = $21,
           requires_video = $22, require_discord = $23, success_message = $24, open_at = $25, close_at = $26,
           submission_limit = $27, one_submission_per_user = $28, max_file_size_mb = $29, banner_url = $30,
           accent_color = $31, anti_spam_cooldown_hours = $32, review_panel = $33,
           judging_enabled = $34, judge_role_id = $35, acceptance_threshold = $36,
           judge_role_ids = $37, judge_count_threshold = $38,
           updated_at = NOW()
       WHERE id = $39 AND owner_user_id = $40
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
        form.judgingEnabled,
        form.judgeRoleId || null,
        form.acceptanceThreshold,
        JSON.stringify(form.judgeRoleIds || []),
        form.judgeCountThreshold,
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
    if (e.message?.includes("Discord session expired")) {
      return res.status(401).json({
        error: "Discord connection expired. Connect Discord again.",
        discordExpired: true,
      });
    }
    if (e.statusCode === 429 && e.retryAfterSeconds) {
      res.setHeader("Retry-After", String(e.retryAfterSeconds));
      return res.status(429).json({
        error: e.message || "Discord rate limited. Try again soon.",
      });
    }
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
        open_at, close_at, submission_limit, one_submission_per_user, max_file_size_mb, banner_url, accent_color, anti_spam_cooldown_hours, review_panel,
        judging_enabled, judge_role_id, acceptance_threshold, judge_role_ids, judge_count_threshold)
       SELECT owner_user_id, $1, $2, description, guild_id, channel_id, panel_channel_id, accepted_role_id, ping_role_id, reviewer_role_id,
              ping_role_ids, voting_enabled, accept_emoji, deny_emoji, reapply_emoji, accept_threshold, deny_threshold, reapply_threshold,
              deny_cooldown_days, reapply_cooldown_days, questions, false, requires_video, require_discord, success_message,
              open_at, close_at, submission_limit, one_submission_per_user, max_file_size_mb, banner_url, accent_color, anti_spam_cooldown_hours, review_panel,
              judging_enabled, judge_role_id, acceptance_threshold, judge_role_ids, judge_count_threshold
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

const JUDGING_CRITERIA = [
  { key: "concept", column: "concept" },
  { key: "individuality", column: "individuality" },
  { key: "execution", column: "execution" },
  { key: "styleImplementation", column: "style_implementation" },
  { key: "overall", column: "overall" },
];

const clampCriterionValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(10, Math.max(0, Math.round(parsed)));
};

const round2 = (value) => Math.round(value * 100) / 100;

const buildScoreRow = (row) => ({
  judgeDiscordId: row.judge_discord_id,
  judgeUsername: row.judge_username || "",
  concept: row.concept,
  individuality: row.individuality,
  execution: row.execution,
  styleImplementation: row.style_implementation,
  overall: row.overall,
  average: Number(row.average),
});

const aggregateScores = (rows) => {
  if (!rows.length) return { judgeCount: 0, finalScore: null };
  const total = rows.reduce((sum, row) => sum + Number(row.average), 0);
  return { judgeCount: rows.length, finalScore: round2(total / rows.length) };
};

const refreshSubmissionJudgingResult = async (submissionId) => {
  const scoreResult = await pool.query(
    "SELECT * FROM discord_form_scores WHERE submission_id = $1 ORDER BY created_at ASC",
    [submissionId],
  );
  const rows = scoreResult.rows;
  const aggregate = aggregateScores(rows);

  const submissionResult = await pool.query(
    `SELECT s.*, f.acceptance_threshold, f.judge_count_threshold, f.guild_id, f.channel_id, f.name AS form_name,
            f.accepted_role_id, v.original_name
     FROM discord_form_submissions s
     JOIN discord_forms f ON f.id = s.form_id
     LEFT JOIN videos v ON v.id = s.video_id
     WHERE s.id = $1`,
    [submissionId],
  );
  const submission = submissionResult.rows[0];
  if (!submission) return aggregate;

  const threshold =
    submission.acceptance_threshold === null ||
    submission.acceptance_threshold === undefined
      ? 7
      : Number(submission.acceptance_threshold);
  const judgeThreshold =
    submission.judge_count_threshold === null ||
    submission.judge_count_threshold === undefined
      ? 1
      : Math.max(1, Number(submission.judge_count_threshold));
  const thresholdMet = aggregate.judgeCount >= judgeThreshold;

  let nextStatus = submission.status;
  if (aggregate.finalScore !== null && thresholdMet && submission.status === "pending") {
    if (aggregate.finalScore >= threshold) {
      nextStatus = "accept";
      await pool.query(
        "UPDATE discord_form_submissions SET status = 'accept', decided_at = NOW() WHERE id = $1",
        [submissionId],
      );
      if (submission.accepted_role_id && /^\d{17,20}$/.test(String(submission.discord_user_id || ""))) {
        try {
          await discordService.grantAcceptedRole({
            guildId: submission.guild_id,
            discordUserId: submission.discord_user_id,
            acceptedRoleId: submission.accepted_role_id,
            formName: submission.form_name,
          });
        } catch (e) {
          console.warn("Judging auto-accept role grant failed:", e.message);
        }
      }
    }
  }

  if (submission.discord_message_id && submission.channel_id) {
    try {
      const lines = rows.map(
        (row) =>
          `• ${row.judge_username || "Judge"}: **${round2(Number(row.average))}**/10`,
      );
      const scoreLine = thresholdMet
        ? `**Final score:** ${aggregate.finalScore}/10 (needs ${threshold})`
        : `**Provisional score:** ${aggregate.finalScore}/10 (needs ${threshold})`;
      const embed = {
        title: `Judging — ${submission.original_name || submission.form_name || "Submission"}`,
        color: nextStatus === "accept" ? 0x57f287 : 0xffffff,
        description:
          aggregate.finalScore === null
            ? `No judge scores yet. Waiting for ${judgeThreshold} judge${judgeThreshold === 1 ? "" : "s"}.`
            : `${scoreLine}\n**Judges:** ${aggregate.judgeCount}/${judgeThreshold}\n\n${lines.join("\n")}`,
        footer: {
          text:
            nextStatus === "accept"
              ? "Accepted — final score met the threshold."
              : thresholdMet
                ? "Judging complete."
                : `Waiting for ${Math.max(0, judgeThreshold - aggregate.judgeCount)} more judge(s).`,
        },
      };
      await discordService.editChannelMessage({
        channelId: submission.channel_id,
        messageId: submission.discord_message_id,
        body: { embeds: [embed], allowedMentions: { parse: [] } },
      });
    } catch (e) {
      console.warn("Failed to update judging results embed:", e.message);
    }
  }

  return { ...aggregate, status: nextStatus, threshold };
};

const loadJudgingContext = async (slug, submissionId) => {
  const formResult = await pool.query(
    "SELECT * FROM discord_forms WHERE slug = $1",
    [slug],
  );
  if (!formResult.rows[0]) return { error: { status: 404, message: "Form not found" } };
  const form = mapDiscordForm(formResult.rows[0]);
  if (!form.judgingEnabled)
    return { error: { status: 400, message: "Judging is not enabled for this form" } };

  const submissionResult = await pool.query(
    `SELECT s.*, v.original_name, v.bunny_video_id
     FROM discord_form_submissions s
     LEFT JOIN videos v ON v.id = s.video_id
     WHERE s.id = $1 AND s.form_id = $2`,
    [submissionId, form.id],
  );
  if (!submissionResult.rows[0])
    return { error: { status: 404, message: "Submission not found" } };
  return { form, submission: submissionResult.rows[0] };
};

// Judge panel: check role access + return submission + current scores
app.get(
  "/api/judging/:slug/:submissionId",
  requireDiscordSession,
  async (req, res) => {
    const submissionId = Number.parseInt(req.params.submissionId, 10);
    if (!Number.isInteger(submissionId))
      return res.status(400).json({ error: "Invalid submission ID" });
    try {
      const ctx = await loadJudgingContext(req.params.slug, submissionId);
      if (ctx.error)
        return res.status(ctx.error.status).json({ error: ctx.error.message });
      const { form, submission } = ctx;

      let isJudge = false;
      try {
        isJudge = await discordService.hasAnyGuildRole({
          guildId: form.guildId,
          discordUserId: req.discord.discordId,
          roleIds: form.judgeRoleIds,
        });
      } catch (e) {
        console.warn("Judge role check failed:", e.message);
      }

      const scoresResult = await pool.query(
        "SELECT * FROM discord_form_scores WHERE submission_id = $1 ORDER BY created_at ASC",
        [submissionId],
      );
      const aggregate = aggregateScores(scoresResult.rows);
      const myScore = scoresResult.rows.find(
        (row) => row.judge_discord_id === req.discord.discordId,
      );

      res.json({
        form: {
          slug: form.slug,
          name: form.name,
          acceptanceThreshold: form.acceptanceThreshold,
          judgeCountThreshold: form.judgeCountThreshold,
        },
        submission: {
          id: submission.id,
          videoId: submission.video_id || "",
          videoUrl: submission.video_id
            ? `${PUBLIC_VIDEO_URL.replace(/\/+$/, "")}/${submission.video_id}`
            : "",
          embedUrl: submission.video_id
            ? `${getRequestPublicOrigin(req)}/embed/${submission.video_id}`
            : "",
          originalName: submission.original_name || "",
          discordUsername: submission.discord_username || "",
          discordUserId: submission.discord_user_id,
          discordAvatar: submission.discord_avatar || "",
          status: submission.status || "pending",
        },
        isJudge,
        myScore: myScore ? buildScoreRow(myScore) : null,
        results: {
          ...aggregate,
          scores: scoresResult.rows.map(buildScoreRow),
        },
      });
    } catch (e) {
      console.error("Judge panel error:", e);
      res.status(500).json({ error: "Failed to load judge panel" });
    }
  },
);

// Submit/update a judge's score for a submission
app.post(
  "/api/judging/:slug/:submissionId",
  requireDiscordSession,
  async (req, res) => {
    const submissionId = Number.parseInt(req.params.submissionId, 10);
    if (!Number.isInteger(submissionId))
      return res.status(400).json({ error: "Invalid submission ID" });
    try {
      const ctx = await loadJudgingContext(req.params.slug, submissionId);
      if (ctx.error)
        return res.status(ctx.error.status).json({ error: ctx.error.message });
      const { form } = ctx;

      let isJudge = false;
      try {
        isJudge = await discordService.hasAnyGuildRole({
          guildId: form.guildId,
          discordUserId: req.discord.discordId,
          roleIds: form.judgeRoleIds,
        });
      } catch (e) {
        console.warn("Judge role check failed:", e.message);
      }
      if (!isJudge)
        return res
          .status(403)
          .json({ error: "You do not have a judge role for this form." });

      const values = {};
      for (const criterion of JUDGING_CRITERIA) {
        values[criterion.column] = clampCriterionValue(req.body?.[criterion.key]);
      }
      const average = round2(
        JUDGING_CRITERIA.reduce(
          (sum, criterion) => sum + values[criterion.column],
          0,
        ) / JUDGING_CRITERIA.length,
      );

      await pool.query(
        `INSERT INTO discord_form_scores
           (submission_id, form_id, judge_discord_id, judge_username, concept, individuality, execution, style_implementation, overall, average, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (submission_id, judge_discord_id)
         DO UPDATE SET judge_username = EXCLUDED.judge_username,
           concept = EXCLUDED.concept,
           individuality = EXCLUDED.individuality,
           execution = EXCLUDED.execution,
           style_implementation = EXCLUDED.style_implementation,
           overall = EXCLUDED.overall,
           average = EXCLUDED.average,
           updated_at = NOW()`,
        [
          submissionId,
          form.id,
          req.discord.discordId,
          req.discord.username || "Judge",
          values.concept,
          values.individuality,
          values.execution,
          values.style_implementation,
          values.overall,
          average,
        ],
      );

      const result = await refreshSubmissionJudgingResult(submissionId);
      res.json({ ok: true, average, result });
    } catch (e) {
      console.error("Submit judge score error:", e);
      res.status(500).json({ error: "Failed to submit score" });
    }
  },
);

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
    let verifiedDiscordUser = null;
    if (discordSession?.accessToken) {
      try {
        verifiedDiscordUser = await fetchDiscordCurrentUser(
          discordSession.accessToken,
        );
      } catch (error) {
        console.warn(
          "Unable to refresh Discord user for submission:",
          getErrorMessage(error),
        );
      }
    }
    const fallbackDiscordId = normalizeSnowflake(req.body.discordUserId, true);
    const discordUserId =
      verifiedDiscordUser?.id ||
      discordSession?.discordId ||
      fallbackDiscordId ||
      (form.requireDiscord ? "" : `anon_${crypto.randomBytes(8).toString("hex")}`);
    const discordUsername =
      verifiedDiscordUser?.username ||
      discordSession?.username ||
      sanitizeText(req.body.discordUsername, 120) ||
      "Anonymous applicant";
    const discordAvatar =
      verifiedDiscordUser?.avatar ||
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
        question.required &&
        !isVideoLinkQuestion(question) &&
        !sanitizeText(answersById.get(question.id), 600),
    );
    if (missingRequired)
      return res
        .status(400)
        .json({ error: `Missing answer: ${missingRequired.label}` });

    const videoLinkAnswer = answers.find((answer) => isVideoLinkQuestion(answer));
    const videoLinkAnswerValue = sanitizeText(videoLinkAnswer?.value, 1000);
    const allowFallbackVideo = req.body.allowFallbackVideo === true;
    const rawExternalVideoUrl = allowFallbackVideo
      ? sanitizeText(req.body.videoUrl, 1000) || videoLinkAnswerValue
      : "";
    const externalVideoUrl = normalizeHttpUrl(rawExternalVideoUrl, 1000);
    const videoId = sanitizeText(req.body.videoId, 16);
    if (req.body.videoUrl && !externalVideoUrl) {
      return res.status(400).json({
        error: "Paste a valid video link, like https://example.com/video.",
      });
    }
    if (videoLinkAnswerValue && !externalVideoUrl) {
      return res.status(400).json({
        error: "Paste a valid video link, like https://example.com/video.",
      });
    }
    if (videoId && !/^[a-f0-9]{8}$/.test(videoId)) {
      return res.status(400).json({
        error: "Invalid video ID. Please upload again or paste a video link.",
      });
    }
    if (form.requiresVideo && !videoId && !externalVideoUrl) {
      return res.status(400).json({
        error: "Upload a video before submitting.",
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

      const readiness = await getBunnyReadiness(videoRow.bunny_video_id, videoRow.original_name);
      if (isBunnyFailed(readiness)) {
        return res.status(409).json({
          error: readiness.message || "Video processing failed. Please upload again.",
        });
      }
      if (!isBunnyReady(readiness)) {
        return res.status(409).json({
          error: "Video is still processing. Wait until it is ready before submitting.",
        });
      }

      video = {
        ...serializeVideoResponse(req, videoRow),
      };
    }
    const submissionAnswers = externalVideoUrl
      ? [
          ...answers,
          {
            id: "external_video_url",
            label: video ? "Backup video link" : "Video link",
            value: externalVideoUrl,
          },
        ]
      : answers;

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
        JSON.stringify(submissionAnswers),
      ],
    );

    try {
      await discordService.sendSubmissionMessage({
        form,
        submission: { ...submissionResult.rows[0], answers: submissionAnswers },
        video,
        externalVideoUrl,
      });
    } catch (discordError) {
      console.error("Discord message failed (submission saved):", discordError);
      return res.status(202).json({
        success: true,
        video,
        submissionId: submissionResult.rows[0].id,
        warning: `Application saved, but Discord notification failed: ${discordError.message}`,
        successMessage: form.successMessage,
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
app.post("/api/upload/session", uploadLimiter, optionalAuth, async (req, res) => {
  const originalName = sanitizeText(req.body?.filename || req.body?.originalName, 200);
  const size = Number(req.body?.size);
  const validationError = validateUploadRequest(originalName, size);
  if (validationError) return res.status(400).json({ error: validationError });

  const isAuthenticated = Boolean(req.user?.id);
  if (isAuthenticated) {
    try {
      const [count, allowance] = await Promise.all([
        getActiveUserVideoCount(req.user.id),
        getUserUploadAllowance(req.user.id),
      ]);
      if (!allowance.unlimited && count >= allowance.limit) {
        return res.status(403).json({
          error: `Active video limit reached. Your account includes ${allowance.limit} active videos. Join the Discord server and open a ticket to add more active videos or upgrade to unlimited.`,
          code: "ACTIVE_VIDEO_LIMIT_REACHED",
          discordUrl: DISCORD_SUPPORT_URL,
          activeVideoCount: count,
          activeVideoLimit: allowance.limit,
        });
      }
    } catch (e) {
      const failure = getUploadLimitFailureResponse(e);
      return res.status(failure.status).json(failure.body);
    }
  }

  const expiresAt = isAuthenticated
    ? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    const result = await createVideoUploadRecord({
      originalName,
      size,
      userId: isAuthenticated ? req.user.id : null,
      expiresAt,
      uploadTimezone: req.body?.uploadTimezone,
    });

    res.json({
      success: true,
      ...serializeVideoResponse(req, result),
      tus: createBunnyTusAuth(result.bunny_video_id),
      transcodingStatus: result.transcodingStatus,
      processingState: "processing",
      processingMessage: "Video is still processing.",
    });
  } catch (e) {
    console.error("Upload session error:", e);
    if (e.code === "23503" && String(e.constraint || "").includes("videos_user_id_fkey")) {
      return res.status(401).json({
        error: "Session expired. Please log out and log in again.",
        code: "USER_NOT_FOUND",
      });
    }
    res.status(500).json({ error: e.message || "Failed to start upload" });
  }
});

app.post(
  "/api/upload",
  auth,
  uploadLimiter,
  requireUserUploadSlot,
  uploadVideo,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No video file" });

    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // 6 months

    try {
      const result = await uploadFileToBunny({
        file: req.file,
        userId: req.user.id,
        expiresAt,
        uploadTimezone: req.body.uploadTimezone,
      });
      res.json({
        success: true,
        ...serializeVideoResponse(req, result),
        transcodingStatus: result.transcodingStatus,
        processingState: "processing",
        processingMessage: "Video is still processing.",
      });
    } catch (e) {
      console.error("Upload error:", e);
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      if (e.code === "23503" && String(e.constraint || "").includes("videos_user_id_fkey")) {
        return res.status(401).json({
          error: "Session expired. Please log out and log in again.",
          code: "USER_NOT_FOUND",
        });
      }
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

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    try {
      const result = await uploadFileToBunny({
        file: req.file,
        userId: null,
        expiresAt,
        uploadTimezone: req.body.uploadTimezone,
      });
      res.json({
        success: true,
        ...serializeVideoResponse(req, result),
        transcodingStatus: result.transcodingStatus,
        processingState: "processing",
        processingMessage: "Video is still processing.",
      });
    } catch (e) {
      console.error("Upload anonymous error:", e);
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      res.status(500).json({ error: e.message });
    }
  },
);

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
    if (!(await hasValidVideoPassword(req, video))) {
      return res.status(401).json({
        error: "Password required",
        requiresPassword: true,
        id: video.id,
        originalName: video.original_name,
      });
    }
    if (new Date(video.expires_at) < new Date())
      return res.status(410).json({ error: "Video expired" });

    const readiness = await getBunnyReadiness(video.bunny_video_id, video.original_name);
    const transcodingStatus =
      readiness.state === "ready" ? (readiness.status ?? 4) : "processing";
    const transcodingStatusUnknown = readiness.state === "unknown";

    res.json({
      ...serializeVideoResponse(req, video, { password: req.query.password }),
      width: Number(readiness.bunnyVideo?.width) || null,
      height: Number(readiness.bunnyVideo?.height) || null,
      transcodingStatus,
      transcodingStatusUnknown,
      processingState: readiness.state,
      encodeProgress: readiness.encodeProgress,
      processingMessage: readiness.message,
    });
  } catch (e) {
    console.error("Get video error:", e);
    res.status(500).json({ error: "Failed to get video" });
  }
});

app.get("/api/video/:id/discord-embed-check", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM videos WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.user.id,
    ]);
    const video = result.rows[0];
    if (!video) return res.status(404).json({ error: "Video not found" });

    const readiness = await getBunnyReadiness(video.bunny_video_id, video.original_name, {
      requireMp4: true,
    });
    if (!isBunnyReady(readiness)) {
      return res.status(503).json({
        ready: false,
        error: readiness.message || "Video still processing",
        processingState: readiness.state,
      });
    }

    const serverUrl = getRequestPublicOrigin(req);
    const accessSuffix = buildVideoAccessSuffix(video);
    const pageRes = await fetch(`${serverUrl}/${video.id}${accessSuffix}`, {
      headers: { "User-Agent": "Discordbot/2.0" },
    });
    const html = await pageRes.text().catch(() => "");
    const hasOgVideo = html.includes('property="og:video"');
    const hasMp4Type = html.includes('property="og:video:type" content="video/mp4"');
    const hasTwitterPlayer = html.includes('name="twitter:player"');

    if (!pageRes.ok || !hasOgVideo || !hasMp4Type || !hasTwitterPlayer) {
      return res.status(503).json({
        ready: false,
        status: pageRes.status,
        hasOgVideo,
        hasMp4Type,
        hasTwitterPlayer,
      });
    }

    res.json({
      ready: true,
      status: pageRes.status,
      hasOgVideo,
      hasMp4Type,
      hasTwitterPlayer,
    });
  } catch (e) {
    console.error("Discord embed check error:", e);
    res.status(500).json({ ready: false, error: "Failed to check Discord embed" });
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
        if (!statusRes.ok) {
          await pool.query("DELETE FROM videos WHERE id = $1", [v.id]);
          continue;
        }

        const readiness = await getBunnyReadiness(v.bunny_video_id, v.original_name);
        if (isBunnyReady(readiness) || readiness.state === "unknown") {
          validVideos.push(v);
        }
      } catch (error) {
        console.error("Failed to verify video readiness for my-videos:", error);
        validVideos.push(v);
      }
    }

    const videos = validVideos.map((v) => serializeVideoResponse(req, v));
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

    await pool.query(
      "UPDATE videos SET thumbnail_index = $1 WHERE id = $2 AND user_id = $3",
      [Number(time), req.params.id, req.user.id],
    );

    res.json({ success: true, thumbnailIndex: Number(time) });
  } catch (e) {
    console.error("Set thumbnail error:", e);
    res.status(500).json({ error: "Failed to set thumbnail" });
  }
});

// Update video settings (signed-up users only)
app.patch("/api/video/:id/settings", auth, async (req, res) => {
  try {
    const { volume, description, autoplay, originalName, allowTimeComments } = req.body;

    const hasVolume = volume !== undefined;
    const hasDescription = description !== undefined;
    const hasAutoplay = autoplay !== undefined;
    const hasOriginalName = originalName !== undefined;
    const hasAllowTimeComments = allowTimeComments !== undefined;

    if (!hasVolume && !hasDescription && !hasAutoplay && !hasOriginalName && !hasAllowTimeComments) {
      return res.json({ success: true });
    }

    const normalizedVolume = hasVolume
      ? Math.max(0, Math.min(100, Number(volume)))
      : null;
    if (hasVolume && !Number.isFinite(normalizedVolume)) {
      return res.status(400).json({ error: "Volume must be a number" });
    }

    const normalizedAutoplay = hasAutoplay ? Boolean(autoplay) : null;
    const normalizedAllowTimeComments = hasAllowTimeComments ? Boolean(allowTimeComments) : null;

    const result = await pool.query(
      `UPDATE videos
       SET volume = CASE WHEN $1 THEN $2 ELSE volume END,
           description = CASE WHEN $3 THEN $4 ELSE description END,
           autoplay = CASE WHEN $5 THEN $6 ELSE autoplay END,
           original_name = CASE WHEN $7 THEN $8 ELSE original_name END,
           allow_time_comments = CASE WHEN $9 THEN $10 ELSE allow_time_comments END
       WHERE id = $11 AND user_id = $12`,
      [
        hasVolume,
        normalizedVolume,
        hasDescription,
        hasDescription ? sanitizeText(description, 500) : null,
        hasAutoplay,
        normalizedAutoplay,
        hasOriginalName,
        hasOriginalName ? sanitizeText(originalName, 200) : null,
        hasAllowTimeComments,
        normalizedAllowTimeComments,
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
           visibility = CASE WHEN $1 THEN 'private' ELSE 'public' END,
           private_token = CASE WHEN $1 THEN COALESCE(private_token, $2) ELSE NULL END
       WHERE id = $3 AND user_id = $4
       RETURNING visibility, is_private, private_token`,
      [isPrivate, privateToken, req.params.id, req.user.id],
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Video not found" });
    res.json({
      visibility: result.rows[0].visibility || (result.rows[0].is_private === true ? "private" : "public"),
      isPrivate: result.rows[0].is_private === true,
      privateToken: result.rows[0].private_token || "",
    });
  } catch (e) {
    console.error("Update privacy error:", e);
    res.status(500).json({ error: "Failed to update privacy" });
  }
});

app.patch("/api/video/:id/privacy-settings", auth, async (req, res) => {
  try {
    const requestedVisibility = String(req.body?.visibility || "public");
    const visibility = ["public", "hidden", "private"].includes(
      requestedVisibility,
    )
      ? requestedVisibility
      : "public";
    const isPrivate = visibility === "private";
    const privateToken = isPrivate
      ? crypto.randomBytes(24).toString("hex")
      : null;
    const allowDownloading = req.body?.allowDownloading !== false;
    const allowSharing = req.body?.allowSharing !== false;
    const domainPrivacy = req.body?.domainPrivacy === true;
    const allowedDomains = domainPrivacy
      ? sanitizeText(String(req.body?.allowedDomains || ""), 500)
      : "";
    const passwordProtection = req.body?.passwordProtection === true;
    const password = String(req.body?.password || "");
    const allowTimeComments = req.body?.allowTimeComments === true;
    const existingResult = await pool.query(
      "SELECT video_password_hash FROM videos WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id],
    );
    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: "Video not found" });
    }
    if (passwordProtection && !existingResult.rows[0].video_password_hash && !password) {
      return res.status(400).json({ error: "Set a password to enable password protection" });
    }
    const passwordHash = password
      ? await bcrypt.hash(password, BCRYPT_ROUNDS)
      : existingResult.rows[0].video_password_hash;

    const result = await pool.query(
      `UPDATE videos
       SET visibility = $1,
           is_private = $2,
           private_token = CASE WHEN $2 THEN COALESCE(private_token, $3) ELSE NULL END,
           allow_downloading = $4,
           allow_sharing = $5,
           domain_privacy = $6,
           allowed_domains = $7,
           password_protection = $8,
           video_password_hash = CASE WHEN $8 THEN $9 ELSE NULL END,
           allow_time_comments = $10
       WHERE id = $11 AND user_id = $12
       RETURNING visibility, is_private, private_token, allow_downloading, allow_sharing, domain_privacy, allowed_domains, password_protection, allow_time_comments`,
      [
        visibility,
        isPrivate,
        privateToken,
        allowDownloading,
        allowSharing,
        domainPrivacy,
        allowedDomains,
        passwordProtection,
        passwordHash,
        allowTimeComments,
        req.params.id,
        req.user.id,
      ],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Video not found" });
    }
    const updated = result.rows[0];

    res.json({
      visibility: updated.visibility || "public",
      isPrivate: updated.is_private === true,
      privateToken: updated.private_token || "",
      allowDownloading: updated.allow_downloading !== false,
      allowSharing: updated.allow_sharing !== false,
      domainPrivacy: updated.domain_privacy === true,
      allowedDomains: updated.allowed_domains || "",
      passwordProtection: updated.password_protection === true,
      allowTimeComments: updated.allow_time_comments === true,
    });
  } catch (e) {
    console.error("Update privacy settings error:", e);
    res.status(500).json({ error: "Failed to update privacy settings" });
  }
});

const timeCommentLimiter = (() => {
  const lastCommentAtByUser = new Map();
  const WINDOW_MS = 3000;
  return (req, res, next) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const now = Date.now();
    const last = lastCommentAtByUser.get(userId) || 0;
    if (now - last < WINDOW_MS) {
      return res.status(429).json({ error: "Slow down" });
    }
    lastCommentAtByUser.set(userId, now);
    next();
  };
})();

app.get("/api/video/:id/time-comments", async (req, res) => {
  try {
    const videoResult = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = videoResult.rows[0];
    if (!(await requireVideoAccess(req, res, video))) return;

    // Owners can access timed comments even if disabled (useful for testing / drafts).
    if (video.allow_time_comments !== true && !isVideoOwnerRequest(req, video)) {
      return res.json({ enabled: false, comments: [] });
    }

    const commentsResult = await pool.query(
      `SELECT c.id, c.time_seconds, c.body, c.created_at, c.user_id,
              CASE WHEN c.user_id IS NOT NULL AND c.user_id = v.user_id THEN true ELSE false END AS is_owner_comment
       FROM video_time_comments c
       JOIN videos v ON v.id = c.video_id
       WHERE c.video_id = $1
       ORDER BY c.time_seconds ASC, c.created_at ASC`,
      [req.params.id],
    );

    res.json({
      enabled: true,
      comments: commentsResult.rows.map((row) => ({
        id: row.id,
        timeSeconds: Number(row.time_seconds),
        body: row.body,
        author: { name: row.is_owner_comment === true ? "Owner" : "Viewer" },
        createdAt: serializeDbTimestamp(row.created_at),
      })),
    });
  } catch (e) {
    console.error("Get time comments error:", e);
    res.status(500).json({ error: "Failed to load comments" });
  }
});

app.post("/api/video/:id/time-comments", auth, timeCommentLimiter, async (req, res) => {
  try {
    const videoResult = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = videoResult.rows[0];
    if (!(await requireVideoAccess(req, res, video))) return;
    // Temporary testing mode: any signed-in user can post while the UI is being validated.

    const body = sanitizeText(String(req.body?.body || ""), 500).trim();
    if (!body) return res.status(400).json({ error: "Comment cannot be empty" });

    const timeSeconds = parseTimeSeconds(req.body?.timeSeconds);
    if (timeSeconds === null) return res.status(400).json({ error: "Invalid timeSeconds" });

    const insertResult = await pool.query(
      `INSERT INTO video_time_comments (video_id, user_id, time_seconds, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, time_seconds, body, created_at`,
      [req.params.id, req.user.id, timeSeconds, body],
    );
    const inserted = insertResult.rows[0];
    res.status(201).json({
      id: inserted.id,
      timeSeconds: Number(inserted.time_seconds),
      body: inserted.body,
      author: { name: req.user.id === video.user_id ? "Owner" : "Viewer" },
      createdAt: serializeDbTimestamp(inserted.created_at),
    });
  } catch (e) {
    console.error("Create time comment error:", e);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

app.delete("/api/video/:id/time-comments/:commentId", auth, async (req, res) => {
  try {
    const videoResult = await pool.query("SELECT * FROM videos WHERE id = $1", [
      req.params.id,
    ]);
    const video = videoResult.rows[0];
    if (!(await requireVideoAccess(req, res, video))) return;
    if (!isVideoOwnerRequest(req, video)) {
      return res.status(403).json({ error: "Only the owner can delete comments" });
    }

    const commentId = Number(req.params.commentId);
    if (!Number.isInteger(commentId)) return res.status(400).json({ error: "Invalid comment id" });

    const result = await pool.query(
      "DELETE FROM video_time_comments WHERE id = $1 AND video_id = $2",
      [commentId, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Comment not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("Delete time comment error:", e);
    res.status(500).json({ error: "Failed to delete comment" });
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

    const { bunnyOk, bunnyError } = await deleteVideoRecord(result.rows[0]);
    res.json({ success: true, bunnyOk, bunnyError: bunnyOk ? null : bunnyError });
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
        ...serializeVideoResponse(req, {
          ...video,
          bunny_video_id: bunnyVideo.guid,
          size: req.file.size,
        }),
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
  const normalizedIds = normalizeVideoIds(ids, ANONYMOUS_DASHBOARD_LIMIT);
  if (normalizedIds.length === 0) return res.json([]);

  try {
    const result = await pool.query(
      "SELECT * FROM videos WHERE id = ANY($1) AND expires_at > NOW() AND is_private = false AND COALESCE(visibility, 'public') = 'public'",
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
        if (!statusRes.ok) {
          // Video deleted from Bunny — clean up DB
          await pool.query("DELETE FROM videos WHERE id = $1", [v.id]);
          continue;
        }

        const readiness = await getBunnyReadiness(v.bunny_video_id, v.original_name);
        if (isBunnyReady(readiness) || readiness.state === "unknown") {
          validVideos.push(v);
        }
      } catch (error) {
        console.error("Failed to verify video readiness for anon batch:", error);
        validVideos.push(v); // Keep on transient errors to avoid hiding valid videos.
      }
    }

    const videos = validVideos.map((v) => serializeVideoResponse(req, v));

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
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="CUTRR - Discord Video Hosting and Embed Links">
  <meta property="og:description" content="Upload videos up to 100MB and get short links that embed cleanly in Discord. Made for edits, clips, previews, and quick video sharing.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="CUTRR">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="CUTRR - Discord Video Hosting and Embed Links">
  <meta name="twitter:description" content="A fast Discord video host for editors and creators. Upload up to 100MB, copy a short link, and share clean embeds.">
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

app.get("/", async (req, res) => {
  const origin = getRequestPublicOrigin(req);
  let sampleId = "";
  try {
    const result = await pool.query(
      "SELECT id FROM videos WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
    );
    sampleId = result.rows[0]?.id || "";
  } catch {}

  const sampleVideoUrl = sampleId ? `${origin}/${sampleId}` : "";
  const sampleEmbedUrl = sampleId ? `${origin}/embed/${sampleId}` : "";

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CUTRR API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #111; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    code, a { word-break: break-all; }
    .box { margin-top: 1rem; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; }
  </style>
</head>
<body>
  <h1>CUTRR API is running</h1>
  <p>The root URL is just the API. Use a video link for Discord embed testing.</p>
  <div class="box">
    <p><strong>Discord embed link format</strong></p>
    <p><code>${origin}/&lt;videoId&gt;</code></p>
    ${
      sampleVideoUrl
        ? `<p>Try: <a href="${escapeHtml(sampleVideoUrl)}">${escapeHtml(sampleVideoUrl)}</a></p>`
        : "<p>Upload a video first, then use its 8-character ID.</p>"
    }
    ${
      sampleEmbedUrl
        ? `<p>Embed player: <a href="${escapeHtml(sampleEmbedUrl)}">${escapeHtml(sampleEmbedUrl)}</a></p>`
        : ""
    }
  </div>
  <p>App UI: <a href="http://localhost:5173">http://localhost:5173</a></p>
</body>
</html>`);
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on port ${PORT}`),
);

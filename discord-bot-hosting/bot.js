import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { createDiscordService } from "./discordBot.js";

console.log("CUTRR bot starting...");

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

const getRequiredEnv = (key) => {
  const value = process.env[key]?.trim();
  if (!value) {
    console.error(
      `Missing required environment variable: ${key}. Add it to .env in the PebbleHost File Manager (same folder as bot.js).`,
    );
    process.exit(1);
  }
  return value;
};

const DATABASE_URL = getRequiredEnv("DATABASE_URL");
const DISCORD_BOT_TOKEN = getRequiredEnv("DISCORD_BOT_TOKEN");
console.log("Required environment variables found.");

if (/^postgres(ql)?:\/\/postgres:[^@]+@db\.[^.]+\.supabase\.co/i.test(DATABASE_URL)) {
  console.warn(
    "DATABASE_URL uses Supabase direct host db.*.supabase.co (IPv6-only). PebbleHost cannot reach it — use the Session pooler URL from Supabase Dashboard → Connect → Session pooler (*.pooler.supabase.com).",
  );
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: false }
});

const discordService = createDiscordService(pool, {
  botToken: DISCORD_BOT_TOKEN,
  frontendUrl: process.env.FRONTEND_URL?.trim() || "https://cutrr.xyz",
  embedUrl:
    process.env.DISCORD_EMBED_URL?.trim() ||
    process.env.PUBLIC_API_URL?.trim() ||
    process.env.API_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    process.env.SERVER_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    "https://cutrr.xyz",
  bunnyCdnHost: process.env.BUNNY_CDN_HOST?.trim() || "",
  videoBaseUrl: process.env.PUBLIC_VIDEO_URL?.trim() || "https://cutrr.xyz"
});

const reminderIntervalMs = Math.max(
  60_000,
  Number.parseInt(process.env.DISCORD_REMINDER_INTERVAL_MS || "3600000", 10) || 3_600_000
);

const shutdown = async (signal) => {
  console.log(`${signal} received; closing database pool.`);
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error("Failed during SIGTERM shutdown:", error);
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error("Failed during SIGINT shutdown:", error);
    process.exit(1);
  });
});

try {
  await pool.query("SELECT 1");
  console.log("Database connection ready.");
} catch (error) {
  console.error(
    "Could not connect to the database. Check DATABASE_URL (and DATABASE_SSL). Details:",
    error.message,
  );
  await pool.end().catch(() => {});
  process.exit(1);
}
await pool.query(
  "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS ping_role_ids JSONB DEFAULT '[]'::jsonb",
);
await pool.query(
  "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS voting_enabled BOOLEAN DEFAULT true",
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
console.log("Database schema ready.");

try {
  await discordService.start();
} catch (error) {
  if (error?.code === "TokenInvalid") {
    console.error(
      "Discord bot token is invalid. In PebbleHost, set DISCORD_BOT_TOKEN to the Bot token from the Discord Developer Portal. Do not use the client secret, public key, application id, or include quotes.",
    );
  } else {
    console.error("Discord bot failed to start:", error);
  }
  await pool.end().catch(() => {});
  process.exit(1);
}

setInterval(() => {
  discordService.sendPendingVoteReminders().catch((error) => {
    console.error("Discord pending vote reminder job failed:", error);
  });
}, reminderIntervalMs);

console.log(`Discord reminder loop running every ${reminderIntervalMs}ms.`);

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { createDiscordService } from "./discordBot.js";

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
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const pool = new pg.Pool({
  connectionString: getRequiredEnv("DATABASE_URL"),
  ssl: process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: false }
});

const discordService = createDiscordService(pool, {
  botToken: getRequiredEnv("DISCORD_BOT_TOKEN"),
  frontendUrl: process.env.FRONTEND_URL?.trim() || "https://cutrr.xyz",
  bunnyCdnHost: process.env.BUNNY_CDN_HOST?.trim() || ""
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

await pool.query("SELECT 1");
console.log("Database connection ready.");
await pool.query(
  "ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS ping_role_ids JSONB DEFAULT '[]'::jsonb",
);
console.log("Database schema ready.");

await discordService.start();

setInterval(() => {
  discordService.sendPendingVoteReminders().catch((error) => {
    console.error("Discord pending vote reminder job failed:", error);
  });
}, reminderIntervalMs);

console.log(`Discord reminder loop running every ${reminderIntervalMs}ms.`);

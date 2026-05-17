-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos table
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
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_expires_at ON videos(expires_at);

-- Discord application forms
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
  panel_message_id VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backfill / migrations for existing deployments
ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS reviewer_role_id VARCHAR(32);
ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS ping_role_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE discord_forms ADD COLUMN IF NOT EXISTS voting_enabled BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_discord_forms_owner ON discord_forms(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_discord_forms_slug ON discord_forms(slug);

CREATE TABLE IF NOT EXISTS discord_form_submissions (
  id SERIAL PRIMARY KEY,
  form_id INTEGER REFERENCES discord_forms(id) ON DELETE CASCADE,
  video_id VARCHAR(8) REFERENCES videos(id) ON DELETE SET NULL,
  discord_user_id VARCHAR(32) NOT NULL,
  discord_username VARCHAR(120) DEFAULT '',
  answers JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) DEFAULT 'pending',
  reviewer_note TEXT DEFAULT '',
  discord_message_id VARCHAR(32),
  cooldown_until TIMESTAMP,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMP,
  last_reminder_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_submissions_form ON discord_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_discord_submissions_message ON discord_form_submissions(discord_message_id);
CREATE INDEX IF NOT EXISTS idx_discord_submissions_discord_user ON discord_form_submissions(discord_user_id);

ALTER TABLE discord_form_submissions ADD COLUMN IF NOT EXISTS reviewer_note TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS discord_form_cooldowns (
  id SERIAL PRIMARY KEY,
  form_id INTEGER REFERENCES discord_forms(id) ON DELETE CASCADE,
  discord_user_id VARCHAR(32) NOT NULL,
  reason VARCHAR(20) NOT NULL,
  cooldown_until TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_cooldowns_lookup ON discord_form_cooldowns(form_id, discord_user_id, cooldown_until);

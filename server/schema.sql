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

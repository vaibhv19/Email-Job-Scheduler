-- ReachInbox Email Scheduler Migration: 003_user_sessions.sql
-- Server-side session management for authenticated user sessions (Phase 6 OAuth)

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY, -- SHA-256 hash of the cryptographically secure session token
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

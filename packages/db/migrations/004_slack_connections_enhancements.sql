-- ReachInbox Email Scheduler Schema Migration
-- Version: 004_slack_connections_enhancements.sql

ALTER TABLE slack_connections
  ADD COLUMN IF NOT EXISTS team_name TEXT,
  ADD COLUMN IF NOT EXISTS channel_id TEXT,
  ADD COLUMN IF NOT EXISTS channel_name TEXT,
  ADD COLUMN IF NOT EXISTS bot_user_id TEXT,
  ADD COLUMN IF NOT EXISTS incoming_webhook_url_encrypted TEXT;

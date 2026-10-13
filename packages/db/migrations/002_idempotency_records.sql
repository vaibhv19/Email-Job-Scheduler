-- ReachInbox Email Scheduler Migration: 002_idempotency_records.sql
-- Supports request-level idempotency, response caching, and payload conflict detection

CREATE TABLE IF NOT EXISTS idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_idempotency_user_key UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_lookup ON idempotency_records(user_id, idempotency_key);

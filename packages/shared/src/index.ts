/**
 * ReachInbox Shared Constants and Types
 */

export const EMAIL_STATUS = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
} as const;

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const RATE_LIMIT_DEFAULTS = {
  MIN_SEND_INTERVAL_MS: 2000,
  MAX_EMAILS_PER_HOUR: 50,
  WORKER_CONCURRENCY: 5,
} as const;

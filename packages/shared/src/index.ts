import { z } from 'zod';
export * from './recipients.js';
export * from './crypto.js';

/**
 * Shared Constants and Types
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

/**
 * Zod schema for validating email scheduling requests (BE-01, BE-04, BE-16)
 */
export const scheduleEmailSchema = z
  .object({
    sender_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
      message: 'sender_id must be a valid UUID',
    }),
    recipient_email: z.string().email({ message: 'Invalid recipient email address' }).optional(),
    recipient_emails: z
      .array(z.string().email({ message: 'Invalid email in recipient list' }))
      .min(1, { message: 'At least one recipient email is required in recipient_emails' })
      .optional(),
    recipients_raw: z.string().optional(),
    subject: z.string().min(1, { message: 'Subject is required and cannot be empty' }),
    body: z.string().min(1, { message: 'Body is required and cannot be empty' }),
    scheduled_at: z
      .string()
      .datetime({ message: 'scheduled_at must be an ISO 8601 UTC date string' })
      .refine(
        (val) => {
          const date = new Date(val);
          // Allow up to 60 seconds clock skew in the past, but reject past scheduling (BE-16)
          const nowWithSkew = Date.now() - 60000;
          return date.getTime() >= nowWithSkew;
        },
        {
          message: 'scheduled_at cannot be in the past',
        },
      ),
  })
  .refine((data) => Boolean(data.recipient_email || data.recipient_emails || data.recipients_raw), {
    message:
      'At least one recipient must be provided (recipient_email, recipient_emails, or recipients_raw)',
    path: ['recipient_email'],
  });

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

import { query } from '@reachinbox/db';
import { getRedisClient } from '@reachinbox/redis';
import { decryptToken } from '@reachinbox/shared';

export interface QuotaAlertPayload {
  senderId: string;
  senderEmail: string;
  userId: string;
  maxQuota: number;
  currentCount: number;
  nextEligibleTime: number;
}

export interface SlackNotificationResult {
  sent: boolean;
  reason?: 'duplicate_suppressed' | 'not_connected' | 'provider_error' | 'success';
  error?: string;
}

/**
 * Sends a real rate-limit quota exhaustion alert to the user's connected Slack workspace (SLACK-07..SLACK-11)
 *
 * Guarantees:
 * 1. Deduplicates alerts per sender and hourly window using atomic Redis SET NX (SLACK-08).
 * 2. Dynamically queries the database so workspaces connected after deployment receive alerts immediately (SLACK-10).
 * 3. Gracefully skips if Slack is not connected or disconnected (SLACK-09).
 * 4. Never throws or fails email processing if Slack API fails or returns errors (SLACK-11).
 */
export async function notifySlackQuotaExhausted(
  payload: QuotaAlertPayload,
): Promise<SlackNotificationResult> {
  try {
    const redis = getRedisClient();
    const utcHour = new Date().toISOString().substring(0, 13); // e.g. "2026-10-14T10"
    const dedupKey = `slack_alert:${payload.senderId}:${utcHour}`;

    // 1. Atomic deduplication: exactly one alert per sender per UTC hour window (SLACK-08)
    const acquired = await redis.set(dedupKey, '1', 'EX', 3600, 'NX');
    if (!acquired) {
      console.log(
        `[Slack] Rate limit alert already sent for sender ${payload.senderId} (${payload.senderEmail}) in window ${utcHour}. Skipping duplicate.`,
      );
      return { sent: false, reason: 'duplicate_suppressed' };
    }

    // 2. Resolve user's Slack connection from PostgreSQL (SLACK-04, SLACK-10)
    const connRes = await query<{
      team_id: string;
      team_name: string | null;
      access_token_encrypted: string;
      incoming_webhook_url_encrypted: string | null;
      channel_id: string | null;
    }>(
      `SELECT team_id, team_name, access_token_encrypted, incoming_webhook_url_encrypted, channel_id
       FROM slack_connections
       WHERE user_id = $1`,
      [payload.userId],
    );

    if (connRes.rows.length === 0) {
      console.log(
        `[Slack] No active Slack connection found for user ${payload.userId}. Skipping notification.`,
      );
      return { sent: false, reason: 'not_connected' };
    }

    const conn = connRes.rows[0];
    const accessToken = decryptToken(conn.access_token_encrypted);
    const webhookUrl = conn.incoming_webhook_url_encrypted
      ? decryptToken(conn.incoming_webhook_url_encrypted)
      : null;

    if (!accessToken && !webhookUrl) {
      console.log(`[Slack] Slack connection has empty credentials for user ${payload.userId}.`);
      return { sent: false, reason: 'not_connected' };
    }

    const nextSendUtc = new Date(payload.nextEligibleTime).toUTCString();
    const alertText = `⚠️ *ReachInbox Rate Limit Alert*: Sender \`${payload.senderEmail}\` has exhausted its hourly quota (${payload.currentCount}/${payload.maxQuota} emails). Remaining emails have been deferred to ${nextSendUtc}.`;

    const messagePayload = {
      text: alertText,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ ReachInbox Rate Limit Alert',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Sender:*\n${payload.senderEmail}` },
            { type: 'mrkdwn', text: `*Hourly Quota:*\n${payload.maxQuota} emails/hr` },
            { type: 'mrkdwn', text: `*Current Window Sends:*\n${payload.currentCount}` },
            { type: 'mrkdwn', text: `*Next Send Window:*\n${nextSendUtc}` },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🛡️ All pending emails remain safely queued in BullMQ and will resume automatically.',
            },
          ],
        },
      ],
    };

    // 3. Dispatch to Slack via Incoming Webhook or Web API
    let response: Response;
    if (webhookUrl) {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload),
      });
    } else {
      const channel = conn.channel_id || '#general';
      response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          ...messagePayload,
        }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Slack] Failed to post message to Slack (HTTP ${response.status}): ${errorText}`,
      );
      return { sent: false, reason: 'provider_error', error: errorText };
    }

    // Verify Slack API JSON response if Web API was used
    if (!webhookUrl) {
      const resultJson = (await response.json()) as { ok?: boolean; error?: string };
      if (!resultJson.ok) {
        console.error(`[Slack] Slack API rejected message: ${resultJson.error}`);
        return { sent: false, reason: 'provider_error', error: resultJson.error };
      }
    }

    console.log(
      `[Slack] Rate limit alert successfully delivered to Slack for sender ${payload.senderEmail}.`,
    );
    return { sent: true, reason: 'success' };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Slack] Error while sending Slack rate limit alert (non-fatal):`, errorMsg);
    // Never fail email processing if Slack throws an exception (SLACK-11)
    return { sent: false, reason: 'provider_error', error: errorMsg };
  }
}

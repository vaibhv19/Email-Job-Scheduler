import crypto from 'node:crypto';
import { query } from '@email-scheduler/db';
import { encryptToken, decryptToken } from '@email-scheduler/shared';

export const SLACK_STATE_COOKIE_NAME = 'scheduler_slack_state';

export interface SlackConnectionDto {
  connected: boolean;
  team_id?: string;
  team_name?: string | null;
  channel_name?: string | null;
  scopes?: string;
  connected_at?: string;
}

function getHmacSecret(): string {
  return process.env.SESSION_SECRET || 'email-scheduler-slack-hmac-key';
}

export function signSlackState(userId: string, nonce: string): string {
  const hmac = crypto
    .createHmac('sha256', getHmacSecret())
    .update(`${userId}:${nonce}`)
    .digest('hex');
  return `${userId}:${nonce}:${hmac}`;
}

export function verifySlackState(state: string): { valid: boolean; userId?: string } {
  if (!state || typeof state !== 'string') return { valid: false };
  const parts = state.split(':');
  if (parts.length !== 3) return { valid: false };
  const [userId, nonce, hmac] = parts;
  const expectedHmac = crypto
    .createHmac('sha256', getHmacSecret())
    .update(`${userId}:${nonce}`)
    .digest('hex');

  if (
    hmac.length === expectedHmac.length &&
    crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))
  ) {
    return { valid: true, userId };
  }
  return { valid: false };
}

export function buildSlackInstallUrl(userId: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    throw new Error('SLACK_NOT_CONFIGURED');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const signedState = signSlackState(userId, nonce);

  const redirectUri =
    process.env.SLACK_CALLBACK_URL ||
    `${process.env.API_BASE_URL || 'http://localhost:3001'}/api/slack/callback`;

  // Standard bot scopes required for notifications and incoming webhook
  const scopes = 'chat:write,chat:write.public,incoming-webhook';

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: signedState,
  });

  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;

  const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const stateCookie = {
    name: SLACK_STATE_COOKIE_NAME,
    value: signedState,
    options: {
      httpOnly: true,
      secure: isSecure,
      sameSite: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
      maxAge: 15 * 60 * 1000, // 15 mins
      path: '/',
    },
  };

  return { url, stateCookie };
}

export async function exchangeSlackAuthorizationCode(
  code: string,
  state: string,
  cookieState?: string,
) {
  // 1. Verify state parameter (SLACK-03)
  const verification = verifySlackState(state);
  if (!verification.valid || !verification.userId) {
    throw new Error('INVALID_STATE');
  }

  if (cookieState && cookieState !== state) {
    throw new Error('STATE_MISMATCH');
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SLACK_NOT_CONFIGURED');
  }

  const redirectUri =
    process.env.SLACK_CALLBACK_URL ||
    `${process.env.API_BASE_URL || 'http://localhost:3001'}/api/slack/callback`;

  // 2. Real OAuth exchange with Slack (SLACK-01)
  const tokenEndpoint = 'https://slack.com/api/oauth.v2.access';
  const bodyParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  });

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id: string; name: string };
    incoming_webhook?: {
      url: string;
      channel: string;
      channel_id: string;
      configuration_url: string;
    };
  };

  if (!data.ok || !data.access_token) {
    throw new Error(data.error || 'SLACK_EXCHANGE_FAILED');
  }

  // 3. Encrypt credentials at rest (SLACK-04, SLACK-05)
  const encryptedToken = encryptToken(data.access_token);
  const encryptedWebhookUrl = data.incoming_webhook?.url
    ? encryptToken(data.incoming_webhook.url)
    : null;

  const teamId = data.team?.id || '';
  const teamName = data.team?.name || null;
  const scopes = data.scope || '';
  const botUserId = data.bot_user_id || null;
  const channelId = data.incoming_webhook?.channel_id || null;
  const channelName = data.incoming_webhook?.channel || null;

  // 4. Upsert into database
  await query(
    `INSERT INTO slack_connections (
       user_id, team_id, team_name, access_token_encrypted, scopes,
       bot_user_id, channel_id, channel_name, incoming_webhook_url_encrypted, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       team_id = EXCLUDED.team_id,
       team_name = EXCLUDED.team_name,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       scopes = EXCLUDED.scopes,
       bot_user_id = EXCLUDED.bot_user_id,
       channel_id = EXCLUDED.channel_id,
       channel_name = EXCLUDED.channel_name,
       incoming_webhook_url_encrypted = EXCLUDED.incoming_webhook_url_encrypted,
       updated_at = NOW();`,
    [
      verification.userId,
      teamId,
      teamName,
      encryptedToken,
      scopes,
      botUserId,
      channelId,
      channelName,
      encryptedWebhookUrl,
    ],
  );

  return { userId: verification.userId, teamName };
}

export async function getSlackConnection(userId: string): Promise<SlackConnectionDto> {
  const res = await query<{
    team_id: string;
    team_name: string | null;
    channel_name: string | null;
    scopes: string;
    connected_at: Date;
  }>(
    `SELECT team_id, team_name, channel_name, scopes, connected_at
     FROM slack_connections
     WHERE user_id = $1`,
    [userId],
  );

  if (res.rows.length === 0) {
    return { connected: false };
  }

  const row = res.rows[0];
  return {
    connected: true,
    team_id: row.team_id,
    team_name: row.team_name,
    channel_name: row.channel_name,
    scopes: row.scopes,
    connected_at: row.connected_at.toISOString(),
  };
}

export async function disconnectSlack(userId: string): Promise<void> {
  // Query token to attempt graceful revocation
  const res = await query<{ access_token_encrypted: string }>(
    `SELECT access_token_encrypted FROM slack_connections WHERE user_id = $1`,
    [userId],
  );

  if (res.rows.length > 0 && res.rows[0].access_token_encrypted) {
    try {
      const token = decryptToken(res.rows[0].access_token_encrypted);
      // Attempt revoke on Slack side, ignore errors if already revoked
      await fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (err) {
      console.warn('[Slack] Revocation request error (non-fatal):', err);
    }
  }

  await query('DELETE FROM slack_connections WHERE user_id = $1', [userId]);
}

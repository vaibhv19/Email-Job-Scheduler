import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  buildSlackInstallUrl,
  exchangeSlackAuthorizationCode,
  getSlackConnection,
  disconnectSlack,
  SLACK_STATE_COOKIE_NAME,
} from '../modules/slack/slack.service.js';
import { getClearCookieOptions } from '../modules/auth/session.js';

const router = Router();

// 1. Initiate Slack OAuth flow (SLACK-01, SLACK-02)
router.get('/install', requireUser, (req, res) => {
  try {
    const { url, stateCookie } = buildSlackInstallUrl(req.user!.id);
    res.cookie(stateCookie.name, stateCookie.value, stateCookie.options);
    return res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'SLACK_NOT_CONFIGURED') {
      return res.status(503).json({
        error: {
          code: 'SLACK_NOT_CONFIGURED',
          message:
            'Slack OAuth is not configured. Please set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env.',
        },
      });
    }
    return res.status(500).json({
      error: {
        code: 'SLACK_INSTALL_FAILED',
        message: 'Failed to initiate Slack OAuth installation.',
      },
    });
  }
});

// 2. Slack OAuth Callback (SLACK-01, SLACK-03, SLACK-04, SLACK-05)
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    console.warn(`[Slack OAuth] Consent or authorization failed: ${error}`);
    return res.redirect(`${frontendUrl}/?slack_error=${encodeURIComponent(String(error))}`);
  }

  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Missing required code or state parameter in Slack OAuth callback.',
      },
    });
  }

  const cookieState = req.cookies?.[SLACK_STATE_COOKIE_NAME];

  try {
    await exchangeSlackAuthorizationCode(code, state, cookieState);
    res.clearCookie(SLACK_STATE_COOKIE_NAME, getClearCookieOptions());
    return res.redirect(`${frontendUrl}/?slack_connected=true`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Slack OAuth] Callback exchange error:', message);
    res.clearCookie(SLACK_STATE_COOKIE_NAME, getClearCookieOptions());

    if (message === 'INVALID_STATE' || message === 'STATE_MISMATCH') {
      return res.status(400).json({
        error: {
          code: 'INVALID_SLACK_STATE',
          message: 'Invalid or mismatched Slack OAuth state parameter.',
        },
      });
    }

    if (message === 'SLACK_NOT_CONFIGURED') {
      return res.status(503).json({
        error: {
          code: 'SLACK_NOT_CONFIGURED',
          message: 'Slack OAuth credentials are not configured.',
        },
      });
    }

    return res.redirect(`${frontendUrl}/?slack_error=${encodeURIComponent(message)}`);
  }
});

// 3. Get connection status (SLACK-04, SLACK-05)
router.get('/connection', requireUser, async (req, res) => {
  try {
    const connection = await getSlackConnection(req.user!.id);
    return res.json({ data: connection });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: {
        code: 'SLACK_STATUS_FAILED',
        message,
      },
    });
  }
});

// 4. Disconnect Slack (SLACK-06)
router.post('/disconnect', requireUser, async (req, res) => {
  try {
    await disconnectSlack(req.user!.id);
    return res.json({
      data: {
        success: true,
        message: 'Slack workspace successfully disconnected.',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: {
        code: 'SLACK_DISCONNECT_FAILED',
        message,
      },
    });
  }
});

export default router;

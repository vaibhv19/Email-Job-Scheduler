import { Router, type Request, type Response } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getGoogleOAuthConfig,
  createGoogleOAuth2Client,
  generateOAuthParams,
  signOAuthState,
  verifyOAuthState,
  buildGoogleAuthUrl,
  exchangeCodeForGoogleProfile,
  resolveOrCreateGoogleUser,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_TTL_MS,
} from '../modules/auth/google.js';
import {
  createSession,
  invalidateSession,
  getSessionCookieOptions,
  getClearCookieOptions,
  SESSION_COOKIE_NAME,
} from '../modules/auth/session.js';

export const authRouter = Router();

/**
 * GET /api/auth/google
 * Initiates the real Google OAuth 2.0 authorization-code flow with PKCE and state protection.
 * Redirects the user to Google's real consent/authorization screen.
 */
authRouter.get('/api/auth/google', (_req: Request, res: Response): void => {
  const config = getGoogleOAuthConfig();

  if (!config.isConfigured) {
    res.status(503).json({
      error: {
        code: 'OAUTH_CONFIG_REQUIRED',
        message:
          'Google OAuth 2.0 is not configured on this server. Real GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables must be provided.',
      },
    });
    return;
  }

  try {
    const client = createGoogleOAuth2Client();
    const { state, codeVerifier, codeChallenge } = generateOAuthParams();

    const sessionSecret = process.env.SESSION_SECRET || 'reachinbox_default_session_secret_32_chars';
    const signedCookieValue = signOAuthState(
      { state, codeVerifier, createdAt: Date.now() },
      sessionSecret,
    );

    const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

    // Set short-lived HTTP-only state cookie to protect against CSRF & replay attacks
    res.cookie(OAUTH_STATE_COOKIE_NAME, signedCookieValue, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: OAUTH_STATE_TTL_MS,
      path: '/',
    });

    const authorizationUrl = buildGoogleAuthUrl(client, state, codeChallenge);
    res.redirect(authorizationUrl);
  } catch (err) {
    console.error('Failed to initiate Google OAuth:', err);
    res.status(500).json({
      error: {
        code: 'OAUTH_INITIATION_FAILED',
        message: 'Failed to initiate Google OAuth flow',
      },
    });
  }
});

/**
 * GET /api/auth/google/callback
 * Handles Google's authorization callback:
 * 1. Validates OAuth state and enforces PKCE verification.
 * 2. Exchanges code with Google using server-side client secret.
 * 3. Retrieves and validates verified identity from Google userinfo endpoint.
 * 4. Persists/resolves user in PostgreSQL using Google's stable `sub` identifier.
 * 5. Establishes a real session in user_sessions and sets HTTP-only session cookie.
 * 6. Redirects authenticated user to the ReachInbox dashboard.
 */
authRouter.get('/api/auth/google/callback', async (req: Request, res: Response): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  // 1. Check for error returned by Google
  if (req.query.error) {
    console.error('Google OAuth error from authorization server:', req.query.error);
    res.redirect(
      `${frontendUrl}/?error=${encodeURIComponent(String(req.query.error_description || req.query.error))}`,
    );
    return;
  }

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state) {
    res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Missing authorization code or state parameter from Google callback',
      },
    });
    return;
  }

  // 2. Validate OAuth state from HTTP-only cookie
  const sessionSecret = process.env.SESSION_SECRET || 'reachinbox_default_session_secret_32_chars';
  const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
  const verifiedState = verifyOAuthState(stateCookie, sessionSecret);

  if (!verifiedState || verifiedState.state !== state) {
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, getClearCookieOptions());
    res.status(400).json({
      error: {
        code: 'INVALID_OAUTH_STATE',
        message: 'OAuth state mismatch, expired, or invalid cookie. Authorization aborted for security.',
      },
    });
    return;
  }

  try {
    const client = createGoogleOAuth2Client();

    // 3. Exchange code for tokens & fetch verified Google identity
    const profile = await exchangeCodeForGoogleProfile(client, code, verifiedState.codeVerifier);

    // 4. Resolve or create user in PostgreSQL by stable Google sub
    const user = await resolveOrCreateGoogleUser(profile);

    // 5. Establish real server session in PostgreSQL
    const { sessionToken } = await createSession(user.id);

    // Clear state cookie & set real session cookie
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, getClearCookieOptions());
    res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    // 6. Redirect authenticated user to frontend dashboard
    res.redirect(`${frontendUrl}/`);
  } catch (err) {
    console.error('OAuth callback execution failed:', err);
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, getClearCookieOptions());
    res.status(500).json({
      error: {
        code: 'OAUTH_EXCHANGE_FAILED',
        message: (err as Error)?.message || 'Failed to complete Google OAuth authentication',
      },
    });
  }
});

/**
 * GET /api/auth/me
 * Protected endpoint returning the currently authenticated user's identity.
 */
authRouter.get('/api/auth/me', requireUser, (req: Request, res: Response): void => {
  res.status(200).json({
    user: req.user,
  });
});

/**
 * POST /api/auth/logout
 * Terminates the server session in PostgreSQL and invalidates the session cookie.
 */
authRouter.post('/api/auth/logout', async (req: Request, res: Response): Promise<void> => {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const token =
    cookieToken ||
    (authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined);

  if (token) {
    await invalidateSession(token);
  }

  res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions());
  res.status(200).json({
    status: 'ok',
    message: 'Logged out successfully',
  });
});

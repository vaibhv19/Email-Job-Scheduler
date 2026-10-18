import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface SendMailParams {
  emailId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  smtpConfig?: SmtpConfig;
}

export interface SendMailResult {
  success: boolean;
  messageId: string;
  providerMessageId?: string;
  previewUrl?: string;
  response?: string;
  isTransientError?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

let cachedTestAccount: { user: string; pass: string; host: string; port: number } | null = null;
const transportCache = new Map<string, Transporter>();

/**
 * Resolves or creates an Ethereal SMTP transporter (SMTP-01, SMTP-02)
 */
export async function getTransporter(customConfig?: SmtpConfig): Promise<Transporter> {
  if (customConfig) {
    const cacheKey = `${customConfig.host}:${customConfig.port}:${customConfig.auth.user}`;
    if (!transportCache.has(cacheKey)) {
      transportCache.set(
        cacheKey,
        nodemailer.createTransport({
          host: customConfig.host,
          port: customConfig.port,
          secure: customConfig.secure ?? false,
          auth: customConfig.auth,
        }),
      );
    }
    return transportCache.get(cacheKey)!;
  }

  // Check if env provides explicit Ethereal credentials
  const envUser = process.env.ETHEREAL_USER;
  const envPass = process.env.ETHEREAL_PASS;
  const envHost = process.env.ETHEREAL_HOST || 'smtp.ethereal.email';
  const envPort = process.env.ETHEREAL_PORT ? parseInt(process.env.ETHEREAL_PORT, 10) : 587;

  if (envUser && envPass) {
    const cacheKey = `env:${envHost}:${envPort}:${envUser}`;
    if (!transportCache.has(cacheKey)) {
      transportCache.set(
        cacheKey,
        nodemailer.createTransport({
          host: envHost,
          port: envPort,
          secure: envPort === 465,
          auth: { user: envUser, pass: envPass },
        }),
      );
    }
    return transportCache.get(cacheKey)!;
  }

  // Dynamically generate and cache Ethereal test account if not configured
  if (!cachedTestAccount) {
    const testAccount = await nodemailer.createTestAccount();
    cachedTestAccount = {
      user: testAccount.user,
      pass: testAccount.pass,
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
    };
  }

  const cacheKey = `dynamic:${cachedTestAccount.user}`;
  if (!transportCache.has(cacheKey)) {
    transportCache.set(
      cacheKey,
      nodemailer.createTransport({
        host: cachedTestAccount.host,
        port: cachedTestAccount.port,
        secure: cachedTestAccount.port === 465,
        auth: {
          user: cachedTestAccount.user,
          pass: cachedTestAccount.pass,
        },
      }),
    );
  }

  return transportCache.get(cacheKey)!;
}

/**
 * Classifies whether an SMTP or network error is transient/retryable (SMTP-06)
 */
export function classifySmtpError(err: unknown): {
  isTransient: boolean;
  code: string;
  message: string;
} {
  const error = err as {
    responseCode?: number;
    code?: string;
    message?: string;
  };

  const code = error.code || (error.responseCode ? `SMTP_${error.responseCode}` : 'UNKNOWN_ERROR');
  const message = error.message || 'Unknown SMTP error';

  // 4xx SMTP codes indicate transient errors (mailbox full, greylisting, temp rate-limit)
  if (error.responseCode && error.responseCode >= 400 && error.responseCode < 500) {
    return { isTransient: true, code, message };
  }

  // Network level transient errors
  const transientCodes = new Set([
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ESOCKETTIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
  ]);
  if (error.code && transientCodes.has(error.code)) {
    return { isTransient: true, code, message };
  }

  // 5xx SMTP codes are permanent failures (550 User unknown, 554 Transaction failed, auth rejection)
  return { isTransient: false, code, message };
}

/**
 * Sends an email using Nodemailer, generating a stable Message-ID and capturing Ethereal preview URLs (SMTP-01, SMTP-03, SMTP-04, SMTP-05)
 */
export async function sendEmailViaSmtp(params: SendMailParams): Promise<SendMailResult> {
  const stableMessageId = `<${params.emailId}@scheduler.local>`;
  const transporter = await getTransporter(params.smtpConfig);

  try {
    const info = await transporter.sendMail({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.body,
      text: params.body.replace(/<[^>]+>/g, ''), // Plain-text fallback
      messageId: stableMessageId,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

    return {
      success: true,
      messageId: stableMessageId,
      providerMessageId: info.messageId || stableMessageId,
      previewUrl: previewUrl || undefined,
      response: info.response,
    };
  } catch (err) {
    const { isTransient, code, message } = classifySmtpError(err);
    return {
      success: false,
      messageId: stableMessageId,
      isTransientError: isTransient,
      errorCode: code,
      errorMessage: message,
    };
  }
}

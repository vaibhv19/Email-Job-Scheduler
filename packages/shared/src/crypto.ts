import crypto from 'node:crypto';

/**
 * Derives a consistent 32-byte key using SHA-256 for AES-256-GCM.
 */
function deriveEncryptionKey(secret?: string): Buffer {
  const secretKey =
    secret ||
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    'reachinbox-default-token-encryption-key-32chars!!';
  return crypto.createHash('sha256').update(secretKey).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM authenticated encryption.
 * Output format: `iv:authTag:ciphertext` in hex.
 */
export function encryptToken(plainText: string, secret?: string): string {
  if (!plainText) return '';
  const key = deriveEncryptionKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted payload (`iv:authTag:ciphertext`).
 */
export function decryptToken(encryptedPayload: string, secret?: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const key = deriveEncryptionKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

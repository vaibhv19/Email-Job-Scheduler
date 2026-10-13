/**
 * Recipient parsing, validation, and deduplication utility (QA-12)
 */

export interface RecipientParseResult {
  valid: string[];
  invalid: string[];
  duplicates: string[];
  totalExtracted: number;
}

// RFC 5322 compliant email regex pattern (practical standard)
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Parses raw input from plaintext (comma/newline separated), an array of strings,
 * or raw CSV text into validated and deduplicated email addresses.
 */
export function parseRecipients(input: string | string[]): RecipientParseResult {
  let rawItems: string[] = [];

  if (Array.isArray(input)) {
    rawItems = input;
  } else if (typeof input === 'string') {
    // If input looks like CSV with headers (e.g. contains commas and newlines)
    const lines = input.split(/\r?\n/);
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Check if it's a CSV header line (e.g. 'email,name' or 'Email Address')
      if (/^email(?:_address)?(?:,|$)/i.test(trimmedLine)) {
        continue;
      }

      // Split by commas, semicolons, or whitespace if multiple
      const tokens = trimmedLine.split(/[,;\t]/).map((t) => t.trim().replace(/^["']|["']$/g, ''));
      rawItems.push(...tokens);
    }
  }

  const validSet = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  let totalExtracted = 0;

  for (const raw of rawItems) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    totalExtracted++;

    if (!isValidEmail(trimmed)) {
      invalid.push(trimmed);
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (validSet.has(normalized)) {
      duplicates.push(normalized);
    } else {
      validSet.add(normalized);
      valid.push(normalized);
    }
  }

  return {
    valid,
    invalid,
    duplicates,
    totalExtracted,
  };
}

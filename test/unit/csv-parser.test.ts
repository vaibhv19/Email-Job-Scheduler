import { describe, it, expect } from 'vitest';
import { parseRecipients, isValidEmail } from '@email-scheduler/shared';

describe('Recipient CSV and Plaintext Parsing & Deduplication (QA-12)', () => {
  it('validates email addresses correctly', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name+tag@sub.domain.co')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('parses comma-separated and newline-separated emails', () => {
    const input = 'alice@example.com, bob@example.com\ncharlie@example.com';
    const result = parseRecipients(input);

    expect(result.valid).toEqual(['alice@example.com', 'bob@example.com', 'charlie@example.com']);
    expect(result.invalid).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.totalExtracted).toBe(3);
  });

  it('parses standard CSV formatted content with header and quotes', () => {
    const csvContent = `email,name
"david@example.com","David Smith"
"emma@example.com","Emma Watson"
"frank@example.com","Frank Castle"`;

    const result = parseRecipients(csvContent);
    expect(result.valid).toContain('david@example.com');
    expect(result.valid).toContain('emma@example.com');
    expect(result.valid).toContain('frank@example.com');
    expect(result.valid.length).toBe(3);
  });

  it('deduplicates emails case-insensitively and tracks duplicates', () => {
    const input = 'user@example.com, USER@EXAMPLE.COM, user@example.com, other@example.com';
    const result = parseRecipients(input);

    expect(result.valid).toEqual(['user@example.com', 'other@example.com']);
    expect(result.duplicates).toEqual(['user@example.com', 'user@example.com']);
    expect(result.invalid).toEqual([]);
  });

  it('filters out malformed recipient inputs and records them in invalid list', () => {
    const input = 'good@example.com, not-an-email, another.good@test.org, @bad.com';
    const result = parseRecipients(input);

    expect(result.valid).toEqual(['good@example.com', 'another.good@test.org']);
    expect(result.invalid).toEqual(['not-an-email', '@bad.com']);
  });

  it('handles array of string inputs', () => {
    const input = ['one@test.com', 'TWO@TEST.COM', 'one@test.com', 'bad'];
    const result = parseRecipients(input);

    expect(result.valid).toEqual(['one@test.com', 'two@test.com']);
    expect(result.duplicates).toEqual(['one@test.com']);
    expect(result.invalid).toEqual(['bad']);
  });
});

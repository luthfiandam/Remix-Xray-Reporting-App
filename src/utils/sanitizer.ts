/**
 * Input Sanitization & Security Utilities
 * Protects against XSS, HTML injection, prototype pollution, path traversal, and malicious inputs.
 */

// Dangerous patterns for XSS & script injection
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const HTML_TAG_REGEX = /<[^>]+>/g;
const DANGEROUS_ATTRIBUTES_REGEX = /\b(on\w+|javascript:|data:text\/html|vbscript:)\s*=/gi;
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Sanitizes a single string input.
 * Strips script tags, dangerous event handlers, and encodes/removes unsafe markup
 * while preserving valid multiline text, punctuation, and Indonesian accents.
 */
export function sanitizeText(input: unknown, maxLength: number = 5000): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') {
    return String(input).slice(0, maxLength);
  }

  let text = input;

  // 1. Remove null bytes (\0)
  text = text.replace(/\0/g, '');

  // 2. Strip script tags and dangerous event handlers
  text = text.replace(SCRIPT_REGEX, '');
  text = text.replace(DANGEROUS_ATTRIBUTES_REGEX, '');

  // 3. Strip HTML tags (except safe text characters)
  text = text.replace(HTML_TAG_REGEX, '');

  // 4. Normalize unicode & trim
  try {
    text = text.normalize('NFC');
  } catch (_) {}

  // 5. Trim & limit length to prevent DoS / buffer overflow
  return text.trim().slice(0, maxLength);
}

/**
 * Sanitizes text while allowing safe multiline formatting (for problem description, action taken, etc.)
 */
export function sanitizeMultilineText(input: unknown, maxLength: number = 8000): string {
  if (input === null || input === undefined) return '';
  const str = typeof input === 'string' ? input : String(input);
  
  // Clean line by line to preserve newlines
  const lines = str.split('\n').map((line) => sanitizeText(line, 2000));
  return lines.join('\n').slice(0, maxLength).trim();
}

/**
 * Sanitizes a filename or storage path part to prevent Path Traversal (../)
 * and illegal OS filesystem characters.
 */
export function sanitizeFileName(fileName: unknown, maxLength: number = 180): string {
  if (!fileName || typeof fileName !== 'string') return 'file';

  let clean = fileName.trim();

  // Strip path traversal attempts
  clean = clean.replace(/(\.\.[\/\\])+/g, '');
  clean = clean.replace(/[\/\\]/g, '_');

  // Remove forbidden characters
  clean = clean.replace(/[<>:"|?*\0]/g, '');

  // Strip leading dots to prevent hidden files
  clean = clean.replace(/^\.+/, '');

  return clean.slice(0, maxLength) || 'file';
}

/**
 * Sanitizes search queries to prevent regex DoS or query injection
 */
export function sanitizeSearchQuery(query: unknown, maxLength: number = 120): string {
  if (!query || typeof query !== 'string') return '';
  return query
    .replace(/[^\w\s\-\.\,\@\/]/gi, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Safe numeric parser with fallback
 */
export function sanitizeNumber(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return isNaN(num) || !isFinite(num) ? fallback : num;
}

/**
 * Recursively sanitizes all string fields in an object or array.
 * Automatically strips prototype pollution keys.
 */
export function sanitizeObject<T>(input: T, depth: number = 0): T {
  if (depth > 10) return input; // Guard against circular refs
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    // Preserve data URIs (e.g. photos) from aggressive stripping
    if (input.startsWith('data:image/')) {
      return input.slice(0, 35 * 1024 * 1024) as any;
    }
    return sanitizeText(input) as any;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeObject(item, depth + 1)) as any;
  }

  if (typeof input === 'object') {
    const sanitizedObj: any = {};
    for (const [key, value] of Object.entries(input)) {
      // Prevent Prototype Pollution
      if (PROTO_POLLUTION_KEYS.has(key)) continue;

      sanitizedObj[key] = sanitizeObject(value, depth + 1);
    }
    return sanitizedObj as T;
  }

  return input;
}

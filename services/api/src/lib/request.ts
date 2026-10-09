import type { HttpEvent } from './http.js';

/** Parses a JSON object body; undefined for anything else (missing, malformed, array, ...). */
export function parseJsonBody(event: HttpEvent): Record<string, unknown> | undefined {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A non-empty string field, trimmed, capped at `maxLength` so nobody can post megabytes. */
export function stringField(body: Record<string, unknown>, name: string, maxLength = 256): string | undefined {
  const value = body[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

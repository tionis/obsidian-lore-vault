import { createHash } from 'crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function stableJsonHash(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

export function slugifyIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'default';
}

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const textEncoder = new TextEncoder();

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function getSubtleCrypto():
  | {
      digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
    }
  | null {
  const cryptoRef = (globalThis as typeof globalThis & { crypto?: unknown }).crypto as
    | {
        subtle?: {
          digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
        };
      }
    | undefined;
  if (!cryptoRef?.subtle) {
    return null;
  }
  return cryptoRef.subtle;
}

export async function sha256HexAsync(value: string): Promise<string> {
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error('WebCrypto subtle.digest is unavailable; use sha256Hex for sync hashing paths.');
  }
  const digest = await subtle.digest('SHA-256', textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function stableJsonHash(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

export async function stableJsonHashAsync(value: unknown): Promise<string> {
  return sha256HexAsync(JSON.stringify(value));
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

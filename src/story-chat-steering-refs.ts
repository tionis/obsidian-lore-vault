export type StoryChatSteeringRefType = 'note';

export interface StoryChatSteeringRef {
  type: StoryChatSteeringRefType;
  key: string;
}

export function parseStoryChatSteeringRef(raw: string): StoryChatSteeringRef | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (/^[a-z][a-z0-9_+-]*:/.test(lower) && !lower.startsWith('note:')) {
    return null;
  }

  const key = lower.startsWith('note:')
    ? trimmed.slice('note:'.length).trim()
    : trimmed;
  if (!key) {
    return null;
  }
  return {
    type: 'note',
    key
  };
}

export function stringifyStoryChatSteeringRef(ref: StoryChatSteeringRef): string {
  return `${ref.type}:${ref.key}`;
}

export function normalizeStoryChatSteeringRefs(rawRefs: string[]): string[] {
  const normalized: string[] = [];
  for (const rawRef of rawRefs) {
    const parsed = parseStoryChatSteeringRef(rawRef);
    if (!parsed) {
      continue;
    }
    const canonical = stringifyStoryChatSteeringRef(parsed);
    if (!normalized.includes(canonical)) {
      normalized.push(canonical);
    }
  }
  return normalized;
}

export function extractNoteRefsFromStoryChatSteeringRefs(rawRefs: string[]): string[] {
  const noteRefs: string[] = [];
  for (const rawRef of rawRefs) {
    const parsed = parseStoryChatSteeringRef(rawRef);
    if (!parsed || parsed.type !== 'note') {
      continue;
    }
    if (!noteRefs.includes(parsed.key)) {
      noteRefs.push(parsed.key);
    }
  }
  return noteRefs;
}

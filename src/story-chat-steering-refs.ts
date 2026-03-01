export type StoryChatSteeringRefType = 'note' | 'story' | 'chapter';

export interface StoryChatSteeringRef {
  type: StoryChatSteeringRefType;
  key: string;
}

function parsePrefixedRef(
  trimmed: string,
  prefix: string,
  type: StoryChatSteeringRefType
): StoryChatSteeringRef | null {
  if (!trimmed.toLowerCase().startsWith(prefix)) {
    return null;
  }
  const key = trimmed.slice(prefix.length).trim();
  if (!key) {
    return null;
  }
  return { type, key };
}

export function parseStoryChatSteeringRef(raw: string): StoryChatSteeringRef | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const prefixedStory = parsePrefixedRef(trimmed, 'story:', 'story');
  if (prefixedStory) {
    return prefixedStory;
  }

  const prefixedChapter = parsePrefixedRef(trimmed, 'chapter:', 'chapter');
  if (prefixedChapter) {
    return prefixedChapter;
  }

  const prefixedNote = parsePrefixedRef(trimmed, 'note:', 'note');
  if (prefixedNote) {
    return prefixedNote;
  }

  return {
    type: 'note',
    key: trimmed
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

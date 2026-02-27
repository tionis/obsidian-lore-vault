import { asString } from './frontmatter-utils';

export type RetrievalMode = 'auto' | 'world_info' | 'rag' | 'both' | 'none';

function normalizeRetrievalValue(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
}

export function parseRetrievalMode(value: unknown): RetrievalMode | undefined {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }

  const normalized = normalizeRetrievalValue(raw);
  if (normalized === 'auto') {
    return 'auto';
  }
  if (normalized === 'world_info' || normalized === 'worldinfo' || normalized === 'lorebook') {
    return 'world_info';
  }
  if (normalized === 'rag') {
    return 'rag';
  }
  if (normalized === 'both') {
    return 'both';
  }
  if (normalized === 'none' || normalized === 'off' || normalized === 'disabled') {
    return 'none';
  }

  return undefined;
}

export function resolveRetrievalTargets(mode: RetrievalMode, hasKeywords: boolean): {
  includeWorldInfo: boolean;
  includeRag: boolean;
} {
  void hasKeywords;

  if (mode === 'none') {
    return { includeWorldInfo: false, includeRag: false };
  }

  // Unified model: canonical lore entries are always included for world_info
  // retrieval and for downstream projection exports. `retrieval: none` remains
  // the only hard exclusion mode.
  return {
    includeWorldInfo: true,
    includeRag: true
  };
}

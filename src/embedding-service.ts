import { App } from 'obsidian';
import { ConverterSettings, RagChunk, RagChunkEmbedding } from './models';
import { sha256HexAsync, stableJsonHashAsync } from './hash-utils';
import { requestEmbeddings } from './embedding-provider';
import { CachedEmbeddingRecord, EmbeddingCache } from './embedding-cache';
import { CompletionOperationLogger } from './completion-provider';

interface PendingChunk {
  chunk: RagChunk;
  cacheKey: string;
}

const QUERY_EMBED_MAX_CHARS_PER_CHUNK = 5000;
const QUERY_EMBED_MIN_CHARS_PER_CHUNK = 900;
const QUERY_EMBED_MAX_CHUNKS = 6;
const QUERY_EMBED_TAIL_CHARS_CAP = 28000;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RagSimilarityScore {
  chunkId: string;
  docUid: number;
  score: number;
}

interface EmbeddingServiceOptions {
  onOperationLog?: CompletionOperationLogger;
}

function normalizeQueryText(text: string): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function splitHeadingSections(text: string): string[] {
  const matches: Array<{ index: number }> = [];
  const headingRegex = /^##{1,5}\s+\S.*$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    matches.push({ index: match.index });
  }
  if (matches.length === 0) {
    return [text];
  }

  const sections: string[] = [];
  const firstHeadingIndex = matches[0].index ?? 0;
  const preface = text.slice(0, firstHeadingIndex).trim();
  if (preface) {
    sections.push(preface);
  }

  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const section = text.slice(start, nextStart).trim();
    if (section) {
      sections.push(section);
    }
  }

  return sections;
}

function splitLongChunk(text: string, maxChars: number, minChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + maxChars);
    if (end < normalized.length) {
      const candidate = normalized.lastIndexOf('\n', end);
      if (candidate > cursor + minChars) {
        end = candidate;
      }
    }
    const slice = normalized.slice(cursor, end).trim();
    if (slice) {
      pieces.push(slice);
    }
    if (end <= cursor) {
      break;
    }
    cursor = end;
  }

  return pieces;
}

export function splitQueryTextForEmbedding(text: string): string[] {
  const normalized = normalizeQueryText(text);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= QUERY_EMBED_MAX_CHARS_PER_CHUNK) {
    return [normalized];
  }

  const cappedTail = normalized.length > QUERY_EMBED_TAIL_CHARS_CAP
    ? normalized.slice(normalized.length - QUERY_EMBED_TAIL_CHARS_CAP).trimStart()
    : normalized;

  const sections = splitHeadingSections(cappedTail);
  const collectedRecent: string[] = [];

  for (let sectionIndex = sections.length - 1; sectionIndex >= 0; sectionIndex -= 1) {
    const section = sections[sectionIndex];
    const pieces = splitLongChunk(
      section,
      QUERY_EMBED_MAX_CHARS_PER_CHUNK,
      QUERY_EMBED_MIN_CHARS_PER_CHUNK
    );
    for (let pieceIndex = pieces.length - 1; pieceIndex >= 0; pieceIndex -= 1) {
      const piece = pieces[pieceIndex];
      if (!piece) {
        continue;
      }
      collectedRecent.push(piece);
      if (collectedRecent.length >= QUERY_EMBED_MAX_CHUNKS) {
        break;
      }
    }
    if (collectedRecent.length >= QUERY_EMBED_MAX_CHUNKS) {
      break;
    }
  }

  if (collectedRecent.length === 0) {
    const fallbackPieces = splitLongChunk(
      cappedTail,
      QUERY_EMBED_MAX_CHARS_PER_CHUNK,
      QUERY_EMBED_MIN_CHARS_PER_CHUNK
    );
    for (let index = fallbackPieces.length - 1; index >= 0; index -= 1) {
      const piece = fallbackPieces[index];
      if (!piece) {
        continue;
      }
      collectedRecent.push(piece);
      if (collectedRecent.length >= QUERY_EMBED_MAX_CHUNKS) {
        break;
      }
    }
  }

  return collectedRecent.reverse();
}

export function averageEmbeddingVectors(vectors: number[][], weights: number[]): number[] | null {
  if (vectors.length === 0) {
    return null;
  }
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions <= 0) {
    return null;
  }

  const totals = new Array<number>(dimensions).fill(0);
  let weightTotal = 0;

  for (let index = 0; index < vectors.length; index += 1) {
    const vector = vectors[index];
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      return null;
    }
    const weight = Math.max(1, Math.floor(Number(weights[index] ?? 1)));
    weightTotal += weight;
    for (let dim = 0; dim < dimensions; dim += 1) {
      const value = Number(vector[dim] ?? 0);
      totals[dim] += Number.isFinite(value) ? value * weight : 0;
    }
  }

  if (weightTotal <= 0) {
    return null;
  }
  return totals.map(value => value / weightTotal);
}

export class EmbeddingService {
  private app: App;
  private config: ConverterSettings['embeddings'];
  private cache: EmbeddingCache;
  private chunkingSignature: string;
  private onOperationLog: CompletionOperationLogger | undefined;

  constructor(app: App, config: ConverterSettings['embeddings'], options?: EmbeddingServiceOptions) {
    this.app = app;
    this.config = config;
    this.cache = new EmbeddingCache(app, config);
    this.onOperationLog = options?.onOperationLog;
    this.chunkingSignature = JSON.stringify({
      mode: config.chunkingMode,
      minChunkChars: config.minChunkChars,
      maxChunkChars: config.maxChunkChars,
      overlapChars: config.overlapChars
    });
  }

  private async createCacheKey(textHash: string): Promise<string> {
    const stablePayload = await stableJsonHashAsync({
      provider: this.config.provider,
      model: this.config.model,
      instruction: this.config.instruction,
      chunkingSignature: this.chunkingSignature,
      textHash
    });
    return sha256HexAsync(stablePayload);
  }

  private toEmbeddingRecord(chunk: RagChunk, cacheKey: string, vector: number[]): RagChunkEmbedding {
    return {
      chunkId: chunk.chunkId,
      provider: this.config.provider,
      model: this.config.model,
      dimensions: vector.length,
      vector,
      cacheKey,
      createdAt: Date.now()
    };
  }

  private toCachedRecord(embedding: RagChunkEmbedding): CachedEmbeddingRecord {
    return {
      cacheKey: embedding.cacheKey,
      provider: embedding.provider,
      model: embedding.model,
      chunkingSignature: this.chunkingSignature,
      dimensions: embedding.dimensions,
      vector: embedding.vector,
      createdAt: embedding.createdAt
    };
  }

  async embedChunks(chunks: RagChunk[]): Promise<RagChunkEmbedding[]> {
    if (!this.config.enabled) {
      return [];
    }

    const sortedChunks = [...chunks].sort((a, b) => a.chunkId.localeCompare(b.chunkId));
    const results: RagChunkEmbedding[] = [];
    const pending: PendingChunk[] = [];

    const cacheKeys = await Promise.all(sortedChunks.map(chunk => this.createCacheKey(chunk.textHash)));

    for (let chunkIndex = 0; chunkIndex < sortedChunks.length; chunkIndex += 1) {
      const chunk = sortedChunks[chunkIndex];
      const cacheKey = cacheKeys[chunkIndex];
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        results.push({
          chunkId: chunk.chunkId,
          provider: cached.provider,
          model: cached.model,
          dimensions: cached.dimensions,
          vector: cached.vector,
          cacheKey: cached.cacheKey,
          createdAt: cached.createdAt
        });
      } else {
        pending.push({ chunk, cacheKey });
      }
    }

    const batchSize = Math.max(1, Math.floor(this.config.batchSize));
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const vectors = await requestEmbeddings(this.config, {
        texts: batch.map(item => item.chunk.text),
        instruction: this.config.instruction,
        operationName: 'embeddings_embed_chunks',
        onOperationLog: this.onOperationLog
      });

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const vector = vectors[j];
        const embedding = this.toEmbeddingRecord(item.chunk, item.cacheKey, vector);
        await this.cache.set(this.toCachedRecord(embedding));
        results.push(embedding);
      }
    }

    return results.sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  }

  async embedQuery(text: string): Promise<number[] | null> {
    if (!this.config.enabled) {
      return null;
    }

    const queryChunks = splitQueryTextForEmbedding(text);
    if (queryChunks.length === 0) {
      return null;
    }

    try {
      const vectors = await requestEmbeddings(this.config, {
        texts: queryChunks,
        instruction: this.config.instruction,
        operationName: queryChunks.length > 1
          ? 'embeddings_embed_query_chunked'
          : 'embeddings_embed_query',
        onOperationLog: this.onOperationLog
      });

      if (queryChunks.length === 1) {
        return vectors[0] ?? null;
      }

      const averaged = averageEmbeddingVectors(
        vectors,
        queryChunks.map(chunk => chunk.length)
      );
      return averaged ?? vectors[vectors.length - 1] ?? null;
    } catch (primaryError) {
      if (queryChunks.length > 1) {
        try {
          const fallbackTail = queryChunks[queryChunks.length - 1];
          const vectors = await requestEmbeddings(this.config, {
            texts: [fallbackTail],
            instruction: this.config.instruction,
            operationName: 'embeddings_embed_query_recent_fallback',
            onOperationLog: this.onOperationLog
          });
          return vectors[0] ?? null;
        } catch (fallbackError) {
          console.warn(
            'LoreVault: Query embedding failed; proceeding with lexical retrieval fallback.',
            primaryError,
            fallbackError
          );
          return null;
        }
      }

      console.warn(
        'LoreVault: Query embedding failed; proceeding with lexical retrieval fallback.',
        primaryError
      );
      return null;
    }
  }

  scoreChunks(
    queryEmbedding: number[] | null,
    chunks: RagChunk[],
    embeddings: RagChunkEmbedding[]
  ): RagSimilarityScore[] {
    if (!queryEmbedding) {
      return [];
    }

    const vectorByChunkId = new Map<string, number[]>();
    for (const embedding of embeddings) {
      vectorByChunkId.set(embedding.chunkId, embedding.vector);
    }

    const scores: RagSimilarityScore[] = [];
    for (const chunk of chunks) {
      const vector = vectorByChunkId.get(chunk.chunkId);
      if (!vector) {
        continue;
      }
      const similarity = cosineSimilarity(queryEmbedding, vector);
      if (similarity <= 0) {
        continue;
      }
      scores.push({
        chunkId: chunk.chunkId,
        docUid: chunk.docUid,
        score: similarity
      });
    }

    return scores.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  }
}

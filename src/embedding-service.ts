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
    if (!this.config.enabled || !text.trim()) {
      return null;
    }

    const vectors = await requestEmbeddings(this.config, {
      texts: [text],
      instruction: this.config.instruction,
      operationName: 'embeddings_embed_query',
      onOperationLog: this.onOperationLog
    });
    return vectors[0] ?? null;
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

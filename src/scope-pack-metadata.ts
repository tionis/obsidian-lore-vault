import { ConverterSettings, ScopePack, ScopePackBuildMetadata } from './models';
import { stableJsonHash } from './hash-utils';

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const dimension = vectors[0].length;
  const sum = new Array<number>(dimension).fill(0);
  let count = 0;
  for (const vector of vectors) {
    if (vector.length !== dimension) {
      continue;
    }
    for (let index = 0; index < dimension; index += 1) {
      sum[index] += vector[index];
    }
    count += 1;
  }
  if (count === 0) {
    return [];
  }
  return sum.map(value => value / count);
}

function normalizeVector(vector: number[]): number[] {
  if (vector.length === 0) {
    return [];
  }
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  if (norm <= 0) {
    return vector.map(() => 0);
  }
  const scale = 1 / Math.sqrt(norm);
  return vector.map(value => value * scale);
}

export interface ScopePackBuildContext {
  pluginId?: string;
  pluginVersion?: string;
}

export function buildNoteEmbeddings(pack: Pick<ScopePack, 'scope' | 'ragChunks' | 'ragChunkEmbeddings'>): ScopePack['noteEmbeddings'] {
  const chunkById = new Map<string, ScopePack['ragChunks'][number]>();
  for (const chunk of pack.ragChunks) {
    chunkById.set(chunk.chunkId, chunk);
  }

  type EmbeddingBucket = {
    uid: number;
    scope: string;
    provider: string;
    model: string;
    dimensions: number;
    createdAt: number;
    cacheKeys: string[];
    vectors: number[][];
  };

  const buckets = new Map<string, EmbeddingBucket>();
  for (const embedding of pack.ragChunkEmbeddings) {
    const chunk = chunkById.get(embedding.chunkId);
    if (!chunk || embedding.vector.length === 0) {
      continue;
    }
    const bucketKey = `${chunk.docUid}::${embedding.provider}::${embedding.model}`;
    const existing = buckets.get(bucketKey);
    if (existing) {
      if (existing.dimensions !== embedding.dimensions || embedding.vector.length !== existing.dimensions) {
        continue;
      }
      existing.vectors.push(embedding.vector);
      existing.cacheKeys.push(embedding.cacheKey);
      existing.createdAt = Math.max(existing.createdAt, embedding.createdAt);
      continue;
    }

    if (embedding.vector.length !== embedding.dimensions) {
      continue;
    }

    buckets.set(bucketKey, {
      uid: chunk.docUid,
      scope: chunk.scope,
      provider: embedding.provider,
      model: embedding.model,
      dimensions: embedding.dimensions,
      createdAt: embedding.createdAt,
      cacheKeys: [embedding.cacheKey],
      vectors: [embedding.vector]
    });
  }

  const noteEmbeddings: ScopePack['noteEmbeddings'] = [];
  for (const bucket of buckets.values()) {
    const average = averageVectors(bucket.vectors);
    if (average.length === 0) {
      continue;
    }
    const sortedCacheKeys = [...bucket.cacheKeys].sort((a, b) => a.localeCompare(b));
    noteEmbeddings.push({
      uid: bucket.uid,
      scope: bucket.scope,
      provider: bucket.provider,
      model: bucket.model,
      dimensions: bucket.dimensions,
      aggregation: 'mean_normalized',
      sourceChunkCount: bucket.vectors.length,
      cacheKey: stableJsonHash({
        uid: bucket.uid,
        provider: bucket.provider,
        model: bucket.model,
        cacheKeys: sortedCacheKeys
      }),
      createdAt: bucket.createdAt,
      vector: normalizeVector(average)
    });
  }

  return noteEmbeddings.sort((left, right) => (
    left.uid - right.uid ||
    left.provider.localeCompare(right.provider) ||
    left.model.localeCompare(right.model)
  ));
}

export function buildScopePackMetadata(
  settings: ConverterSettings,
  scope: string,
  buildAllScopes: boolean,
  sourceFileCount: number,
  sourceNoteCount: number,
  explicitRootUid: number | null,
  context?: ScopePackBuildContext
): ScopePackBuildMetadata {
  const settingsSnapshot: ScopePackBuildMetadata['settingsSnapshot'] = {
    tagScoping: { ...settings.tagScoping },
    weights: { ...settings.weights },
    defaultEntry: { ...settings.defaultEntry },
    retrieval: {
      ...settings.retrieval,
      toolCalls: { ...settings.retrieval.toolCalls }
    },
    summaries: { ...settings.summaries },
    embeddings: {
      enabled: settings.embeddings.enabled,
      provider: settings.embeddings.provider,
      endpoint: settings.embeddings.endpoint,
      model: settings.embeddings.model,
      instruction: settings.embeddings.instruction,
      batchSize: settings.embeddings.batchSize,
      timeoutMs: settings.embeddings.timeoutMs,
      chunkingMode: settings.embeddings.chunkingMode,
      minChunkChars: settings.embeddings.minChunkChars,
      maxChunkChars: settings.embeddings.maxChunkChars,
      overlapChars: settings.embeddings.overlapChars
    }
  };

  return {
    format: 'lorevault.scope-pack',
    schemaVersion: 2,
    pluginId: (context?.pluginId ?? 'lore-vault').trim() || 'lore-vault',
    pluginVersion: (context?.pluginVersion ?? 'unknown').trim() || 'unknown',
    buildMode: buildAllScopes ? 'multi_scope' : 'single_scope',
    sourceFileCount,
    sourceNoteCount,
    explicitRootUid,
    settingsSnapshot,
    settingsSignature: stableJsonHash({
      scope,
      settingsSnapshot
    })
  };
}

export function computeScopePackContentSignature(pack: ScopePack): string {
  return stableJsonHash({
    worldInfo: pack.worldInfoEntries.map(entry => ({
      uid: entry.uid,
      comment: entry.comment,
      order: entry.order,
      key: entry.key,
      keysecondary: entry.keysecondary,
      content: entry.content
    })),
    ragDocuments: pack.ragDocuments.map(document => ({
      uid: document.uid,
      scope: document.scope,
      path: document.path,
      title: document.title,
      content: document.content
    })),
    ragChunks: pack.ragChunks.map(chunk => ({
      chunkId: chunk.chunkId,
      docUid: chunk.docUid,
      textHash: chunk.textHash,
      tokenEstimate: chunk.tokenEstimate,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset
    })),
    ragChunkEmbeddings: pack.ragChunkEmbeddings.map(embedding => ({
      chunkId: embedding.chunkId,
      provider: embedding.provider,
      model: embedding.model,
      dimensions: embedding.dimensions,
      cacheKey: embedding.cacheKey
    })),
    sourceNotes: pack.sourceNotes.map(note => ({
      uid: note.uid,
      scope: note.scope,
      path: note.path,
      retrievalMode: note.retrievalMode,
      includeWorldInfo: note.includeWorldInfo,
      includeRag: note.includeRag,
      summaryHash: note.summaryHash,
      noteBodyHash: note.noteBodyHash
    })),
    noteEmbeddings: pack.noteEmbeddings.map(embedding => ({
      uid: embedding.uid,
      provider: embedding.provider,
      model: embedding.model,
      dimensions: embedding.dimensions,
      aggregation: embedding.aggregation,
      sourceChunkCount: embedding.sourceChunkCount,
      cacheKey: embedding.cacheKey
    }))
  });
}

export function collectScopePackMetaRows(pack: ScopePack): Array<[string, string]> {
  const embeddingProfiles = new Set<string>();
  for (const embedding of pack.ragChunkEmbeddings) {
    embeddingProfiles.add(`${embedding.provider}::${embedding.model}::${embedding.dimensions}`);
  }
  for (const embedding of pack.noteEmbeddings) {
    embeddingProfiles.add(`${embedding.provider}::${embedding.model}::${embedding.dimensions}`);
  }

  const metadata = pack.metadata;
  const rows: Array<[string, string]> = [
    ['format', metadata.format],
    ['schema_version', String(pack.schemaVersion)],
    ['scope', pack.scope],
    ['generated_at', String(pack.generatedAt)],
    ['plugin_id', metadata.pluginId],
    ['plugin_version', metadata.pluginVersion],
    ['build_mode', metadata.buildMode],
    ['source_file_count', String(metadata.sourceFileCount)],
    ['source_note_count', String(metadata.sourceNoteCount)],
    ['explicit_root_uid', metadata.explicitRootUid === null ? '' : String(metadata.explicitRootUid)],
    ['settings_signature', metadata.settingsSignature],
    ['content_signature', computeScopePackContentSignature(pack)],
    ['world_info_entries_count', String(pack.worldInfoEntries.length)],
    ['rag_documents_count', String(pack.ragDocuments.length)],
    ['rag_chunks_count', String(pack.ragChunks.length)],
    ['rag_chunk_embeddings_count', String(pack.ragChunkEmbeddings.length)],
    ['source_notes_count', String(pack.sourceNotes.length)],
    ['note_embeddings_count', String(pack.noteEmbeddings.length)],
    ['settings_snapshot_json', JSON.stringify(metadata.settingsSnapshot)],
    ['settings_tag_scoping_json', JSON.stringify(metadata.settingsSnapshot.tagScoping)],
    ['settings_retrieval_json', JSON.stringify(metadata.settingsSnapshot.retrieval)],
    ['settings_embeddings_json', JSON.stringify(metadata.settingsSnapshot.embeddings)],
    ['settings_summaries_json', JSON.stringify(metadata.settingsSnapshot.summaries)],
    ['settings_weights_json', JSON.stringify(metadata.settingsSnapshot.weights)],
    ['settings_default_entry_json', JSON.stringify(metadata.settingsSnapshot.defaultEntry)],
    ['embedding_profiles_json', JSON.stringify([...embeddingProfiles].sort((a, b) => a.localeCompare(b)))]
  ];
  return rows.sort((left, right) => left[0].localeCompare(right[0]));
}

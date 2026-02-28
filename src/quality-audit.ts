import { LoreBookEntry, RagChunk, RagChunkEmbedding, RagDocument } from './models';

export type QualityRiskLevel = 'high' | 'medium' | 'low' | 'info';

export interface QualityAuditRow {
  uid: number;
  title: string;
  path: string;
  keywordCount: number;
  summaryTokens: number;
  bodyTokens: number;
  riskScore: number;
  riskLevel: QualityRiskLevel;
  reasons: string[];
  bestSimilarUid: number | null;
  bestSimilarTitle: string | null;
  bestSimilarPath: string;
  bestSimilarScore: number;
  canGenerateKeywords: boolean;
}

export interface QualityAuditInput {
  entries: LoreBookEntry[];
  ragDocuments: RagDocument[];
  ragChunks: RagChunk[];
  ragChunkEmbeddings: RagChunkEmbedding[];
  worldInfoBodyByUid?: {[key: number]: string};
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeVector(vector: number[]): number[] {
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
    for (let i = 0; i < dimension; i += 1) {
      sum[i] += vector[i];
    }
    count += 1;
  }
  if (count === 0) {
    return [];
  }
  return sum.map(value => value / count);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
  }
  return dot;
}

function toRiskLevel(score: number): QualityRiskLevel {
  if (score >= 60) {
    return 'high';
  }
  if (score >= 35) {
    return 'medium';
  }
  if (score > 0) {
    return 'low';
  }
  return 'info';
}

function getEntryPathByUid(documents: RagDocument[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const doc of documents) {
    if (!map.has(doc.uid)) {
      map.set(doc.uid, doc.path);
    }
  }
  return map;
}

function buildEntryEmbeddingByUid(input: QualityAuditInput): Map<number, number[]> {
  const chunkById = new Map<string, RagChunk>();
  for (const chunk of input.ragChunks) {
    chunkById.set(chunk.chunkId, chunk);
  }

  const vectorByChunkId = new Map<string, number[]>();
  for (const embedding of input.ragChunkEmbeddings) {
    if (!vectorByChunkId.has(embedding.chunkId)) {
      vectorByChunkId.set(embedding.chunkId, embedding.vector);
    }
  }

  const vectorsByUid = new Map<number, number[][]>();
  for (const [chunkId, vector] of vectorByChunkId.entries()) {
    const chunk = chunkById.get(chunkId);
    if (!chunk) {
      continue;
    }
    const current = vectorsByUid.get(chunk.docUid) ?? [];
    current.push(vector);
    vectorsByUid.set(chunk.docUid, current);
  }

  const byUid = new Map<number, number[]>();
  for (const entry of input.entries) {
    const vectors = vectorsByUid.get(entry.uid) ?? [];
    const avg = averageVectors(vectors);
    if (avg.length > 0) {
      byUid.set(entry.uid, normalizeVector(avg));
    }
  }
  return byUid;
}

export function buildQualityAuditRows(input: QualityAuditInput): QualityAuditRow[] {
  const entries = [...input.entries].sort((a, b) => a.uid - b.uid);
  const pathByUid = getEntryPathByUid(input.ragDocuments);
  const embeddingByUid = buildEntryEmbeddingByUid(input);
  const titleByUid = new Map<number, string>(entries.map(entry => [entry.uid, entry.comment || `Entry ${entry.uid}`]));

  const rows: QualityAuditRow[] = [];

  for (const entry of entries) {
    const keywords = [...entry.key, ...entry.keysecondary].map(value => value.trim()).filter(Boolean);
    const summaryTokens = estimateTokens(entry.content || '');
    const bodyText = (input.worldInfoBodyByUid?.[entry.uid] ?? '').trim();
    const bodyTokens = estimateTokens(bodyText || entry.content || '');
    const reasons: string[] = [];
    let riskScore = 0;

    if (keywords.length === 0) {
      riskScore += 30;
      reasons.push('Missing explicit keywords');
    }
    if (summaryTokens <= 16) {
      riskScore += 12;
      reasons.push('Summary is very short');
    }
    if (bodyTokens <= 40) {
      riskScore += 18;
      reasons.push('Body content is very short');
    }

    const vector = embeddingByUid.get(entry.uid) ?? [];
    let bestSimilarUid: number | null = null;
    let bestSimilarScore = 0;
    const neighborScores: number[] = [];
    if (vector.length > 0) {
      for (const other of entries) {
        if (other.uid === entry.uid) {
          continue;
        }
        const otherVector = embeddingByUid.get(other.uid);
        if (!otherVector || otherVector.length === 0) {
          continue;
        }
        const similarity = cosineSimilarity(vector, otherVector);
        neighborScores.push(similarity);
        if (similarity > bestSimilarScore) {
          bestSimilarScore = similarity;
          bestSimilarUid = other.uid;
        }
      }
    }

    if (bestSimilarUid !== null) {
      const similarTitle = titleByUid.get(bestSimilarUid) ?? `UID ${bestSimilarUid}`;
      if (bestSimilarScore >= 0.97) {
        riskScore += 45;
        reasons.push(`Possible duplicate of "${similarTitle}" (${bestSimilarScore.toFixed(3)})`);
      } else if (bestSimilarScore >= 0.94) {
        riskScore += 30;
        reasons.push(`Very similar to "${similarTitle}" (${bestSimilarScore.toFixed(3)})`);
      }
    }

    if (neighborScores.length >= 3) {
      const top3 = [...neighborScores].sort((a, b) => b - a).slice(0, 3);
      const avgTop3 = top3.reduce((sum, value) => sum + value, 0) / top3.length;
      if (avgTop3 >= 0.88 && keywords.length === 0) {
        riskScore += 18;
        reasons.push(`Broadly similar embedding neighborhood (${avgTop3.toFixed(3)})`);
      }
    }

    rows.push({
      uid: entry.uid,
      title: entry.comment || `Entry ${entry.uid}`,
      path: pathByUid.get(entry.uid) ?? '',
      keywordCount: keywords.length,
      summaryTokens,
      bodyTokens,
      riskScore,
      riskLevel: toRiskLevel(riskScore),
      reasons,
      bestSimilarUid,
      bestSimilarTitle: bestSimilarUid !== null ? (titleByUid.get(bestSimilarUid) ?? `UID ${bestSimilarUid}`) : null,
      bestSimilarPath: bestSimilarUid !== null ? (pathByUid.get(bestSimilarUid) ?? '') : '',
      bestSimilarScore,
      canGenerateKeywords: keywords.length === 0 && Boolean(pathByUid.get(entry.uid))
    });
  }

  return rows.sort((left, right) => (
    right.riskScore - left.riskScore ||
    left.keywordCount - right.keywordCount ||
    left.title.localeCompare(right.title) ||
    left.uid - right.uid
  ));
}

import { ConverterSettings, RagChunk, RagDocument } from './models';
import { sha256HexAsync } from './hash-utils';

interface SectionSlice {
  heading: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeBody(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

async function createChunk(
  doc: RagDocument,
  chunkIndex: number,
  heading: string,
  text: string,
  startOffset: number,
  endOffset: number
): Promise<RagChunk> {
  const normalizedText = text.trim();
  const textHash = await sha256HexAsync(normalizedText);
  const chunkId = await sha256HexAsync(`${doc.path}|${doc.uid}|${chunkIndex}|${textHash}`);
  return {
    chunkId,
    docUid: doc.uid,
    scope: doc.scope,
    path: doc.path,
    title: doc.title,
    chunkIndex,
    heading,
    text: normalizedText,
    textHash,
    tokenEstimate: estimateTokens(normalizedText),
    startOffset,
    endOffset
  };
}

async function splitLongText(
  doc: RagDocument,
  heading: string,
  text: string,
  startOffset: number,
  maxChunkChars: number,
  overlapChars: number,
  nextChunkIndex: () => number
): Promise<RagChunk[]> {
  const chunks: RagChunk[] = [];
  const source = text.trim();
  if (!source) {
    return chunks;
  }

  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + maxChunkChars);
    if (end < source.length) {
      const newline = source.lastIndexOf('\n', end);
      if (newline > cursor + Math.floor(maxChunkChars * 0.4)) {
        end = newline;
      }
    }

    const slice = source.slice(cursor, end).trim();
    if (slice.length > 0) {
      const chunk = await createChunk(
        doc,
        nextChunkIndex(),
        heading,
        slice,
        startOffset + cursor,
        startOffset + end
      );
      chunks.push(chunk);
    }

    if (end >= source.length) {
      break;
    }
    const nextCursor = Math.max(cursor + 1, end - overlapChars);
    cursor = nextCursor;
  }

  return chunks;
}

function sectionSlicesFromContent(content: string): SectionSlice[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const headingRegex = /^#{1,6}\s+(.*)$/gm;
  const matches: Array<{ heading: string; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(normalized)) !== null) {
    matches.push({
      heading: match[1].trim(),
      index: match.index
    });
  }

  if (matches.length === 0) {
    return [{
      heading: '',
      text: normalized,
      startOffset: 0,
      endOffset: normalized.length
    }];
  }

  const slices: SectionSlice[] = [];
  const firstHeadingOffset = matches[0].index;
  if (firstHeadingOffset > 0) {
    slices.push({
      heading: '',
      text: normalized.slice(0, firstHeadingOffset),
      startOffset: 0,
      endOffset: firstHeadingOffset
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index;
    const end = next ? next.index : normalized.length;
    slices.push({
      heading: current.heading,
      text: normalized.slice(start, end),
      startOffset: start,
      endOffset: end
    });
  }

  return slices.filter(slice => slice.text.trim().length > 0);
}

function mergeTinySections(sections: SectionSlice[], minChunkChars: number): SectionSlice[] {
  if (sections.length <= 1) {
    return sections;
  }

  const merged: SectionSlice[] = [];
  let pending: SectionSlice | null = null;

  for (const section of sections) {
    if (!pending) {
      pending = section;
      continue;
    }

    if (pending.text.trim().length < minChunkChars) {
      pending = {
        heading: pending.heading || section.heading,
        text: `${pending.text.trimEnd()}\n\n${section.text.trimStart()}`,
        startOffset: pending.startOffset,
        endOffset: section.endOffset
      };
      continue;
    }

    merged.push(pending);
    pending = section;
  }

  if (pending) {
    merged.push(pending);
  }

  return merged;
}

async function chunkDocumentBySections(
  doc: RagDocument,
  minChunkChars: number,
  maxChunkChars: number,
  overlapChars: number
): Promise<RagChunk[]> {
  const normalized = normalizeBody(doc.content);
  if (!normalized) {
    return [];
  }

  const sections = mergeTinySections(sectionSlicesFromContent(normalized), minChunkChars);
  const chunks: RagChunk[] = [];
  let chunkIndex = 0;
  const nextChunkIndex = (): number => {
    const value = chunkIndex;
    chunkIndex += 1;
    return value;
  };

  for (const section of sections) {
    const sectionText = section.text.trim();
    if (!sectionText) {
      continue;
    }

    if (sectionText.length <= maxChunkChars) {
      chunks.push(
        await createChunk(
          doc,
          nextChunkIndex(),
          section.heading,
          sectionText,
          section.startOffset,
          section.endOffset
        )
      );
      continue;
    }

    chunks.push(...await splitLongText(
      doc,
      section.heading,
      sectionText,
      section.startOffset,
      maxChunkChars,
      overlapChars,
      nextChunkIndex
    ));
  }

  return chunks;
}

async function chunkDocumentByNote(
  doc: RagDocument,
  maxChunkChars: number,
  overlapChars: number
): Promise<RagChunk[]> {
  const normalized = normalizeBody(doc.content);
  if (!normalized) {
    return [];
  }

  let chunkIndex = 0;
  const nextChunkIndex = (): number => {
    const value = chunkIndex;
    chunkIndex += 1;
    return value;
  };

  if (normalized.length <= maxChunkChars) {
    return [await createChunk(doc, 0, '', normalized, 0, normalized.length)];
  }

  return splitLongText(
    doc,
    '',
    normalized,
    0,
    maxChunkChars,
    overlapChars,
    nextChunkIndex
  );
}

export async function chunkRagDocuments(
  documents: RagDocument[],
  settings: ConverterSettings['embeddings']
): Promise<RagChunk[]> {
  const sortedDocs = [...documents].sort((a, b) => {
    return (
      a.path.localeCompare(b.path) ||
      a.title.localeCompare(b.title) ||
      a.uid - b.uid
    );
  });

  const chunks: RagChunk[] = [];

  for (const doc of sortedDocs) {
    const body = normalizeBody(doc.content);
    if (!body) {
      continue;
    }

    let docChunks: RagChunk[];
    if (settings.chunkingMode === 'note') {
      docChunks = await chunkDocumentByNote(doc, settings.maxChunkChars, settings.overlapChars);
    } else if (settings.chunkingMode === 'section') {
      docChunks = await chunkDocumentBySections(
        doc,
        settings.minChunkChars,
        settings.maxChunkChars,
        settings.overlapChars
      );
    } else {
      // Auto mode: keep short/medium notes whole; split larger notes by sections.
      if (body.length <= Math.max(settings.maxChunkChars, settings.minChunkChars * 2)) {
        docChunks = await chunkDocumentByNote(doc, settings.maxChunkChars, settings.overlapChars);
      } else {
        docChunks = await chunkDocumentBySections(
          doc,
          settings.minChunkChars,
          settings.maxChunkChars,
          settings.overlapChars
        );
      }
    }

    chunks.push(...docChunks);
  }

  return chunks;
}

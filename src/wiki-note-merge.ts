import { normalizeWikiSectionBody } from './wiki-markdown-format';

interface MarkdownSection {
  headingLine: string;
  headingKey: string;
  body: string;
}

const SECTION_HEADING_PATTERN = /^\s{0,3}(#{2,6})\s+(.+?)\s*$/;

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeTextKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeBlockKey(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitParagraphBlocks(body: string): string[] {
  const normalized = normalizeMarkdown(body);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean);
}

function hasEquivalentBlock(blocks: string[], candidate: string): boolean {
  const candidateKey = normalizeBlockKey(candidate);
  if (!candidateKey) {
    return true;
  }
  for (const block of blocks) {
    const blockKey = normalizeBlockKey(block);
    if (!blockKey) {
      continue;
    }
    if (blockKey === candidateKey || blockKey.includes(candidateKey) || candidateKey.includes(blockKey)) {
      return true;
    }
  }
  return false;
}

function mergeSectionBodies(existingBody: string, incomingBody: string): string {
  const existingBlocks = splitParagraphBlocks(existingBody);
  const incomingBlocks = splitParagraphBlocks(incomingBody);
  if (existingBlocks.length === 0) {
    return incomingBlocks.join('\n\n').trim();
  }
  if (incomingBlocks.length === 0) {
    return existingBlocks.join('\n\n').trim();
  }

  const merged = [...existingBlocks];
  for (const block of incomingBlocks) {
    if (!hasEquivalentBlock(merged, block)) {
      merged.push(block);
    }
  }
  return merged.join('\n\n').trim();
}

function parseMarkdownSections(body: string, pageKey: string): MarkdownSection[] {
  const normalized = normalizeWikiSectionBody(body, pageKey).trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeadingLine = '';
  let currentHeadingKey = '';
  let currentBodyLines: string[] = [];

  const flush = (): void => {
    if (!currentHeadingLine) {
      return;
    }
    sections.push({
      headingLine: currentHeadingLine.trim(),
      headingKey: currentHeadingKey,
      body: currentBodyLines.join('\n').trim()
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(SECTION_HEADING_PATTERN);
    if (headingMatch) {
      flush();
      currentHeadingLine = line.trim();
      currentHeadingKey = normalizeTextKey(headingMatch[2] ?? '');
      currentBodyLines = [];
      continue;
    }
    currentBodyLines.push(line);
  }

  flush();
  return sections;
}

function renderMarkdownSections(sections: MarkdownSection[]): string {
  return sections
    .map(section => {
      const body = section.body.trim();
      if (!body) {
        return section.headingLine;
      }
      return `${section.headingLine}\n\n${body}`;
    })
    .join('\n\n')
    .trim();
}

export function normalizeManagedMarkdownBody(body: string, pageKey: string): string {
  return normalizeWikiSectionBody(body, pageKey).trim();
}

export function mergeStructuredMarkdownBodies(existingBody: string, incomingBody: string, pageKey: string): string {
  const normalizedExisting = normalizeManagedMarkdownBody(existingBody, pageKey);
  const normalizedIncoming = normalizeManagedMarkdownBody(incomingBody, pageKey);
  if (!normalizedIncoming) {
    return normalizedExisting;
  }
  if (!normalizedExisting) {
    return normalizedIncoming;
  }

  const mergedSections = parseMarkdownSections(normalizedExisting, pageKey);
  const sectionIndexByKey = new Map<string, number>();
  for (let index = 0; index < mergedSections.length; index += 1) {
    sectionIndexByKey.set(mergedSections[index].headingKey, index);
  }

  for (const incomingSection of parseMarkdownSections(normalizedIncoming, pageKey)) {
    const existingIndex = sectionIndexByKey.get(incomingSection.headingKey);
    if (existingIndex === undefined) {
      sectionIndexByKey.set(incomingSection.headingKey, mergedSections.length);
      mergedSections.push(incomingSection);
      continue;
    }
    const existingSection = mergedSections[existingIndex];
    mergedSections[existingIndex] = {
      headingLine: existingSection.headingLine,
      headingKey: existingSection.headingKey,
      body: mergeSectionBodies(existingSection.body, incomingSection.body)
    };
  }

  return renderMarkdownSections(mergedSections);
}

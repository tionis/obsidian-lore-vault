import { unzipSync } from 'fflate';

export interface EbookChapter {
  index: number; // 1-based reading order
  title: string;
  bodyText: string; // plain text, paragraphs separated by \n\n
  isFrontMatter: boolean; // true for title pages, ToC, copyright, dedication, etc.
}

export interface ParsedEbook {
  title: string;
  author: string;
  chapters: EbookChapter[];
  warnings: string[];
}

// --- Shared utilities ---

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function buildLcFileMap(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    map.set(path.toLowerCase(), bytes);
  }
  return map;
}

function lookupFile(lcMap: Map<string, Uint8Array>, archivePath: string): Uint8Array | null {
  return lcMap.get(archivePath.toLowerCase()) ?? null;
}

function hasParseError(doc: Document): boolean {
  return doc.querySelector('parsererror') !== null;
}

function parseAsXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function parseAsHtml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/html');
}

function parseAsXhtml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xhtml+xml');
}

// getElementsByTagName is namespace-agnostic in Chromium's XML DOMParser in most cases.
// The fallback localName scan handles edge cases.
function getByLocalName(parent: Document | Element, localName: string): Element[] {
  const byTag = Array.from(parent.getElementsByTagName(localName));
  if (byTag.length > 0) return byTag;
  return Array.from(parent.getElementsByTagName('*')).filter(el => el.localName === localName);
}

function getFirstByLocalName(parent: Document | Element, localName: string): Element | null {
  return getByLocalName(parent, localName)[0] ?? null;
}

function resolveRelativeHref(baseDirPath: string, href: string): string {
  if (!href) return baseDirPath;
  if (href.startsWith('/')) return href.slice(1);
  const base = baseDirPath ? `${baseDirPath}/` : '';
  const parts = `${base}${href}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function getBaseDirPath(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

// --- EPUB parsing ---

function findOpfPath(lcMap: Map<string, Uint8Array>): string {
  const bytes = lookupFile(lcMap, 'meta-inf/container.xml');
  if (!bytes) throw new Error('EPUB is missing META-INF/container.xml');
  const doc = parseAsXml(decodeText(bytes));
  if (hasParseError(doc)) throw new Error('Failed to parse META-INF/container.xml');
  const rootfile = getFirstByLocalName(doc, 'rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('container.xml has no rootfile full-path attribute');
  return opfPath;
}

interface ManifestItem {
  id: string;
  href: string;       // absolute path within the archive
  mediaType: string;
  properties: string;
  nonLinear: boolean; // true when spine itemref has linear="no"
}

interface ParsedOpf {
  title: string;
  author: string;
  spineItems: ManifestItem[];
  ncxItem: ManifestItem | null;
  navItem: ManifestItem | null;
  warnings: string[];
}

function parseOpfDoc(lcMap: Map<string, Uint8Array>, opfPath: string): ParsedOpf {
  const warnings: string[] = [];
  const bytes = lookupFile(lcMap, opfPath);
  if (!bytes) throw new Error(`OPF file not found in archive: ${opfPath}`);
  const doc = parseAsXml(decodeText(bytes));
  if (hasParseError(doc)) throw new Error(`Failed to parse OPF file: ${opfPath}`);

  const opfBaseDir = getBaseDirPath(opfPath);

  // Dublin Core namespace for title/author
  const DC_NS = 'http://purl.org/dc/elements/1.1/';
  const titleEl =
    doc.getElementsByTagNameNS(DC_NS, 'title')[0] ??
    getFirstByLocalName(doc, 'title') ?? null;
  const creatorEl =
    doc.getElementsByTagNameNS(DC_NS, 'creator')[0] ??
    getFirstByLocalName(doc, 'creator') ?? null;
  const title = titleEl?.textContent?.trim() ?? '';
  const author = creatorEl?.textContent?.trim() ?? '';

  // Manifest: map id → item
  const manifestMap = new Map<string, ManifestItem>();
  for (const item of getByLocalName(doc, 'item')) {
    const id = item.getAttribute('id') ?? '';
    if (!id) continue;
    const href = item.getAttribute('href') ?? '';
    const mediaType = item.getAttribute('media-type') ?? '';
    const properties = item.getAttribute('properties') ?? '';
    const absoluteHref = resolveRelativeHref(opfBaseDir, href);
    manifestMap.set(id, { id, href: absoluteHref, mediaType, properties, nonLinear: false });
  }

  // Spine: ordered list of HTML items
  const spineItems: ManifestItem[] = [];
  for (const itemref of getByLocalName(doc, 'itemref')) {
    const idref = itemref.getAttribute('idref') ?? '';
    const item = manifestMap.get(idref);
    if (!item) {
      warnings.push(`Spine references unknown manifest id: ${idref}`);
      continue;
    }
    const isHtml =
      item.mediaType === 'application/xhtml+xml' ||
      item.mediaType === 'text/html' ||
      item.href.endsWith('.html') ||
      item.href.endsWith('.xhtml');
    if (!isHtml) continue;
    const nonLinear = itemref.getAttribute('linear') === 'no';
    spineItems.push({ ...item, nonLinear });
  }

  if (spineItems.length === 0) {
    warnings.push('No HTML spine items found in OPF.');
  }

  let ncxItem: ManifestItem | null = null;
  let navItem: ManifestItem | null = null;
  for (const item of manifestMap.values()) {
    if (item.mediaType === 'application/x-dtbncx+xml') ncxItem = item;
    if (item.properties.includes('nav')) navItem = item;
  }

  return { title, author, spineItems, ncxItem, navItem, warnings };
}

function buildTitleMapFromNcx(
  lcMap: Map<string, Uint8Array>,
  ncxItem: ManifestItem
): Map<string, string> {
  const titleMap = new Map<string, string>();
  const bytes = lookupFile(lcMap, ncxItem.href);
  if (!bytes) return titleMap;
  const doc = parseAsXml(decodeText(bytes));
  if (hasParseError(doc)) return titleMap;

  const ncxBaseDir = getBaseDirPath(ncxItem.href);
  for (const navPoint of getByLocalName(doc, 'navPoint')) {
    const contentEl = getFirstByLocalName(navPoint, 'content');
    const textEl = getFirstByLocalName(navPoint, 'text');
    const src = contentEl?.getAttribute('src') ?? '';
    const chapterTitle = textEl?.textContent?.trim() ?? '';
    if (!src || !chapterTitle) continue;
    const absoluteSrc = resolveRelativeHref(ncxBaseDir, src.split('#')[0]);
    titleMap.set(absoluteSrc.toLowerCase(), chapterTitle);
  }
  return titleMap;
}

function buildTitleMapFromNav(
  lcMap: Map<string, Uint8Array>,
  navItem: ManifestItem
): Map<string, string> {
  const titleMap = new Map<string, string>();
  const bytes = lookupFile(lcMap, navItem.href);
  if (!bytes) return titleMap;
  const text = decodeText(bytes);
  let doc = parseAsXhtml(text);
  if (hasParseError(doc)) doc = parseAsHtml(text);

  const navBaseDir = getBaseDirPath(navItem.href);

  // Find the toc nav element
  let tocNav: Element | null = null;
  for (const navEl of Array.from(doc.querySelectorAll('nav'))) {
    const epubType =
      navEl.getAttribute('epub:type') ??
      navEl.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ??
      '';
    if (epubType.includes('toc')) {
      tocNav = navEl;
      break;
    }
  }
  if (!tocNav) tocNav = doc.querySelector('nav');
  if (!tocNav) return titleMap;

  for (const anchor of Array.from(tocNav.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href') ?? '';
    const chapterTitle = anchor.textContent?.trim() ?? '';
    if (!href || !chapterTitle) continue;
    const hrefWithoutFragment = href.split('#')[0];
    if (!hrefWithoutFragment) continue;
    const absoluteHref = resolveRelativeHref(navBaseDir, hrefWithoutFragment);
    titleMap.set(absoluteHref.toLowerCase(), chapterTitle);
  }
  return titleMap;
}

const BLOCK_TAG_NAMES = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'section', 'article', 'header',
  'footer', 'aside', 'tr', 'dt', 'dd', 'pre', 'figure',
  'figcaption', 'main', 'nav', 'ol', 'ul', 'table',
  'caption', 'thead', 'tbody', 'tfoot'
]);

function extractTextFromNode(node: Node, parts: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text) parts.push(text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'head') return;
  if (tag === 'br') {
    parts.push('\n');
    return;
  }
  for (const child of Array.from(el.childNodes)) {
    extractTextFromNode(child, parts);
  }
  if (BLOCK_TAG_NAMES.has(tag)) parts.push('\n\n');
}

function htmlDocToPlainText(doc: Document): string {
  const parts: string[] = [];
  const root = doc.body ?? doc.documentElement;
  if (!root) return '';
  extractTextFromNode(root, parts);
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseEpubHtmlFile(htmlText: string): Document {
  const xhtmlDoc = parseAsXhtml(htmlText);
  if (!hasParseError(xhtmlDoc)) return xhtmlDoc;
  return parseAsHtml(htmlText);
}

// epub:type values that indicate front/back matter that is not story content.
// See: https://www.w3.org/TR/epub-ssv/
const EPUB_FRONT_MATTER_TYPES = new Set([
  'cover', 'title-page', 'copyright-page', 'dedication',
  'halftitlepage', 'frontmatter', 'landmarks', 'toc',
  'loa', 'loi', 'lot', 'lov', 'colophon', 'imprint',
]);

const EPUB_NS = 'http://www.idpf.org/2007/ops';

function getEpubTypeAttr(el: Element): string {
  return (
    el.getAttributeNS(EPUB_NS, 'type') ??
    el.getAttribute('epub:type') ??
    ''
  );
}

function hasEpubFrontMatterType(el: Element): boolean {
  const epubType = getEpubTypeAttr(el);
  if (!epubType) return false;
  return epubType.split(/\s+/).some(t => EPUB_FRONT_MATTER_TYPES.has(t));
}

// Checks epub:type on body and its first block-level child.
function isFrontMatterDoc(doc: Document): boolean {
  const body = doc.body;
  if (body && hasEpubFrontMatterType(body)) return true;
  // Many publishers put epub:type on the top-level <section> or <div>
  const firstBlock = body?.firstElementChild;
  if (firstBlock && hasEpubFrontMatterType(firstBlock)) return true;
  return false;
}

// Title-pattern heuristic for EPUB 2 / untagged books.
const FRONT_MATTER_TITLE_RE =
  /^(title\s*page|copyright(\s+(page|notice))?|dedication|table\s+of\s+contents|contents|toc|half\s*title|colophon|also\s+by(\s+the\s+author)?|about\s+the\s+author|acknowledgements?|imprint|epigraph|frontispiece|about\s+this\s+book|publisher'?s?\s+note)$/i;

function extractFirstHeading(doc: Document): string {
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = doc.querySelector(tag);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function extractChaptersFromSpine(
  lcMap: Map<string, Uint8Array>,
  spineItems: ManifestItem[],
  titleMap: Map<string, string>,
  warnings: string[]
): EbookChapter[] {
  const chapters: EbookChapter[] = [];
  let chapterIndex = 0;

  for (const item of spineItems) {
    const bytes = lookupFile(lcMap, item.href);
    if (!bytes) {
      warnings.push(`Spine item not found in archive: ${item.href}`);
      continue;
    }

    let htmlText: string;
    try {
      htmlText = decodeText(bytes);
    } catch {
      warnings.push(`Failed to decode spine item: ${item.href}`);
      continue;
    }

    let doc: Document;
    try {
      doc = parseEpubHtmlFile(htmlText);
    } catch {
      warnings.push(`Failed to parse HTML for spine item: ${item.href}`);
      continue;
    }

    const bodyText = htmlDocToPlainText(doc);
    if (bodyText.trim().length < 30) continue; // skip cover/title-page-only items

    chapterIndex += 1;
    const titleFromMap = titleMap.get(item.href.toLowerCase()) ?? '';
    const title = titleFromMap || extractFirstHeading(doc) || `Chapter ${chapterIndex}`;

    const frontMatterByLinear = item.nonLinear;
    const frontMatterByEpubType = isFrontMatterDoc(doc);
    const frontMatterByTitle = FRONT_MATTER_TITLE_RE.test(title.trim());
    const isFrontMatter = frontMatterByLinear || frontMatterByEpubType || frontMatterByTitle;

    chapters.push({ index: chapterIndex, title, bodyText, isFrontMatter });
  }

  return chapters;
}

export function parseEpub(bytes: Uint8Array): ParsedEbook {
  const warnings: string[] = [];

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (err) {
    throw new Error(`Failed to unzip EPUB: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lcMap = buildLcFileMap(files);
  const opfPath = findOpfPath(lcMap);
  const parsedOpf = parseOpfDoc(lcMap, opfPath);
  warnings.push(...parsedOpf.warnings);

  let titleMap = new Map<string, string>();
  if (parsedOpf.navItem) {
    titleMap = buildTitleMapFromNav(lcMap, parsedOpf.navItem);
  }
  // Use NCX as primary or fallback when NAV map is empty
  if (titleMap.size === 0 && parsedOpf.ncxItem) {
    titleMap = buildTitleMapFromNcx(lcMap, parsedOpf.ncxItem);
  }

  const chapters = extractChaptersFromSpine(lcMap, parsedOpf.spineItems, titleMap, warnings);
  if (chapters.length === 0) {
    warnings.push('No chapters could be extracted from the EPUB spine.');
  }

  return { title: parsedOpf.title, author: parsedOpf.author, chapters, warnings };
}

// --- TXT parsing ---

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

const EXPLICIT_CHAPTER_RE = /^[ \t]*(chapter|part|section|book|prologue|epilogue)\b/i;
const MD_HEADING_RE = /^#{1,3}\s+(.+)/;

function buildChaptersFromHeadings(
  lines: string[],
  headings: Array<{ lineIndex: number; title: string }>
): EbookChapter[] {
  const chapters: EbookChapter[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i].lineIndex + 1;
    const end = headings[i + 1]?.lineIndex ?? lines.length;
    const bodyText = lines
      .slice(start, end)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!bodyText) continue;
    const title = headings[i].title || `Chapter ${chapters.length + 1}`;
    chapters.push({ index: chapters.length + 1, title, bodyText });
  }
  return chapters;
}

export function parseTxt(text: string, fallbackTitle = ''): ParsedEbook {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const warnings: string[] = [];

  // Rule 1: explicit chapter/part/etc headings preceded by a blank line (or start of file)
  const explicitHeadings: Array<{ lineIndex: number; title: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!EXPLICIT_CHAPTER_RE.test(lines[i])) continue;
    if (i > 0 && !isBlankLine(lines[i - 1])) continue;
    explicitHeadings.push({ lineIndex: i, title: lines[i].trim() });
  }
  if (explicitHeadings.length >= 2) {
    const chapters = buildChaptersFromHeadings(lines, explicitHeadings);
    if (chapters.length >= 2) {
      return { title: fallbackTitle, author: '', chapters, warnings };
    }
  }

  // Rule 2: Markdown-style headings
  const mdHeadings: Array<{ lineIndex: number; title: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = MD_HEADING_RE.exec(lines[i]);
    if (!match) continue;
    mdHeadings.push({ lineIndex: i, title: (match[1] ?? '').trim() });
  }
  if (mdHeadings.length >= 2) {
    const chapters = buildChaptersFromHeadings(lines, mdHeadings);
    if (chapters.length >= 2) {
      return { title: fallbackTitle, author: '', chapters, warnings };
    }
  }

  // Rule 3: large blank gaps (3+ consecutive blank lines)
  const sections = normalized.split(/\n{3,}/);
  const substantialSections = sections.filter(s => s.trim().length >= 500);
  if (substantialSections.length >= 2) {
    const chapters = substantialSections.map((section, i) => ({
      index: i + 1,
      title: `Chapter ${i + 1}`,
      bodyText: section.trim()
    }));
    return { title: fallbackTitle, author: '', chapters, warnings };
  }

  // Rule 4: fallback — entire text as one chapter
  warnings.push('No chapter boundaries detected; treating the entire file as one chapter.');
  return {
    title: fallbackTitle,
    author: '',
    chapters: [{ index: 1, title: fallbackTitle || 'Full Text', bodyText: normalized.trim() }],
    warnings
  };
}

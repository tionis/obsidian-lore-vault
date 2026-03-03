import { normalizeLinkTarget } from './link-target-index';
import {
  FrontmatterData,
  asNumber,
  asString,
  asStringArray,
  getFrontmatterValue,
  normalizeFrontmatter
} from './frontmatter-utils';

export interface StoryThreadNode {
  path: string;
  title: string;
  storyId: string;
  chapter: number | null;
  chapterTitle: string;
  previousChapterRefs: string[];
  nextChapterRefs: string[];
}

export interface StoryThreadResolution {
  storyId: string;
  currentPath: string;
  currentIndex: number;
  orderedPaths: string[];
}

function normalizeStoryId(value: string): string {
  return value.trim().toLowerCase();
}

function compareNodes(a: StoryThreadNode, b: StoryThreadNode): number {
  const chapterA = a.chapter ?? Number.MAX_SAFE_INTEGER;
  const chapterB = b.chapter ?? Number.MAX_SAFE_INTEGER;
  return (
    chapterA - chapterB ||
    a.path.localeCompare(b.path)
  );
}

function insertSorted(queue: string[], value: string, compare: (left: string, right: string) => number): void {
  if (queue.includes(value)) {
    return;
  }
  queue.push(value);
  queue.sort(compare);
}

function normalizeChapterRef(value: string): string {
  let normalized = value.trim();
  const wikilinkMatch = normalized.match(/^\[\[([\s\S]+)\]\]$/);
  if (wikilinkMatch) {
    normalized = wikilinkMatch[1].trim();
    const pipeIndex = normalized.indexOf('|');
    if (pipeIndex >= 0) {
      normalized = normalized.slice(0, pipeIndex).trim();
    }
  }
  return normalizeLinkTarget(normalized).toLowerCase();
}

export function parseStoryThreadNodeFromFrontmatter(
  path: string,
  title: string,
  frontmatter: FrontmatterData
): StoryThreadNode | null {
  const normalizedFrontmatter = normalizeFrontmatter(frontmatter);
  const rawStoryId = asString(getFrontmatterValue(normalizedFrontmatter, 'storyId', 'story'));
  const rawAuthorNoteRef = asString(getFrontmatterValue(normalizedFrontmatter, 'authorNote'));
  const normalizedAuthorNoteRef = rawAuthorNoteRef ? normalizeChapterRef(rawAuthorNoteRef) : '';
  const normalizedStoryId = rawStoryId ? normalizeStoryId(rawStoryId) : '';
  const threadAnchorId = normalizedAuthorNoteRef
    ? `author-note:${normalizedAuthorNoteRef}`
    : normalizedStoryId;
  if (!threadAnchorId) {
    return null;
  }

  const chapterValue = asNumber(getFrontmatterValue(normalizedFrontmatter, 'chapter', 'chapterIndex', 'scene'));
  const chapter = Number.isFinite(chapterValue)
    ? Math.max(0, Math.floor(chapterValue as number))
    : null;
  const chapterTitle = asString(getFrontmatterValue(normalizedFrontmatter, 'chapterTitle', 'sceneTitle')) ?? '';
  const previousChapterRefs = asStringArray(getFrontmatterValue(
    normalizedFrontmatter,
    'previousChapter',
    'previous',
    'prevChapter',
    'prev'
  ))
    .map(normalizeChapterRef)
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  const nextChapterRefs = asStringArray(getFrontmatterValue(
    normalizedFrontmatter,
    'nextChapter',
    'next'
  ))
    .map(normalizeChapterRef)
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);

  return {
    path,
    title,
    storyId: threadAnchorId,
    chapter,
    chapterTitle,
    previousChapterRefs,
    nextChapterRefs
  };
}

function resolveRefToPath(
  ref: string,
  pathLookup: Map<string, string>,
  basenameLookup: Map<string, string>
): string | null {
  if (!ref) {
    return null;
  }
  const normalized = normalizeChapterRef(ref);
  if (!normalized) {
    return null;
  }
  if (pathLookup.has(normalized)) {
    return pathLookup.get(normalized) ?? null;
  }
  return basenameLookup.get(normalized) ?? null;
}

export function resolveStoryThread(
  nodes: StoryThreadNode[],
  currentPath: string
): StoryThreadResolution | null {
  const current = nodes.find(node => node.path === currentPath);
  if (!current) {
    return null;
  }

  const scopeNodes = nodes
    .filter(node => node.storyId === current.storyId)
    .sort(compareNodes);
  if (scopeNodes.length === 0) {
    return null;
  }

  const byPath = new Map(scopeNodes.map(node => [node.path, node]));
  const pathLookup = new Map<string, string>();
  const basenameLookup = new Map<string, string>();
  for (const node of scopeNodes) {
    const normalizedPath = normalizeChapterRef(node.path);
    if (normalizedPath && !pathLookup.has(normalizedPath)) {
      pathLookup.set(normalizedPath, node.path);
    }
    const basename = normalizeChapterRef(node.path.split('/').pop() ?? '');
    if (basename && !basenameLookup.has(basename)) {
      basenameLookup.set(basename, node.path);
    }
  }

  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const node of scopeNodes) {
    adjacency.set(node.path, new Set());
    inDegree.set(node.path, 0);
  }

  const addEdge = (from: string, to: string): void => {
    if (from === to) {
      return;
    }
    const fromSet = adjacency.get(from);
    if (!fromSet || fromSet.has(to)) {
      return;
    }
    fromSet.add(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  };

  for (const node of scopeNodes) {
    for (const ref of node.previousChapterRefs) {
      const resolved = resolveRefToPath(ref, pathLookup, basenameLookup);
      if (resolved && byPath.has(resolved)) {
        addEdge(resolved, node.path);
      }
    }
    for (const ref of node.nextChapterRefs) {
      const resolved = resolveRefToPath(ref, pathLookup, basenameLookup);
      if (resolved && byPath.has(resolved)) {
        addEdge(node.path, resolved);
      }
    }
  }

  const comparePaths = (left: string, right: string): number => {
    const leftNode = byPath.get(left);
    const rightNode = byPath.get(right);
    if (!leftNode || !rightNode) {
      return left.localeCompare(right);
    }
    return compareNodes(leftNode, rightNode);
  };

  const queue: string[] = [];
  for (const node of scopeNodes) {
    if ((inDegree.get(node.path) ?? 0) === 0) {
      insertSorted(queue, node.path, comparePaths);
    }
  }

  const ordered: string[] = [];
  while (queue.length > 0) {
    const nextPath = queue.shift();
    if (!nextPath) {
      break;
    }
    ordered.push(nextPath);
    const targets = adjacency.get(nextPath) ?? new Set<string>();
    for (const target of [...targets].sort(comparePaths)) {
      const nextInDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextInDegree);
      if (nextInDegree === 0) {
        insertSorted(queue, target, comparePaths);
      }
    }
  }

  const orderedPaths = ordered.length === scopeNodes.length
    ? ordered
    : scopeNodes.map(node => node.path);
  const currentIndex = orderedPaths.indexOf(currentPath);
  if (currentIndex < 0) {
    return null;
  }

  return {
    storyId: current.storyId,
    currentPath,
    currentIndex,
    orderedPaths
  };
}

export function resolveStoryThreadLineage(
  nodes: StoryThreadNode[],
  currentPath: string
): StoryThreadResolution | null {
  const current = nodes.find(node => node.path === currentPath);
  if (!current) {
    return null;
  }

  const sortedNodes = [...nodes].sort(compareNodes);
  const byPath = new Map(sortedNodes.map(node => [node.path, node]));
  const pathLookup = new Map<string, string>();
  const basenameLookup = new Map<string, string>();
  for (const node of sortedNodes) {
    const normalizedPath = normalizeChapterRef(node.path);
    if (normalizedPath && !pathLookup.has(normalizedPath)) {
      pathLookup.set(normalizedPath, node.path);
    }
    const basename = normalizeChapterRef(node.path.split('/').pop() ?? '');
    if (basename && !basenameLookup.has(basename)) {
      basenameLookup.set(basename, node.path);
    }
  }

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const node of sortedNodes) {
    outgoing.set(node.path, new Set());
    incoming.set(node.path, new Set());
  }

  const addEdge = (from: string, to: string): void => {
    if (from === to) {
      return;
    }
    const fromSet = outgoing.get(from);
    const toSet = incoming.get(to);
    if (!fromSet || !toSet || fromSet.has(to)) {
      return;
    }
    fromSet.add(to);
    toSet.add(from);
  };

  for (const node of sortedNodes) {
    for (const ref of node.previousChapterRefs) {
      const resolved = resolveRefToPath(ref, pathLookup, basenameLookup);
      if (resolved && byPath.has(resolved)) {
        addEdge(resolved, node.path);
      }
    }
    for (const ref of node.nextChapterRefs) {
      const resolved = resolveRefToPath(ref, pathLookup, basenameLookup);
      if (resolved && byPath.has(resolved)) {
        addEdge(node.path, resolved);
      }
    }
  }

  const comparePaths = (left: string, right: string): number => {
    const leftNode = byPath.get(left);
    const rightNode = byPath.get(right);
    if (!leftNode || !rightNode) {
      return left.localeCompare(right);
    }
    return compareNodes(leftNode, rightNode);
  };

  const lineageSet = new Set<string>([current.path]);
  const queue: string[] = [current.path];
  while (queue.length > 0) {
    const nextPath = queue.shift();
    if (!nextPath) {
      break;
    }
    const parents = [...(incoming.get(nextPath) ?? new Set<string>())].sort(comparePaths);
    for (const parentPath of parents) {
      if (lineageSet.has(parentPath)) {
        continue;
      }
      lineageSet.add(parentPath);
      queue.push(parentPath);
    }
  }

  // Always include the current anchor's own nodes so chapter-order-only threads
  // still resolve deterministically even when explicit prev/next links are sparse.
  for (const node of sortedNodes) {
    if (node.storyId === current.storyId) {
      lineageSet.add(node.path);
    }
  }

  const lineagePaths = [...lineageSet];
  if (lineagePaths.length === 0) {
    return null;
  }

  const lineageInDegree = new Map<string, number>();
  for (const path of lineagePaths) {
    lineageInDegree.set(path, 0);
  }
  for (const path of lineagePaths) {
    const targets = outgoing.get(path) ?? new Set<string>();
    for (const target of targets) {
      if (!lineageSet.has(target)) {
        continue;
      }
      lineageInDegree.set(target, (lineageInDegree.get(target) ?? 0) + 1);
    }
  }

  const lineageQueue: string[] = [];
  for (const path of [...lineageSet].sort(comparePaths)) {
    if ((lineageInDegree.get(path) ?? 0) === 0) {
      insertSorted(lineageQueue, path, comparePaths);
    }
  }

  const orderedPaths: string[] = [];
  while (lineageQueue.length > 0) {
    const nextPath = lineageQueue.shift();
    if (!nextPath) {
      break;
    }
    orderedPaths.push(nextPath);
    const targets = outgoing.get(nextPath) ?? new Set<string>();
    for (const target of [...targets].sort(comparePaths)) {
      if (!lineageSet.has(target)) {
        continue;
      }
      const nextInDegree = (lineageInDegree.get(target) ?? 0) - 1;
      lineageInDegree.set(target, nextInDegree);
      if (nextInDegree === 0) {
        insertSorted(lineageQueue, target, comparePaths);
      }
    }
  }

  const resolvedOrder = orderedPaths.length === lineageSet.size
    ? orderedPaths
    : [...lineageSet].sort(comparePaths);
  const currentIndex = resolvedOrder.indexOf(currentPath);
  if (currentIndex < 0) {
    return null;
  }

  return {
    storyId: current.storyId,
    currentPath,
    currentIndex,
    orderedPaths: resolvedOrder
  };
}

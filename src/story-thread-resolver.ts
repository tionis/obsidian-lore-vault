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
  if (!rawStoryId) {
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
    storyId: normalizeStoryId(rawStoryId),
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

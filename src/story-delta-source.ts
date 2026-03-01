import { StoryThreadResolution } from './story-thread-resolver';

export type StoryDeltaSourceMode = 'note' | 'chapter' | 'story';

export function resolveStoryDeltaSourcePaths(
  mode: StoryDeltaSourceMode,
  selectedPath: string,
  resolution: StoryThreadResolution | null
): string[] {
  const normalizedSelectedPath = selectedPath.trim();
  if (!normalizedSelectedPath) {
    return [];
  }

  if (mode === 'note') {
    return [normalizedSelectedPath];
  }

  if (!resolution || resolution.orderedPaths.length === 0) {
    return [];
  }

  if (mode === 'chapter') {
    const chapterPath = resolution.orderedPaths[resolution.currentIndex] ?? '';
    return chapterPath ? [chapterPath] : [];
  }

  return resolution.orderedPaths.filter(Boolean);
}

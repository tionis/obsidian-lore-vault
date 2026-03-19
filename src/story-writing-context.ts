export function updateStoryWritingContextPath(currentPath: string, nextPath: string): string {
  const normalizedNextPath = nextPath.trim();
  if (normalizedNextPath) {
    return normalizedNextPath;
  }
  return currentPath.trim();
}

export function resolveStoryWritingContextPath(activePath: string, rememberedPath: string): string {
  return updateStoryWritingContextPath(rememberedPath, activePath);
}

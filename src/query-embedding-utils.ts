export async function resolveQueryEmbedding(
  queryEmbedding: number[] | null | undefined,
  shouldCompute: boolean,
  computeQueryEmbedding: () => Promise<number[] | null>
): Promise<number[] | null> {
  if (queryEmbedding !== undefined) {
    return queryEmbedding ?? null;
  }
  if (!shouldCompute) {
    return null;
  }
  return computeQueryEmbedding();
}

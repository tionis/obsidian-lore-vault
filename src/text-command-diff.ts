import { buildSourceDiffPreview, SourceDiffPreview } from './source-diff';

export type TextCommandDiffPreview = SourceDiffPreview;

export function buildTextCommandDiffPreview(originalText: string, revisedText: string): TextCommandDiffPreview {
  return buildSourceDiffPreview(originalText, revisedText, {
    contextLines: 4,
    maxRenderRows: 320
  });
}

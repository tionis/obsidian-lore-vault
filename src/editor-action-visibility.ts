export interface InlineDirectiveContextActionVisibilityInput {
  isAuthorNote: boolean;
}

export function shouldShowInsertInlineDirectiveContextAction(
  input: InlineDirectiveContextActionVisibilityInput
): boolean {
  return !input.isAuthorNote;
}

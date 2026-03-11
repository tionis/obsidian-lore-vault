export type GenerationState = 'idle' | 'preparing' | 'retrieving' | 'generating' | 'error';

export function isActiveGenerationState(state: GenerationState): boolean {
  return state === 'preparing' || state === 'retrieving' || state === 'generating';
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInlineLoreDirectives,
  renderInlineLoreDirectivesAsTags,
  stripInlineLoreDirectives
} from '../src/inline-directives';

test('extractInlineLoreDirectives supports bracket and comment syntax', () => {
  const source = [
    'Normal text before.',
    '[LV: Make the tone tenser]',
    'Mid text.',
    '<!-- LV: Keep POV in first person -->',
    'After text.'
  ].join('\n');

  const directives = extractInlineLoreDirectives(source);
  assert.deepEqual(directives, [
    'Make the tone tenser',
    'Keep POV in first person'
  ]);
});

test('extractInlineLoreDirectives ignores non-prefixed bracket notes', () => {
  const source = [
    '[Editor\'s Note: ignore this]',
    '[Make it bigger]',
    '[LV: Keep scene length short]'
  ].join('\n');

  const directives = extractInlineLoreDirectives(source);
  assert.deepEqual(directives, ['Keep scene length short']);
});

test('extractInlineLoreDirectives is deterministic and dedupes by normalized text', () => {
  const source = [
    '[LV:  Keep    scene   tight ]',
    '<!-- LV: Keep scene tight -->',
    '[LV: keep scene tight]'
  ].join('\n');

  const directives = extractInlineLoreDirectives(source);
  assert.deepEqual(directives, ['Keep scene tight']);
});

test('stripInlineLoreDirectives removes directive markers from markdown', () => {
  const source = [
    '# Chapter',
    '',
    '[LV: Emphasize dread]',
    '',
    'The corridor narrows.',
    '',
    '<!-- LV: keep this whispered -->',
    '',
    'Shadows move.'
  ].join('\n');

  const stripped = stripInlineLoreDirectives(source);
  assert.equal(stripped.includes('[LV:'), false);
  assert.equal(stripped.includes('<!-- LV:'), false);
  assert.equal(stripped.includes('The corridor narrows.'), true);
  assert.equal(stripped.includes('Shadows move.'), true);
});

test('renderInlineLoreDirectivesAsTags preserves placement and converts directives to inline tags', () => {
  const source = [
    'Before.',
    '<!-- Keep this hidden note out of the prompt -->',
    '<!-- LV: Keep this scene claustrophobic -->',
    '',
    'Middle [LV: Raise tension] text.',
    '',
    'After.'
  ].join('\n');

  const rendered = renderInlineLoreDirectivesAsTags(source);
  assert.deepEqual(rendered.directives, [
    'Keep this scene claustrophobic',
    'Raise tension'
  ]);
  assert.equal(rendered.text.includes('<inline_story_directive>'), true);
  assert.equal(rendered.text.includes('Keep this scene claustrophobic'), true);
  assert.equal(rendered.text.includes('Raise tension'), true);
  assert.equal(rendered.text.includes('hidden note out of the prompt'), false);
  assert.equal(rendered.text.includes('Before.'), true);
  assert.equal(rendered.text.includes('After.'), true);
});

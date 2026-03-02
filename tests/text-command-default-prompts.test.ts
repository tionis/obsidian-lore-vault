import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEXT_COMMAND_PROMPT_TEMPLATES,
  cloneDefaultTextCommandPromptTemplates
} from '../src/models';

test('default text command templates include canon and scene consistency passes', () => {
  const templates = cloneDefaultTextCommandPromptTemplates();
  const ids = templates.map(template => template.id);
  assert.ok(ids.includes('canon-consistency'));
  assert.ok(ids.includes('scene-consistency'));

  const sceneTemplate = templates.find(template => template.id === 'scene-consistency');
  assert.ok(sceneTemplate);
  assert.equal(sceneTemplate.includeLorebookContext, true);
  assert.match(sceneTemplate.prompt.toLowerCase(), /internal scene consistency/);
});

test('cloneDefaultTextCommandPromptTemplates returns a detached clone', () => {
  const cloned = cloneDefaultTextCommandPromptTemplates();
  const originalFirstName = DEFAULT_TEXT_COMMAND_PROMPT_TEMPLATES[0]?.name ?? '';
  cloned[0].name = 'mutated';
  assert.equal(DEFAULT_TEXT_COMMAND_PROMPT_TEMPLATES[0]?.name ?? '', originalFirstName);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCharacterCardDetailsContentFromMarkdown } from '../src/character-card-details';

test('parseCharacterCardDetailsContentFromMarkdown extracts text and list sections from managed details block', () => {
  const markdown = [
    '---',
    'lvDocType: characterCard',
    '---',
    '',
    '# Demo Card',
    '',
    '<!-- LV_BEGIN_CHARACTER_CARD_DETAILS -->',
    '<!-- LV_CHARACTER_CARD_DETAILS_VERSION: 2 -->',
    '## Character Card Details',
    '',
    '![[LoreVault/attachments/avatar-local.png]]',
    '',
    'Source Card: [[cards/demo.png]]',
    '',
    '### Card Summary',
    '',
    'Short, focused summary.',
    '',
    '### Summary Tone',
    '',
    '- dark',
    '- intimate',
    '',
    '### Creator Notes',
    '',
    'Use present tense.',
    '',
    '### Personality',
    '',
    'Clever but reckless.',
    '',
    '### Alternate Greetings',
    '',
    '- Hey there.',
    '- Need a hand?',
    '',
    '<!-- LV_END_CHARACTER_CARD_DETAILS -->'
  ].join('\n');

  const parsed = parseCharacterCardDetailsContentFromMarkdown(markdown);
  assert.equal(parsed.avatarEmbedMarkdown, '![[LoreVault/attachments/avatar-local.png]]');
  assert.equal(parsed.cardSummary, 'Short, focused summary.');
  assert.deepEqual(parsed.cardSummaryTone, ['dark', 'intimate']);
  assert.equal(parsed.creatorNotes, 'Use present tense.');
  assert.equal(parsed.cardPersonality, 'Clever but reckless.');
  assert.deepEqual(parsed.cardAlternateGreetings, ['Hey there.', 'Need a hand?']);
});

test('parseCharacterCardDetailsContentFromMarkdown extracts grouped greeting subheadings', () => {
  const markdown = [
    '<!-- LV_BEGIN_CHARACTER_CARD_DETAILS -->',
    '<!-- LV_CHARACTER_CARD_DETAILS_VERSION: 2 -->',
    '## Character Card Details',
    '',
    'Source Card: [[cards/demo.png]]',
    '',
    '### Alternate Greetings',
    '',
    '#### Alternate Greeting 1',
    '',
    'The door is already open.',
    '"Come in, slowly," she says.',
    '',
    '#### Alternate Greeting 2',
    '',
    'Night falls over the market square.',
    '',
    '### Group-Only Greetings',
    '',
    '#### Group-Only Greeting 1',
    '',
    'Everyone made it. Keep your voices down.',
    '',
    '<!-- LV_END_CHARACTER_CARD_DETAILS -->'
  ].join('\n');

  const parsed = parseCharacterCardDetailsContentFromMarkdown(markdown);
  assert.deepEqual(parsed.cardAlternateGreetings, [
    'The door is already open.\n"Come in, slowly," she says.',
    'Night falls over the market square.'
  ]);
  assert.deepEqual(parsed.cardGroupOnlyGreetings, [
    'Everyone made it. Keep your voices down.'
  ]);
});

test('parseCharacterCardDetailsContentFromMarkdown returns empty values when no managed block exists', () => {
  const parsed = parseCharacterCardDetailsContentFromMarkdown('# No managed details here');
  assert.equal(parsed.cardSummary, '');
  assert.equal(parsed.creatorNotes, '');
  assert.equal(parsed.cardScenario, '');
  assert.deepEqual(parsed.cardSummaryThemes, []);
  assert.deepEqual(parsed.cardAlternateGreetings, []);
});

test('parseCharacterCardDetailsContentFromMarkdown detects avatar embed even when moved below source line', () => {
  const markdown = [
    '<!-- LV_BEGIN_CHARACTER_CARD_DETAILS -->',
    '<!-- LV_CHARACTER_CARD_DETAILS_VERSION: 2 -->',
    '## Character Card Details',
    '',
    'Source Card: [[cards/demo.png]]',
    '',
    '![](LoreVault/attachments/avatar-local.png "Localized")',
    '',
    '### Card Summary',
    '',
    'Summary body.',
    '',
    '<!-- LV_END_CHARACTER_CARD_DETAILS -->'
  ].join('\n');

  const parsed = parseCharacterCardDetailsContentFromMarkdown(markdown);
  assert.equal(parsed.avatarEmbedMarkdown, '![](LoreVault/attachments/avatar-local.png "Localized")');
});

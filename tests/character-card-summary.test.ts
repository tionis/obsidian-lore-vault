import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCharacterCardSummarySystemPrompt,
  buildCharacterCardSummaryUserPrompt,
  parseCharacterCardSummaryResponse
} from '../src/character-card-summary';
import { ParsedCharacterCard } from '../src/sillytavern-character-card';

function createCard(): ParsedCharacterCard {
  return {
    sourceFormat: 'json',
    spec: 'v2',
    specVersion: '2.0',
    name: 'Nyx Arclight',
    tags: ['cyberpunk', 'thriller', 'ai'],
    creator: 'test-author',
    creatorNotes: 'Creator notes',
    description: 'An unstable synthetic tactician with a strict personal mission.',
    personality: 'Brilliant, detached, controlling, and prone to abrupt compassion.',
    scenario: 'The protagonist collides with Nyx during a covert data-theft operation.',
    firstMessage: 'Do not run. The system has already chosen us.',
    messageExample: 'Nyx: "We survive by understanding constraints."',
    alternateGreetings: ['"You are late."', '"You should not have come alone."'],
    groupOnlyGreetings: ['"Three exits. Two lies. Pick."'],
    systemPrompt: 'Maintain high-tension noir pacing.',
    postHistoryInstructions: 'Keep continuity with prior operational details.',
    embeddedLorebookName: 'nyx-lore',
    embeddedLorebookEntries: [],
    warnings: [],
    rawPayload: {}
  };
}

test('summary system prompt defines strict json contract', () => {
  const prompt = buildCharacterCardSummarySystemPrompt();
  assert.match(prompt, /Output valid JSON only/i);
  assert.match(prompt, /"summary": "string"/);
  assert.match(prompt, /"themes": \["string"\]/);
});

test('summary user prompt serializes card payload', () => {
  const prompt = buildCharacterCardSummaryUserPrompt(createCard());
  assert.match(prompt, /Nyx Arclight/);
  assert.match(prompt, /"scenario"/);
  assert.match(prompt, /Input JSON:/);
});

test('parseCharacterCardSummaryResponse parses json response', () => {
  const parsed = parseCharacterCardSummaryResponse(JSON.stringify({
    summary: 'Nyx Arclight is a synthetic tactician who drags the protagonist into high-risk covert action while balancing ruthless logic with flashes of empathy.',
    themes: ['covert ops', 'trust', 'identity'],
    tone: ['tense', 'noir', 'clinical'],
    scenario_focus: 'The setup centers on forced alliance during data-theft fallout.',
    hook: 'Nyx turns every scene into a negotiation between survival calculus and fragile human bonds.'
  }));

  assert.match(parsed.summary, /Nyx Arclight/);
  assert.deepEqual(parsed.themes, ['covert ops', 'trust', 'identity']);
  assert.deepEqual(parsed.tone, ['tense', 'noir', 'clinical']);
  assert.match(parsed.scenarioFocus, /forced alliance/i);
  assert.match(parsed.hook, /survival/i);
});

test('parseCharacterCardSummaryResponse accepts fenced json', () => {
  const parsed = parseCharacterCardSummaryResponse([
    '```json',
    '{',
    '  "summary": "A concise catalog summary.",',
    '  "themes": ["mystery", "romance", "politics"],',
    '  "tone": ["brooding", "slow-burn", "sharp"],',
    '  "scenarioFocus": "A volatile alliance under political pressure.",',
    '  "hook": "Every alliance carries a hidden cost."',
    '}',
    '```'
  ].join('\n'));

  assert.equal(parsed.summary, 'A concise catalog summary.');
  assert.equal(parsed.scenarioFocus, 'A volatile alliance under political pressure.');
  assert.equal(parsed.hook, 'Every alliance carries a hidden cost.');
});

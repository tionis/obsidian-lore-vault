import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCharacterCardImportPlan,
  parseCharacterCardRewriteResponse,
  parseSillyTavernCharacterCardJson,
  parseSillyTavernCharacterCardPngBytes
} from '../src/sillytavern-character-card';

test('parseSillyTavernCharacterCardPngBytes reads ccv3/chara payload fields', () => {
  const bytes = new Uint8Array(readFileSync('references/default_Seraphina.png'));
  const parsed = parseSillyTavernCharacterCardPngBytes(bytes);

  assert.equal(parsed.sourceFormat, 'png');
  assert.equal(parsed.name, 'Seraphina');
  assert.equal(parsed.creator, 'OtisAlejandro');
  assert.equal(parsed.spec, 'chara_card_v3');
  assert.equal(parsed.embeddedLorebookEntries.length > 0, true);
  assert.equal(parsed.firstMessage.length > 0, true);
});

test('parseSillyTavernCharacterCardJson handles v1 payload shape', () => {
  const parsed = parseSillyTavernCharacterCardJson(JSON.stringify({
    name: 'Wakaba',
    description: 'Cyberpunk field operator',
    personality: 'Witty and guarded',
    scenario: 'Arasaka safehouse infiltration',
    first_mes: 'You are late.',
    mes_example: 'Keep your voice low.',
    metadata: {
      creator: 'SynthWriter'
    }
  }));

  assert.equal(parsed.sourceFormat, 'json');
  assert.equal(parsed.name, 'Wakaba');
  assert.equal(parsed.creator, 'SynthWriter');
  assert.equal(parsed.spec, 'v1');
  assert.equal(parsed.scenario, 'Arasaka safehouse infiltration');
  assert.deepEqual(parsed.warnings, []);
});

test('parseCharacterCardRewriteResponse accepts fenced JSON with freeform author-note markdown', () => {
  const rewrite = parseCharacterCardRewriteResponse([
    '```json',
    '{',
    '  "title": "Yggdrasil: Opening Move",',
    '  "storyMarkdown": "# Opening\\n\\nScene setup.",',
    '  "authorNoteMarkdown": "# Author Guidance\\n\\n- Stay grounded.\\n- Converted roleplay placeholders to prose framing.",',
    '  "rewriteNotes": ["Kept faction naming from source."]',
    '}',
    '```'
  ].join('\n'));

  assert.equal(rewrite.title, 'Yggdrasil: Opening Move');
  assert.equal(rewrite.storyMarkdown.includes('Scene setup.'), true);
  assert.equal(rewrite.authorNoteMarkdown.includes('# Author Guidance'), true);
  assert.equal(rewrite.authorNoteMarkdown.includes('Stay grounded.'), true);
  assert.equal(rewrite.authorNoteMarkdown.includes('Converted roleplay placeholders'), true);
  assert.deepEqual(rewrite.rewriteNotes, ['Kept faction naming from source.']);
});

test('parseCharacterCardRewriteResponse falls back to authorNote string when authorNoteMarkdown is absent', () => {
  const rewrite = parseCharacterCardRewriteResponse(JSON.stringify({
    title: 'Fallback',
    storyMarkdown: 'Scene.',
    authorNote: [
      '# Guidance',
      '- Keep scenes anchored in physical action.',
      '- Reveal the hidden witness.'
    ].join('\n'),
    rewriteNotes: []
  }));

  assert.equal(rewrite.authorNoteMarkdown.includes('# Guidance'), true);
  assert.equal(rewrite.authorNoteMarkdown.includes('Keep scenes anchored in physical action.'), true);
  assert.equal(rewrite.authorNoteMarkdown.includes('Reveal the hidden witness.'), true);
});

test('parseCharacterCardRewriteResponse preserves long author-note markdown content', () => {
  const rewrite = parseCharacterCardRewriteResponse(JSON.stringify({
    title: 'Compact',
    storyMarkdown: 'Scene.',
    authorNoteMarkdown: [
      '# Notes',
      '- Write in exceptionally gritty, hyper-atmospheric, deeply cinematic prose with long, dramatic, highly ornamental descriptions that never stop.'
    ].join('\n'),
    rewriteNotes: []
  }));

  const lines = rewrite.authorNoteMarkdown.split('\n').filter(line => line.startsWith('- '));
  assert.equal(lines.length > 0, true);
  const first = lines[0].slice(2).toLowerCase();
  assert.equal(first.includes('exceptionally gritty'), true);
});

test('buildCharacterCardImportPlan creates story + author note + embedded lorebook pages', () => {
  const card = parseSillyTavernCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    data: {
      name: 'Captain Sol',
      creator: 'Archivist',
      description: 'Fleet commander',
      personality: 'Strategic',
      scenario: 'Third Fleet escalation',
      first_mes: 'Status report.',
      mes_example: 'Hold formation.',
      creator_notes: 'Roleplay focused source card.',
      tags: ['fleet', 'military'],
      character_book: {
        name: 'Fleet Facts',
        entries: [
          {
            uid: 7,
            comment: 'Third Fleet',
            content: 'The Third Fleet guards the inner lanes.',
            key: ['Third Fleet'],
            keysecondary: ['Fleet'],
            disable: false
          }
        ]
      }
    }
  }));

  const rewrite = parseCharacterCardRewriteResponse(JSON.stringify({
    title: 'Captain Sol: First Draft',
    storyMarkdown: '## Opening\n\nThe fleet gathered over Drila.',
    authorNoteMarkdown: [
      '# Author Note',
      '- Keep tactical realism.',
      '- Third Fleet doctrine must stay consistent.',
      '- Open with orbital pressure.'
    ].join('\n'),
    rewriteNotes: []
  }));

  const plan = buildCharacterCardImportPlan(card, rewrite, {
    targetFolder: 'LoreVault/import',
    authorNoteFolder: 'LoreVault/author-notes',
    defaultTagsRaw: 'wiki, imported',
    lorebookNames: ['universe/yggdrasil/factions'],
    tagPrefix: 'lorebook',
    maxSummaryChars: 320,
    includeEmbeddedLorebook: true,
    sourceCardPath: 'cards/captain-sol.png',
    completionPresetId: 'openrouter-default'
  });

  assert.equal(plan.pages.length, 3);
  const storyPage = plan.pages.find(page => page.path.endsWith('captain-sol-first-draft.md'));
  const authorPage = plan.pages.find(page => page.path.endsWith('captain-sol-first-draft-author-note.md'));
  assert.ok(storyPage);
  assert.ok(authorPage);
  assert.match(storyPage.content, /authorNote: "\[\[LoreVault\/author-notes\/captain-sol-first-draft-author-note\]\]"/);
  assert.match(storyPage.content, /sourceType: "sillytavern_character_card_import"/);
  assert.match(storyPage.content, /characterCardAvatar: "\[\[cards\/captain-sol\.png\]\]"/);
  assert.match(storyPage.content, /!\[\[cards\/captain-sol\.png\]\]/);
  assert.match(authorPage.content, /lvDocType: "authorNote"/);
  assert.match(authorPage.content, /completionProfile: "openrouter-default"/);
});

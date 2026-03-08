import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyCharacterCardWriteBackToPayload,
  buildCharacterCardCharacterExtractUserPrompt,
  buildCharacterCardRewriteUserPrompt,
  buildCharacterCardImportPlan,
  collectCharacterCardTemplatePlaceholders,
  parseCharacterCardCharacterExtractResponse,
  parseCharacterCardRewriteResponse,
  parseSillyTavernCharacterCardJson,
  parseSillyTavernCharacterCardPngBytes,
  upsertSillyTavernCharacterCardPngPayload
} from '../src/sillytavern-character-card';

test('parseSillyTavernCharacterCardPngBytes reads ccv3/chara payload fields', () => {
  const bytes = new Uint8Array(readFileSync('fixtures/cards/default_Seraphina.png'));
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

test('parseCharacterCardCharacterExtractResponse parses character-page payload', () => {
  const parsed = parseCharacterCardCharacterExtractResponse(JSON.stringify({
    title: 'Captain Sol',
    summary: 'Veteran fleet commander balancing doctrine and political pressure.',
    keywords: ['captain sol', 'third fleet'],
    aliases: ['Sol'],
    markdown: [
      '## Overview',
      'Captain Sol commands the Third Fleet and prioritizes disciplined tactical execution.'
    ].join('\n'),
    rewriteNotes: ['Removed roleplay placeholders.']
  }));

  assert.equal(parsed.title, 'Captain Sol');
  assert.equal(parsed.summary.includes('Veteran fleet commander'), true);
  assert.equal(parsed.markdown.includes('## Overview'), true);
  assert.deepEqual(parsed.keywords, ['captain sol', 'third fleet']);
  assert.deepEqual(parsed.aliases, ['Sol']);
  assert.deepEqual(parsed.rewriteNotes, ['Removed roleplay placeholders.']);
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
    characterCardMetaPath: 'LoreVault/character-cards/library/captain-sol-card.md',
    completionPresetId: 'openrouter-default'
  });

  assert.equal(plan.pages.length, 3);
  const storyPage = plan.pages.find(page => page.path.endsWith('captain-sol-first-draft.md'));
  const authorPage = plan.pages.find(page => page.path.endsWith('captain-sol-first-draft-author-note.md'));
  assert.ok(storyPage);
  assert.ok(authorPage);
  assert.match(storyPage.content, /authorNote: "\[\[LoreVault\/author-notes\/captain-sol-first-draft-author-note\]\]"/);
  assert.match(storyPage.content, /sourceType: "sillytavern_character_card_import"/);
  assert.match(storyPage.content, /characterCardMeta: "\[\[LoreVault\/character-cards\/library\/captain-sol-card\]\]"/);
  assert.match(storyPage.content, /characterCardAvatar: "\[\[cards\/captain-sol\.png\]\]"/);
  assert.match(storyPage.content, /!\[\[cards\/captain-sol\.png\]\]/);
  assert.match(authorPage.content, /lvDocType: "authorNote"/);
  assert.match(authorPage.content, /completionProfile: "openrouter-default"/);
});

test('buildCharacterCardImportPlan optionally includes extracted character wiki page', () => {
  const card = parseSillyTavernCharacterCardJson(JSON.stringify({
    data: {
      name: 'Wakaba',
      creator: 'SynthWriter',
      description: 'A volatile cyber-entity',
      personality: 'Cheerful and possessive',
      scenario: 'Night City intrusion'
    }
  }));
  const rewrite = parseCharacterCardRewriteResponse(JSON.stringify({
    title: 'Wakaba: First Draft',
    storyMarkdown: 'Opening scene.',
    authorNoteMarkdown: '# Author Note\n- Keep tension high.',
    rewriteNotes: []
  }));
  const characterPage = parseCharacterCardCharacterExtractResponse(JSON.stringify({
    title: 'Wakaba',
    summary: 'Sentient AI entity bound to a prototype chip and visible only to the host.',
    keywords: ['wakaba', 'prototype chip'],
    aliases: ['SUCCUBI.exe'],
    markdown: [
      '## Overview',
      'Wakaba is an unstable sentient AI embedded in a prototype Arasaka chip.',
      '',
      '## Capabilities',
      '- Can influence nearby connected systems.',
      '- Interfaces directly with host neural pathways.'
    ].join('\n'),
    rewriteNotes: []
  }));

  const plan = buildCharacterCardImportPlan(card, rewrite, {
    targetFolder: 'LoreVault/import',
    authorNoteFolder: 'LoreVault/author-notes',
    defaultTagsRaw: 'wiki, imported',
    lorebookNames: ['universe/yggdrasil/characters'],
    tagPrefix: 'lorebook',
    maxSummaryChars: 320,
    includeEmbeddedLorebook: false,
    sourceCardPath: 'cards/wakaba.json',
    completionPresetId: '',
    characterPage
  });

  const extractedPage = plan.pages.find(page => page.path.endsWith('/characters/wakaba.md'));
  assert.ok(extractedPage);
  assert.match(extractedPage.content, /sourceType: "sillytavern_character_card_character_extract"/);
  assert.match(extractedPage.content, /## Summary/);
  assert.match(extractedPage.content, /Sentient AI entity bound to a prototype chip/);
  assert.match(extractedPage.content, /tags:\n {2}- "wiki"\n {2}- "imported"\n {2}- "lorebook\/universe\/yggdrasil\/characters"/);
});

test('applyCharacterCardWriteBackToPayload updates canonical card fields without dropping unknown payload fields', () => {
  const originalPayload = {
    spec: 'chara_card_v2',
    data: {
      name: 'Captain Sol',
      description: 'Fleet commander',
      personality: 'Strategic',
      scenario: 'Third Fleet escalation',
      first_mes: 'Status report.',
      mes_example: 'Hold formation.',
      creator: 'Archivist',
      creator_notes: 'Original notes',
      tags: ['fleet'],
      metadata: {
        creator_notes: 'Original metadata notes'
      },
      extensions: {
        customFlag: true
      }
    }
  };

  const updated = applyCharacterCardWriteBackToPayload(originalPayload, {
    name: 'Captain Sol Prime',
    tags: ['fleet', 'command'],
    creator: 'VaultAdmin',
    creatorNotes: 'Rewritten in vault meta note',
    description: 'Veteran command officer',
    personality: 'Precise and uncompromising',
    scenario: 'Orbit over Drila',
    firstMessage: 'Report all batteries.',
    messageExample: 'Keep hard formation.',
    alternateGreetings: ['Ready check.'],
    groupOnlyGreetings: ['Squad briefing online.'],
    systemPrompt: 'Stay consistent with military tone.',
    postHistoryInstructions: 'Prefer concise command dialogue.'
  }) as {data: Record<string, unknown>};

  const updatedRoot = updated.data;
  assert.equal(updatedRoot.name, 'Captain Sol Prime');
  assert.deepEqual(updatedRoot.tags, ['fleet', 'command']);
  assert.equal(updatedRoot.creator, 'VaultAdmin');
  assert.equal(updatedRoot.creator_notes, 'Rewritten in vault meta note');
  assert.equal(updatedRoot.description, 'Veteran command officer');
  assert.equal(updatedRoot.personality, 'Precise and uncompromising');
  assert.equal(updatedRoot.scenario, 'Orbit over Drila');
  assert.equal(updatedRoot.first_mes, 'Report all batteries.');
  assert.equal(updatedRoot.mes_example, 'Keep hard formation.');
  assert.deepEqual(updatedRoot.alternate_greetings, ['Ready check.']);
  assert.deepEqual(updatedRoot.group_only_greetings, ['Squad briefing online.']);
  assert.equal(updatedRoot.system_prompt, 'Stay consistent with military tone.');
  assert.equal(updatedRoot.post_history_instructions, 'Prefer concise command dialogue.');
  assert.equal((updatedRoot.metadata as {creator_notes: string}).creator_notes, 'Rewritten in vault meta note');
  assert.deepEqual(updatedRoot.extensions, { customFlag: true });
});

test('upsertSillyTavernCharacterCardPngPayload rewrites card metadata while preserving PNG readability', () => {
  const originalBytes = new Uint8Array(readFileSync('fixtures/cards/default_Seraphina.png'));
  const originalCard = parseSillyTavernCharacterCardPngBytes(originalBytes);
  const updatedPayload = applyCharacterCardWriteBackToPayload(originalCard.rawPayload, {
    name: 'Seraphina Prime',
    tags: [...originalCard.tags, 'vault-updated'],
    creator: 'LoreVault',
    creatorNotes: 'Updated from character-card meta note.',
    description: `${originalCard.description} Updated.`,
    personality: originalCard.personality,
    scenario: `${originalCard.scenario} (updated)`,
    firstMessage: originalCard.firstMessage,
    messageExample: originalCard.messageExample,
    alternateGreetings: originalCard.alternateGreetings,
    groupOnlyGreetings: originalCard.groupOnlyGreetings,
    systemPrompt: originalCard.systemPrompt,
    postHistoryInstructions: originalCard.postHistoryInstructions
  });

  const rewrittenBytes = upsertSillyTavernCharacterCardPngPayload(originalBytes, updatedPayload);
  const reparsed = parseSillyTavernCharacterCardPngBytes(rewrittenBytes);

  assert.equal(reparsed.name, 'Seraphina Prime');
  assert.equal(reparsed.creator, 'LoreVault');
  assert.equal(reparsed.tags.includes('vault-updated'), true);
  assert.equal(reparsed.description.endsWith('Updated.'), true);
  assert.equal(reparsed.scenario.endsWith('(updated)'), true);
  assert.equal(reparsed.embeddedLorebookEntries.length > 0, true);
});

test('collectCharacterCardTemplatePlaceholders detects common template placeholders', () => {
  const card = parseSillyTavernCharacterCardJson(JSON.stringify({
    name: 'Lena',
    description: 'A fixer who trusts {{user}} only in private.',
    scenario: '{{char}} and {{user}} prepare the heist.',
    first_mes: 'Hello {{USER}}.',
    mes_example: 'Coordinate with {{random_user_1}} and {{random_char}}.',
    post_history_instructions: 'Avoid raw {{group}} macros.'
  }));

  const placeholders = collectCharacterCardTemplatePlaceholders(card);
  assert.deepEqual(
    [...placeholders].sort((left, right) => left.localeCompare(right)),
    ['{{char}}', '{{group}}', '{{random_char}}', '{{random_user_1}}', '{{user}}']
  );
});

test('buildCharacterCardRewriteUserPrompt uses selectedGreeting as firstMessage and omits alternates', () => {
  const card = parseSillyTavernCharacterCardJson(JSON.stringify({
    name: 'Kira',
    description: 'A courier.',
    scenario: 'Night City drop point.',
    first_mes: 'You found the package.',
    alternate_greetings: [
      'The package is gone.',
      'Wrong drop point — run.'
    ]
  }));

  const selected = 'The package is gone.';
  const prompt = buildCharacterCardRewriteUserPrompt(card, { selectedGreeting: selected });
  const payload = JSON.parse(prompt.split('Input JSON:\n')[1].split('\n\nOutput only')[0]) as {
    card: { firstMessage: string; alternateGreetings: string[] }
  };

  assert.equal(payload.card.firstMessage, selected);
  assert.deepEqual(payload.card.alternateGreetings, []);
});

test('buildCharacterCardRewriteUserPrompt keeps original firstMessage and alternates when no selectedGreeting', () => {
  const card = parseSillyTavernCharacterCardJson(JSON.stringify({
    name: 'Kira',
    description: 'A courier.',
    first_mes: 'You found the package.',
    alternate_greetings: ['The package is gone.', 'Wrong drop point — run.']
  }));

  const prompt = buildCharacterCardRewriteUserPrompt(card, {});
  const payload = JSON.parse(prompt.split('Input JSON:\n')[1].split('\n\nOutput only')[0]) as {
    card: { firstMessage: string; alternateGreetings: string[] }
  };

  assert.equal(payload.card.firstMessage, 'You found the package.');
  assert.deepEqual(payload.card.alternateGreetings, ['The package is gone.', 'Wrong drop point — run.']);
});

test('rewrite and extract prompts include persona context and placeholder guidance', () => {
  const card = parseSillyTavernCharacterCardJson(JSON.stringify({
    name: 'Lena',
    description: 'A fixer.',
    scenario: '{{char}} and {{user}} in Night City.'
  }));
  const context = {
    personaName: 'Morgan Vale',
    personaPath: 'LoreVault/personas/morgan-vale.md',
    personaMarkdown: 'Morgan is a former Arasaka operative turned freelance broker.'
  };

  const rewritePrompt = buildCharacterCardRewriteUserPrompt(card, context);
  const extractPrompt = buildCharacterCardCharacterExtractUserPrompt(card, context);

  assert.match(rewritePrompt, /"persona": \{/);
  assert.match(rewritePrompt, /"Morgan Vale"/);
  assert.match(rewritePrompt, /"placeholderGuidance": \{/);
  assert.match(rewritePrompt, /"\{\{char\}\}"/);
  assert.match(rewritePrompt, /"\{\{user\}\}"/);

  assert.match(extractPrompt, /"persona": \{/);
  assert.match(extractPrompt, /"placeholderGuidance": \{/);
  assert.match(extractPrompt, /"Morgan Vale"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoryStarterImportPlan,
  buildStoryStarterPreviewStoryMarkdown,
  parseStoryStarterResponse
} from '../src/story-starter';

test('parseStoryStarterResponse accepts fenced JSON and fallback field names', () => {
  const parsed = parseStoryStarterResponse([
    '```json',
    '{',
    '  "storyTitle": "The Glass Orchard",',
    '  "openingTitle": "Arrival at the Orchard",',
    '  "openingMarkdown": "Mira stepped through the frost-lit gate.",',
    '  "authorNote": "## Author Note\\n\\nKeep Mira wary but curious.",',
    '  "notes": ["Uses close third person.", "Opens in motion."]',
    '}',
    '```'
  ].join('\n'));

  assert.equal(parsed.title, 'The Glass Orchard');
  assert.equal(parsed.chapterTitle, 'Arrival at the Orchard');
  assert.equal(parsed.storyMarkdown, 'Mira stepped through the frost-lit gate.');
  assert.equal(parsed.authorNoteMarkdown, '## Author Note\n\nKeep Mira wary but curious.');
  assert.deepEqual(parsed.starterNotes, ['Uses close third person.', 'Opens in motion.']);
});

test('buildStoryStarterImportPlan creates deterministic story and author-note files', () => {
  const plan = buildStoryStarterImportPlan({
    title: 'The Glass Orchard',
    chapterTitle: 'Arrival at the Orchard',
    storyMarkdown: 'Mira stepped through the frost-lit gate.\n\nThe orchard bells answered with a single note.',
    authorNoteMarkdown: '## Author Note\n\n- Close third POV on Mira.\n- Keep the orchard uncanny but not hostile.\n- End the next beat on the first sign that the bells are reacting to her bloodline.',
    starterNotes: ['Anchor the setting to cold light and bells.']
  }, {
    targetFolder: 'LoreVault/stories',
    authorNoteFolder: 'LoreVault/author-notes',
    defaultTagsRaw: 'draft, story',
    lorebookNames: ['universe/glass-orchard', 'universe/glass-orchard'],
    completionPresetId: 'starter-premium'
  });

  assert.equal(plan.storyId, 'the-glass-orchard');
  assert.equal(plan.storyPath, 'LoreVault/stories/the-glass-orchard-ch01-arrival-at-the-orchard.md');
  assert.equal(plan.authorNotePath, 'LoreVault/author-notes/the-glass-orchard-author-note.md');
  assert.equal(plan.pages.length, 2);
  assert.deepEqual(plan.warnings, []);

  const storyPage = plan.pages.find(page => page.path === plan.storyPath);
  const authorNotePage = plan.pages.find(page => page.path === plan.authorNotePath);
  assert.ok(storyPage);
  assert.ok(authorNotePage);
  assert.match(storyPage?.content ?? '', /^---\n/);
  assert.match(storyPage?.content ?? '', /^title: "The Glass Orchard"$/m);
  assert.match(storyPage?.content ?? '', /^authorNote: "\[\[LoreVault\/author-notes\/the-glass-orchard-author-note\]\]"$/m);
  assert.match(storyPage?.content ?? '', /^storyId: "the-glass-orchard"$/m);
  assert.match(storyPage?.content ?? '', /^chapter: 1$/m);
  assert.match(storyPage?.content ?? '', /^chapterTitle: "Arrival at the Orchard"$/m);
  assert.match(storyPage?.content ?? '', /^lorebooks:\n {2}- "universe\/glass-orchard"$/m);
  assert.match(storyPage?.content ?? '', /# Arrival at the Orchard/);

  assert.match(authorNotePage?.content ?? '', /^lvDocType: "authorNote"$/m);
  assert.match(authorNotePage?.content ?? '', /^storyId: "the-glass-orchard"$/m);
  assert.match(authorNotePage?.content ?? '', /^completionProfile: "starter-premium"$/m);
  assert.match(authorNotePage?.content ?? '', /## Author Note/);
});

test('buildStoryStarterImportPlan reports unresolved placeholders in generated output', () => {
  const plan = buildStoryStarterImportPlan({
    title: 'Placeholder Story',
    chapterTitle: 'Chapter 1',
    storyMarkdown: 'The guide greeted {{user}} at the gate.',
    authorNoteMarkdown: 'Keep {{user}} unnamed until chapter two.',
    starterNotes: []
  }, {
    targetFolder: 'LoreVault/stories',
    authorNoteFolder: 'LoreVault/author-notes',
    defaultTagsRaw: '',
    lorebookNames: [],
    completionPresetId: ''
  });

  assert.deepEqual(plan.warnings, [
    'Author note still contains unresolved placeholder: {{user}}',
    'Story note still contains unresolved placeholder: {{user}}'
  ]);
});

test('buildStoryStarterPreviewStoryMarkdown ensures a top-level heading', () => {
  assert.equal(
    buildStoryStarterPreviewStoryMarkdown({
      title: 'The Glass Orchard',
      chapterTitle: 'Arrival at the Orchard',
      storyMarkdown: 'Mira stepped through the frost-lit gate.',
      authorNoteMarkdown: '## Author Note',
      starterNotes: []
    }),
    '# Arrival at the Orchard\n\nMira stepped through the frost-lit gate.'
  );
});

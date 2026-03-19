import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyStorySteeringState,
  mergeStorySteeringStates,
  normalizeStorySteeringState,
  parseStorySteeringExtractionResponse,
  parseStorySteeringMarkdown,
  StorySteeringStore,
  sanitizeStorySteeringExtractionState
} from '../src/story-steering';

test('story author-note markdown parser strips frontmatter deterministically', () => {
  const markdown = [
    '---',
    'lvDocType: authorNote',
    '---',
    '',
    '## Story Notes',
    '',
    'Keep tense in past tense.'
  ].join('\n');

  const parsed = parseStorySteeringMarkdown(markdown);
  assert.deepEqual(parsed, {
    authorNote: '## Story Notes\n\nKeep tense in past tense.'
  });
});

test('story steering merge combines layers deterministically', () => {
  const merged = mergeStorySteeringStates([
    {
      ...createEmptyStorySteeringState(),
      authorNote: '## Story Notes\n\nFocus on tension.'
    },
    {
      ...createEmptyStorySteeringState(),
      authorNote: '## Story Notes\n\nFocus on tension.'
    },
    {
      ...createEmptyStorySteeringState(),
      authorNote: '## Scene Intent\n\nEnd on a hard decision.'
    }
  ]);

  assert.equal(
    merged.authorNote,
    [
      '## Story Notes',
      '',
      'Focus on tension.',
      '',
      '## Scene Intent',
      '',
      'End on a hard decision.'
    ].join('\n')
  );
});

test('story steering extraction parser accepts direct authorNote payload', () => {
  const parsed = parseStorySteeringExtractionResponse(JSON.stringify({
    authorNote: '## Scene Intent\n\nEscalate the conflict.'
  }));
  assert.equal(parsed.authorNote, '## Scene Intent\n\nEscalate the conflict.');
});

test('story steering extraction parser rejects legacy structured payloads', () => {
  assert.throws(() => {
    parseStorySteeringExtractionResponse(JSON.stringify({
      state: {
        storyNotes: 'Focus on aftermath.',
        plotThreads: ['Thread A', 'Thread B']
      }
    }));
  }, /authorNote/i);
});

test('story steering extraction sanitization removes lorebook-like profile facts', () => {
  const sanitized = sanitizeStorySteeringExtractionState({
    authorNote: [
      'Baalthasar is an ancient dark elven archmage.',
      '',
      'Focus on escalating tension and keep dialogue concise.',
      '',
      'Ari now knows the true sigil sequence.'
    ].join('\n')
  });

  assert.equal(sanitized.authorNote, 'Focus on escalating tension and keep dialogue concise.\n\nAri now knows the true sigil sequence.');
});

test('normalizeStorySteeringState trims authorNote text', () => {
  const normalized = normalizeStorySteeringState({
    authorNote: '  keep this tight\n'
  });

  assert.equal(normalized.authorNote, 'keep this tight');
});

test('StorySteeringStore resolves newly linked author notes before metadata cache catches up', async () => {
  const storyFile = {
    path: 'story/ch01.md',
    basename: 'ch01'
  } as any;
  const authorNoteFile = {
    path: 'LoreVault/author-notes/ch01-note.md',
    basename: 'ch01-note'
  } as any;

  const frontmatterByPath = new Map<string, Record<string, unknown>>([
    [storyFile.path, {}],
    [authorNoteFile.path, { lvDocType: 'authorNote' }]
  ]);

  const app = {
    metadataCache: {
      getFileCache(file: { path: string }) {
        return {
          frontmatter: frontmatterByPath.get(file.path) ?? {}
        };
      },
      getFirstLinkpathDest() {
        return null;
      }
    },
    vault: {
      getAbstractFileByPath(path: string) {
        if (path === storyFile.path) {
          return storyFile;
        }
        if (path === authorNoteFile.path) {
          return authorNoteFile;
        }
        return null;
      },
      getMarkdownFiles() {
        return [storyFile, authorNoteFile];
      }
    },
    fileManager: {
      async processFrontMatter(_file: unknown, callback: (frontmatter: Record<string, unknown>) => void) {
        callback({});
      }
    }
  } as any;

  const store = new StorySteeringStore(app, () => 'LoreVault/author-notes');
  await store.linkStoryToAuthorNote(storyFile, authorNoteFile);

  const resolved = await store.resolveAuthorNoteFileForStory(storyFile);
  assert.equal(resolved?.path, authorNoteFile.path);
  assert.equal(store.getAuthorNoteRefForStory(storyFile), 'LoreVault/author-notes/ch01-note');
});

test('StorySteeringStore resolves relative authorNote wikilinks without metadata-cache link resolution', async () => {
  const storyFile = {
    path: 'stories/continuations/ch01.md',
    basename: 'ch01'
  } as any;
  const authorNoteFile = {
    path: 'stories/LoreVault/steering/ch01-author-note.md',
    basename: 'ch01-author-note'
  } as any;

  const frontmatterByPath = new Map<string, Record<string, unknown>>([
    [storyFile.path, {
      authorNote: '[[../LoreVault/steering/ch01-author-note]]'
    }],
    [authorNoteFile.path, { lvDocType: 'authorNote' }]
  ]);

  const app = {
    metadataCache: {
      getFileCache(file: { path: string }) {
        return {
          frontmatter: frontmatterByPath.get(file.path) ?? {}
        };
      },
      getFirstLinkpathDest() {
        return null;
      }
    },
    vault: {
      getAbstractFileByPath(path: string) {
        if (path === storyFile.path) {
          return storyFile;
        }
        if (path === authorNoteFile.path) {
          return authorNoteFile;
        }
        return null;
      },
      getMarkdownFiles() {
        return [storyFile, authorNoteFile];
      }
    },
    fileManager: {
      async processFrontMatter(_file: unknown, callback: (frontmatter: Record<string, unknown>) => void) {
        callback({});
      }
    }
  } as any;

  const store = new StorySteeringStore(app, () => 'LoreVault/author-notes');
  const resolved = await store.resolveAuthorNoteFileForStory(storyFile);

  assert.equal(resolved?.path, authorNoteFile.path);
});

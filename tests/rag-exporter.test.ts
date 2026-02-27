import test from 'node:test';
import assert from 'node:assert/strict';
import { RagExporter } from '../src/rag-exporter';
import { RagDocument } from '../src/models';

function createMockApp() {
  const writes: Array<{ outputPath: string; content: string }> = [];
  const folders = new Set<string>();
  const createdFolders: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (targetPath: string) => {
        if (!folders.has(targetPath)) {
          return null;
        }
        return {
          path: targetPath,
          children: []
        };
      },
      createFolder: async (targetPath: string) => {
        folders.add(targetPath);
        createdFolders.push(targetPath);
      },
      adapter: {
        write: async (outputPath: string, content: string) => {
          writes.push({ outputPath, content });
        }
      }
    }
  };

  return { app, writes, createdFolders };
}

test('RagExporter writes deterministically ordered markdown sections', async () => {
  const { app, writes, createdFolders } = createMockApp();
  const exporter = new RagExporter(app as any);

  const docs: RagDocument[] = [
    {
      uid: 4,
      title: 'B Entry',
      path: 'world/b.md',
      content: 'Body B',
      scope: 'world'
    },
    {
      uid: 2,
      title: 'A Entry',
      path: 'world/a.md',
      content: 'Body A',
      scope: 'world'
    },
    {
      uid: 3,
      title: 'A Entry',
      path: 'world/a.md',
      content: 'Body A2',
      scope: 'world'
    }
  ];

  await exporter.exportRagMarkdown(docs, 'exports/world.rag.md', 'world');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].outputPath, 'exports/world.rag.md');
  assert.deepEqual(createdFolders, ['exports']);

  const content = writes[0].content;
  const firstIndex = content.indexOf('## A Entry');
  const secondIndex = content.indexOf('## A Entry', firstIndex + 1);
  const thirdIndex = content.indexOf('## B Entry');

  assert.ok(firstIndex >= 0);
  assert.ok(secondIndex > firstIndex);
  assert.ok(thirdIndex > secondIndex);
  assert.ok(content.includes('Source: `world/a.md`'));
  assert.ok(content.includes('Source: `world/b.md`'));
});

test('RagExporter falls back to _No content_ for empty note bodies', async () => {
  const { app, writes, createdFolders } = createMockApp();
  const exporter = new RagExporter(app as any);

  await exporter.exportRagMarkdown([
    {
      uid: 1,
      title: 'Empty',
      path: 'empty.md',
      content: '   ',
      scope: ''
    }
  ], 'exports/empty.rag.md', '');

  assert.equal(writes.length, 1);
  assert.deepEqual(createdFolders, ['exports']);
  assert.ok(writes[0].content.includes('Scope: `(all)`'));
  assert.ok(writes[0].content.includes('_No content_'));
});

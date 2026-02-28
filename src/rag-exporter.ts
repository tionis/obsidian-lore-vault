import { App } from 'obsidian';
import { RagDocument } from './models';
import {
  ensureParentVaultFolderForFile,
  normalizeVaultRelativePath
} from './vault-path-utils';

function compareRagDocs(a: RagDocument, b: RagDocument): number {
  return (
    a.path.localeCompare(b.path) ||
    a.title.localeCompare(b.title) ||
    a.uid - b.uid
  );
}

export class RagExporter {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async exportRagMarkdown(
    documents: RagDocument[],
    outputPath: string,
    scopeLabel: string
  ): Promise<void> {
    const normalizedOutputPath = normalizeVaultRelativePath(outputPath);
    const sortedDocuments = [...documents].sort(compareRagDocs);
    const normalizedScopeLabel = scopeLabel || '(all)';

    const sections = sortedDocuments.map((doc) => {
      const body = doc.content.trim() || '_No content_';
      return `## ${doc.title}\n\nSource: \`${doc.path}\`\n\n${body}\n`;
    });

    const markdown = [
      '# LoreVault RAG Pack',
      '',
      `Scope: \`${normalizedScopeLabel}\``,
      '',
      sections.join('\n---\n\n')
    ].join('\n');

    try {
      await ensureParentVaultFolderForFile(this.app, normalizedOutputPath);
      await this.app.vault.adapter.write(normalizedOutputPath, markdown);

      console.log(`Successfully exported ${documents.length} RAG docs to ${normalizedOutputPath}`);
    } catch (e) {
      console.error(`Error writing RAG markdown to ${normalizedOutputPath}:`, e);
      throw e;
    }
  }
}

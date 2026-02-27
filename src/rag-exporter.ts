import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { RagDocument } from './models';

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
    const normalizedOutputPath = outputPath.replace(/\\/g, '/');
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
      const isAbsolutePath = path.isAbsolute(outputPath);

      if (!isAbsolutePath) {
        await this.app.vault.adapter.write(normalizedOutputPath, markdown);
      } else {
        const dirPath = path.dirname(outputPath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(outputPath, markdown, 'utf8');
      }

      console.log(`Successfully exported ${documents.length} RAG docs to ${outputPath}`);
    } catch (e) {
      console.error(`Error writing RAG markdown to ${outputPath}:`, e);
      throw e;
    }
  }
}

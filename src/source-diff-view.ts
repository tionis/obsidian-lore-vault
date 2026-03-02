import { SourceDiffPreview } from './source-diff';

function lineNumberLabel(value: number | null): string {
  return value === null ? '' : String(value);
}

function lineText(value: string): string {
  return value.length > 0 ? value : ' ';
}

export function renderSourceDiffPreview(container: HTMLElement, diff: SourceDiffPreview): void {
  container.empty();
  container.addClass('lorevault-source-diff');

  if (diff.addedLines === 0 && diff.removedLines === 0) {
    container.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: 'No source changes.'
    });
    return;
  }

  if (diff.hunks.length === 0) {
    container.createEl('p', {
      cls: 'lorevault-routing-subtle',
      text: 'Diff unavailable.'
    });
    return;
  }

  for (const hunk of diff.hunks) {
    const hunkEl = container.createDiv({ cls: 'lorevault-source-diff-hunk' });
    for (const row of hunk.rows) {
      if (row.type === 'omitted') {
        hunkEl.createDiv({
          cls: 'lorevault-source-diff-row lorevault-source-diff-row-omitted',
          text: `... ${row.omittedCount ?? 0} unchanged line(s) omitted ...`
        });
        continue;
      }

      const rowEl = hunkEl.createDiv({
        cls: `lorevault-source-diff-row lorevault-source-diff-row-${row.type}`
      });
      rowEl.createSpan({
        cls: 'lorevault-source-diff-line-number',
        text: lineNumberLabel(row.leftLine)
      });
      rowEl.createSpan({
        cls: 'lorevault-source-diff-cell lorevault-source-diff-cell-left',
        text: lineText(row.leftText)
      });
      rowEl.createSpan({
        cls: 'lorevault-source-diff-line-number',
        text: lineNumberLabel(row.rightLine)
      });
      rowEl.createSpan({
        cls: 'lorevault-source-diff-cell lorevault-source-diff-cell-right',
        text: lineText(row.rightText)
      });
    }
  }

  if (diff.truncated) {
    container.createDiv({
      cls: 'lorevault-source-diff-truncated',
      text: 'Diff output truncated for readability.'
    });
  }
}

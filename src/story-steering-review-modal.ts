import { App, Modal, Notice, Setting } from 'obsidian';
import {
  normalizeStorySteeringState,
  StorySteeringState
} from './story-steering';

export interface StorySteeringReviewResult {
  action: 'cancel' | 'apply';
  state: StorySteeringState;
}

function normalizeComparisonValue(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export class StorySteeringReviewModal extends Modal {
  private readonly sourceLabel: string;
  private readonly notePath: string;
  private readonly existingState: StorySteeringState;
  private draftState: StorySteeringState;
  private resolver: (result: StorySteeringReviewResult) => void;
  private resolved = false;

  constructor(
    app: App,
    sourceLabel: string,
    notePath: string,
    proposedState: StorySteeringState,
    existingState: StorySteeringState,
    resolver: (result: StorySteeringReviewResult) => void
  ) {
    super(app);
    this.sourceLabel = sourceLabel;
    this.notePath = notePath;
    this.existingState = normalizeStorySteeringState(existingState);
    this.draftState = normalizeStorySteeringState(proposedState);
    this.resolver = resolver;
  }

  onOpen(): void {
    this.modalEl.addClass('lorevault-summary-modal-shell');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lorevault-summary-modal');
    contentEl.createEl('h2', { text: 'Author Note Update Review' });
    contentEl.createEl('p', {
      text: `Source: ${this.sourceLabel} | Note: ${this.notePath}`
    });

    new Setting(contentEl)
      .setName('Author Note')
      .setDesc('Current value is read-only. Proposed value is editable before apply.');

    const field = contentEl.createDiv({ cls: 'lorevault-steering-review-field' });
    const changeStateEl = field.createEl('p', {
      cls: 'lorevault-steering-review-change'
    });
    const columns = field.createDiv({ cls: 'lorevault-steering-review-columns' });

    const currentColumn = columns.createDiv({ cls: 'lorevault-steering-review-column' });
    currentColumn.createEl('label', { text: 'Current (read-only)' });
    const currentInput = currentColumn.createEl('textarea', {
      cls: 'lorevault-summary-textarea lorevault-summary-textarea-existing lorevault-steering-review-textarea'
    });
    currentInput.value = this.existingState.authorNote;
    currentInput.rows = 18;
    currentInput.readOnly = true;
    currentInput.placeholder = '[Empty]';

    const proposedColumn = columns.createDiv({ cls: 'lorevault-steering-review-column' });
    proposedColumn.createEl('label', { text: 'Proposed (editable)' });
    const proposedInput = proposedColumn.createEl('textarea', {
      cls: 'lorevault-summary-textarea lorevault-steering-review-textarea'
    });
    proposedInput.value = this.draftState.authorNote;
    proposedInput.rows = 18;
    proposedInput.placeholder = '[Empty]';

    const updateChangeState = (): void => {
      const unchanged = normalizeComparisonValue(currentInput.value) === normalizeComparisonValue(proposedInput.value);
      if (unchanged) {
        changeStateEl.removeClass('is-changed');
        changeStateEl.setText('No change from current value.');
      } else {
        changeStateEl.addClass('is-changed');
        changeStateEl.setText('Changed from current value.');
      }
    };

    proposedInput.addEventListener('input', () => {
      this.draftState.authorNote = proposedInput.value.trim();
      updateChangeState();
    });
    updateChangeState();

    const snapshotDetails = contentEl.createEl('details', { cls: 'lorevault-summary-existing' });
    snapshotDetails.createEl('summary', { text: 'Current State Snapshot (JSON)' });
    snapshotDetails.createEl('pre', {
      cls: 'lorevault-help-code',
      text: JSON.stringify(this.existingState, null, 2)
    });

    const actions = contentEl.createDiv({ cls: 'lorevault-summary-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.finish('cancel');
    });
    const applyButton = actions.createEl('button', { text: 'Apply To Panel' });
    applyButton.addClass('mod-cta');
    applyButton.addEventListener('click', () => {
      const normalized = normalizeStorySteeringState(this.draftState);
      if (!normalized.authorNote) {
        new Notice('Extraction produced an empty author note.');
      }
      this.finish('apply');
    });
  }

  private finish(action: 'cancel' | 'apply'): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver({
      action,
      state: normalizeStorySteeringState(this.draftState)
    });
    this.close();
  }

  onClose(): void {
    this.modalEl.removeClass('lorevault-summary-modal-shell');
    if (!this.resolved) {
      this.resolved = true;
      this.resolver({
        action: 'cancel',
        state: normalizeStorySteeringState(this.draftState)
      });
    }
    this.contentEl.empty();
  }
}

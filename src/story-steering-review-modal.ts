import { App, Modal, Notice, Setting } from 'obsidian';
import {
  normalizeStorySteeringState,
  StorySteeringState
} from './story-steering';

export interface StorySteeringReviewResult {
  action: 'cancel' | 'apply';
  state: StorySteeringState;
}

interface ComparisonFieldOptions {
  name: string;
  description: string;
  currentValue: string;
  proposedValue: string;
  rows: number;
  onChange: (value: string) => void;
}

function formatList(values: string[]): string {
  return values.join('\n');
}

function parseList(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
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
    contentEl.createEl('h2', { text: 'Story Steering Update Review' });
    contentEl.createEl('p', {
      text: `Source: ${this.sourceLabel} | Note: ${this.notePath}`
    });

    contentEl.createEl('p', {
      cls: 'lorevault-help-note',
      text: 'Review each field below. Current values are read-only; proposed values are editable before apply.'
    });

    this.renderComparisonField(contentEl, {
      name: 'Pinned Instructions',
      description: 'Stable constraints for this steering scope.',
      currentValue: this.existingState.pinnedInstructions,
      proposedValue: this.draftState.pinnedInstructions,
      rows: 4,
      onChange: value => {
        this.draftState.pinnedInstructions = value.trim();
      }
    });

    this.renderComparisonField(contentEl, {
      name: 'Story Notes',
      description: 'Author-note style guidance.',
      currentValue: this.existingState.storyNotes,
      proposedValue: this.draftState.storyNotes,
      rows: 4,
      onChange: value => {
        this.draftState.storyNotes = value.trim();
      }
    });

    this.renderComparisonField(contentEl, {
      name: 'Scene Intent',
      description: 'Immediate scene/chapter objective.',
      currentValue: this.existingState.sceneIntent,
      proposedValue: this.draftState.sceneIntent,
      rows: 3,
      onChange: value => {
        this.draftState.sceneIntent = value.trim();
      }
    });

    this.renderComparisonField(contentEl, {
      name: 'Active Lorebooks',
      description: 'One lorebook scope per line (for example universe/yggdrasil).',
      currentValue: formatList(this.existingState.activeLorebooks),
      proposedValue: formatList(this.draftState.activeLorebooks),
      rows: 4,
      onChange: value => {
        this.draftState.activeLorebooks = parseList(value);
      }
    });

    this.renderComparisonField(contentEl, {
      name: 'Active Plot Threads',
      description: 'One item per line.',
      currentValue: formatList(this.existingState.plotThreads),
      proposedValue: formatList(this.draftState.plotThreads),
      rows: 4,
      onChange: value => {
        this.draftState.plotThreads = parseList(value);
      }
    });

    this.renderComparisonField(contentEl, {
      name: 'Open Loops',
      description: 'One unresolved loop per line.',
      currentValue: formatList(this.existingState.openLoops),
      proposedValue: formatList(this.draftState.openLoops),
      rows: 4,
      onChange: value => {
        this.draftState.openLoops = parseList(value);
      }
    });

    this.renderComparisonField(contentEl, {
      name: 'Canon Deltas',
      description: 'One recent fact change per line.',
      currentValue: formatList(this.existingState.canonDeltas),
      proposedValue: formatList(this.draftState.canonDeltas),
      rows: 4,
      onChange: value => {
        this.draftState.canonDeltas = parseList(value);
      }
    });

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
      if (
        !normalized.pinnedInstructions &&
        !normalized.storyNotes &&
        !normalized.sceneIntent &&
        normalized.activeLorebooks.length === 0 &&
        normalized.plotThreads.length === 0 &&
        normalized.openLoops.length === 0 &&
        normalized.canonDeltas.length === 0
      ) {
        new Notice('Extraction produced an empty steering state.');
      }
      this.finish('apply');
    });
  }

  private renderComparisonField(container: HTMLElement, options: ComparisonFieldOptions): void {
    new Setting(container)
      .setName(options.name)
      .setDesc(options.description);

    const field = container.createDiv({ cls: 'lorevault-steering-review-field' });
    const changeStateEl = field.createEl('p', {
      cls: 'lorevault-steering-review-change'
    });
    const columns = field.createDiv({ cls: 'lorevault-steering-review-columns' });

    const currentColumn = columns.createDiv({ cls: 'lorevault-steering-review-column' });
    currentColumn.createEl('label', { text: 'Current (read-only)' });
    const currentInput = currentColumn.createEl('textarea', {
      cls: 'lorevault-summary-textarea lorevault-summary-textarea-existing lorevault-steering-review-textarea'
    });
    currentInput.value = options.currentValue;
    currentInput.rows = options.rows;
    currentInput.readOnly = true;
    currentInput.placeholder = '[Empty]';

    const proposedColumn = columns.createDiv({ cls: 'lorevault-steering-review-column' });
    proposedColumn.createEl('label', { text: 'Proposed (editable)' });
    const proposedInput = proposedColumn.createEl('textarea', {
      cls: 'lorevault-summary-textarea lorevault-steering-review-textarea'
    });
    proposedInput.value = options.proposedValue;
    proposedInput.rows = options.rows;
    proposedInput.placeholder = '[Empty]';
    proposedInput.addEventListener('input', () => {
      options.onChange(proposedInput.value);
      updateChangeState();
    });

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
    updateChangeState();
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

import { App, Modal, Notice, Setting } from 'obsidian';
import {
  normalizeStorySteeringState,
  StorySteeringState
} from './story-steering';

export interface StorySteeringReviewResult {
  action: 'cancel' | 'apply';
  state: StorySteeringState;
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
    contentEl.createEl('h2', { text: 'Story Steering Extraction Review' });
    contentEl.createEl('p', {
      text: `Source: ${this.sourceLabel} | Note: ${this.notePath}`
    });

    const current = contentEl.createDiv({ cls: 'lorevault-summary-existing' });
    current.createEl('h3', { text: 'Current Steering State' });
    current.createEl('pre', {
      cls: 'lorevault-help-code',
      text: JSON.stringify(this.existingState, null, 2)
    });

    new Setting(contentEl)
      .setName('Pinned Instructions')
      .setDesc('Stable constraints for this steering scope.');
    const pinnedInput = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    pinnedInput.value = this.draftState.pinnedInstructions;
    pinnedInput.rows = 4;
    pinnedInput.addEventListener('input', () => {
      this.draftState.pinnedInstructions = pinnedInput.value.trim();
    });

    new Setting(contentEl)
      .setName('Story Notes')
      .setDesc('Author-note style guidance.');
    const notesInput = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    notesInput.value = this.draftState.storyNotes;
    notesInput.rows = 4;
    notesInput.addEventListener('input', () => {
      this.draftState.storyNotes = notesInput.value.trim();
    });

    new Setting(contentEl)
      .setName('Scene Intent')
      .setDesc('Immediate scene/chapter objective.');
    const intentInput = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    intentInput.value = this.draftState.sceneIntent;
    intentInput.rows = 3;
    intentInput.addEventListener('input', () => {
      this.draftState.sceneIntent = intentInput.value.trim();
    });

    new Setting(contentEl)
      .setName('Active Plot Threads')
      .setDesc('One item per line.');
    const threadsInput = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    threadsInput.value = formatList(this.draftState.plotThreads);
    threadsInput.rows = 4;
    threadsInput.addEventListener('input', () => {
      this.draftState.plotThreads = parseList(threadsInput.value);
    });

    new Setting(contentEl)
      .setName('Open Loops')
      .setDesc('One unresolved loop per line.');
    const loopsInput = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    loopsInput.value = formatList(this.draftState.openLoops);
    loopsInput.rows = 4;
    loopsInput.addEventListener('input', () => {
      this.draftState.openLoops = parseList(loopsInput.value);
    });

    new Setting(contentEl)
      .setName('Canon Deltas')
      .setDesc('One recent fact change per line.');
    const deltasInput = contentEl.createEl('textarea', { cls: 'lorevault-summary-textarea' });
    deltasInput.value = formatList(this.draftState.canonDeltas);
    deltasInput.rows = 4;
    deltasInput.addEventListener('input', () => {
      this.draftState.canonDeltas = parseList(deltasInput.value);
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
        normalized.plotThreads.length === 0 &&
        normalized.openLoops.length === 0 &&
        normalized.canonDeltas.length === 0
      ) {
        new Notice('Extraction produced an empty steering state.');
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

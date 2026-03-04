import {
  App,
  BasesEntry,
  BasesView,
  BasesViewRegistration,
  Component,
  MarkdownRenderer,
  Modal,
  QueryController,
  TFile,
  setIcon
} from 'obsidian';
import {
  asString,
  asStringArray,
  FrontmatterData,
  getFrontmatterValue,
  normalizeFrontmatter
} from './frontmatter-utils';
import { normalizeVaultPath } from './vault-path-utils';

export const LOREVAULT_CHARACTER_BASES_VIEW_ID = 'lorevault-character-bases-view';

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif'
]);

interface CharacterCardRenderData {
  title: string;
  creator: string;
  tags: string[];
  summary: string;
  summaryThemes: string[];
  summaryTone: string[];
  summaryScenarioFocus: string;
  summaryHook: string;
  summaryStale: boolean;
  personality: string;
  description: string;
  scenario: string;
  sourceCardPath: string;
  avatarSource: string;
}

interface CharacterCardPropertyVisibility {
  showCreator: boolean;
  showTags: boolean;
  showSummary: boolean;
  showPersonality: boolean;
  showDescription: boolean;
  showScenario: boolean;
  showPath: boolean;
}

class CharacterAvatarPreviewModal extends Modal {
  private readonly titleText: string;
  private readonly imageSrc: string;

  constructor(app: App, titleText: string, imageSrc: string) {
    super(app);
    this.titleText = titleText;
    this.imageSrc = imageSrc;
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    const body = this.contentEl.createDiv({ cls: 'lorevault-bases-avatar-preview-body' });
    body.createEl('img', {
      cls: 'lorevault-bases-avatar-preview-image',
      attr: {
        src: this.imageSrc,
        alt: this.titleText
      }
    });
  }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalizedString = typeof value === 'string'
    ? value.trim().toLowerCase()
    : value !== null && value !== undefined
      ? String(value).trim().toLowerCase()
      : '';
  if (normalizedString) {
    if (['true', '1', 'yes', 'y', 'on'].includes(normalizedString)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalizedString)) {
      return false;
    }
  }
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function isImagePath(path: string): boolean {
  const normalized = normalizeVaultPath(path).toLowerCase();
  const queryIndex = normalized.indexOf('?');
  const sanitized = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized;
  const hashIndex = sanitized.indexOf('#');
  const noHash = hashIndex >= 0 ? sanitized.slice(0, hashIndex) : sanitized;
  const lastDot = noHash.lastIndexOf('.');
  if (lastDot < 0) {
    return false;
  }
  return IMAGE_EXTENSIONS.has(noHash.slice(lastDot + 1));
}

function normalizeLinkLikeValue(raw: string): string {
  let normalized = raw.trim();
  if (!normalized) {
    return '';
  }

  const wikiEmbedMatch = normalized.match(/^!\[\[([\s\S]+)\]\]$/);
  if (wikiEmbedMatch) {
    normalized = wikiEmbedMatch[1].trim();
  }

  const wikiMatch = normalized.match(/^\[\[([\s\S]+)\]\]$/);
  if (wikiMatch) {
    normalized = wikiMatch[1].trim();
  }

  const markdownLinkMatch = normalized.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
  if (markdownLinkMatch) {
    normalized = markdownLinkMatch[1].trim();
  }

  const angleBracketMatch = normalized.match(/^<([\s\S]+)>$/);
  if (angleBracketMatch) {
    normalized = angleBracketMatch[1].trim();
  }

  const pipeIndex = normalized.indexOf('|');
  if (pipeIndex >= 0) {
    normalized = normalized.slice(0, pipeIndex).trim();
  }

  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) {
    normalized = normalized.slice(0, hashIndex).trim();
  }

  return normalized;
}

function isExternalImageSource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('data:image/');
}

export class LorevaultCharacterBasesView extends BasesView {
  type = LOREVAULT_CHARACTER_BASES_VIEW_ID;

  private readonly rootEl: HTMLElement;
  private markdownRenderComponent: Component | null = null;
  private renderEpoch = 0;

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.rootEl = containerEl.createDiv({ cls: 'lorevault-bases-character-view' });
  }

  onDataUpdated(): void {
    void this.renderView();
  }

  onunload(): void {
    this.markdownRenderComponent?.unload();
    this.markdownRenderComponent = null;
    super.onunload();
  }

  private resetMarkdownRenderComponent(): Component {
    this.markdownRenderComponent?.unload();
    const component = new Component();
    this.addChild(component);
    this.markdownRenderComponent = component;
    return component;
  }

  private readFrontmatter(file: TFile): FrontmatterData {
    const cache = this.app.metadataCache.getFileCache(file);
    return normalizeFrontmatter((cache?.frontmatter ?? {}) as FrontmatterData);
  }

  private readCharacterCardRenderData(entry: BasesEntry): CharacterCardRenderData {
    const file = entry.file;
    const frontmatter = this.readFrontmatter(file);
    const title = asString(getFrontmatterValue(frontmatter, 'characterName', 'characterCardName', 'title')) ?? file.basename;
    const creator = asString(getFrontmatterValue(frontmatter, 'creator', 'characterCardCreator')) ?? '';
    const tags = asStringArray(getFrontmatterValue(frontmatter, 'cardTags', 'characterCardTags'));
    const summary = asString(getFrontmatterValue(frontmatter, 'cardSummary')) ?? '';
    const summaryThemes = asStringArray(getFrontmatterValue(frontmatter, 'cardSummaryThemes'));
    const summaryTone = asStringArray(getFrontmatterValue(frontmatter, 'cardSummaryTone'));
    const summaryScenarioFocus = asString(getFrontmatterValue(frontmatter, 'cardSummaryScenarioFocus')) ?? '';
    const summaryHook = asString(getFrontmatterValue(frontmatter, 'cardSummaryHook')) ?? '';
    const summaryStale = Boolean(getFrontmatterValue(frontmatter, 'cardSummaryStale'));
    const personality = asString(getFrontmatterValue(frontmatter, 'cardPersonality', 'personality')) ?? '';
    const description = asString(getFrontmatterValue(frontmatter, 'cardDescription', 'description')) ?? '';
    const scenario = asString(getFrontmatterValue(frontmatter, 'cardScenario', 'scenario')) ?? '';
    const sourceCardPath = asString(getFrontmatterValue(frontmatter, 'cardPath', 'characterCardPath')) ?? '';
    const avatarSource = asString(getFrontmatterValue(frontmatter, 'avatar', 'characterCardAvatar', 'cardFile')) ?? '';
    return {
      title,
      creator,
      tags,
      summary,
      summaryThemes,
      summaryTone,
      summaryScenarioFocus,
      summaryHook,
      summaryStale,
      personality,
      description,
      scenario,
      sourceCardPath,
      avatarSource
    };
  }

  private resolveImageSource(rawSource: string, sourceFile: TFile): string {
    const normalized = normalizeLinkLikeValue(rawSource);
    if (!normalized) {
      return '';
    }

    if (isExternalImageSource(normalized)) {
      return normalized;
    }

    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(normalized, sourceFile.path);
    if (linkedFile instanceof TFile && isImagePath(linkedFile.path)) {
      return this.app.vault.getResourcePath(linkedFile);
    }

    const fallback = this.app.vault.getAbstractFileByPath(normalizeVaultPath(normalized));
    if (fallback instanceof TFile && isImagePath(fallback.path)) {
      return this.app.vault.getResourcePath(fallback);
    }

    return '';
  }

  private async renderMarkdownField(
    markdownParent: Component,
    parentEl: HTMLElement,
    title: string,
    value: string,
    sourcePath: string
  ): Promise<void> {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const fieldEl = parentEl.createDiv({ cls: 'lorevault-bases-character-field' });
    fieldEl.createEl('h5', { text: title });
    const bodyEl = fieldEl.createDiv({ cls: 'lorevault-bases-character-field-body markdown-rendered' });
    await MarkdownRenderer.render(this.app, normalized, bodyEl, sourcePath, markdownParent);
  }

  private renderTagList(parentEl: HTMLElement, tags: string[]): void {
    if (tags.length === 0) {
      return;
    }

    const tagsEl = parentEl.createDiv({ cls: 'lorevault-bases-character-tags' });
    for (const tag of tags) {
      tagsEl.createSpan({ cls: 'lorevault-bases-character-tag', text: tag });
    }
  }

  private renderSummaryMetaLine(parentEl: HTMLElement, label: string, value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    const line = parentEl.createDiv({ cls: 'lorevault-bases-character-summary-line' });
    line.createSpan({ cls: 'lorevault-bases-character-summary-line-label', text: `${label}:` });
    line.createSpan({ cls: 'lorevault-bases-character-summary-line-value', text: normalized });
  }

  private renderSummaryChips(parentEl: HTMLElement, title: string, values: string[], modifierClass: string): void {
    if (values.length === 0) {
      return;
    }
    const wrap = parentEl.createDiv({ cls: `lorevault-bases-character-summary-chip-wrap ${modifierClass}` });
    wrap.createEl('h6', { text: title });
    const chips = wrap.createDiv({ cls: 'lorevault-bases-character-summary-chips' });
    for (const value of values) {
      chips.createSpan({ cls: 'lorevault-bases-character-summary-chip', text: value });
    }
  }

  private renderSummaryBlock(
    markdownParent: Component,
    parentEl: HTMLElement,
    sourcePath: string,
    data: CharacterCardRenderData
  ): void {
    if (!data.summary.trim()) {
      return;
    }

    const block = parentEl.createDiv({ cls: 'lorevault-bases-character-summary-block' });
    const titleRow = block.createDiv({ cls: 'lorevault-bases-character-summary-title-row' });
    titleRow.createEl('h5', { text: 'Summary' });
    if (data.summaryStale) {
      titleRow.createSpan({ cls: 'lorevault-bases-character-summary-stale', text: 'stale' });
    }
    const body = block.createDiv({ cls: 'lorevault-bases-character-summary-body markdown-rendered' });
    void MarkdownRenderer.render(this.app, data.summary, body, sourcePath, markdownParent);

    this.renderSummaryMetaLine(block, 'Scenario Focus', data.summaryScenarioFocus);
    this.renderSummaryMetaLine(block, 'Hook', data.summaryHook);
    this.renderSummaryChips(block, 'Themes', data.summaryThemes, 'lorevault-bases-character-summary-chip-wrap-themes');
    this.renderSummaryChips(block, 'Tone', data.summaryTone, 'lorevault-bases-character-summary-chip-wrap-tone');
  }

  private renderCardActions(parentEl: HTMLElement, entry: BasesEntry, sourceCardPath: string): void {
    const actionsEl = parentEl.createDiv({ cls: 'lorevault-bases-character-actions' });

    const openNoteButton = actionsEl.createEl('button', { text: 'Open Note' });
    const openNoteIcon = openNoteButton.createSpan({ cls: 'lorevault-bases-character-action-icon' });
    setIcon(openNoteIcon, 'file-text');
    openNoteButton.addEventListener('click', () => {
      void this.app.workspace.openLinkText(entry.file.path, entry.file.path, true);
    });

    if (sourceCardPath) {
      const openSourceButton = actionsEl.createEl('button', { text: 'Open Source Card' });
      const openSourceIcon = openSourceButton.createSpan({ cls: 'lorevault-bases-character-action-icon' });
      setIcon(openSourceIcon, 'image-file');
      openSourceButton.addEventListener('click', () => {
        void this.app.workspace.openLinkText(sourceCardPath, entry.file.path, true);
      });
    }
  }

  private createPropertyVisibility(
    showSummaryOption: boolean,
    showDescriptionOption: boolean,
    showScenarioOption: boolean,
    showMetadataOption: boolean
  ): CharacterCardPropertyVisibility {
    const orderedProperties = this.config.getOrder()
      .map(propertyId => String(propertyId).trim().toLowerCase())
      .filter(Boolean);
    const hasPropertyFilter = orderedProperties.length > 0;
    const orderedPropertySet = new Set(orderedProperties);

    const hasVisibleProperty = (...propertyIds: string[]): boolean => {
      if (!hasPropertyFilter) {
        return true;
      }
      return propertyIds.some(propertyId => orderedPropertySet.has(propertyId.toLowerCase()));
    };

    return {
      showCreator: hasVisibleProperty('note.creator', 'note.charactercardcreator'),
      showTags: hasVisibleProperty('note.cardtags', 'note.charactercardtags'),
      showSummary: showSummaryOption && hasVisibleProperty(
        'note.cardsummary',
        'note.cardsummarythemes',
        'note.cardsummarytone',
        'note.cardsummaryscenariofocus',
        'note.cardsummaryhook'
      ),
      showPersonality: hasVisibleProperty('note.cardpersonality', 'note.personality'),
      showDescription: showDescriptionOption && hasVisibleProperty('note.carddescription', 'note.description'),
      showScenario: showScenarioOption && hasVisibleProperty('note.cardscenario', 'note.scenario'),
      showPath: showMetadataOption && hasVisibleProperty('file.path')
    };
  }

  private openAvatarPreview(title: string, imageSrc: string): void {
    if (!imageSrc) {
      return;
    }
    const modal = new CharacterAvatarPreviewModal(this.app, `${title} Avatar`, imageSrc);
    modal.open();
  }

  private async renderEntryCard(
    markdownParent: Component,
    cardsEl: HTMLElement,
    entry: BasesEntry,
    visibility: CharacterCardPropertyVisibility,
    largeAvatars: boolean
  ): Promise<void> {
    const cardData = this.readCharacterCardRenderData(entry);
    const cardEl = cardsEl.createDiv({ cls: 'lorevault-bases-character-card' });
    if (largeAvatars) {
      cardEl.addClass('lorevault-bases-character-card-large-avatar');
    }

    const headerEl = cardEl.createDiv({ cls: 'lorevault-bases-character-header' });
    const avatarSrc = this.resolveImageSource(cardData.avatarSource, entry.file);
    if (avatarSrc) {
      const avatarButton = headerEl.createEl('button', {
        cls: 'lorevault-bases-character-avatar-wrap lorevault-bases-character-avatar-button',
        attr: {
          type: 'button',
          'aria-label': `Preview ${cardData.title} avatar`
        }
      });
      avatarButton.createEl('img', {
        cls: 'lorevault-bases-character-avatar',
        attr: {
          src: avatarSrc,
          alt: `${cardData.title} avatar`,
          loading: 'lazy'
        }
      });
      avatarButton.addEventListener('click', () => this.openAvatarPreview(cardData.title, avatarSrc));
    }

    const titleWrap = headerEl.createDiv({ cls: 'lorevault-bases-character-title-wrap' });
    titleWrap.createEl('h4', { text: cardData.title });
    if (visibility.showCreator && cardData.creator) {
      titleWrap.createEl('p', {
        cls: 'lorevault-bases-character-creator',
        text: `Creator: ${cardData.creator}`
      });
    }
    if (visibility.showPath) {
      titleWrap.createEl('p', {
        cls: 'lorevault-bases-character-path',
        text: entry.file.path
      });
    }

    if (visibility.showTags) {
      this.renderTagList(cardEl, cardData.tags);
    }
    if (visibility.showSummary) {
      this.renderSummaryBlock(markdownParent, cardEl, entry.file.path, cardData);
    }
    if (visibility.showPersonality) {
      await this.renderMarkdownField(markdownParent, cardEl, 'Personality', cardData.personality, entry.file.path);
    }
    if (visibility.showDescription) {
      await this.renderMarkdownField(markdownParent, cardEl, 'Description', cardData.description, entry.file.path);
    }
    if (visibility.showScenario) {
      await this.renderMarkdownField(markdownParent, cardEl, 'Scenario', cardData.scenario, entry.file.path);
    }

    this.renderCardActions(cardEl, entry, cardData.sourceCardPath);
  }

  private async renderView(): Promise<void> {
    const renderEpoch = ++this.renderEpoch;
    const markdownParent = this.resetMarkdownRenderComponent();
    this.rootEl.empty();

    const showDescription = normalizeBoolean(this.config.get('showDescription'), true);
    const showScenario = normalizeBoolean(this.config.get('showScenario'), false);
    const showMetadata = normalizeBoolean(this.config.get('showMetadata'), true);
    const showSummary = normalizeBoolean(this.config.get('showSummary'), true);
    const largeAvatars = normalizeBoolean(this.config.get('largeAvatars'), true);
    const maxCards = normalizeNumber(this.config.get('maxCards'), 300, 20, 5000);
    const visibility = this.createPropertyVisibility(showSummary, showDescription, showScenario, showMetadata);

    const groups = this.data?.groupedData ?? [];
    const allEntries = this.data?.data ?? [];
    if (allEntries.length === 0) {
      const emptyEl = this.rootEl.createDiv({ cls: 'lorevault-bases-character-empty' });
      emptyEl.setText('No entries matched the current Base query.');
      return;
    }

    const summaryEl = this.rootEl.createDiv({ cls: 'lorevault-bases-character-summary' });
    summaryEl.setText(`Rendering ${Math.min(allEntries.length, maxCards)} of ${allEntries.length} entries.`);

    let rendered = 0;
    for (const group of groups) {
      if (rendered >= maxCards) {
        break;
      }
      if (renderEpoch !== this.renderEpoch) {
        return;
      }
      const sectionEl = this.rootEl.createDiv({ cls: 'lorevault-bases-character-group' });
      if (groups.length > 1) {
        const key = group.hasKey() ? group.key?.toString() ?? '(empty)' : '(empty)';
        sectionEl.createEl('h3', {
          cls: 'lorevault-bases-character-group-title',
          text: key
        });
      }

      const cardsEl = sectionEl.createDiv({ cls: 'lorevault-bases-character-grid' });
      for (const entry of group.entries) {
        if (rendered >= maxCards) {
          break;
        }
        if (renderEpoch !== this.renderEpoch) {
          return;
        }
        await this.renderEntryCard(
          markdownParent,
          cardsEl,
          entry,
          visibility,
          largeAvatars
        );
        rendered += 1;
      }
    }
  }
}

export function createLorevaultCharacterBasesViewRegistration(): BasesViewRegistration {
  return {
    name: 'LoreVault Characters',
    icon: 'users',
    factory: (controller, containerEl) => new LorevaultCharacterBasesView(controller, containerEl),
    options: () => [
      {
        key: 'maxCards',
        type: 'slider',
        displayName: 'Max Cards',
        min: 20,
        max: 5000,
        step: 20,
        default: 300
      },
      {
        key: 'largeAvatars',
        type: 'toggle',
        displayName: 'Large Avatars',
        default: true
      },
      {
        key: 'showSummary',
        type: 'toggle',
        displayName: 'Show Summary',
        default: true
      },
      {
        key: 'showDescription',
        type: 'toggle',
        displayName: 'Show Description',
        default: true
      },
      {
        key: 'showScenario',
        type: 'toggle',
        displayName: 'Show Scenario',
        default: false
      },
      {
        key: 'showMetadata',
        type: 'toggle',
        displayName: 'Show File Metadata',
        default: true
      }
    ]
  };
}

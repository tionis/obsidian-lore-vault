# LoreVault

LoreVault is an Obsidian plugin for deterministic writing context assembly.

It turns tagged notes into lorebooks, exports canonical packs, and provides writing/chat workflows that inject the right context while keeping the selection inspectable.

## Compatibility

- Plugin id: `lore-vault`
- Minimum Obsidian version: `1.11.4`
- Desktop and mobile supported (`isDesktopOnly: false`)

## What LoreVault Does

- Builds lorebooks from hierarchical tags (`#lorebook/...` by default).
- Exports one canonical SQLite pack per lorebook.
- Exports downstream lorebook files (`world_info` JSON and `rag` markdown projection).
- Runs graph-first retrieval for story continuation and chat.
- Supports optional embedding-assisted fallback retrieval.
- Provides a unified Story Writing panel for continuation, author-note workflow, chapter actions, and live generation/cost telemetry.
- Provides a Story Starter panel that turns an idea into a first chapter note plus linked author note.
- Provides a Story Chat panel with per-conversation context controls.
- Provides a Lore Delta panel for idea-driven lorebook maintenance across multiple notes, with section-aware merges and focused-note rewrites.
- Registers a custom Bases view (`LoreVault Characters`) for character-card libraries with avatar cards and markdown-rendered character fields.
- Includes selection rewrite text commands with built-in templates such as `Canon Consistency Pass`, `Scene Consistency Pass`, and `Remove LLMisms`, with pending-review recovery when the result arrives after you have moved elsewhere.
- Adds `Fork Active Lorebook` to clone a lorebook into a new lorebook/folder while rewriting internal links.
- Story extraction/update keeps one best summary candidate per page (instead of concatenating multiple summary strings).
- World-info summary output capping is optional (`Summary Max Output Chars`; default `0` means no hard truncation).
- Keeps retrieval/debug behavior deterministic and inspectable.

## Quick Start

1. Add lorebook tags to relevant notes (for example `#lorebook/universe/yggdrasil`).
2. Add frontmatter metadata (`keywords`, `summary`, aliases) to improve retrieval quality.
3. Open `LoreVault Manager` and run `Build/Export` for your target lorebook.
4. Open `Story Writing Panel`.
5. Link an author note from your story note (`authorNote: [[...]]`) using `Open/Create Author Note` or `Link Author Note`.
6. Use `Continue Story` to generate at the cursor.

## Core Note Model

| Concept | Where it lives | Purpose |
| --- | --- | --- |
| Lorebook membership | Tags (`#lorebook/...`) | Determines lorebook inclusion |
| Story-to-author-note link | Story frontmatter `authorNote` | Anchors writing instructions |
| Author-note completion profile | Author note frontmatter `completionProfile` | Optional per-story model profile override |
| Story lorebook selection | Story frontmatter `lorebooks` | Selects lorebooks for continuation/chat |
| Chapter ordering | `chapter`, `previousChapter`, `nextChapter` | Determines chapter threading/memory |
| Inline directives | Story body (`<!-- LV: ... -->` or `[LV: ...]`) | Turn-level guidance kept next to the related text |
| Ignored LLM callouts | Story/author-note callouts (`> [!lv-ignore]`, `> [!note]`, `> [!lv-thinking]`) | Note-local text stripped from prompts by default |

## Frontmatter Examples

### Lore entry note

```yaml
---
tags: [lorebook/universe/yggdrasil]
title: "Aurelia"
aliases: ["The Radiant Sphere"]
keywords: [aurelia, radiant sphere]
summary: "Compact retrieval summary."
retrieval: auto
---
```

### Story chapter note

```yaml
---
authorNote: [[LoreVault/author-notes/chronicles-main-author-note]]
lorebooks: [universe/yggdrasil]
chapter: 7
chapterTitle: "Crossing the Spine"
previousChapter: [[story/ch06-the-fallout]]
nextChapter: [[story/ch08-the-reckoning]]
---
```

### Author note (optional explicit typing)

```yaml
---
lvDocType: authorNote
lorebooks: [universe/yggdrasil]
completionProfile: preset-openrouter-main
---
```

## Story Writing Workflow

Command: `Open Story Writing Panel`

The panel groups writing actions into three rows:

- `Continue Story` (switches to `Stop` while generating), `Insert Directive`
- `Open/Create Author Note`, `Link Author Note`, `Rewrite Author Note`
- `Generate Chapter Summary`, `Create Next Chapter`, `Fork Story`

The panel also shows:

- active note + linked author note state
- linked stories when an author note is active
- active completion model
- the editor right-click menu exposes `Insert Inline Directive` on non-author-note notes, even before an author note is linked
- device profile selected from dropdown applies immediately (disabled with `Overridden by Author Note` when author-note override is active)
- if a generation ends in error, the active-note card keeps the error state but the action row returns to `Continue Story` and the device profile selector unlocks
- provider/request options edited for the selected completion preset, including thinking/reasoning, persist with that preset when switching profiles
- if reasoning is enabled and `Exclude Reasoning from Response` is off, `Continue Story` stores returned thinking in a collapsed `lv-thinking` callout before the generated continuation
- Story Writing uses `authorNote completionProfile -> Story Writing device preset -> base settings`; Story Chat profile selection does not affect `Continue Story`
- command `Set Author Note Completion Profile` updates author-note frontmatter `completionProfile` override
- generation status and token usage
- selected context items (`world_info` + fallback)
- selected lorebooks from linked Author Note (interactive add + per-item remove)
- device-local cost profile label configured in settings (usage metadata tagging; auto-derived from API key hash when empty)
- budget settings are configured per cost profile in settings (daily/session + operation/model/lorebook maps)
- collapsible cost breakdown (session/day/week/month/project) in the same panel section as the profile selector
- rewrite/edit review modals use side-by-side source diffs (with omitted-line markers for large unchanged ranges)

## Story Starter Workflow

Command: `Open Story Starter`

The panel is for going from premise to usable story assets in one pass:

- set target story folder, optional default tags, completion profile, and optional lorebooks
- provide a story idea plus optional brainstorm/chat notes
- preview two editable planned writes:
  - first chapter/introduction note
  - linked author note
- selected lorebooks are used both for retrieval during generation and for `lorebooks` frontmatter on the generated notes
- `Create Notes` writes or updates the story note in the selected target folder and the author note in the configured Author Note Folder

## Story Chat Workflow

Command: `Open Story Chat`

Per-conversation context controls are ordered as:

1. Lorebooks
2. Author Notes
3. Chapters and Raw Notes
4. Manual Context

Additional behavior:

- `Open Conversation` picker + `New Chat`
- device-level `Chat Completion Profile` selector in Story Chat (independent from Story Writing panel profile selection; shared across conversations)
- markdown-rendered messages
- edit/fork/regenerate message actions
- assistant message metadata shows the profile/model used for that response
- chat sessions are saved as readable markdown notes with frontmatter + `## User` / `## Model` transcript sections
- full turn context metadata is stored in collapsed `Context Meta` callouts with fenced `yaml` blocks
- optional bounded tool-calling (search/read lorebooks and selected notes, read/update linked author note)
- per-response context inspector and layer/token diagnostics

## Character Library Bases View

LoreVault registers a custom Bases view type named `LoreVault Characters` (Obsidian Bases view switcher).

Use it with your character-card meta notes (`lvDocType: characterCard`) to get:

- avatar image cards
- click avatar to open a larger preview modal
- markdown/HTML rendering for long text fields such as personality/description/scenario
- quick actions to open the meta note or source card
- card section visibility also respects Bases property visibility/order configuration
- view options for max cards, avatar size, and visible sections

## Continuation Behavior (High Level)

`Continue Story with Context`:

1. Reads near-cursor story text.
2. Resolves story lorebooks from story frontmatter (`lorebooks`, aliases) or linked author note frontmatter fallback.
3. Resolves linked author note content.
4. Converts strict inline directives (`[LV: ...]`, `<!-- LV: ... -->`) into in-place `<inline_story_directive>` tags for prompt context.
5. Builds layered context (chapter memory, graph-selected `world_info`, optional fallback entries).
6. Streams continuation text into the editor at the cursor.

Notes:

- Inline directives remain in-place near their source text in prompt staging.
- Configured ignored callout types are stripped from staged prompt blocks before sending note text to the LLM. Default types: `lv-thinking`, `lv-ignore`, `note`.
- Non-`LV:` HTML comments are stripped from staged prompt blocks before sending context to the LLM.
- If reasoning is enabled and not excluded, returned thinking is inserted into the note as a collapsed `> [!lv-thinking]- Thinking` callout immediately before the streamed continuation.
- Chapter memory scales aggressively with available budget on large-context models and can include deeper prior-chapter coverage plus recent style excerpts (in addition to chapter summaries) when budget allows.
- Optional semantic chapter recall can inject a `Related Past Scenes` block by embedding prior chapter chunks and selecting high-similarity matches to the current query/story window.
- Chapter-memory lineage can walk linked prior chapters across different author-note anchors, but steering guidance is still taken only from the active note's linked author note.
- `Story Continuity Aggressiveness` in settings controls chapter-memory behavior (`Balanced` vs `Aggressive`) for both Continue Story and Story Chat.
- `Writing Completion -> Semantic Chapter Recall` controls this behavior and can be fully disabled (`Enable Semantic Chapter Recall` off). It is enabled by default. Tunables include chapter/chunk limits, chunk sizing, similarity threshold, recency blend, and budget share.
- Long query windows for embeddings are chunked and averaged deterministically.
- If embedding calls fail, LoreVault falls back to lexical retrieval instead of aborting generation.

## Build and Export Outputs

For each lorebook:

- `lorebooks/<lorebook-slug>.db` (canonical SQLite pack)
- `lorebooks/sillytavern/<lorebook-slug>.json` (`world_info`, default pattern `sillytavern/{lorebook}.json`)
- `lorebooks/sillytavern/<lorebook-slug>.rag.md` (`rag` projection)

Output naming remains deterministic; collisions fail the build.

## Key Commands

Core:

- `Build Active Lorebook`
- `Open LoreVault Manager`
- `Open LoreVault Lorebook Auditor`
- `Open LoreVault Query Simulation`
- `Open LoreVault Help`

Writing:

- `Continue Story with Context`
- `Stop Active Generation`
- `Open Story Writing Panel`
- `Open Story Starter`
- `Open Story Chat`
- `Open or Create Linked Author Note`
- `Link Existing Author Note`
- `Rewrite Author Note`
- `Insert Inline Directive at Cursor`
- `Create Next Story Chapter`
- `Fork Story from Active Note`
- `Split Active Story Note into Chapter Notes`
- `Split Active Story Note into Chapter Notes (Pick Folder)`
- `Generate Chapter Summary (Active Note)`

Quality and utility:

- `Generate World Info Summary (Active Note)`
- `Generate Keywords (Active Note)`
- `Generate World Info Summaries (Active Lorebook)`
- `Generate Chapter Summaries (Current Story)`
- `Run Text Command on Selection`
- `Review Pending Text Command Edit`

Import and updates:

- `Import Ebook`
- `Import SillyTavern Lorebook`
- `Import SillyTavern Character Card`
- `Inject Character Card Event`
- `Sync Character Card Library`
- `Write Back Character Card Source`
- `Extract Wiki Pages from Story`
- `Fork Active Lorebook`
- `Apply Story Delta to Existing Wiki`
- `Open Lorebook Update`
- `Apply Lore Delta to Existing Wiki`
- `Open Lore Delta`

Import/extraction/update/story-starter panel behavior:

- each panel has a completion-profile selector
- ebook import panel supports three sub-modes:
  - `Story Chapters`: one chapter note per selected chapter with linked `previousChapter`/`nextChapter` frontmatter and auto-generated chapter summaries
  - `Lorebook Extraction`: concatenates selected chapters and runs the same AI extraction pipeline as `Extract Wiki Pages from Story`
  - `Raw Text Notes`: writes chapter text as plain notes (one per chapter or combined) without story-nav frontmatter
- ebook import accepts `.epub` and `.txt` vault files picked via fuzzy search
- EPUB parsing reads OPF spine and NCX/NAV navigation for chapter titles; TXT files are split by heading/blank-gap heuristics
- chapter selector shows detected character counts per chapter so you can scope what you import
- import panel supports two modes:
  - lorebook JSON import (`Import SillyTavern Lorebook`)
  - character-card import (`Import SillyTavern Character Card`) for `.png`/`.json` cards with LLM rewrite into story note + author note
- extraction and lorebook-update previews report chunk-stage progress while running
- lore-delta preview accepts inline idea briefs or an idea note, optional focused target notes, and uses `section_merge` / `rewrite_focused` policies instead of append-only note updates
- import and apply flows report live write progress while files are being created/updated
- lorebook selection in the import panel uses a list with per-item delete, interactive add picker, and Enter-to-add custom input
- character-card import can optionally import embedded card lorebooks into generated wiki notes
- character-card import can optionally run `Extract Character Wiki Page` to create one character-only lorebook page from scenario/card context
- character-card import accepts an optional `Persona Note` input and bakes it into generated story/author-note content at import time
- character-card rewrite expects freeform `authorNoteMarkdown`; structure is prompt-guided (no hardcoded section normalization/caps)
- character-card rewrite prompt now explicitly preserves detailed card constraints from description/personality/scenario/system prompts and allows longer author-note output when source detail is dense
- character-card rewrite/extract resolves common SillyTavern placeholders (`{{char}}`, `{{user}}`, `{{persona}}`, `{{random_user_1}}`, etc.) and warns if unresolved `{{...}}` placeholders remain in generated output
- known limitation: character-card import rewrite/extract currently runs as a single request (no chunked map-reduce path yet), so very large cards can exceed model context limits and fail
- character-card preview exposes editable planned writes (path + content) before import apply
- `Inject Character Card Event` uses linked `characterCardPath` and/or `characterCardMeta` to pick first/alternate/group greeting events and run a review-first rewrite of the current story (plus linked author note when present)
- `Sync Character Card Library` scans `Character Card Source Folder` and creates/updates one `lvDocType: characterCard` meta note per source card in `Character Card Meta Folder`
- synced character-card meta notes keep compact metadata in frontmatter (identity/tags/source/lorebook stats) plus duplicated summary fields for Bases usage (`cardSummary`, themes/tone, scenario focus, hook)
- all long card prose fields live in a managed, versioned markdown details block (`Character Card Details`) with avatar embed at top; block metadata is tracked by `characterCardDetailsVersion`
- alternate/group-only greetings inside the details block are rendered as numbered `####` subheadings for easier scanning/navigation
- sync preserves existing local avatar embeds in the details block (for plugins like Local Images Plus) instead of reverting to source-card image links
- `Write Back Character Card Source` pushes edited long fields from the managed details block (plus identity/tags/creator from frontmatter) back into the linked source `.png`/`.json` card
- write-back is hash-safe: if the source card changed since last sync, run `Sync Character Card Library` first
- optional `Auto-Generate Card Summaries on Sync` adds concise LLM-generated catalog fields (`cardSummary`, themes/tone, scenario focus, hook) and tracks stale summaries by card hash without overwriting manual summaries
- sync now shows live progress notifications (stage + percent + elapsed time), useful for long runs with LLM summary generation
- when a synced character-card meta note exists, generated story notes include `characterCardMeta: [[...]]` for backlink-based related-story tracing
- story notes generated from image-based character cards include linked avatar metadata and an embedded image reference for visual vibe anchoring
- default target folder for import/extraction/fork is `Default Lorebook Import Location` (default `LoreVault/import`)
- story-delta change/conflict review renders side-by-side source diffs directly beside accept/reject decisions
- story-starter panel (`Open Story Starter`) turns a premise + optional brainstorm notes into a first chapter note and linked author note with preview/apply and editable planned writes

Operations and reporting:

- `Open LLM Operation Log Explorer`
- `Open Cost Analyzer`
- `Export Usage Report (JSON)`
- `Export Usage Report (CSV)`

## Logging and Cost Tracking

- Operation log is enabled by default and captures full LLM request/response payloads.
- Embedding backend call logging is enabled by default.
- Operation logs are namespaced by cost profile (one JSONL file per profile suffix).
- Default retention is `10000` entries per profile log file.
- Operation Log Explorer includes a cost-profile selector and defaults to the active device profile.
- Optional usage ledger tracks requests/tokens/cost with session/day/week/month/project aggregation.
- Budget settings are stored per cost profile (`Budget Cost Profile` selector in settings).
- Completion and embedding API keys are stored via Obsidian Secret Storage (not persisted in `data.json`).
- LoreVault only creates missing secrets; it never overwrites an existing secret value.
- Secret IDs are user-configurable; you can pick existing IDs in settings to reuse one secret across multiple presets.
- Each completion preset has its own `Completion API Secret Name` used to load that preset's API key.
- Active completion preset and cost-profile label are device-local (Obsidian local storage), not shared vault settings.
- Budget warnings are evaluated per selected cost profile.
- Cost Analyzer view provides per-profile breakdowns (totals + by-operation/model/lorebook/source).

## Development

```bash
npm install
npm run check:mobile-runtime
npm run build
npm run lint
npm test
```

Release automation (maintainers):

```bash
npm run release:version -- <version>
```

This updates `manifest.json` + `versions.json`, creates `release <version>` commit, creates tag `<version>`, and pushes branch + tag.

## Documentation

- [docs/documentation.md](docs/documentation.md)
- [docs/technical-reference.md](docs/technical-reference.md)
- [docs/installation-guide.md](docs/installation-guide.md)
- [docs/sqlite-pack-schema.md](docs/sqlite-pack-schema.md)
- [docs/planning.md](docs/planning.md)
- [docs/todo.md](docs/todo.md)

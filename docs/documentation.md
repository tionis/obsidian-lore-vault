# LoreVault Documentation

## Overview

LoreVault compiles Obsidian notes into deterministic context exports.

Current runtime export targets per lorebook:

- canonical LoreVault SQLite pack (`.db`)
- SillyTavern-style `world_info` JSON
- fallback markdown projection pack

Core lorebook boundary:

- LoreVault does not provide human book/EPUB/PDF publishing output.
- Human-oriented publishing should be implemented as a companion plugin consuming LoreVault exports.

## Compatibility

- Plugin id: `lore-vault`
- Plugin name: `LoreVault`
- Minimum Obsidian version: `1.11.4`
- Desktop and mobile supported (`isDesktopOnly: false`)
- Mobile compatibility matrix and QA checklist: `docs/mobile-compatibility-plan.md`

## User Documentation Surfaces

- Command: `Open LoreVault Help`
  - opens embedded in-plugin help panel (`lorevault-help-view`)
  - provides setup/run/debug guidance for users without leaving Obsidian
- Repository docs:
  - `README.md` (quickstart behavior summary)
  - `docs/documentation.md` (this detailed behavior doc)
  - `docs/technical-reference.md` (implementation-level architecture/contracts)

## Conversion Pipeline

When you run **Build Active Lorebook** or **Build/Export Lorebook**:

1. Collect all markdown files
2. Resolve lorebooks from hierarchical tags
3. Parse frontmatter + markdown body
4. Include notes as canonical lore entries (unless `retrieval: none`)
5. Build wikilink graph for `world_info` entries
6. Compute deterministic `order`
7. Build canonical SQLite pack (`world_info`, fallback docs/chunks/embeddings, source-note metadata, note-level embeddings)
8. Export lorebook `world_info` JSON + lorebook fallback markdown

## Lorebook Selection

Selection is driven by hierarchical tags under a configurable prefix:

- default prefix: `lorebook`
- examples:
  - `#lorebook/universe`
  - `#lorebook/universe/yggdrasil`
  - `#lorebook/universe/yggdrasil/factions`

Settings:

- `tagPrefix`
- `activeScope`
- `membershipMode` (`exact` | `cascade`)
- `includeUntagged`

Behavior:

- `exact`: only notes with matching lorebook tag are included
- `cascade`: notes in child and parent lorebooks are included within the same hierarchy branch
- notes with frontmatter `exclude: true` are always skipped
- empty `activeScope`: no configured fallback lorebook
- export command builds one lorebook at a time:
  - active file lorebook first
  - otherwise configured `activeScope`
- manager view discovers all lorebooks and provides per-lorebook build actions

## Frontmatter Parsing

Structured metadata is frontmatter-first.

Key fields:

- `title` / `comment`
- `aliases`
- `keywords` / `key`
- `summary`
- `trigger_method`
- `selectiveLogic`
- `probability`
- `depth`
- `group`
- `exclude`
- `root` / `lorebookRoot`
- `retrieval`

Content:

- markdown body (frontmatter stripped)
- overridden by summary content under `## Summary` when present (`LV_BEGIN/LV_END` delimited block if present, otherwise first paragraph)
- if summary section is missing, LoreVault falls back to frontmatter `summary`
- if both are missing, LoreVault uses the note body

## Retrieval Routing

Default (`retrieval: auto`):

- note is included as a canonical lore entry
- `retrieval: none` is the hard exclusion mode

Overrides:

- `retrieval: world_info`
- `retrieval: rag`
- `retrieval: both`
- `retrieval: none`

Current behavior: `world_info|rag|both|auto` all include canonical lore entries; `none` excludes the note from retrieval/export.

## Root Behavior

Hierarchy root is:

1. explicit frontmatter root (`root: true` / `lorebookRoot: true`) in deterministic file order
2. otherwise inferred deterministically from graph connectivity

## Wikilink Normalization

Supported link forms:

- `[[Page]]`
- `[[Page|Alias]]`
- embedded wikilinks

Normalization:

- `\` -> `/`
- strip `#...` refs
- strip `.md`
- trim whitespace

Ambiguous basename mappings are removed to avoid incorrect edge links.

## Ranking / Order

Order uses weighted normalized metrics:

- hierarchy depth
- in-degree
- PageRank
- betweenness
- out-degree
- total degree
- file depth

Computation:

- `order = max(1, floor(score))`
- ties resolved deterministically by ascending UID offsets

Current tuned default weights:

- `hierarchy`: `3800`
- `in_degree`: `3300`
- `pagerank`: `3000`
- `betweenness`: `1700`
- `out_degree`: `700`
- `total_degree`: `250`
- `file_depth`: `850`

These defaults are calibrated against representative graph fixtures to reduce over-bias toward deep-file depth while preserving strong hub/bridge prioritization.

## Testing

```bash
npm run build
npm test
npm run profile:large-vault
```

Release command (maintainers):

```bash
npm run release:version -- <version>
```

Release behavior:

- validates target version is strict `x.y.z` and greater than current `manifest.json` version
- updates `manifest.json` and `versions.json` deterministically
- creates commit `release <version>`
- creates tag `<version>`
- pushes branch + tag (`origin main <version>` by default)
- supports `--dry-run`, `--remote`, `--branch`, and `--allow-dirty`

Fixture coverage includes:

- graph-order determinism
- wikilink normalization and ambiguity handling
- lorebook selection (`exact` + `cascade`)
- retrieval routing mode parsing and target resolution
- output path resolution/collision checks
- rag markdown export ordering
- rag chunking determinism
- non-English retrieval/metadata compatibility
- summary precedence behavior (`## Summary` section > `frontmatter` fallback > body/excerpt fallback)

Large-vault profiling command (`npm run profile:large-vault`) provides deterministic synthetic timing baselines for graph build/ranking/query behavior.

## Output Naming Rules

Given configured `Downstream Export Path Pattern` + SQLite output directory:

- SQLite pack file: `<sqliteOutputDir>/<lorebook-slug>.db` (default: `lorebooks/<lorebook-slug>.db`)
- world info file: `<sqliteOutputDir>/<downstreamSubpath>.json` (default subpath: `sillytavern/{lorebook}.json`)
- rag file: `<sqliteOutputDir>/<downstreamSubpath>.rag.md`

Downstream naming:

- if downstream subpath contains `{lorebook}` (or legacy `{scope}`): replace token with lorebook slug
- otherwise append `-<lorebook-slug>` before extension

SQLite path behavior:

- if SQLite output setting is a directory: write `<dir>/<lorebook-slug>.db`
- if SQLite output setting is a `.db` file path: append `-<lorebook-slug>` unless `{lorebook}`/`{scope}` is present
- SQLite output path must be vault-relative (absolute filesystem paths are rejected)
- downstream export subpath/pattern must be vault-relative (absolute filesystem paths are rejected)
- downstream exports are always written under the SQLite lorebook directory (for example `lorebooks/sillytavern/...`)

Output build fails fast if path collisions are detected.

Export freshness policy (`LoreVault Settings -> SQLite`):

- `manual`: only explicit build actions update exports
- `on_build` (default): exports update when build commands/buttons run
- `background_debounced`: vault edits queue impacted-lorebook rebuilds after debounce delay
- manager lorebook cards display per-lorebook `Last canonical export` timestamp plus humanized relative age (`minutes/hours/days/months ago`)

## Companion Publishing Contract (Phase 10.5)

For downstream publishing tools/plugins:

- Treat SQLite lorebook packs as canonical inputs.
- Do not re-parse vault markdown when a SQLite lorebook pack is available.
- Stable core tables for downstream consumption:
  - `world_info_entries`
  - `rag_documents`
  - `rag_chunks`
  - `rag_chunk_embeddings`
  - `source_notes`
  - `note_embeddings`
- Deterministic order guarantees:
  - `world_info_entries`: `order_value DESC, uid ASC`
  - `rag_documents`: `path ASC, title ASC, uid ASC`
  - `rag_chunks`: `path ASC, chunk_index ASC`
- Stable downstream export roots:
  - canonical lorebook `.db` under configured SQLite output path
  - ST-style outputs under a subpath of the SQLite root (`sillytavern/{lorebook}.json` by default)

SQLite pack metadata:

- counts, build metadata, deterministic signatures, and settings snapshots are stored in `meta` table
- schema is documented in:
  - `docs/sqlite-pack-schema.md`

This contract lets a companion publishing plugin select tags/pages/assets independently without changing LoreVault core behavior.

## Embeddings and Semantic RAG

Configurable embedding providers:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Default model:

- `qwen/qwen3-embedding-8b`

Caching:

- one-file-per-hash cache records
- cache directory must be vault-relative
- cache key includes:
  - chunk text hash
  - provider/model
  - instruction
  - chunking signature

Chunking modes:

- `auto` (heuristic)
- `note`
- `section`

Live query combines:

- lexical scoring
- optional semantic boost from chunk embeddings

## Writing Completion

Command: `Continue Story with Context`
Stop command: `Stop Active Generation`
Also available in markdown editor right-click menu as `LoreVault: Continue Story with Context`.
Also registered as an editor action command so it appears in mobile editor action menus.
Also available via ribbon icon for fast mobile invocation.
The same editor menu also exposes note-level summary actions when eligible:

- `LoreVault: Insert Inline Directive` for story notes (chapter metadata or `authorNote` link).
- `LoreVault: Run Text Command on Selection` (only when text selection is non-empty).
- `LoreVault: Generate Keywords` for notes with lorebook tags.
- `LoreVault: Generate World Info Summary` for notes with lorebook tags.
- `LoreVault: Rewrite Author Note` for author-note documents.
- `LoreVault: Continue Story with Context` is hidden for author-note documents.

Provider options:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Settings:

- enable/disable completion
- provider, endpoint, api key, model
- completion/embedding API keys are persisted in Obsidian Secret Storage (not in plugin `data.json`)
- LoreVault only creates missing secrets and never overwrites existing secret values
- secret IDs are user-defined; settings expose `Pick Existing` (from Obsidian secret storage) so multiple presets can share one key
- reusable model presets (`New Preset`, `Clone Current`, `Delete Selected`)
- preset edits are auto-saved; no separate update/save step
- each preset has a `Completion API Secret Name` used to load/store that preset's API key
- active completion preset is device-local (Obsidian local storage), not shared vault settings
- system prompt
- temperature
- max output tokens
- context window tokens
- prompt reserve tokens
- steering layer placement for author note
- inline directives are converted in-place to `<inline_story_directive>` tags during prompt assembly
- timeout

Story lorebook selection order:

1. Linked Author Note frontmatter lorebook keys (preferred)
2. Story note frontmatter lorebook keys (fallback)
3. no implicit lorebook fallback

Story frontmatter lorebook keys:

- keys: `lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`
- value format:
  - list: `['universe', 'universe/yggdrasil']`
  - comma-separated string: `universe, universe/yggdrasil`
  - accepts `lorebook/<lorebook>` and `#lorebook/<lorebook>` forms
- behavior:
  - values are normalized and deduplicated deterministically
  - each selected lorebook is queried and combined into completion context
  - completion token budget is split across selected lorebooks
  - context budgets are trimmed iteratively if selected context exceeds input budget

Optional continuity frontmatter keys for editor continuation:

- continuity lists:
  - `lvPlotThreads` (or `plotThreads` / `activePlotThreads`)
  - `lvOpenLoops` (or `openLoops` / `unresolvedCommitments`)
  - `lvCanonDeltas` (or `canonDeltas` / `recentCanonDeltas`)
- continuity inclusion toggles:
  - `lvIncludePlotThreads` (or `includePlotThreads`)
  - `lvIncludeOpenLoops` (or `includeOpenLoops`)
  - `lvIncludeCanonDeltas` (or `includeCanonDeltas`)

Long-form story metadata (new):

- `authorNote`: wikilink/markdown-link to the note-level Author Note for this story note (primary thread anchor)
- `chapter`: chapter/scene index (numeric)
- `chapterTitle`: optional chapter display title
- `previousChapter` / `prevChapter`: optional links/paths to prior chapter notes
- `nextChapter`: optional links/paths to following chapter notes
- `storyId`: optional explicit fallback anchor when no `authorNote` is linked

Author Note model:

- one note-level Author Note markdown document per story note link
- Author Note content is edited directly in native Obsidian notes
- optional `completionProfile` frontmatter can pin an Author Note to a completion preset id
- optional frontmatter lorebook values use the same accepted lorebook keys as story notes
- default creation folder is configurable in settings (`Story Steering -> Author Note Folder`)
- optional `lvDocType: authorNote` frontmatter marks notes as explicit Author Notes
- if multiple story notes link to the same Author Note, rewrite/generation context includes all linked stories

Author Note rewrite behavior:

- rewrite/update focuses on Author Note markdown only
- optional per-run update prompt can steer what should be changed
- rewrite context includes linked story note content, selected lorebook context, and current Author Note
- review modal shows a side-by-side source diff (`Current` vs `Proposed`) with context windows and omitted-line markers before apply
- optional sanitization mode controls filtering:
  - `strict` (default): filters obvious lorebook-style profile facts (for example static character bios) to reduce duplicated context
  - `off`: keeps raw extracted content

When running `Continue Story with Context`, LoreVault resolves a deterministic story sequence for the active note and injects a bounded chapter-memory block from recent prior chapters before lorebook context.
The chapter-memory window scales deterministically with available chapter-memory budget, so larger context windows include more prior chapters.
Chapter memory uses a rolling summary store (`## Summary` section preferred, `frontmatter summary` fallback, deterministic excerpt final fallback) so repeated generations avoid unnecessary re-parsing.
When chapter-memory budget is sufficiently large, LoreVault additionally injects bounded style excerpts from the most recent prior chapters to better preserve narrative voice and pacing continuity.
Optional semantic chapter recall can also inject a `## Related Past Scenes` block by chunking prior chapters, embedding chunks, and selecting high-similarity chunks against the current query/story window.
On very large context windows, LoreVault allocates substantially more chapter-memory budget, so long-form threads can carry a deeper summary trail and richer recent-chapter style context.
`Story Continuity Aggressiveness` (Settings -> Writing Completion) controls this behavior:
- `Balanced`: moderate chapter-memory depth and style carryover.
- `Aggressive`: larger chapter-memory budgets, deeper prior-chapter windows, and stronger style carryover.
`Semantic Chapter Recall` settings (Settings -> Writing Completion -> Semantic Chapter Recall) control the optional embedding-based recall layer:
- `Enable Semantic Chapter Recall` toggles the feature on/off.
- tunables: max source chapters, max chunks, max chunks per chapter, chunk max/overlap chars, minimum similarity threshold, recency blend, and chapter-memory budget share reserved for semantic recall.
- default profile is tuned for large-context drafting (`enabled`, `maxSourceChapters: 40`, `maxChunks: 10`, `maxChunksPerChapter: 2`, `chunkMaxChars: 1800`, `chunkOverlapChars: 220`, `minSimilarity: 0.16`, `recencyBlend: 0.28`, `budgetShare: 0.32`).
If semantic recall is enabled but embeddings are unavailable/fail, LoreVault skips this layer and continues generation with summary/excerpt chapter memory plus normal retrieval.
When enabled, LoreVault can also add a bounded tool-retrieval layer (`<tool_retrieval_context>`) before final generation.

## Text Commands (Selection Rewrite/Reformat)

Command:

- `Run Text Command on Selection`
- `Review Pending Text Command Edit` (appears when a saved text-command review is waiting)

Editor menu:

- `LoreVault: Run Text Command on Selection` appears only when selected text is non-empty.

Run flow:

1. select editor text
2. open prompt modal
  - choose prompt template from prompt-note files in your configured prompt folder (or custom prompt)
  - optional per-run lorebook-context toggle
3. LoreVault optionally retrieves lorebook context using selected text as query
4. LoreVault sends prompt + selected text (+ optional context) to completion provider
5. response text is treated as replacement candidate
6. if auto-accept is off and the original editor selection is still active, LoreVault opens an editable review modal with side-by-side source diff before apply
7. if focus moved elsewhere or the review modal is dismissed, LoreVault saves the result into a pending-review queue instead of discarding it; reopen it with `Review Pending Text Command Edit` or the status-bar indicator
8. LoreVault applies the edit only when it can still match the captured target text/range safely; otherwise the review stays pending so the generated edit is not lost
9. default `Canon Consistency Pass` template emphasizes lorebook factual consistency and only minimal style edits needed to fix canon conflicts
10. default `Scene Consistency Pass` template focuses on internal scene continuity (character positions, movement continuity, object state, and immediate spatial logic) with minimal edits
11. default `Remove LLMisms` template removes common AI-writing tells such as mirrored contrast framing (`not X but Y` / `not just X, but Y`), heavy signposting, hedging/meta filler, buzzwordy abstraction, cliche metaphors, overly even cadence, and unnecessary em-dash pivots while preserving voice

Settings (LoreVault -> Text Commands):

- `Auto-Accept Text Command Edits` (default off)
- `Include Lorebook Context by Default`
- `Text Command Context Token Budget`
- `Text Command System Prompt`
- `Text Command Prompt Notes Folder`
- `Create Default Prompt Notes`

## Auto Summary Workflows (Phase 9)

Commands:

- `Generate Keywords (Active Note)`
- `Generate World Info Summary (Active Note)`
- `Generate Chapter Summary (Active Note)`
- `Generate World Info Summaries (Active Lorebook)`
- `Generate Chapter Summaries (Current Story)`

Editor context menu behavior:

- keyword generation action appears only when the current note is in a lorebook (tag-derived).
- world_info summary action appears only when the current note is in a lorebook (tag-derived).
- chapter summary generation is available via command palette and Story Writing panel.

Review/acceptance flow:

1. LoreVault reads note body and builds a constrained summary prompt.
2. Completion provider returns candidate summary.
3. Review modal shows side-by-side source diff (`existing` -> `proposed`), lets user edit, and choose:
  - `Write Summary Section` (writes/updates `## Summary` section)
  - `Cancel`

Storage and determinism:

- accepted summaries are written into note body (`## Summary` section)
- deterministic output comes from explicit source notes plus deterministic processing/ranking/export order

Precedence:

- world_info export content:
  - summary section content (`LV_BEGIN/LV_END` block when present, otherwise first paragraph)
  - frontmatter `summary` (fallback)
  - note body
- chapter memory:
  - summary section content (`LV_BEGIN/LV_END` block when present, otherwise first paragraph)
  - frontmatter `summary` (fallback)
  - deterministic excerpt fallback
  - chapter-link lineage traversal may include linked prior chapters across different Author Notes
  - only the active note's linked Author Note is injected as steering guidance
  - when budget allows: additional bounded style excerpts from recent prior chapter bodies (more recent chapters and larger excerpt slices on high-context models)
  - optional semantic chunk recall (`## Related Past Scenes`) from prior chapters when enabled in Writing Completion settings
- chapter summaries are not hard-length capped.
- when a chapter summary contains multiple paragraphs, LoreVault writes it inside:
  - `<!-- LV_BEGIN_SUMMARY -->`
  - `<!-- LV_END_SUMMARY -->`

Settings (LoreVault -> Auto Summaries):

- `Summary Max Input Chars`
- `Summary Max Output Chars` (world_info only; default `0` = no hard truncation)

## Long-Form Chapter Utilities

Commands:

- `Split Active Story Note into Chapter Notes`
- `Split Active Story Note into Chapter Notes (Pick Folder)`
- `Create Next Story Chapter`
- `Fork Story from Active Note`

Current behavior:

- split commands parse active note chapters from `##` headings (`#` is treated as story title) and create one chapter note per section.
- created chapter notes write canonical frontmatter fields:
  - `authorNote` link to shared Author Note
  - `chapter`
  - `chapterTitle`
  - `previousChapter`
  - `nextChapter`
  - optional `storyId` only when already explicitly set on source note
- split command in current-folder mode writes chapter files beside the source note.
- split command in pick-folder mode writes chapter files to the selected existing vault folder.
- create-next command creates a new chapter note in the active note folder, sets current note `nextChapter`, sets new note `previousChapter`, and links the new note to the same Author Note.
- create-next chapter is exposed in Story Writing panel (and command palette), not editor context menu.
- fork-story command prompts for a new note name (prefilled from active note), creates a copied note in the same folder, creates a new derived Author Note, links the fork to the new Author Note, and copies source Author Note markdown/frontmatter into the new Author Note.
- fork-story keeps story frontmatter unchanged except:
  - `authorNote` is rewritten to the forked Author Note link
  - forward-link keys (`nextChapter`/`next`) are removed to avoid branch-mixing with downstream chapters
- when a source Author Note exists, its markdown (including frontmatter like `lorebooks` and `completionProfile`) is copied verbatim into the forked Author Note.

## Cost Tracking (Experimental, Phase 13)

Current implemented feature set:

- completion and summary requests capture usage when provider payload includes token usage
- records are written to a local usage ledger JSON file
- cost calculation uses:
  - provider-reported cost when available
  - model-specific pricing overrides when configured
  - fallback estimate from configured default input/output USD-per-1M rates
  - `unknown` when neither is available

Settings:

- `Enable Cost Tracking`
- `Usage Ledger Path`
- `Default Input Cost / 1M Tokens (USD)`
- `Default Output Cost / 1M Tokens (USD)`
- `Model Pricing Overrides` (`provider | model-pattern | input | output`)
- `Usage Report Output Directory`
- `Budget Cost Profile` (select which cost profile budget settings you are editing)
- `Daily Budget Warning (USD)`
- `Session Budget Warning (USD)`
- `Budget by Operation (USD)`
- `Budget by Model (USD)`
- `Budget by Lorebook (USD)`

Budget settings are saved per selected cost profile.
Use `Budget Cost Profile` in settings to switch which profile's budget set you edit.

Ledger default path:

- `.obsidian/plugins/lore-vault/cache/usage-ledger.json`

Each record contains deterministic fields:

- timestamp
- operation (`summary_world_info`, `summary_chapter`, `story_chat_turn`, `editor_continuation`)
- provider/model
- prompt/completion/total tokens
- reported/estimated cost and cost source
- pricing provenance (`pricingSource`, `pricingRule`, `pricingSnapshotAt`)
- effective rates used for estimation (`inputCostPerMillionUsd`, `outputCostPerMillionUsd`)
- operation metadata

Report exports:

- `Export Usage Report (JSON)`
- `Export Usage Report (CSV)`

JSON export includes snapshot totals + full ledger entries.
CSV export includes deterministic row order, pricing provenance columns, and metadata JSON column.

## LoreVault Manager UI

Command: `Open LoreVault Manager` (opens a persistent right-side workspace panel)

Capabilities:

- lists discovered lorebooks with deterministic ordering in compact cards
- shows counts:
  - included notes
  - `world_info` entries
  - `rag` documents
- provides quick navigation buttons:
  - `Lorebook Auditor`
  - `Query Simulation`
  - `Story Writing Panel`
  - `Cost Analyzer`
- title-row refresh icon triggers a manual panel refresh

## Story Writing Panel

Command: `Open Story Writing Panel` (persistent right-side workspace panel)
Author-note profile command: `Set Author Note Completion Profile`

Capabilities:

- active-note writing controls:
  - group 1: `Continue Story` (toggles to `Stop` while generation is running), `Insert Directive` (`<!-- LV: ... -->`)
  - group 2: `Open/Create Author Note`, `Link Author Note` (interactive picker), `Rewrite Author Note`
  - group 3: `Generate Chapter Summary`, `Create Next Chapter`, `Fork Story`
- Author Note workflow:
  - linked from story frontmatter `authorNote`
  - authored in native Obsidian note editor
  - optional per-author-note completion profile override (`completionProfile`) managed via command `Set Author Note Completion Profile`
  - rewrite flow uses optional change prompt + diff review
  - when an Author Note is active, panel lists linked chapters/stories (chapter-ordered when available)
- completion profile controls:
  - device-local active preset selector (dropdown, applies immediately)
  - selector is disabled when Author Note `completionProfile` override is active and shows `Overridden by Author Note`
  - provider/request options in Writing Completion settings, including reasoning/thinking, are saved per selected preset
  - selected preset `Completion API Secret Name` for secret storage key mapping
  - API key bootstrap fields only create missing secrets; update existing secret values via Obsidian Secret Storage
  - device-local cost profile label is configured in settings (usage metadata tagging only); if empty, usage falls back to an automatic API-key hash profile
  - cost breakdown is shown in the same section directly under the profile selector
- lorebook controls for active story note:
  - show selected lorebooks from linked Author Note frontmatter
  - add lorebooks via interactive picker
  - remove lorebooks via per-item remove action
  - writes canonical `lorebooks` key on linked Author Note frontmatter
- generation monitor details:
  - state/status
  - effective provider/model
  - active lorebooks, token usage, output progress
  - collapsible selected context items (`world_info`, fallback items)
- compact collapsible usage/cost summary:
  - session/day/week/month/project totals
  - warnings when selected-profile budgets are exceeded

## Story Starter Panel

Command: `Open Story Starter`

Current behavior:

- opens a persistent workspace view for premise-to-draft generation
- collects:
  - target folder for the generated first chapter note (default `LoreVault/stories`)
  - author-note folder from `Story Steering -> Author Note Folder`
  - optional default tags
  - optional completion profile override (same profile resolution path as Story Chat when unset)
  - optional lorebooks
  - optional requested title
  - required story idea
  - optional brainstorm/chat notes
- selected lorebooks are used in two ways:
  - live retrieval against the selected lorebooks before generation
  - persisted `lorebooks` frontmatter on the generated story note and author note
- preview flow:
  - retrieves graph-first lore context (`world_info` + fallback entries) from selected lorebooks when present
  - sends one strict-JSON completion request with fields:
    - `title`
    - `chapterTitle`
    - `storyMarkdown`
    - `authorNoteMarkdown`
    - `starterNotes`
  - parses the response deterministically
  - materializes two editable planned writes:
    - first chapter/introduction story note
    - linked author note
- create flow reuses the previewed plan when inputs are unchanged
- generated story note frontmatter includes:
  - `title`
  - `authorNote`
  - `storyId`
  - `chapter: 1`
  - `chapterTitle`
  - optional `tags`
  - optional `lorebooks`
  - `sourceType: "lorevault_story_starter"`
- generated author note frontmatter includes:
  - `lvDocType: "authorNote"`
  - `storyId`
  - optional `tags`
  - optional `lorebooks`
  - optional `completionProfile` when a profile is chosen in the panel
  - `sourceType: "lorevault_story_starter"`
- preview output exposes:
  - starter notes returned by the model
  - unresolved-placeholder warnings when generated output still contains `{{...}}`
  - editable path/content fields before apply

## Cost Analyzer

Command: `Open Cost Analyzer`

Capabilities:

- select a cost profile (defaults to current device profile)
- inspect profile totals (session/day/week/month/project)
- inspect top breakdowns by operation, model, lorebook, and cost source
- review budget warnings evaluated against the selected profile

## Character Library Bases View

LoreVault registers a custom Bases view type: `LoreVault Characters`.

Usage:

- create/open a Base that targets your character-card meta notes (`lvDocType: characterCard`)
- in the Bases view switcher, pick `LoreVault Characters`

Behavior:

- renders avatar images from `avatar` / `characterCardAvatar` / `cardFile`
- clicking an avatar opens a larger preview modal
- renders personality/description/scenario as markdown (HTML in those fields is rendered by Obsidian's markdown renderer)
- shows quick actions to open the meta note and linked source card
- field visibility respects Bases property visibility/order plus view toggles
- exposes view options: max cards, avatar size, and section visibility

## Inbound Wiki Import and Story Extraction (Phase 14)

Commands:

- `Import Ebook`
- `Import SillyTavern Lorebook`
- `Import SillyTavern Character Card`
- `Inject Character Card Event`
- `Sync Character Card Library`
- `Write Back Character Card Source`
- `Extract Wiki Pages from Story`
- `Fork Active Lorebook`
- `Apply Story Delta to Existing Wiki` (Phase 15 foundation)

Shared panel inputs:

- shared default target folder setting:
  - `Default Lorebook Import Location` (settings, default `LoreVault/import`)
- character-card library settings:
  - `Character Card Source Folder` (raw `.png`/`.json` cards, default `LoreVault/character-cards/source`)
  - `Character Card Meta Folder` (`lvDocType: characterCard` notes, default `LoreVault/character-cards/library`)
  - `Auto-Generate Card Summaries on Sync` (optional LLM summary generation)
  - `Card Summary Completion Profile` (optional profile override; empty = active device/default profile)
  - `Regenerate Auto Summaries on Card Changes` (hash-aware regeneration for LoreVault-generated summaries)
  - used to prefill target folder in import, extraction, and lorebook-fork flows

- `Import Ebook`:
  - ebook file picker (`.epub` and `.txt` vault files via fuzzy search)
  - sub-mode selector: `Story Chapters` | `Lorebook Extraction` | `Raw Text Notes`
  - chapter selector: all-toggle + per-chapter checkboxes with detected character count label
  - `Story Chapters` sub-mode:
    - target folder (manual path or Browse picker)
    - story ID (derived from ebook title, editable)
    - default tags
    - produces one note per selected chapter with `storyId`, `chapter`, `chapterTitle`, `previousChapter`/`nextChapter` frontmatter and an auto-generated `## Summary` section
    - two-pass path computation ensures `previousChapter`/`nextChapter` wikilinks are consistent across the import batch
  - `Lorebook Extraction` sub-mode:
    - target folder (manual path or Browse picker)
    - lorebook name → lorebook tag (same pipeline as `Extract Wiki Pages from Story`)
    - default tags
    - completion profile selector
    - concatenates selected chapter text then runs AI extraction into wiki notes
  - `Raw Text Notes` sub-mode:
    - target folder
    - default tags
    - optional `Combine into single note` toggle to merge all selected chapters into one file
    - writes chapter body text verbatim without story-nav frontmatter
  - parsed ebook is cached by file path; re-selecting the same file does not re-parse
  - preview/import key encodes all relevant settings so a re-preview is forced when settings change
  - EPUB parsing: ZIP decompressed via `fflate` → `META-INF/container.xml` → OPF → spine → XHTML HTML extraction; NCX (EPUB 2) and NAV (EPUB 3) navigation documents used for chapter title map; chapters < 30 chars are skipped (cover pages)
  - TXT parsing: four-rule heuristic — explicit `Chapter N`/`Part N`/`CHAPTER` headings with blank line before, Markdown headings (`#`/`##`), 3+ blank line gaps with ≥ 500 chars body, single-chapter fallback
- `Import SillyTavern Lorebook`:
  - target folder (manual path or Browse picker)
  - default tags
  - lorebook selection list with per-item delete, interactive add picker, and Enter-to-add custom input
  - completion profile selector (for import workflow profile consistency)
- `Import SillyTavern Character Card`:
  - target folder (story note output)
  - character-card file picker (`.png` and `.json`)
  - optional `Persona Note` picker (`.md`) used only at import time to bake protagonist/user context into generated story + author note
  - default tags
  - lorebook selection list with per-item delete, interactive add picker, and Enter-to-add custom input
  - completion profile selector (used for LLM rewrite into freeform story format)
  - optional `Extract Character Wiki Page` toggle for one character-only wiki page from scenario/card context
  - optional `Import Embedded Lorebook` toggle for card `character_book` payloads
  - when the card has multiple greetings, a selection modal lets you choose which opening scene to rewrite as the import story start
  - rewrite instructions prioritize preserving high-detail description/personality/scenario/system constraints; longer author-note output is allowed when source detail is dense
  - when `Persona Note` is set, rewrite/extract prompts include persona markdown and explicit placeholder guidance
  - generated preview warns when unresolved `{{...}}` placeholders remain in rewrite/extract outputs
  - known limitation: rewrite/extract uses a single completion request (no chunked import path yet), so very large cards can exceed the selected model context window and fail
- `Inject Character Card Event`:
  - runs from the active story note and requires `characterCardPath` and/or `characterCardMeta` frontmatter linkage
  - resolves event candidates from first/alternate/group-only greetings (source card preferred, synced meta-note details as fallback)
  - shows the same greeting/event picker UI used by import when multiple candidates exist
  - sends one rewrite request with current story markdown, linked author note markdown (if present), selected event text, and linked card context
  - review-first apply flow:
    - side-by-side story diff is required before write
    - optional side-by-side author-note diff is shown when a linked author note exists and model returns updated author-note guidance
  - preserves existing story frontmatter while replacing only the story body
  - operation log + usage ledger operation name: `character_card_event_injection`
- `Sync Character Card Library`:
  - scans source folder for `.png`/`.json` cards
  - ensures one meta note exists per source card in meta folder
  - updates compact card metadata in frontmatter for Bases-friendly indexing (`characterName`, `cardTags`, source stats, embedded-lorebook stats) and keeps summary fields duplicated in frontmatter (`cardSummary`, themes/tone, scenario focus, hook)
  - upserts a managed, versioned markdown details block so long fields stay readable directly in the note body
  - details block includes top avatar embed (when image card/avatar is available) and summary-first ordering (`Card Summary`, `Summary Scenario Focus`, `Summary Hook`, tone/themes, then `Creator Notes`, `Personality`, and remaining fields)
  - alternate/group-only greetings in that details block are emitted as numbered `####` subheadings (`Alternate Greeting 1`, etc.) so long greeting variants are easier to navigate
  - if the existing details block already contains a local avatar embed (for example localized by Local Images Plus), sync preserves that local embed instead of reverting it to the source-card link
  - block markers include a version comment and frontmatter tracks `characterCardDetailsVersion` for future migrations
  - optional auto-summary mode generates concise card catalog fields (`cardSummary`, themes/tone, scenario focus, hook) via completion profile selection
  - auto-summary updates are hash-aware (`cardSummaryForHash`); manual summaries are preserved and stale summaries are flagged instead of silently overwritten
  - shows live sync progress notifications (phase, percent, elapsed time) while processing cards and missing-source checks
  - marks notes `status: missing_source` when source cards are removed (no automatic deletion)
- `Write Back Character Card Source`:
  - expects active note to be a synced `lvDocType: characterCard` meta note
  - reads editable identity fields from frontmatter (`name`, `tags`, `creator`) and long prose fields from the managed details block (`Creator Notes`, personality/description/scenario/messages/prompts/greetings)
  - writes those values back into the linked source card (`cardPath`) for both `.json` and `.png` (PNG metadata `ccv3/chara`)
  - hash-safe guard: aborts if source card payload hash differs from synced `cardHash` (run sync first)
- `Extract Wiki Pages from Story`:
  - target folder (manual path or Browse picker)
  - default tags
  - lorebook name converted into a lorebook tag using configured `tagPrefix`
  - completion profile selector used for extraction model calls
- `Apply Story Delta to Existing Wiki`:
  - source story input: inline markdown or `Source Story Note Path` (`Pick Note` / `Use Active Note`)
  - source range mode: `note` | `chapter` | `story` (deterministic expansion from selected source note)
  - lorebook selection list (add/remove lorebooks to consider for existing-page updates)
  - `New Note Target Folder` (used only for new-note creation)
  - default tags
  - completion profile selector used for lorebook-update model calls
- `Fork Active Lorebook`:
  - source lorebook resolved from active note lorebook first, then configured active lorebook
  - prompts for new lorebook + target folder
  - default folder prefilled as `<Default Lorebook Import Location>/<new-lorebook>`
  - copies all notes in source-lorebook branch into target folder with deterministic path allocation
  - rewrites internal wikilinks/markdown links to the forked note paths
  - strips old lorebook inline tags from body text and writes the new lorebook tag in frontmatter

Implemented now:

- SillyTavern lorebook JSON paste-import panel
- SillyTavern character-card import flow (`.png` / `.json`) with LLM rewrite to story note + author note
- deterministic parse and entry normalization
- preview mode (entry count + planned file paths)
- deterministic wiki page generation + create/update writes
- story markdown extraction pipeline:
  - deterministic chunking
  - per-chunk LLM extraction
  - strict JSON response validation
  - iterative existing-page state injection between chunks
  - deterministic safe-merge policy
  - preview before apply writes
  - extracted page layout normalization:
    - top `# Title` heading
    - `## Summary` section insertion
    - sectioned body (`## Backstory`/`## Overview`/`## Details` inferred from page key)
  - title sanitization removes type-label prefixes from display title (for example `Character:` / `Location:` / `Faction:`)
- runtime progress reporting:
  - import panel reports parse/build/apply stages and per-file write progress
  - extraction panel reports chunk-by-chunk progress and apply-write progress
  - story-delta panel reports chunk-by-chunk progress and apply-write progress
- lorebook fork reports deterministic completion summary with created note count
- lorebook update is exposed via both commands:
  - `Apply Story Delta to Existing Wiki`
  - `Open Lorebook Update` (alias command)

Current mapping for imported notes:

- title/comment from ST `comment` when present
- `keywords` from ST `key`
- `aliases` from ST `keysecondary`
- summary derived deterministically from entry content and written to `## Summary` section
- tags from defaults + lorebook tag
- note body from ST `content`

Current mapping for imported character cards:

- story note + author note are generated deterministically from rewritten output
- story note frontmatter includes:
  - `authorNote: [[...]]`
  - `sourceType: "sillytavern_character_card_import"`
  - card metadata (`characterCardName`, optional creator/spec/path, tag list)
  - `characterCardMeta: [[...]]` when a synced character-card meta note exists for the selected source card
  - `characterCardAvatar` when source card is an image file (wikilink to source image)
  - selected lorebooks
- story note body includes an embedded avatar image reference (`![[...]]`) when the source card is image-based
- author note frontmatter includes:
  - `lvDocType: "authorNote"`
  - selected lorebooks
  - optional `completionProfile` override when a profile is selected in import panel
- author note body is taken directly from model-provided `authorNoteMarkdown`
  - no hardcoded section template, caps, or structural post-processing
  - steering is prompt-driven; model chooses the most relevant markdown structure
- optional `Extract Character Wiki Page` adds one character-only wiki note:
  - generated from card scenario/context via dedicated extraction pass
  - writes a lorebook-tagged character page under `<target>/characters/<name>.md`
  - includes deterministic frontmatter (`type: "character"`, aliases/keywords/tags, source-card metadata)
  - inserts `## Summary` section using extracted summary or markdown fallback
- character-card preview allows editing planned writes (target path + markdown content) before apply
- optional embedded lorebook import:
  - card `character_book` entries are converted to wiki notes using the same deterministic lorebook-import path/materialization pipeline

Current merge policy (default):

- summary: keep a single best summary candidate (recency-biased, confidence-aware replacement; no `existing | incoming` concatenation)
- keywords/aliases: deterministic union with case-insensitive dedupe
- content: append unique blocks only (normalized-text dedupe)
- story delta update policy:
  - `safe_append`: keep existing metadata for existing notes, append unique updates
  - `structured_merge`: update summary/keywords/aliases and append unique updates
- low-confidence story-delta operations are skipped by default using configurable threshold
- story delta note matching order:
  - explicit/normalized `pageKey`
  - normalized `title`
  - deterministic new-note creation in `New Note Target Folder`
- story delta can use inline markdown or load source markdown from a selected story source note
- source note mode supports deterministic `note`, `chapter`, or `story` expansion from the selected note (with picker support)
- story delta selects existing notes from one or more chosen lorebooks
- story delta preview includes per-change side-by-side source diffs with context windows and omitted-line markers
- story delta preview includes conflict-review rows for update churn with quick decisions (`accept`, `reject`, `keep_both`)
- conflict rows render diff details inline at the decision point (no separate detached diff section)
- story delta preview includes conflict counters and filter controls (`all`, `pending`, `accept`, `reject`, `keep_both`)
- story delta apply persists per-conflict decisions from preview:
  - `accept`: apply planned update
  - `reject`: skip write for that page
  - `keep_both`: keep existing note and write a deterministic companion `*.lorevault-proposed.md`
- story delta apply still supports per-page approval checkboxes and `Apply Selected`
- warns when lorebooks have no included notes or no entries in one section
- actions:
  - `Build/Export` per lorebook
  - `Auditor` per lorebook
  - `Lorebook Auditor` (toolbar)
  - `Query Simulation` (toolbar)
  - `Story Writing Panel` (toolbar)
  - `Cost Analyzer` (toolbar)

## Lorebook Auditor UI

Command: `Open LoreVault Lorebook Auditor`

Capabilities:

- opens a dedicated workspace view with more horizontal space for lorebook auditing
- lorebook selector for switching debug target
- lorebook contents panel with `world_info` entries (keywords, trigger parameters, collapsible content)
- quality audit panel:
  - per-entry risk score (duplicate-like similarity, thin content, missing keywords)
  - similarity-mode banner (`embeddings + heuristics` vs `heuristics only`)
  - embedding-driven nearest-neighbor similarity hints when embeddings are available
  - per-row actions (`Open Entry`, `Open Similar`, `Open Pair`, `Generate Keywords`)
  - bulk keyword generation across selected missing-keyword rows
  - keyword generation opens a review step before writing frontmatter

## Query Simulation UI

Command: `Open LoreVault Query Simulation`

Capabilities:

- dedicated retrieval simulation view separated from routing diagnostics
- multi-lorebook selection (query one or many lorebooks in a single run)
- total token budget split evenly per selected lorebook
- optional override knobs:
  - `maxGraphHops`
  - `graphHopDecay`
  - `includeBacklinksInGraphExpansion`
  - `ragFallbackPolicy` (fallback policy)
  - `ragFallbackSeedScoreThreshold` (fallback seed threshold)
  - `maxWorldInfoEntries`
  - `maxRagDocuments` (max fallback entries)
  - `worldInfoBudgetRatio`
  - `worldInfoBodyLiftEnabled`
  - `worldInfoBodyLiftMaxEntries`
  - `worldInfoBodyLiftTokenCapPerEntry`
  - `worldInfoBodyLiftMinScore`
  - `worldInfoBodyLiftMaxHopDistance`
- per-lorebook selected `world_info` diagnostics:
  - scores
  - graph backlink mode
  - graph path
  - reasons
  - content tiers (including `full_body` lifts)
  - body-lift decision trace (applied/skipped reason per entry)
- per-lorebook selected fallback diagnostics:
  - score
  - matched terms

## Live Query Layer (MVP)

Command: `Continue Story with Context`

Runtime behavior:

- initializes an in-memory context index at plugin load
- subscribes to vault changes (`create`, `modify`, `delete`, `rename`)
- applies debounced near-live refresh for affected lorebooks
- supports full rebuild when settings change or export completes

Query behavior:

- query text source: active editor content up to cursor (last window)
- inline directives source: strict-prefix directives in context markdown (`[LV: ...]`, `<!-- LV: ... -->`)
- lorebook resolution:
  - linked Author Note frontmatter (`lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`)
  - otherwise story note frontmatter (same keys)
  - otherwise no lorebook retrieval is selected
- scoring:
  - `world_info` (primary):
    - deterministic seed detection from keywords/aliases/titles
    - bounded graph expansion over wikilink-derived relations
    - hop-decayed graph scoring with deterministic tie-breaks
    - score factors: seed + graph + constant + order
  - `rag` (secondary/fallback-capable):
    - term overlap in title/path/content
    - optional semantic boost from embeddings
    - long query windows are chunked deterministically for query embedding; chunk vectors are averaged
    - when query embedding calls fail, LoreVault falls back to lexical-only scoring instead of aborting completion
    - default fallback policy is `auto` (used when seed confidence is low or no `world_info` matches are selected)
    - configurable fallback policy: `off|auto|always`
- completion:
  - builds a prompt from lorebook context + recent near-cursor story context
  - stages explicit steering layer for author note (`system`, `pre-history`, `pre-response`)
  - converts inline directives to `<inline_story_directive>` tags in-place so directives stay near related text
  - optionally runs model-driven retrieval hooks (`search_entries`, `expand_neighbors`, `get_entry`) within configured safety limits
  - calls configured completion provider with streaming enabled
  - inserts streamed generated continuation text at cursor
  - active story-text generation can be aborted via `Stop Active Generation` (or editor menu while running)
- deterministic tie-breakers:
  - `world_info`: score desc, hop asc, order desc, uid asc
  - `rag`: score desc, path asc, title asc, uid asc
- explainability metadata per query:
  - seed reasons
  - selected graph path per entry
  - score breakdown factors
  - budget cutoff diagnostics

Token budgeting:

- uses completion context budget (`contextWindowTokens - maxOutputTokens`) and lorebook token budget cap (`defaultLoreBook.tokenBudget`)
- reserves headroom via `promptReserveTokens`
- reserves deterministic per-layer slices for steering/history/retrieval/output based on configured context window
- trims near-cursor story context to keep minimum context capacity
- splits budget between sections (`world_info` 70%, `rag` 30% by default)
- iteratively shrinks per-lorebook context budget if total selected context exceeds input budget
- runs deterministic overflow trimming in fixed layer order and records trim rationale in layer traces
- `world_info` starts at `short` tier, then upgrades to `medium`/`full` if budget remains
- top-scoring entries can be lifted to `full_body` using full note body when budget allows; if not, LoreVault falls back to excerpt lift
- excerpt lift is deterministic lexical paragraph scoring and gains semantic paragraph rerank when embeddings are enabled
- skips entries/documents that would exceed section budget and reports cutoff diagnostics
- context block is used for generation input and is not inserted into the note
- inline directives are parsed and rendered in-place for prompt steering, but excluded from lore exports/summary generation/import-update pipelines

Retrieval tuning settings (applies immediately to live query and generation):

- `RAG Fallback Policy`
- `RAG Auto Fallback Seed Threshold`
- `Max Graph Hops`
- `Graph Hop Decay`
- `Include Backlinks in Graph Expansion`
- `Enable Tool Retrieval Hooks`
- `Tool Calls Per Turn`
- `Tool Result Token Cap`
- `Tool Planning Time Cap (ms)`

LLM operation log settings:

- `Enable LLM Operation Log`
- `LLM Operation Log Path`
- `LLM Operation Log Max Entries`
- `Include Embedding Backend Calls`
- `Open LLM Operation Log Explorer` (settings button + command)

Operation log defaults:

- `Enable LLM Operation Log` is enabled by default.
- `Include Embedding Backend Calls` is enabled by default.
- LoreVault writes one JSONL file per cost profile by suffixing the configured base path.
- default retention is `10000` entries per profile file.

Use command `Open LLM Operation Log Explorer` to inspect/search entries, choose a cost profile, view parsed request messages (with preserved newlines) in expandable textboxes, and open the raw per-profile JSONL file.

## Story Chat Panel

Command: `Open Story Chat`

Current behavior:

- opens a persistent workspace view (non-modal)
- includes an in-chat generation monitor (state, lorebooks, token usage, output progress)
- supports streaming send/stop controls
- shows active conversation title with inline actions:
  - `Open Conversation` (interactive picker)
  - `New Chat`
- exposes device-level Story Chat completion profile selection (`Chat Completion Profile`) independent from Story Writing panel profile selection
- selected chat profile is shared across conversations on the same device and falls back to device/default completion when unset
- stores per-chat context controls:
  - selected lorebooks (add/remove list)
  - author note refs (interactive picker + remove; stored as `note:*` refs)
  - chapter/raw note refs (interactive picker + remove)
  - manual context text
- allows manual-context-only operation by leaving lorebook selection empty
- supports per-message actions:
  - `Edit` past user/assistant messages
  - `Fork Here` to create a new conversation note from any turn
  - `Regenerate` on latest assistant turn (adds a new assistant version)
- allows switching between multiple generated versions of a message; only selected version is used for future context
- renders message content as markdown inside the chat transcript
- assistant message metadata includes the effective completion profile/model used for that turn
- persists each chat/fork as a markdown note under `LoreVault/chat`
- conversation-note format is human-readable (`agent-session` frontmatter + `## User` / `## Model` transcript sections)
- conversation frontmatter stores `completion_preset_id` as a snapshot of the active Story Chat profile when the conversation is saved
- assistant turns store expanded Message Info table rows plus a collapsed `Context Meta` callout containing a fenced `yaml` metadata payload
- legacy JSON code-block conversation notes are not loaded; Story Chat expects `agent-session` notes
- plugin settings persist active conversation path and chat folder
- chat folder path is configurable in settings (`Story Chat Conversation Folder`)
- optional Story Chat tool-calling settings:
  - `Enable Story Chat Tool Calls`
  - `Story Chat Tool Calls Per Turn`
  - `Story Chat Tool Result Token Cap`
  - `Story Chat Tool Planning Time Cap (ms)`
  - `Allow Story Chat Tool Write Actions`

Turn context assembly:

- optional lorebook retrieval for selected lorebooks
- optional Story Chat agent tool layer (when enabled and budget allows):
  - search/read selected lorebook entries
  - search/read linked story and manually selected notes
  - read/update the active note-level author note (selection is implicit)
  - optionally create lorebook notes when write actions are enabled and current turn includes explicit write intent
- optional tool-retrieved context layer (when enabled and budget allows)
- explicit steering layer (author note) plus in-place inline-directive tags
- optional continuity-state layer (plot threads, open loops, canon deltas; no per-chat checkbox UI)
- optional manual context block
- optional specific-note context blocks resolved from note references
- optional author-note context blocks resolved from selected author notes
- recent chat history window
- deterministic context inspector metadata attached to assistant turns:
  - effective completion profile source/id/name and completion model
  - selected lorebooks
  - resolved steering source refs + resolved author-note paths
  - unresolved steering source refs
  - resolved specific note paths
  - unresolved note references
  - chapter memory chapters used for the turn
  - continuity state items included for the turn
  - per-layer context trace (`steering(system/pre_history/pre_response)`, `local_window`, `inline_directives`, `manual_context`, `specific_notes`, `chapter_memory`, `agent_tools`, `graph_memory`, `fallback_entries`, `tool_hooks`)
  - Story Chat agent tool traces (calls, write actions, stop reason)
  - per-layer usage table (`reserved`, `used`, `headroom`, trim flag/reason)
  - overflow trace entries when staged prompt trimming occurs
  - context token estimate
  - selected `world_info` and `rag` item labels

## Inline Story Directives

Goal:

- provide fast in-note story steering without replacing explicit chat/story controls.

Supported syntax (strict-prefix only):

- `[LV: <instruction>]`
- `<!-- LV: <instruction> -->`

Rules:

- only strict-prefix `LV:` directives are parsed for steering
- plain bracket text (for example `[Editor Note: ...]` or `[Make it bigger]`) is treated as normal prose
- directives are converted to `<inline_story_directive>` tags in-place within each prompt context block
- non-`LV:` HTML comments are stripped from staged prompt blocks before request dispatch
- system prompt explicitly tells the model to follow `<inline_story_directive>` tags
- resolved directives are shown in inspector traces before/with generation output
- directives are excluded from lorebook exports and wiki import/update extraction flows

## Technical Deep-Dive

For implementation-level details (module boundaries, retrieval internals, story-thread resolution), see `docs/technical-reference.md`.
For canonical SQLite schema/tables/meta keys, see `docs/sqlite-pack-schema.md`.

# LoreVault Documentation

## Overview

LoreVault compiles Obsidian notes into deterministic context exports.

Current runtime export targets per scope:

- canonical LoreVault SQLite pack (`.db`)
- SillyTavern-style `world_info` JSON
- fallback markdown projection pack

Core scope boundary:

- LoreVault does not provide human book/EPUB/PDF publishing output.
- Human-oriented publishing should be implemented as a companion plugin consuming LoreVault exports.

## Compatibility

- Plugin id: `lore-vault`
- Plugin name: `LoreVault`
- Minimum Obsidian version: `1.1.0`
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

When you run **Build Active Lorebook Scope** or **Build/Export Scope**:

1. Collect all markdown files
2. Resolve lorebook scopes from hierarchical tags
3. Parse frontmatter + markdown body
4. Include notes as canonical lore entries (unless `retrieval: none`)
5. Build wikilink graph for `world_info` entries
6. Compute deterministic `order`
7. Build canonical SQLite pack (`world_info`, fallback docs/chunks/embeddings, source-note metadata, note-level embeddings)
8. Export scoped `world_info` JSON + scoped fallback markdown

## Tag Scoping

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

- `exact`: only notes with matching scope tag are included
- `cascade`: notes in child and parent scopes are included within the same hierarchy branch
- notes with frontmatter `exclude: true` are always skipped
- empty `activeScope`: no configured fallback scope
- export command builds one scope at a time:
  - active file lorebook scope first
  - otherwise configured `activeScope`
- manager view discovers all scopes and provides per-scope build actions

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
- lorebook scope selection (`exact` + `cascade`)
- retrieval routing mode parsing and target resolution
- output path resolution/collision checks
- rag markdown export ordering
- rag chunking determinism
- non-English retrieval/metadata compatibility
- summary precedence behavior (`## Summary` section > `frontmatter` fallback > body/excerpt fallback)

Large-vault profiling command (`npm run profile:large-vault`) provides deterministic synthetic timing baselines for graph build/ranking/query behavior.

## Output Naming Rules

Given configured `Downstream Export Path Pattern` + SQLite output directory:

- SQLite pack file: `<sqliteOutputDir>/<scope-slug>.db` (default: `lorebooks/<scope-slug>.db`)
- world info file: `<sqliteOutputDir>/<downstreamSubpath>.json` (default subpath: `sillytavern/lorevault.json`)
- rag file: `<sqliteOutputDir>/<downstreamSubpath>.rag.md`

Downstream naming:

- if downstream subpath contains `{scope}`: replace token with scope slug
- otherwise append `-<scope-slug>` before extension

SQLite path behavior:

- if SQLite output setting is a directory: write `<dir>/<scope-slug>.db`
- if SQLite output setting is a `.db` file path: append `-<scope-slug>` unless `{scope}` is present
- SQLite output path must be vault-relative (absolute filesystem paths are rejected)
- downstream export subpath/pattern must be vault-relative (absolute filesystem paths are rejected)
- downstream exports are always written under the SQLite scope directory (for example `lorebooks/sillytavern/...`)

Output build fails fast if path collisions are detected.

Export freshness policy (`LoreVault Settings -> SQLite`):

- `manual`: only explicit build actions update exports
- `on_build` (default): exports update when build commands/buttons run
- `background_debounced`: vault edits queue impacted-scope rebuilds after debounce delay
- manager scope cards display per-scope `Last canonical export` timestamp plus humanized relative age (`minutes/hours/days/months ago`)

## Companion Publishing Contract (Phase 10.5)

For downstream publishing tools/plugins:

- Treat SQLite scope packs as canonical inputs.
- Do not re-parse vault markdown when a SQLite scope pack is available.
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
  - canonical scope `.db` under configured SQLite output path
  - ST-style outputs under a subpath of the SQLite root (`sillytavern/...` by default)

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
The same editor menu also exposes note-scoped summary actions when eligible:

- `LoreVault: Insert Inline Directive` for story notes (chapter metadata or `authorNote` link).
- `LoreVault: Run Text Command on Selection` (only when text selection is non-empty).
- `LoreVault: Generate Keywords` for notes with lorebook-scope tags.
- `LoreVault: Generate World Info Summary` for notes with lorebook-scope tags.
- `LoreVault: Rewrite Author Note` for author-note documents.
- `LoreVault: Continue Story with Context` is hidden for author-note documents.

Provider options:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Settings:

- enable/disable completion
- provider, endpoint, api key, model
- reusable model presets (save/update/delete + active preset selection)
- system prompt
- temperature
- max output tokens
- context window tokens
- prompt reserve tokens
- steering layer placement for:
  - author note
  - inline directives
- timeout

Story lorebook scope selection order:

1. Story note frontmatter scope keys (preferred)
2. Author Note frontmatter scope keys (fallback)
3. no implicit scope fallback

Story frontmatter scope keys:

- keys: `lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`
- value format:
  - list: `['universe', 'universe/yggdrasil']`
  - comma-separated string: `universe, universe/yggdrasil`
  - accepts `lorebook/<scope>` and `#lorebook/<scope>` forms
- behavior:
  - values are normalized and deduplicated deterministically
  - each selected scope is queried and combined into completion context
  - completion token budget is split across selected scopes
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
- optional frontmatter lorebook scopes use the same accepted scope keys as story notes
- default creation folder is configurable in settings (`Story Steering -> Author Note Folder`)
- optional `lvDocType: authorNote` frontmatter marks notes as explicit Author Notes
- if multiple story notes link to the same Author Note, rewrite/generation context includes all linked stories

Author Note rewrite behavior:

- rewrite/update focuses on Author Note markdown only
- optional per-run update prompt can steer what should be changed
- rewrite context includes linked story note content, selected lorebook context, and current Author Note
- review modal shows `Current` vs `Proposed` Author Note markdown diff before apply
- optional sanitization mode controls filtering:
  - `strict` (default): filters obvious lorebook-style profile facts (for example static character bios) to reduce duplicated context
  - `off`: keeps raw extracted content

When running `Continue Story with Context`, LoreVault resolves a deterministic story sequence for the active note and injects a bounded chapter-memory block from recent prior chapters before lorebook context.
The chapter-memory window scales deterministically with available chapter-memory budget, so larger context windows include more prior chapters.
Chapter memory uses a rolling summary store (`## Summary` section preferred, `frontmatter summary` fallback, deterministic excerpt final fallback) so repeated generations avoid unnecessary re-parsing.
When enabled, LoreVault can also add a bounded tool-retrieval layer (`<tool_retrieval_context>`) before final generation.

## Text Commands (Selection Rewrite/Reformat)

Command:

- `Run Text Command on Selection`

Editor menu:

- `LoreVault: Run Text Command on Selection` appears only when selected text is non-empty.

Run flow:

1. select editor text
2. open prompt modal
  - choose prompt template from prompt-note files in your configured prompt folder (or custom prompt)
  - optional per-run lorebook-context toggle
3. LoreVault optionally retrieves scoped lore context using selected text as query
4. LoreVault sends prompt + selected text (+ optional context) to completion provider
5. response text is treated as replacement candidate
6. if auto-accept is off, review modal shows original + diff preview before apply
7. selected range is replaced only if selection still matches original text
8. default `Canon Consistency Pass` template emphasizes lorebook factual consistency and only minimal style edits needed to fix canon conflicts

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
- `Generate World Info Summaries (Active Scope)`
- `Generate Chapter Summaries (Current Story)`

Editor context menu behavior:

- keyword generation action appears only when the current note is in a lorebook scope (tag-derived).
- world_info summary action appears only when the current note is in a lorebook scope (tag-derived).
- chapter summary generation is available via command palette and Story Writing panel.

Review/acceptance flow:

1. LoreVault reads note body and builds a constrained summary prompt.
2. Completion provider returns candidate summary.
3. Review modal lets user edit and choose:
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
- chapter summaries are not hard-length capped.
- when a chapter summary contains multiple paragraphs, LoreVault writes it inside:
  - `<!-- LV_BEGIN_SUMMARY -->`
  - `<!-- LV_END_SUMMARY -->`

Settings (LoreVault -> Auto Summaries):

- `Summary Max Input Chars`
- `Summary Max Output Chars`

## Long-Form Chapter Utilities

Commands:

- `Split Active Story Note into Chapter Notes`
- `Split Active Story Note into Chapter Notes (Pick Folder)`
- `Create Next Story Chapter`

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

## Cost Tracking (Experimental, Phase 13)

Current implemented scope:

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
- `Daily Budget Warning (USD)`
- `Session Budget Warning (USD)`
- `Budget by Operation (USD)`
- `Budget by Model (USD)`
- `Budget by Scope (USD)`

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

- lists discovered scopes with deterministic ordering in compact cards
- separates generation monitor from scope actions for clearer layout
- shows counts:
  - included notes
  - `world_info` entries
  - `rag` documents
- generation monitor details:
  - current generation state (`idle|preparing|retrieving|generating|error`)
  - active scopes
  - provider/model
  - context window and token usage
  - selected `world_info` and `rag` items used for the active/last run
- usage/cost monitor details:
  - session/day/week/month/project totals (requests/tokens/known cost/unknown cost count)
  - known cost split (`provider_reported` vs `estimated`)
  - budget warnings from configured daily/session/operation/model/scope limits
- top breakdown lists by operation, model, scope, and cost source

## Story Writing Panel

Command: `Open Story Writing Panel` (persistent right-side workspace panel)

Capabilities:

- active-note writing controls:
  - group 1: `Continue Story` (toggles to `Stop` while generation is running), `Insert Directive` (`<!-- LV: ... -->`)
  - group 2: `Open/Create Author Note`, `Link Author Note` (interactive picker), `Rewrite Author Note`
  - group 3: `Generate Chapter Summary`, `Create Next Chapter`
- Author Note workflow:
  - linked from story frontmatter `authorNote`
  - authored in native Obsidian note editor
  - rewrite flow uses optional change prompt + diff review
  - when an Author Note is active, panel lists linked chapters/stories (chapter-ordered when available)
- lorebook scope controls for active story note:
  - show selected scopes
  - add/remove scopes
  - `All` / `None`
  - writes canonical story-note `lorebooks` key and clears legacy aliases
- generation monitor details:
  - state/status
  - configured provider/model
  - active scopes, token usage, output progress
  - collapsible selected context items (`world_info`, fallback items)
- compact collapsible usage/cost summary:
  - session/day/week/month/project totals
  - warnings when configured budgets are exceeded

## Inbound Wiki Import and Story Extraction (Phase 14)

Commands:

- `Import SillyTavern Lorebook`
- `Extract Wiki Pages from Story`
- `Apply Story Delta to Existing Wiki` (Phase 15 foundation)

Shared panel inputs:

- `Import SillyTavern Lorebook` and `Extract Wiki Pages from Story`:
  - target folder (manual path or Browse picker)
  - default tags
  - lorebook name converted into a lorebook tag using configured `tagPrefix`
- `Apply Story Delta to Existing Wiki`:
  - source story input: inline markdown or `Source Story Note Path` (`Pick Note` / `Use Active Note`)
  - source scope mode: `note` | `chapter` | `story` (deterministic expansion from selected source note)
  - lorebook scope selection list (add/remove scopes to consider for existing-page updates)
  - `New Note Target Folder` (used only for new-note creation)
  - default tags

Implemented now:

- SillyTavern lorebook JSON paste-import panel
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

Current mapping for imported notes:

- title/comment from ST `comment` when present
- `keywords` from ST `key`
- `aliases` from ST `keysecondary`
- summary derived deterministically from entry content and written to `## Summary` section
- tags from defaults + lorebook tag
- note body from ST `content`

Current merge policy (default):

- summary: merge into compact combined summary, persisted in `## Summary` section
- keywords/aliases: deterministic union with case-insensitive dedupe
- content: append unique blocks only (normalized-text dedupe)
- story delta update policy:
  - `safe_append`: keep existing metadata for existing notes, append unique updates
  - `structured_merge`: merge summary/keywords/aliases and append unique updates
- low-confidence story-delta operations are skipped by default using configurable threshold
- story delta note matching order:
  - explicit/normalized `pageKey`
  - normalized `title`
  - deterministic new-note creation in `New Note Target Folder`
- story delta can use inline markdown or load source markdown from a selected story source note
- source note mode supports deterministic `note`, `chapter`, or `story` expansion from the selected note (with picker support)
- story delta selects existing notes from one or more chosen lorebook scopes
- story delta preview includes per-change dry-run diff snippets (`+`/`-` line summary + collapsed preview block)
- story delta preview includes conflict-review rows for update churn with quick decisions (`accept`, `reject`, `keep_both`)
- story delta preview includes conflict counters and filter controls (`all`, `pending`, `accept`, `reject`, `keep_both`)
- story delta apply persists per-conflict decisions from preview:
  - `accept`: apply planned update
  - `reject`: skip write for that page
  - `keep_both`: keep existing note and write a deterministic companion `*.lorevault-proposed.md`
- story delta apply still supports per-page approval checkboxes and `Apply Selected`
- warns when scopes have no included notes or no entries in one section
- actions:
  - `Build/Export` per scope
  - `Open Auditor` per scope
  - `Open Lorebook Auditor` (toolbar)
  - `Open Query Simulation` (toolbar)

## Lorebook Auditor UI

Command: `Open LoreVault Lorebook Auditor`

Capabilities:

- opens a dedicated workspace view with more horizontal space for lorebook auditing
- scope selector for switching debug target
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
- multi-scope selection (query one or many lorebooks in a single run)
- total token budget split evenly per selected scope
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
- per-scope selected `world_info` diagnostics:
  - scores
  - graph backlink mode
  - graph path
  - reasons
  - content tiers (including `full_body` lifts)
  - body-lift decision trace (applied/skipped reason per entry)
- per-scope selected fallback diagnostics:
  - score
  - matched terms

## Live Query Layer (MVP)

Command: `Continue Story with Context`

Runtime behavior:

- initializes an in-memory context index at plugin load
- subscribes to vault changes (`create`, `modify`, `delete`, `rename`)
- applies debounced near-live refresh for affected scopes
- supports full rebuild when settings change or export completes

Query behavior:

- query text source: active editor content up to cursor (last window)
- inline directives source: strict-prefix directives in near-cursor editor window (`[LV: ...]`, `<!-- LV: ... -->`)
- scope resolution:
  - story note frontmatter (`lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`)
  - otherwise linked Author Note frontmatter (same keys)
  - otherwise no lorebook retrieval scopes are selected
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
  - builds a prompt from scope context + recent near-cursor story context
  - stages explicit steering layers (author note + inline directives)
  - steering placement is configurable for author note + inline directives (`system`, `pre-history`, `pre-response`)
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
- iteratively shrinks per-scope context budget if total selected context exceeds input budget
- runs deterministic overflow trimming in fixed layer order and records trim rationale in layer traces
- `world_info` starts at `short` tier, then upgrades to `medium`/`full` if budget remains
- top-scoring entries can be lifted to `full_body` using full note body when budget allows; if not, LoreVault falls back to excerpt lift
- excerpt lift is deterministic lexical paragraph scoring and gains semantic paragraph rerank when embeddings are enabled
- skips entries/documents that would exceed section budget and reports cutoff diagnostics
- context block is used for generation input and is not inserted into the note
- inline directives are parsed for steering but excluded from lore exports/summary generation/import-update pipelines

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

When enabled, LoreVault writes full LLM request/response content (including tool planner calls) to the configured JSONL file.
When `Include Embedding Backend Calls` is enabled, LoreVault also writes embedding provider calls with `kind: embedding`.
Use command `Open LLM Operation Log Explorer` to inspect/search entries, view parsed request messages (with preserved newlines) in expandable textboxes, and open full raw request/response payload JSON inside the plugin.

## Story Chat Panel

Command: `Open Story Chat`

Current behavior:

- opens a persistent workspace view (non-modal)
- includes an in-chat generation monitor (state, scopes, token usage, output progress)
- supports streaming send/stop controls
- shows active conversation title with inline actions:
  - `Open Conversation` (interactive picker)
  - `New Chat`
- stores per-chat context controls:
  - selected lorebook scopes (add/remove list)
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
- persists each chat/fork as a markdown note under `LoreVault/chat`
- conversation-note format is human-readable (`agent-session` frontmatter + `## User` / `## Model` transcript sections)
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

- optional lorebook retrieval for selected scopes
- optional Story Chat agent tool layer (when enabled and budget allows):
  - search/read selected lorebook entries
  - search/read linked story and manually selected notes
  - read/update the active note-level author note (scope is implicit)
  - optionally create lorebook notes when write actions are enabled and current turn includes explicit write intent
- optional tool-retrieved context layer (when enabled and budget allows)
- explicit steering layers (author note, inline directives)
- optional continuity-state layer (plot threads, open loops, canon deltas; no per-chat checkbox UI)
- optional manual context block
- optional specific-note context blocks resolved from note references
- optional author-note context blocks resolved from selected author notes
- recent chat history window
- deterministic context inspector metadata attached to assistant turns:
  - selected scopes
  - resolved steering source refs + resolved author-note paths
  - unresolved steering source refs
  - resolved specific note paths
  - unresolved note references
  - chapter memory summaries used for the turn
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
- directives are parsed from active-story near-cursor context only
- directives are injected into a dedicated steering layer (not mixed into lore retrieval layers)
- system prompt explicitly tells the model to follow injected inline directives
- directive placement is configurable with other steering layers (`system` / `pre-history` / `pre-response`)
- resolved directives are shown in inspector traces before/with generation output
- directives are excluded from lorebook exports and wiki import/update extraction flows
- per-turn caps are enforced for directive count and token usage

## Technical Deep-Dive

For implementation-level details (module boundaries, retrieval internals, story-thread resolution), see `docs/technical-reference.md`.
For canonical SQLite schema/tables/meta keys, see `docs/sqlite-pack-schema.md`.

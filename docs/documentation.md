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
- Minimum Obsidian version: `0.15.0`
- Desktop only (`isDesktopOnly: true`)

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
7. Build canonical SQLite pack (`world_info`, fallback docs/chunks/embeddings)
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
- overridden by the first paragraph under `## Summary` when present
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
- downstream exports are always written under the SQLite scope directory (for example `lorebooks/sillytavern/...`)
- absolute downstream subpaths are normalized to file basename under SQLite root

Output build fails fast if path collisions are detected.

## Companion Publishing Contract (Phase 10.5)

For downstream publishing tools/plugins:

- Treat SQLite scope packs as canonical inputs.
- Do not re-parse vault markdown when a SQLite scope pack is available.
- Stable core tables for downstream consumption:
  - `world_info_entries`
  - `rag_documents`
  - `rag_chunks`
  - `rag_chunk_embeddings`
- Deterministic order guarantees:
  - `world_info_entries`: `order_value DESC, uid ASC`
  - `rag_documents`: `path ASC, title ASC, uid ASC`
  - `rag_chunks`: `path ASC, chunk_index ASC`
- Stable downstream export roots:
  - canonical scope `.db` under configured SQLite output path
  - ST-style outputs under a subpath of the SQLite root (`sillytavern/...` by default)

SQLite pack metadata:

- counts and generation metadata are stored in `meta` table:
  - `schema_version`
  - `scope`
  - `generated_at`
  - `world_info_entries_count`
  - `rag_documents_count`
  - `rag_chunks_count`
  - `rag_chunk_embeddings_count`

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
Also available in markdown editor right-click menu as `LoreVault: Continue Story with Context`.
The same editor menu also exposes note-scoped summary actions when eligible:

- `LoreVault: Run Text Command on Selection` (only when text selection is non-empty).
- `LoreVault: Generate World Info Summary` for notes with lorebook-scope tags.
- `LoreVault: Generate Chapter Summary` for notes with story/chapter frontmatter.

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
- timeout

Story frontmatter scope override:

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

Long-form story metadata (new):

- `storyId`: stable story thread identifier
- `chapter`: chapter/scene index (numeric)
- `chapterTitle`: optional chapter display title
- `previousChapter` / `prevChapter`: optional links/paths to prior chapter notes
- `nextChapter`: optional links/paths to following chapter notes

When running `Continue Story with Context`, LoreVault resolves a deterministic story thread for the active note and injects a bounded chapter-memory block from recent prior chapters before lorebook context.
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
  - choose prompt template from stored collection (or custom prompt)
  - optional per-run lorebook-context toggle
3. LoreVault optionally retrieves scoped lore context using selected text as query
4. LoreVault sends prompt + selected text (+ optional context) to completion provider
5. response text is treated as replacement candidate
6. if auto-accept is off, review modal shows original + diff preview before apply
7. selected range is replaced only if selection still matches original text

Settings (LoreVault -> Text Commands):

- `Auto-Accept Text Command Edits` (default off)
- `Include Lorebook Context by Default`
- `Text Command Context Token Budget`
- `Text Command System Prompt`
- `Text Command Prompt Collection (JSON)` with `Save Collection` and `Load Defaults`

## Auto Summary Workflows (Phase 9)

Commands:

- `Generate World Info Summary (Active Note)`
- `Generate Chapter Summary (Active Note)`
- `Generate World Info Summaries (Active Scope)`
- `Generate Chapter Summaries (Current Story)`

Editor context menu behavior:

- world_info summary action appears only when the current note is in a lorebook scope (tag-derived).
- chapter summary action appears only when the current note resolves as a story/chapter note from frontmatter.

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
  - first paragraph under `## Summary`
  - frontmatter `summary` (fallback)
  - note body
- chapter memory:
  - first paragraph under `## Summary`
  - frontmatter `summary` (fallback)
  - deterministic excerpt fallback

Settings (LoreVault -> Auto Summaries):

- `Summary Max Input Chars`
- `Summary Max Output Chars`

## Cost Tracking (Experimental, Phase 13)

Current implemented scope:

- completion and summary requests capture usage when provider payload includes token usage
- records are written to a local usage ledger JSON file
- cost calculation uses:
  - provider-reported cost when available
  - fallback estimate from configured input/output USD-per-1M rates
  - `unknown` when neither is available

Settings:

- `Enable Cost Tracking`
- `Usage Ledger Path`
- `Default Input Cost / 1M Tokens (USD)`
- `Default Output Cost / 1M Tokens (USD)`
- `Usage Report Output Directory`
- `Daily Budget Warning (USD)`
- `Session Budget Warning (USD)`

Ledger default path:

- `.obsidian/plugins/lore-vault/cache/usage-ledger.json`

Each record contains deterministic fields:

- timestamp
- operation (`summary_world_info`, `summary_chapter`, `story_chat_turn`, `editor_continuation`)
- provider/model
- prompt/completion/total tokens
- reported/estimated cost and cost source
- operation metadata

Report exports:

- `Export Usage Report (JSON)`
- `Export Usage Report (CSV)`

JSON export includes snapshot totals + full ledger entries.
CSV export includes deterministic row order and metadata JSON column.

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
  - session/day/project totals (requests/tokens/known cost/unknown cost count)
  - budget warnings from configured daily/session limits
- top breakdown lists by operation and model

## Inbound Wiki Import and Story Extraction (Phase 14)

Commands:

- `Import SillyTavern Lorebook`
- `Extract Wiki Pages from Story`
- `Apply Story Delta to Existing Wiki` (Phase 15 foundation)

Shared panel inputs:

- target folder (manual path or Browse picker)
- default tags
- lorebook name converted into a lorebook tag using configured `tagPrefix`

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
  - deterministic new-note creation in target folder
- story delta can use inline markdown or load source markdown from a story note path
- story delta supports optional scope-tag filter when selecting existing notes from target folder
- story delta preview includes per-change dry-run diff snippets (`+`/`-` line summary + collapsed preview block)
- story delta apply supports per-change approval checkboxes and `Apply Selected`
- warns when scopes have no included notes or no entries in one section
- actions:
  - `Build/Export` per scope
  - `Inspect Routing` per scope
  - `Open Routing Debug` (toolbar)
  - `Open Query Simulation` (toolbar)

## Routing Debug UI

Command: `Open LoreVault Routing Debug`

Capabilities:

- opens a dedicated workspace view with more horizontal space for routing diagnostics
- scope selector for switching debug target
- lorebook contents panel with `world_info` entries (keywords, trigger parameters, collapsible content)
- full inclusion/routing table for selected scope:
  - note path
  - inclusion/exclusion reason
  - retrieval mode and keyword presence
  - resolved route (`world_info`, `rag`, both, or none)
  - detected lorebook scopes

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
  - `ragFallbackPolicy`
  - `ragFallbackSeedScoreThreshold`
  - `maxWorldInfoEntries`
  - `maxRagDocuments`
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
- per-scope selected `rag` diagnostics:
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
- scope resolution:
  - first lorebook scope tag on active file, if present
  - otherwise configured `activeScope`
  - otherwise first discovered scope
- scoring:
  - `world_info` (primary):
    - deterministic seed detection from keywords/aliases/titles
    - bounded graph expansion over wikilink-derived relations
    - hop-decayed graph scoring with deterministic tie-breaks
    - score factors: seed + graph + constant + order
  - `rag` (secondary/fallback-capable):
    - term overlap in title/path/content
    - optional semantic boost from embeddings
    - default fallback policy is `auto` (used when seed confidence is low or no `world_info` matches are selected)
    - configurable fallback policy: `off|auto|always`
- completion:
  - builds a prompt from scope context + recent story window
  - optionally runs model-driven retrieval hooks (`search_entries`, `expand_neighbors`, `get_entry`) within configured safety limits
  - calls configured completion provider with streaming enabled
  - inserts streamed generated continuation text at cursor
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
- trims story window to keep minimum context capacity
- splits budget between sections (`world_info` 70%, `rag` 30% by default)
- iteratively shrinks per-scope context budget if total selected context exceeds input budget
- `world_info` starts at `short` tier, then upgrades to `medium`/`full` if budget remains
- top-scoring entries can be lifted to `full_body` using full note body when budget allows; if not, LoreVault falls back to excerpt lift
- excerpt lift is deterministic lexical paragraph scoring and gains semantic paragraph rerank when embeddings are enabled
- skips entries/documents that would exceed section budget and reports cutoff diagnostics
- context block is used for generation input and is not inserted into the note

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

## Story Chat Panel

Command: `Open Story Chat`

Current behavior:

- opens a persistent workspace view (non-modal)
- includes an in-chat generation monitor (state, scopes, token usage, output progress)
- supports streaming send/stop controls
- shows a conversation dropdown and supports creating new chats inline
- stores per-chat context controls:
  - selected lorebook scopes
  - `Use Lorebook Context` toggle
  - manual context text
  - specific notes list managed by note picker (`Add Note` / `Add Active` / remove per item)
- allows manual-context-only operation by disabling lorebook context or selecting no scopes
- supports per-message actions:
  - `Edit` past user/assistant messages
  - `Fork Here` to create a new conversation note from any turn
  - `Regenerate` on latest assistant turn (adds a new assistant version)
- allows switching between multiple generated versions of a message; only selected version is used for future context
- persists each chat/fork as a markdown note under `LoreVault/chat`
- plugin settings persist active conversation path and chat folder
- chat folder path is configurable in settings (`Story Chat Conversation Folder`)

Turn context assembly:

- optional lorebook retrieval for selected scopes
- optional tool-retrieved context layer (when enabled and budget allows)
- optional manual context block
- optional specific-note context blocks resolved from note references
- recent chat history window
- deterministic context inspector metadata attached to assistant turns:
  - selected scopes
  - resolved specific note paths
  - unresolved note references
  - chapter memory summaries used for the turn
  - per-layer context trace (`local_window`, `manual_context`, `specific_notes`, `chapter_memory`, `graph_memory`, `fallback_rag`, `tool_hooks`)
  - context token estimate
  - selected `world_info` and `rag` item labels

## Technical Deep-Dive

For implementation-level details (module boundaries, SQLite metadata schema, retrieval internals, story-thread resolution), see `docs/technical-reference.md`.

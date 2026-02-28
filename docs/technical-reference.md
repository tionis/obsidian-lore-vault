# LoreVault Technical Reference

This document is the implementation-level reference for core architecture and runtime behavior.

## Core Runtime Components

- `src/main.ts`
  - plugin lifecycle
  - command/ribbon registration
  - export pipeline orchestration
  - completion orchestration
  - story-chat turn orchestration
  - vault-backed LLM operation log persistence (`operationLog` settings) + explorer-view refresh hooks
- `src/live-context-index.ts`
  - near-live scope indexing
  - scope pack rebuild strategy
  - per-query context assembly dispatch
- `src/context-query.ts`
  - graph-first `world_info` retrieval
  - optional/fallback entry retrieval over the same canonical lore-entry set
  - token budgeting and tiering
  - explainability artifacts
- `src/retrieval-tool-hooks.ts`
  - model-driven retrieval tool loop (`search_entries`, `expand_neighbors`, `get_entry`)
  - deterministic local tool execution and context rendering
  - per-turn safety limits (calls/tokens/time)
- `src/completion-provider.ts`
  - completion adapters (OpenRouter/Ollama/OpenAI-compatible)
  - generic OpenAI-style tool planner helper used by retrieval hooks and Story Chat agent tools
  - per-call operation log emission hooks (full request/response payloads + errors + aborts)
- `src/scope-pack-builder.ts`
  - deterministic note processing
  - graph ranking
  - fallback chunk generation
  - optional embeddings
- `src/story-chat-view.ts` + `src/story-chat-document.ts`
  - persistent chat UI
  - note-backed conversation persistence
  - message versions/regeneration/forking
- `src/story-steering.ts` + `src/story-steering-view.ts`
  - scope-based steering storage (`global`/`story`/`chapter`/`note`)
  - compatibility alias for legacy `thread` scope files/keys
  - per-scope `activeLorebooks` list used as primary scope selection source for continuation
  - move-safe scope linking via `lvNoteId` frontmatter IDs
  - legacy path-keyed note/chapter scope migration to ID-keyed scope files
  - LLM-assisted steering update flow with optional per-run update prompt
  - extraction source modes: active note body or near-cursor editor context (text-before-cursor, note-body fallback)
  - extraction sanitization mode (`strict` vs `off`) for lorebook-fact filtering
  - markdown-backed steering note parse/serialize
  - effective-layer merge for chat/continuation prompt assembly
- `src/lorebook-scope-cache.ts`
  - shared metadata/scope cache reused by manager/steering/auditor UI
  - explicit invalidation on vault and settings mutations
- `src/story-steering-review-modal.ts`
  - review/edit approval modal for LLM-proposed steering updates
  - field-level `Current` (read-only) vs `Proposed` (editable) comparison layout
- `src/lorebooks-routing-debug-view.ts`
  - scope inclusion/routing diagnostics
  - world_info content inspection
  - quality-audit table + keyword-generation actions
- `src/lorebooks-query-simulator-view.ts`
  - multi-scope retrieval simulation
  - retrieval knob overrides for debugging/tuning
- `src/story-thread-resolver.ts`
  - story/chapter metadata parsing
  - deterministic thread ordering (metadata + prev/next links)
- `src/chapter-summary-store.ts`
  - rolling chapter-summary cache (`## Summary` section -> frontmatter fallback -> excerpt fallback)
- `src/summary-utils.ts`
  - summary normalization and world_info content resolution
- `src/inline-directives.ts`
  - strict-prefix inline directive parse/strip helpers (`[LV: ...]`, `<!-- LV: ... -->`)
- `src/prompt-staging.ts`
  - deterministic prompt-segment budgeting
  - fixed-order overflow trimming with locked-layer protection
  - per-layer usage/headroom metadata helpers
- `src/summary-review-modal.ts`
  - review/approval UI for generated summary candidates
- `src/hash-utils.ts`
  - deterministic hashing and identifier normalization (`@noble/hashes` sync + WebCrypto async)
  - `sha256HexAsync` requires WebCrypto (`crypto.subtle`) at runtime
- `src/scope-pack-metadata.ts`
  - deterministic scope-pack metadata snapshot/signature assembly
  - note-level embedding centroid derivation from chunk embeddings
  - canonical SQLite `meta` row generation/content signatures
- `src/quality-audit.ts`
  - deterministic per-entry risk scoring (missing keywords, thin content, embedding similarity)
- `src/keyword-utils.ts`
  - keyword model-output parsing and deterministic frontmatter keyword upsert helpers
- `src/text-command-modal.ts`
  - prompt/template selection modal for selection rewrite commands
- `src/text-command-review-modal.ts` + `src/text-command-diff.ts`
  - diff preview + review/apply flow for selection edits
- `src/cost-utils.ts`
  - usage-cost estimation helpers (`provider_reported` vs `estimated` vs `unknown`)
- `src/usage-ledger-store.ts`
  - persistent usage ledger storage with deterministic entry shape/order
- `src/usage-ledger-report.ts`
  - deterministic aggregation/snapshot + CSV serialization
- `src/sillytavern-import.ts`
  - deterministic ST lorebook parse + wiki note materialization + apply writes
- `src/lorevault-import-view.ts`
  - import panel UI (`Import SillyTavern Lorebook`)
- `src/lorevault-story-extract-view.ts`
  - extraction panel (`Extract Wiki Pages from Story`) with preview/apply flow
- `src/story-extraction.ts`
  - deterministic chunking
  - per-chunk extraction prompt/validation
  - iterative merge pipeline and final page rendering
- `src/lorevault-story-delta-view.ts`
  - story delta update panel (`Apply Story Delta to Existing Wiki`) with preview/apply flow
  - conflict review rows + decision persistence (`accept`/`reject`/`keep_both`)
- `src/lorevault-operation-log-view.ts` + `src/operation-log.ts`
  - operation-log explorer UI (`Open LLM Operation Log Explorer`)
  - JSONL parsing/coercion with malformed-line diagnostics
  - filter/search and full payload inspection for completion/planner calls
- `src/story-delta-update.ts`
  - deterministic chunked delta extraction
  - low-confidence gating
  - existing page matching and idempotent merge planning
  - deterministic conflict extraction from update diff churn

## Export Pipeline Contract

Per scope, LoreVault writes:

- canonical SQLite pack: `<scope>.db`
- downstream world info JSON
- downstream fallback markdown projection

Storage contract:

- SQLite export/read paths are vault-relative and use Obsidian adapter binary IO.
- Absolute filesystem export paths are intentionally rejected.
- export freshness policy supports `manual`, `on_build`, and `background_debounced` with impacted-scope rebuild queueing in background mode.

Canonicality:

- SQLite is the source of truth for downstream tooling.
- Downstream exporters should consume SQLite artifacts rather than vault markdown.

### SQLite Schema

Canonical schema documentation lives in:

- `docs/sqlite-pack-schema.md`

Highlights:

- canonical lore data tables:
  - `world_info_entries`
  - `rag_documents`
  - `rag_chunks`
  - `rag_chunk_embeddings`
  - `source_notes`
  - `note_embeddings`
- deterministic ordering contract per table
- rich `meta` keys for schema/build/settings/content signatures
- embeddings included at chunk and note levels for downstream reuse

## Retrieval Engine

### World Info (Primary)

Implemented in `src/context-query.ts`.

Flow:

1. detect seed matches from:
  - `key` / `keywords`
  - aliases (`keysecondary` when present)
  - entry comment/title token and phrase matches
  - Unicode-aware tokenization (non-English keywords/titles are supported)
2. build deterministic adjacency graph from wikilink-normalized relations
  - optional backlink-aware reverse expansion can be enabled in retrieval settings
3. run bounded hop expansion from seeds
4. apply hop decay and accumulate score factors
5. rank with deterministic tie-breaks:
  - `score DESC`
  - `hopDistance ASC`
  - `entry.order DESC`
  - `uid ASC`

Score factors:

- `seed`
- `graph`
- `constant`
- `order`

Default graph-priority weights are tuned and regression-locked by representative fixtures:

- fixture: `fixtures/graph/default-weights-representative.json`
- test: `tests/default-weights-calibration.test.ts`

Explainability includes:

- seed reasons
- selected path (`uid -> uid -> ...`)
- per-entry score breakdown
- budget cutoff diagnostics

### Fallback Retrieval (Secondary)

Fallback retrieval remains available and configurable.

Fallback policy (`settings.retrieval.ragFallbackPolicy`):

- `off`
- `auto`
- `always`

`auto` uses `ragFallbackSeedScoreThreshold` and no/weak seed selection heuristics.

Fallback ranking:

- lexical score over entry title/path/content projections
- optional semantic boost from embeddings cache/chunk vectors
- optional semantic paragraph reranking for world_info body excerpt fallback
- deterministic tie-breaks: `score DESC`, then `path/title/uid`

### Tool Retrieval Hooks (Optional Advanced Layer)

Tool-driven retrieval is opt-in (`settings.retrieval.toolCalls.enabled`) and executed after graph/fallback assembly with remaining budget.

Available hooks:

- `search_entries`: lexical lookup over `world_info` titles/keywords/content
- `expand_neighbors`: bounded wikilink-neighbor expansion from a seed entry
- `get_entry`: targeted fetch by `uid` (+ optional scope)

Execution model:

- completion provider is used as planner (`tool_choice=auto`) for OpenAI-compatible providers
- planner emits tool calls
- LoreVault executes calls locally over deterministic scope catalogs
- selected entries are rendered into a bounded `Tool Retrieval Context` block

Hard limits per turn:

- `maxCallsPerTurn`
- `maxResultTokensPerTurn`
- `maxPlanningTimeMs`

If a limit is reached, tool loop stops deterministically and trace output records stop reason.

### Story Chat Agent Tool Layer (Optional)

Story Chat has a separate bounded tool loop (`settings.storyChat.toolCalls.*`) that runs before final chat response generation.

Available tools:

- lorebook read/search (selected scopes only):
  - `search_lorebook_entries`
  - `get_lorebook_entry`
- linked-story/manual-note read/search:
  - `search_story_notes`
  - `read_story_note`
- steering scope read/update (active scope chain only):
  - `get_steering_scope`
  - `update_steering_scope`
- optional lorebook note creation:
  - `create_lorebook_entry_note`

Boundary contract:

- no whole-vault traversal; tools are restricted to:
  - selected lorebook scopes
  - linked story note set (story thread + manually selected note refs)
  - steering scopes in active-note chain (`global`/`story`/`chapter`/`note`)
- write tools require:
  - `settings.storyChat.toolCalls.allowWriteActions = true`
  - explicit write intent in current user turn (deterministic heuristic gate)

Turn metadata contract:

- tool loop traces, call summaries, and write summaries are persisted in assistant turn `contextMeta`
- context inspector renders these as separate rows (`chat tools: calls/writes`, `chat tool trace`)

## Budgeting and Content Tiering

`world_info` and fallback budgets are split from the per-query token budget.

World info tiering:

- initial inclusion at `short`
- opportunistic upgrade to `medium`
- opportunistic upgrade to `full`
- high-score entries first try `full_body` lift with full note body when budget allows
- if full note body does not fit, lift falls back to deterministic excerpt selection
- excerpt selection uses lexical paragraph scoring and optional embedding-based semantic paragraph boosts
- upgrades only occur when budget permits
- body-lift explainability records per-entry decision status (`applied` / specific skip reason)

Budget diagnostics:

- dropped-by-budget count
- dropped-by-limit count
- dropped entry UIDs

## Long-Form Story Memory

### Frontmatter Schema

Supported keys (case-insensitive normalization):

- `storyId`
- `chapter`
- `chapterTitle`
- `previousChapter` / `prevChapter` / `previous` / `prev`
- `nextChapter` / `next`

### Thread Resolution

`src/story-thread-resolver.ts`:

- parses story nodes from frontmatter
- scopes by `storyId`
- applies deterministic ordering by:
  - explicit chapter index where available
  - prev/next edge constraints
  - stable path tie-breaks

If graph order is incomplete/cyclic, resolver falls back to deterministic chapter/path ordering.

### Chapter Memory Injection

`src/main.ts` (`continueStoryWithContext`, `runStoryChatTurn`):

- resolves current note thread
- selects bounded prior chapters
- resolves snippets through rolling chapter summary cache/store
  - prefers `## Summary` section
  - then frontmatter `summary`
  - then deterministic body-head excerpt
- injects `<story_chapter_memory>` block before lorebook context in continuation and chat prompts

This provides a dedicated chapter-memory layer before graph retrieval.

## Auto Summary Internals (Phase 9)

Generation entrypoints in `src/main.ts`:

- `Generate World Info Summary (Active Note)`
- `Generate Chapter Summary (Active Note)`
- `Generate World Info Summaries (Active Scope)`
- `Generate Chapter Summaries (Current Story)`

Flow:

1. read note body (`stripFrontmatter`)
2. build constrained prompt with summary mode (`world_info` or `chapter`)
3. call completion provider (non-stream request)
4. normalize summary text (single paragraph, capped length)
5. show review modal with edit + accept options
6. write accepted summary into note `## Summary` section
7. request index/view refresh and chapter-summary cache invalidation for affected note

Precedence contract:

- world_info entry content: first paragraph under `## Summary` -> `frontmatter summary` fallback -> note body
- chapter memory summary: first paragraph under `## Summary` -> `frontmatter summary` fallback -> deterministic excerpt

## Text Command Internals

Entrypoints in `src/main.ts`:

- command: `Run Text Command on Selection`
- editor menu action: `LoreVault: Run Text Command on Selection`

Flow:

1. capture selected editor range + source text
2. open prompt modal (`src/text-command-modal.ts`)
3. optionally retrieve lore context (scope/frontmatter resolution mirrors continuation behavior)
4. call completion provider with text-command system prompt + user prompt payload
5. optionally record usage ledger entry (`operation = text_command_edit`)
6. if auto-accept disabled, open review modal with unified diff preview (`src/text-command-review-modal.ts`)
7. apply replacement only when selection still matches captured source text

Settings contract (`ConverterSettings.textCommands`):

- `autoAcceptEdits` (default false)
- `defaultIncludeLorebookContext`
- `maxContextTokens`
- `systemPrompt`
- `promptsFolder` (markdown prompt-note directory)

Prompt note frontmatter contract (per note in `promptsFolder`):

- `promptKind: text_command` (or `textcommand`)
- `title`/`name` (optional display name)
- `id` (optional stable template id)
- `includeLorebookContext: true|false` (default from settings)

## Story Chat Persistence

Conversation persistence is note-backed in `storyChat.chatFolder`.

Stored structure:

- conversation metadata
- per-conversation steering fields (pinned instructions, story notes, scene intent)
- per-conversation continuity state (plot threads, open loops, canon deltas, inclusion toggles)
- per-turn messages
- message versions with active version selector
- optional context inspector metadata on assistant versions (including agent tool traces/calls/writes)

Parsing and serialization logic is centralized in `src/story-chat-document.ts` and covered by tests.

## Inline Directive Contract

Inline steering directives are implemented as an optional shorthand layer for generation/chat.

Accepted directive forms:

- bracket directive: `[LV: <instruction>]`
- html comment directive: `<!-- LV: <instruction> -->`

Parser and staging constraints (implemented):

- only strict-prefix `LV:` directives are parsed
- extraction scope is active story note near-cursor window (not whole-vault scans)
- deterministic parse order follows source document order
- stable dedupe normalization is applied before prompt staging
- parsed directives are injected as a dedicated steering layer with inspector trace visibility
- per-turn caps are enforced for directive count and token budget
- directive layer placement follows configured completion placement policy (`system`, `pre_history`, `pre_response`)

Exclusion constraints:

- directive markers/content must be excluded from:
  - lorebook export artifacts
  - summary extraction/generation source text
  - story extraction and story-delta wiki update source payloads

Testing contract:

- fixture coverage for directive parsing variants
- deterministic ordering/dedupe assertions
- inspector layer visibility assertions
- exclusion assertions for export/import/update pipelines

## In-Plugin User Documentation

Embedded docs view:

- view id: `lorevault-help-view`
- file: `src/lorevault-help-view.ts`
- command: `Open LoreVault Help`
- settings shortcut button: `Open LoreVault Help`

This is the primary user-facing in-plugin guide for command flow and feature behavior.

## Cost Tracking (Phase 13)

Implemented scope:

- completion provider usage capture hooks for:
  - active-note continuation stream
  - story chat stream
  - summary generation requests
- usage metadata recorded when provider response includes token usage fields
- optional ledger persistence (`settings.costTracking.enabled`)
- fallback USD estimation via configured per-million token rates
- optional per-model pricing overrides (`provider + wildcard model pattern`)
- manager panel usage/cost monitor (session/day/project totals + warnings + top breakdowns)
- usage report export commands:
  - `Export Usage Report (JSON)`
  - `Export Usage Report (CSV)`

Core contracts:

- ledger path defaults to `.obsidian/plugins/lore-vault/cache/usage-ledger.json`
- usage report output dir defaults to `.obsidian/plugins/lore-vault/reports`
- record fields are normalized and sorted deterministically on persist
- cost source is explicit per record:
  - `provider_reported`
  - `estimated`
  - `unknown`
- pricing provenance is explicit per record:
  - `pricingSource` (`provider_reported` | `model_override` | `default_rates` | `none`)
  - `pricingRule` (matched override/default rule label)
  - `pricingSnapshotAt` (normalized timestamp when rate snapshot was taken)
- effective estimate rates are stored per row:
  - `inputCostPerMillionUsd`
  - `outputCostPerMillionUsd`
- day rollups use UTC day boundaries
- report warnings support budgets at:
  - global day/session
  - operation
  - provider:model
  - lorebook scope
- report CSV row ordering is deterministic (`timestamp ASC`, `id ASC`)

Current non-goals in this phase:

- provider pricing auto-sync

## LLM Operation Log

Optional debugging surface (`settings.operationLog.*`):

- `enabled`: toggles persistence
- `path`: vault-relative JSONL log file
- `maxEntries`: retention cap (oldest entries trimmed deterministically by file order)

Captured records include:

- completion calls (`requestStoryContinuation`)
- streaming completion calls (`requestStoryContinuationStream`)
- completion tool-planner calls (`createCompletionToolPlanner`)

Each record stores:

- operation metadata (id, kind, operation name, provider/model, timing, status/abort)
- full request payload content (messages/tool definitions)
- attempt-level request/response payloads and errors
- final text output (when available)
- parsed usage report (when available)

Explorer surface:

- command: `Open LLM Operation Log Explorer`
- view type: `lorevault-operation-log-view`
- reads/parses the configured JSONL path, shows malformed line diagnostics, and supports text/status/kind filters
- per-entry inspection includes parsed request message/tool sections (newline-preserving textboxes), attempt payloads/responses/errors, final output text, and normalized record JSON

## Phase 14 Import/Extraction (Current Progress)

Implemented:

- inbound SillyTavern lorebook JSON import command/view
- deterministic entry normalization and sorting
- deterministic file naming/path allocation
- deterministic frontmatter/body mapping for generated wiki pages (summary persisted in `## Summary` section)
- preview and apply import flows
- story extraction command/view with preview/apply workflow
- deterministic chunking and per-chunk schema-constrained extraction
- iterative existing-page state injection between chunks
- deterministic merge behavior (summary merge, set unions, unique content append)
- merged story summaries are written to note `## Summary` sections (legacy frontmatter summary treated as fallback input)

## Phase 15 Story Delta Updates (Current Progress)

Implemented:

- story-delta command/view (`Apply Story Delta to Existing Wiki`)
- source story input from inline markdown or note path
- deterministic target-page loading from folder with optional scope-tag filter
- deterministic chunking reuse (`splitStoryMarkdownIntoChunks`)
- schema-constrained delta operations including confidence + rationale
- low-confidence operation skip policy with warnings/preview counts
- deterministic operation matching (`pageKey` first, title fallback, then deterministic create)
- dry-run diff generation for each planned change (deterministic coarse line diff)
- per-change approval selection in panel and `Apply Selected` writes only approved changes
- merge policies:
  - `safe_append`: preserve metadata on existing notes, append unique content blocks
  - `structured_merge`: deterministic summary/keyword/alias merge + unique content append
- idempotence guard: duplicate content blocks are not appended on rerun
- safe-append guard: existing notes without frontmatter stay frontmatter-free
- fixture-backed tests for parsing, gating, deterministic paths, and idempotence behavior

Still pending in this phase:

- structured-merge conflict UX refinements (current behavior is deterministic merge without dedicated conflict-review UI)

## Determinism Requirements (Implementation)

Critical deterministic areas:

- scope discovery order
- output path resolution and collision checks
- graph ranking tie-breaks
- retrieval ranking/tie-breaks
- story-thread ordering

Any behavior change in these areas must be accompanied by:

- test/fixture updates
- docs updates (`README.md`, `docs/documentation.md`, this file)
- roadmap/todo adjustment when applicable

Mobile runtime safety gate:

- `npm run check:mobile-runtime` fails if `src/` imports Node core modules (`node:*`, `fs`, `path`, `crypto`, etc.)
- CI/release workflows run this guard before build/test

## Large-Vault Profiling

Use the deterministic profiling command for synthetic large-vault baselines:

```bash
npm run profile:large-vault
```

Optional environment variables:

- `LOREVAULT_PROFILE_ENTRIES` (default `3000`)
- `LOREVAULT_PROFILE_AVG_LINKS` (default `5`)
- `LOREVAULT_PROFILE_CONTENT_CHARS` (default `420`)
- `LOREVAULT_PROFILE_RUNS` (default `3`)

The profile reports average timing for graph build, ranking, and context query assembly.

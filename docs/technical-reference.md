# LoreVault Technical Reference

This document is the implementation-level reference for core architecture and runtime behavior.

## Core Runtime Components

- `src/main.ts`
  - plugin lifecycle
  - command/ribbon registration
  - export pipeline orchestration
  - completion orchestration
  - story-chat turn orchestration
- `src/live-context-index.ts`
  - near-live scope indexing
  - scope pack rebuild strategy
  - per-query context assembly dispatch
- `src/context-query.ts`
  - graph-first `world_info` retrieval
  - optional/fallback `rag` retrieval
  - token budgeting and tiering
  - explainability artifacts
- `src/retrieval-tool-hooks.ts`
  - model-driven retrieval tool loop (`search_entries`, `expand_neighbors`, `get_entry`)
  - deterministic local tool execution and context rendering
  - per-turn safety limits (calls/tokens/time)
- `src/scope-pack-builder.ts`
  - deterministic note processing
  - graph ranking
  - RAG chunk generation
  - optional embeddings
- `src/story-chat-view.ts` + `src/story-chat-document.ts`
  - persistent chat UI
  - note-backed conversation persistence
  - message versions/regeneration/forking
- `src/lorebooks-routing-debug-view.ts`
  - scope inclusion/routing diagnostics
  - world_info content inspection
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
- `src/summary-review-modal.ts`
  - review/approval UI for generated summary candidates
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
- `src/story-delta-update.ts`
  - deterministic chunked delta extraction
  - low-confidence gating
  - existing page matching and idempotent merge planning

## Export Pipeline Contract

Per scope, LoreVault writes:

- canonical SQLite pack: `<scope>.db`
- downstream world info JSON
- downstream rag markdown

Canonicality:

- SQLite is the source of truth for downstream tooling.
- Downstream exporters should consume SQLite artifacts rather than vault markdown.

### SQLite Meta Keys

`meta` table records deterministic build metadata:

- `schema_version`
- `scope`
- `generated_at`
- `world_info_entries_count`
- `rag_documents_count`
- `rag_chunks_count`
- `rag_chunk_embeddings_count`

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

### Rag (Secondary / Fallback)

RAG remains available and configurable.

Fallback policy (`settings.retrieval.ragFallbackPolicy`):

- `off`
- `auto`
- `always`

`auto` uses `ragFallbackSeedScoreThreshold` and no/weak seed selection heuristics.

RAG ranking:

- lexical score over title/path/content
- optional semantic boost from embeddings cache/chunk vectors
- optional semantic paragraph reranking for world_info body excerpt fallback
- deterministic tie-breaks: `score DESC`, then `path/title/uid`

### Tool Retrieval Hooks (Optional Advanced Layer)

Tool-driven retrieval is opt-in (`settings.retrieval.toolCalls.enabled`) and executed after graph/rag assembly with remaining budget.

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

## Budgeting and Content Tiering

`world_info` and `rag` budgets are split from the per-query token budget.

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

- world_info entry content: `## Summary` section -> `frontmatter summary` fallback -> note body
- chapter memory summary: `## Summary` section -> `frontmatter summary` fallback -> deterministic excerpt

## Story Chat Persistence

Conversation persistence is note-backed in `storyChat.chatFolder`.

Stored structure:

- conversation metadata
- per-turn messages
- message versions with active version selector
- optional context inspector metadata on assistant versions

Parsing and serialization logic is centralized in `src/story-chat-document.ts` and covered by tests.

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
- day rollups use UTC day boundaries
- report CSV row ordering is deterministic (`timestamp ASC`, `id ASC`)

Current non-goals in this phase:

- provider pricing auto-sync
- per-scope spend attribution heuristics beyond stored metadata dimensions

## Phase 14 Import/Extraction (Current Progress)

Implemented:

- inbound SillyTavern lorebook JSON import command/view
- deterministic entry normalization and sorting
- deterministic file naming/path allocation
- deterministic frontmatter/body mapping for generated wiki pages
- preview and apply import flows
- story extraction command/view with preview/apply workflow
- deterministic chunking and per-chunk schema-constrained extraction
- iterative existing-page state injection between chunks
- deterministic merge behavior (summary merge, set unions, unique content append)

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

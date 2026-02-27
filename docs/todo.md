# LoreVault Implementation Todo

Reference design: `docs/planning.md`.

## Status Snapshot (2026-02-27)

- Completed foundations: Phases 0-12 (including 8/9 hardening + auto-summary).
- Story Chat foundation is implemented (Phase 10 core UX done).
- Optional retrieval extensions (Phase 12) are complete.
- Phase 8 hardening is complete.
- Phase 9 auto-summary workflows are complete.
- Current priority shifts to deferred future phases: cost tracking (13), import/extraction (14), and story-delta updates (15).

## Active Execution Order

1. Implement cost estimation/tracking workflow (Phase 13, far future).
2. Implement inbound wiki import/extraction workflow (Phase 14, far future).
3. Implement story-driven wiki update workflow (Phase 15, far future).

## Completed Foundations (Historical)

- [x] Phase 0: Rename and positioning.
- [x] Phase 1: Tag-driven lorebook discovery.
- [x] Phase 2: Dual section build (`world_info` + `rag`).
- [x] Phase 3: Deterministic export outputs.
- [x] Phase 4: Lorebooks manager UI.
- [x] Phase 5: Live query layer + continuation command.
- [x] Phase 6: Canonical SQLite pack pipeline.
- [x] Phase 7: Embedding-based RAG foundation.

## Phase 10: Story Chat Panel (Remainder)

- [x] Add a persistent Story Chat view in Obsidian workspace (non-modal).
- [x] Add per-chat lorebook selection controls (multi-select scopes).
- [x] Add "manual context only" mode (no automatic lorebook retrieval).
- [x] Show live context inspector for each turn (what was added and why).
- [x] Add send/stop/regenerate controls with streaming output.
- [x] Add tests for chat state persistence and deterministic context assembly.

## Phase 10.5: Product Boundary Hardening

- [x] Mark human book/EPUB export as out-of-scope for LoreVault core docs and settings.
- [x] Define companion-plugin contract for publishing bundles (tag/page selectors + asset inclusion).
- [x] Ensure LoreVault exports expose stable inputs for downstream publishing tools.

## Phase 11: Graph-First Retrieval Engine (Primary)

- [x] Replace primary retrieval path with seed-match + graph expansion over `world_info`.
- [x] Implement deterministic seed detection from keywords/aliases/titles.
- [x] Implement bounded hop expansion with score decay and stable tie-breaks.
- [x] Add budget-aware summary tier selection (`short` -> `medium` -> `full`).
- [x] Add retrieval explainability artifacts (seed reason, path, score factors, budget cutoff).
- [x] Add fixture-backed tests for multi-hop inclusion behavior and determinism.

## Phase 11.5: Long-Form Story Memory

- [x] Add chapter/story frontmatter schema support (`storyId`, `chapter`, optional prev/next links).
- [x] Build deterministic story-thread resolver from metadata + links.
- [x] Add rolling chapter summary store for prior chapters/scenes.
- [x] Add layered context assembly: local window -> chapter memory -> graph memory -> optional fallback.
- [x] Add context inspector traces showing which layer contributed each injected item.
- [x] Add fixtures for multi-chapter coherence and deterministic chapter-order resolution.

## Phase 12: Optional Retrieval Extensions (Fallback/Advanced)

- [x] Keep embedding-based retrieval as optional fallback when seed confidence is low.
- [x] Add policy setting for fallback activation (`off|auto|always`).
- [x] Add tool-call retrieval hooks for model-driven context fetch (`search_entries`, `expand_neighbors`, `get_entry`).
- [x] Add hard limits for tool-call count/tokens/time per generation turn.
- [x] Add tests for fallback determinism and tool-call safety constraints.

## Phase 8: Hardening and Quality (Deferred Until Phase 11/11.5 Stabilize)

- [x] Add fixtures for hierarchical tags and cascaded scope behavior.
- [x] Add fixtures for mixed `world_info`/`rag` routing.
- [x] Add performance profiling for large vaults.
- [x] Add compatibility tests for non-English and edge-case metadata.
- [x] Tune default ranking weights using representative fixtures.

## Phase 9: Auto-Summary Workflows

- [x] Add optional automatic summary generation for `world_info` entries.
- [x] Add review/approval workflow before summary replacement.
- [x] Preserve deterministic export after summary acceptance.
- [x] Add tests for manual `summary` precedence over generated summaries.
- [x] Add optional automatic chapter summary generation for long-form story notes.
- [x] Integrate generated chapter summaries into chapter-memory store (same acceptance/traceability model as world_info summaries).
- [x] Add review/approval workflow before writing chapter frontmatter `summary` updates.
- [x] Add deterministic cache invalidation by chapter content hash/model signature.
- [x] Add tests for chapter summary precedence (`frontmatter summary` > generated summary > deterministic excerpt fallback).

## Phase 13: Cost Estimation and Tracking (Deferred Far Future Work)

- [ ] Add OpenRouter usage capture hooks (input/output tokens and provider response metadata).
- [ ] Add cost estimation model that maps usage to estimated USD cost per request/turn/export.
- [ ] Add persistent usage ledger with deterministic records (timestamp, model, scope/chat operation, usage, cost estimate).
- [ ] Add optional UI surface for session/day/project cost totals and budget warnings.
- [ ] Add export/report format for external analysis (CSV/JSON).
- [ ] Add tests for deterministic aggregation and fallback behavior when pricing metadata is missing.

## Phase 14: Inbound Wiki Import and Story Extraction (Deferred Far Future Work)

- [ ] Add command + panel: `Import SillyTavern Lorebook`.
- [ ] Add command + panel: `Extract Wiki Pages from Story`.
- [ ] Add shared panel inputs:
  - target folder for generated wiki pages
  - default tags
  - lorebook name converted into a lorebook tag
- [ ] Implement lorebook JSON paste-import flow with validation and deterministic page generation.
- [ ] Map lorebook entries to frontmatter/body format (`summary`, `keywords`/`key`, tags, aliases/comment where available).
- [ ] Implement story markdown extraction pipeline:
  - deterministic chunking
  - per-chunk LLM extraction
  - strict JSON-schema constrained output validation
- [ ] Add iterative merge context between chunks:
  - inject already-generated page state per chunk, or
  - use explicit retrieval/tool-call mechanism for existing page data
- [ ] Define deterministic merge/conflict policy (append vs merge vs overwrite).
- [ ] Add import/extraction dry-run preview and error reporting before writes.
- [ ] Add fixtures/tests for deterministic import output and multi-chunk merge behavior.

## Phase 15: Story-Driven Wiki Updates (Deferred Far Future Work)

- [ ] Add command + panel: `Apply Story Delta to Existing Wiki`.
- [ ] Add panel inputs:
  - source story markdown/story note selection
  - target wiki folder/tag scope
  - update policy (safe append vs structured merge)
  - default tags/lorebook tag mapping for newly created pages
- [ ] Reuse deterministic chunking + schema-constrained extraction pipeline from story extraction work.
- [ ] Add LLM output schema for update operations:
  - target page key/path
  - proposed summary/keyword/content updates
  - rationale/confidence per change
- [ ] Resolve operations against existing wiki pages with deterministic matching and conflict handling.
- [ ] Add dry-run diff preview and per-change approval before writes.
- [ ] Add idempotence checks so rerunning the same story update does not duplicate content.
- [ ] Add fixtures/tests for deterministic merge/update behavior on existing pages.

## Default Decisions (2026-02-27)

These are the current implementation defaults unless explicitly changed later.

- [x] Embedding fallback scope: global setting first; per-lorebook overrides are a future extension.
- [x] Seed-confidence threshold: keep default auto-fallback threshold at `120`.
- [x] Graph expansion inputs: wikilinks-first; explicit relation-field expansion is future optional work.
- [x] Chat lorebook selection persistence: per-chat thread (conversation note) as source of truth.
- [x] Chapter ordering precedence: explicit `chapter` index first, then prev/next edges, then deterministic path tie-breaks.
- [x] Chapter summary granularity default: chapter-level summaries (scene-level split is optional future enhancement).
- [x] Scope tags support: Obsidian tag system as-is (frontmatter tags + body tags), no custom body parsing.
- [x] Cost tracking segmentation: store vault-global ledger with dimensions (`scope`, `chat/story`, `model`) for rollups.
- [x] Missing/stale provider pricing strategy: keep token usage records and mark cost as estimated/unknown with provenance timestamp.
- [x] Story extraction context strategy: hybrid approach (inject generated page state by default, tool-calls when state grows too large).
- [x] Conflicting extracted-page updates default: deterministic safe-merge with conflict markers and manual review.
- [x] Import page layout default: one-note-per-entry for deterministic mapping; grouped layouts are optional later.
- [x] Story-driven wiki updates with low confidence: queue for manual review by default (do not auto-apply low-confidence edits).

## Remaining Strategic Questions

- [x] Should per-lorebook retrieval/fallback policy overrides be added before or after Phase 9? -> after Phase 9.
- [ ] For structured merge conflicts, should the long-term default be conflict markers or a dedicated interactive merge UI?

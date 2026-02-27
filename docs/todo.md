# LoreVault Implementation Todo

Reference design: `docs/planning.md`.

## Status Snapshot (2026-02-27)

- Completed foundations: Phases 0-7 and 11/11.5.
- Story Chat foundation is implemented (Phase 10 core UX done).
- Optional retrieval extensions (Phase 12) are complete.
- Phase 8 hardening is in progress (fixtures/routing/perf/compatibility complete; weight tuning remains).
- Current priority is finalizing Phase 8 ranking-weight calibration.
- Hardening/perf pass (Phase 8), auto-summary work (Phase 9), cost tracking work (Phase 13), and import/extraction work (Phase 14) are deferred until the graph-first core is stable.

## Active Execution Order

1. Finalize ranking-weight calibration with representative fixtures (Phase 8 tail).
2. Implement optional world_info auto-summary workflow (Phase 9).
3. Implement cost estimation/tracking workflow (Phase 13, far future).
4. Implement inbound wiki import/extraction workflow (Phase 14, far future).

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
- [ ] Tune default ranking weights using representative fixtures.

## Phase 9: World Info Auto-Summary (Deferred Future Work)

- [ ] Add optional automatic summary generation for `world_info` entries.
- [ ] Add review/approval workflow before summary replacement.
- [ ] Preserve deterministic export after summary acceptance.
- [ ] Add tests for manual `summary` precedence over generated summaries.

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

## Open Questions

- [ ] Should embedding fallback be global or per-lorebook configurable?
- [ ] What minimum seed-confidence threshold should trigger fallback retrieval?
- [ ] Should graph expansion use only wikilinks first, or also explicit relation fields in frontmatter?
- [ ] For chat mode, should lorebook selection persist per-note, per-workspace, or per-chat thread?
- [ ] Should chapter order prefer explicit `chapter` numeric field over graph/topological order when both exist?
- [ ] What chapter summary granularity should be default (scene-level, chapter-level, or adaptive)?
- [ ] Should lorebook scope tags in note body be supported, or frontmatter tags only?
- [ ] Should cost tracking be vault-global only, or also segmented per lorebook/chat conversation?
- [ ] What should be the fallback strategy when OpenRouter pricing metadata is absent or stale?
- [ ] For story extraction, should we prefer context injection of generated pages, tool-calls, or hybrid?
- [ ] How should conflicting updates to the same extracted wiki page be resolved by default?
- [ ] Should imported lorebook entries always create one-note-per-entry, or support grouped page layouts?

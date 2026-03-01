# LoreVault Implementation Todo

Reference design: `docs/planning.md`.

## Status Snapshot (2026-02-28)

- Completed foundations: Phases 0-12 (including 8/9 hardening + auto-summary).
- Story Chat foundation is implemented (Phase 10 core UX done).
- Optional retrieval extensions (Phase 12) are complete.
- Phase 8 hardening is complete.
- Phase 9 auto-summary workflows are complete.
- Phase 13 cost tracking is complete (usage hooks + ledger + manager UI + JSON/CSV export + aggregation tests).
- Phase 14 import/extraction is complete (import panel + story extraction pipeline + deterministic preview/apply workflows).
- Phase 15 foundation is complete (story-delta panel + deterministic planning + diff preview + per-change approval/apply).
- Phase 16 text commands are complete (selection command + prompt collection + optional lore context + diff review/auto-accept).
- Phase 17 unified retrieval model is complete (single lore-entry set with graph-first selection + fallback retrieval over the same entries).
- Phase 18 quality audit foundation is complete (risk scoring + missing-keyword actions + LLM keyword generation).
- Phase 19 mobile compatibility migration is complete (adapter-based export/cache IO + vault-relative path contract + manifest flip).
- Story Steering LLM update prompt support is complete (optional per-run change request + baseline-preserving update behavior).
- Story Chat agentic tool layer is complete (bounded lorebook/story/steering tool calls with scoped access and optional write gating).
- LLM operation log is complete (full request/response/tool-planner payload persistence with retention controls + in-plugin explorer view).
- Story text-completion stop control is complete (`Stop Active Generation` command + editor-menu stop action).
- Current priority is Phase 22 stabilization (conflict UX, export freshness, terminology cleanup, UI scaling, and auditor/docs/test parity).

## Active Execution Order

1. Refine structured-merge conflict UX.
2. Add export freshness controls (manual vs background auto-rebuild).
3. Finish story terminology migration (`thread` -> `story`) in internals/docs with compatibility aliases.
4. Reduce full-vault rescans in manager/steering rendering paths.
5. Close Lorebook Auditor parity gaps (actions/docs/tests).
6. Plan advanced cost-management follow-up (OpenRouter pricing sync + estimated/actual provenance).

## Completed Foundations (Historical)

- [x] Phase 0: Rename and positioning.
- [x] Phase 1: Tag-driven lorebook discovery.
- [x] Phase 2: Canonical lore-entry build with downstream projections.
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
- [x] Add tests for manual `summary` precedence over fallback body content.
- [x] Add optional automatic chapter summary generation for long-form story notes.
- [x] Integrate chapter summary generation into chapter-memory store via persisted note summaries.
- [x] Add review/approval workflow before writing chapter `## Summary` section updates.
- [x] Invalidate rolling chapter-summary memory cache on note create/modify/delete/rename events.
- [x] Add tests for chapter summary precedence (`## Summary` section > `frontmatter summary` fallback > deterministic excerpt fallback).

## Phase 13: Cost Estimation and Tracking

- [x] Add OpenRouter usage capture hooks (input/output tokens and provider response metadata).
- [x] Add cost estimation model that maps usage to estimated USD cost per request/turn/export.
- [x] Add persistent usage ledger with deterministic records (timestamp, model, scope/chat operation, usage, cost estimate).
- [x] Add optional UI surface for session/day/project cost totals and budget warnings.
- [x] Add export/report format for external analysis (CSV/JSON).
- [x] Add tests for deterministic aggregation and fallback behavior when pricing metadata is missing.

## Phase 14: Inbound Wiki Import and Story Extraction

- [x] Add command + panel: `Import SillyTavern Lorebook`.
- [x] Add command + panel: `Extract Wiki Pages from Story`.
- [x] Add shared panel inputs:
  - target folder for generated wiki pages
  - default tags
  - lorebook name converted into a lorebook tag
- [x] Implement lorebook JSON paste-import flow with validation and deterministic page generation.
- [x] Map lorebook entries to frontmatter/body format (`## Summary` section, `keywords`/`key`, tags, aliases/comment where available).
- [x] Implement story markdown extraction pipeline:
  - deterministic chunking
  - per-chunk LLM extraction
  - strict JSON-schema constrained output validation
- [x] Add iterative merge context between chunks:
  - inject already-generated page state per chunk, or
  - use explicit retrieval/tool-call mechanism for existing page data
- [x] Define deterministic merge/conflict policy (append vs merge vs overwrite).
- [x] Add import/extraction dry-run preview and error reporting before writes.
- [x] Add fixtures/tests for deterministic import output and multi-chunk merge behavior.

## Phase 15: Story-Driven Wiki Updates (In Progress)

- [x] Add command + panel: `Apply Story Delta to Existing Wiki`.
- [x] Add panel inputs:
  - source story markdown/source-note selection (`note`/`chapter`/`story` with note picker)
  - target wiki folder/tag scope
  - update policy (safe append vs structured merge)
  - default tags/lorebook tag mapping for newly created pages
- [x] Reuse deterministic chunking + schema-constrained extraction pipeline from story extraction work.
- [x] Add LLM output schema for update operations:
  - target page key/path
  - proposed summary/keyword/content updates
  - rationale/confidence per change
- [x] Resolve operations against existing wiki pages with deterministic matching and conflict handling.
- [x] Add dry-run diff preview and per-change approval before writes.
- [x] Add idempotence checks so rerunning the same story update does not duplicate content.
- [x] Add fixtures/tests for deterministic merge/update behavior on existing pages.

## Phase 16: Selection Text Commands

- [x] Add command + editor context-menu action: `Run Text Command on Selection`.
- [x] Add text-command prompt modal with template picker, custom prompt editing, and per-run context toggle.
- [x] Add optional lorebook-context retrieval injection for text commands.
- [x] Add review/approval modal with unified diff preview before apply.
- [x] Add auto-accept setting (default off) for direct apply.
- [x] Add settings-backed prompt collection with JSON editor + load-defaults action.
- [x] Add tests for deterministic diff preview generation.

## Phase 17: Unified Retrieval Model

- [x] Remove keyword-based hard split between `world_info` and `rag` from core routing.
- [x] Include scoped notes as unified lore entries by default (`retrieval: none` remains hard exclusion).
- [x] Keep fallback retrieval (`off|auto|always`) as a secondary selector over the same canonical entries.
- [x] Merge fallback-selected entries into the injected `world_info` context list.
- [x] Add keyword-coverage diagnostics (missing explicit keyword counts/list) to Lorebook Auditor and manager views.
- [x] Update query simulation and generation UI labels from `rag` to `fallback` where relevant.
- [x] Add/refresh tests covering unified routing and fallback-to-world_info merge behavior.

## Phase 18: Quality Audit and Keyword Assist

- [x] Add deterministic quality-audit scoring (missing keywords, thin content, duplicate-like embedding similarity).
- [x] Add quality-audit table in Lorebook Auditor with actionable reasons and similarity hints.
- [x] Add per-entry `Generate Keywords` action for missing-keyword notes in the audit table.
- [x] Add command/context-menu entry: `Generate Keywords (Active Note)`.
- [x] Add deterministic keyword parsing/frontmatter upsert helpers with regression tests.

## Phase 19: Mobile Compatibility

- [x] Add mobile-safe storage adapter abstraction for vault-binary read/write (`src/vault-binary-io.ts`).
- [x] Migrate runtime filesystem paths away from Node `fs` in:
  - [x] `src/lorebook-exporter.ts`
  - [x] `src/rag-exporter.ts`
  - [x] `src/sqlite-pack-exporter.ts`
  - [x] `src/sqlite-pack-reader.ts`
  - [x] `src/embedding-cache.ts`
  - [x] `src/sqlite-cli.ts` (removed; replaced by vault adapter IO utility)
- [x] Replace Node `path` usage in mobile-executed code paths with vault-path utilities.
- [x] Enforce vault-relative export paths in settings normalization/path resolution (absolute paths rejected).
- [x] Add mobile-focused regression tests for deterministic export paths and adapter IO.
- [x] Validate mobile QA matrix and flip `manifest.json isDesktopOnly` to `false`.

## Phase 20: Story Steering and Context Staging

- [x] Add explicit steering layers for completion/chat assembly:
  - [x] pinned session instructions (goal/style/constraints)
  - [x] per-story notes (author-note style)
  - [x] scene/chapter intent block
- [x] Add optional inline directive steering shorthand:
  - [x] support strict-prefix directives only (`[LV: ...]` and `<!-- LV: ... -->`)
  - [x] parse directives from active story note near-cursor window only
  - [x] ignore non-prefixed bracket text (for example `[Editor Note: ...]`) by default
  - [x] preserve deterministic directive order and dedupe behavior
- [x] Add inline-directive safety and visibility rules:
  - [x] show resolved directives in context inspector as a separate steering layer
  - [x] exclude directives from lore exports, summary extraction, and wiki import/update pipelines
  - [x] enforce per-turn directive count/token caps
- [x] Add configurable placement policy per layer (`system` vs pre-history vs pre-assistant context).
- [x] Add deterministic per-layer token reservations with visible headroom:
  - [x] reserve budget slices for system/steering/history/retrieval/output
  - [x] scale reservations against configured model context window
- [x] Add deterministic overflow policy:
  - [x] trim/compress in fixed order by layer priority
  - [x] never silently drop pinned steering blocks
- [x] Extend generation inspector with full prompt-staging visibility:
  - [x] rendered layer order
  - [x] token usage per layer
  - [x] trims/compressions and rationale
- [x] Add continuity-state tracking primitives for long-form drafting:
  - [x] active plot threads
  - [x] unresolved commitments/open loops
  - [x] recent canon/fact deltas
  - [x] selectable inclusion in generation context
- [x] Add tests for deterministic layer ordering, budget partitioning, and overflow behavior.
- [x] Add fixtures/tests covering large-context models (for example `200k`) to verify scaling logic.
- [x] Add tests for inline directive parsing/exclusion/ordering and inspector visibility.
  - [x] parser/exclusion/ordering coverage
  - [x] dedicated UI inspector rendering assertions
- [x] Add gradual async hashing migration plan (WebCrypto-backed):
  - [x] add async hash helper surface (`sha256HexAsync`) and dual-path tests
  - [x] migrate async-safe call sites first (non-hot-path cache/index operations)
  - [x] keep sync hash path for deterministic hot paths until pipeline async refactor is complete
  - [x] remove sync hashing fallback only after all runtime call sites are async-compatible

## Phase 21: Scope-Based Story Steering Workspace (Complete)

- [x] Add dedicated Story Steering panel with editable steering sections.
- [x] Persist steering state as markdown notes under configurable steering folder.
- [x] Support scope layers without mandatory `storyId` (`global` -> optional `story` [compat alias: `thread`] -> optional `chapter` -> `note`).
- [x] Merge scoped steering into Continue Story and Story Chat prompt assembly.
- [x] Expose steering panel via command palette, manager toolbar, and in-plugin help actions.
- [x] Add LLM-assisted extraction actions (proposal + review) to populate/update steering sections from story text.
- [x] Add optional update prompt input for steering LLM assist and preserve-existing-state update contract.

## Phase 22: Stabilization and Roadmap Alignment (Current)

- [x] Story-delta structured-merge conflict UX refinement:
  - [x] add dedicated conflict review rows with quick accept/reject/keep-both controls
  - [x] add conflict counters + filters in preview UI
  - [x] persist deterministic per-conflict override decisions into apply phase
- [x] Export freshness and rebuild policy:
  - [x] add setting: `manual` | `on_build` | `background_debounced`
  - [x] in background mode, debounce vault events and rebuild only impacted scopes
  - [x] show last successful canonical export timestamp per scope in manager UI
- [x] Story terminology normalization:
  - [x] keep compatibility alias for persisted/internal `thread` scope keys
  - [x] migrate user-facing labels/docs/help to `story` terminology
  - [x] add regression tests for `story`/`thread` alias handling
- [x] UI scalability and cache reuse:
  - [x] avoid full metadata rescan on every Story Steering render
  - [x] reuse shared scope metadata cache/index in manager + steering scope selectors
  - [x] add panel-interaction perf tests for large vaults (>1k notes)
- [x] Lorebook Auditor parity:
  - [x] document current row actions (`Open Entry`, `Open Similar`, `Open Pair`, keyword actions)
  - [x] add tests for duplicate/similarity actions and embeddings-present/absent messaging
- [x] Agentic workflow integration:
  - [x] add Story Chat tool-calling planner loop with bounded call/token/time limits
  - [x] expose lorebook/story/steering read tools with scoped-access safety boundaries
  - [x] add optional write tools (steering update + lorebook note create) behind explicit setting and per-turn write-intent gate
  - [x] expose chat tool call/write traces in context inspector metadata
- [x] LLM operation logging:
  - [x] add vault-backed JSONL operation log for completion + streaming + tool planner calls
  - [x] add optional embedding backend call logging (`kind: embedding`)
  - [x] add settings for operation-log enable/path/max-entry retention
  - [x] add operation-log explorer panel with command, filters, and full payload inspection
- [x] Story Steering review/wording clarity:
  - [x] show field-level `Current` vs `Proposed` values in steering update review modal
  - [x] rename ambiguous `Story Window` extraction source label to `Near-Cursor Context` and document behavior
- [x] Story Steering + Story Chat scope UX polish:
  - [x] autosave Story Steering panel edits immediately (remove manual save workflow)
  - [x] replace chat manual steering text fields with steering source refs (`note`)
  - [x] resolve chat steering refs into steering layers and inspector traces each turn
- [x] Story Steering simplification (Author Note model):
  - [x] collapse steering state to one note-level `authorNote` markdown layer
  - [x] link story notes to Author Notes via `authorNote` frontmatter (no manual scope key workflow)
  - [x] replace Story Author Note panel with unified Story Writing panel (author-note actions + generation monitor + lorebook controls + compact cost breakdown)
  - [x] remove legacy scope-based steering storage/backward-compat parsing paths
  - [x] remove multi-scope steering merge in continuation/chat (note-level only)
  - [x] resolve lorebook scope selection from story-note frontmatter, then Author Note frontmatter (no active-scope fallback)
  - [x] limit Story Chat steering refs/tool scope access to note-level steering only
- [x] Story completion stop UX:
  - [x] add command: `Stop Active Generation`
  - [x] expose editor menu stop action while generation is active
- [x] Long-form chapter QoL + embedding resiliency:
  - [x] prevent failed query-embedding calls from aborting story completion (lexical fallback path)
  - [x] chunk/average long query embeddings deterministically before semantic scoring
  - [x] scale prior-chapter memory depth by available context budget (deterministic window expansion)
  - [x] add chapter split utilities (`H1` story title + `H2` chapter split) with linked chapter frontmatter output
  - [x] add `Create Next Story Chapter` command + chapter-frontmatter-gated editor context action
- [x] Text command canon consistency default prompt update:
  - [x] bias default template toward lorebook factual consistency constraints
- [x] Repository release automation:
  - [x] add versioned release command that validates monotonic semver bump against `manifest.json`
  - [x] update `manifest.json` + `versions.json`, commit/tag, and push branch + tag with configurable remote/branch
- [ ] Advanced cost-management follow-up (far future):
  - [ ] integrate provider pricing metadata sync (OpenRouter-first)
  - [x] store/display estimated-vs-actual cost provenance per ledger row
  - [x] add budget policies/alerts by operation/model/scope
- [ ] Retrieval quality optimization follow-up (future):
  - [ ] add deterministic retrieval benchmark fixtures (`query -> relevant note ids`, optional negative ids)
  - [ ] add retrieval quality score (`nDCG@k`, `Recall@k`, routing precision, token-efficiency penalties)
  - [ ] add parameter-sweep runner across retrieval tunables (graph hops/decay, fallback threshold/policy, budget ratios, body-lift thresholds, backlink boosts)
  - [ ] support random/Bayesian search mode for high-dimensional sweeps
  - [ ] require held-out benchmark split and report overfitting risk in results output

## Default Decisions (2026-02-27)

These are the current implementation defaults unless explicitly changed later.

- [x] Embedding fallback scope: global setting first; per-lorebook overrides are a future extension.
- [x] Seed-confidence threshold: keep default auto-fallback threshold at `120`.
- [x] Graph expansion inputs: wikilinks-first; explicit relation-field expansion is future optional work.
- [x] Chat lorebook selection persistence: per-chat story conversation note as source of truth.
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
- [x] For structured merge conflicts, should the long-term default be conflict markers or a dedicated interactive merge UI? -> keep deterministic conflict markers as default; interactive merge UI remains an optional future enhancement.

# LoreVault Implementation Todo

Reference design: `docs/planning.md`.

## Phase 0: Rename and Positioning

- [x] Rename plugin-facing labels from "Lorebook Converter" to "LoreVault".
- [x] Update `manifest.json` name/description and docs naming.
- [x] Add migration note for users upgrading from old naming.

## Phase 1: Tag-Driven Lorebook Discovery

- [x] Implement discovery of lorebook scopes from `#lorebook/...` tags.
- [x] Add deterministic scope ordering.
- [x] Implement membership mode setting: `exact` vs `cascade`.
- [x] Add tests for scope expansion and membership.

## Phase 2: Dual Section Build (`world_info` + `rag`)

- [x] Add routing logic:
  - `keywords` present -> `world_info`
  - no `keywords` -> `rag`
- [x] Add `retrieval` override (`auto|world_info|rag|both|none`).
- [x] Build per-lorebook outputs for both sections.
- [x] Add tests for routing and output determinism.

## Phase 3: Export Outputs

- [x] Export `world_info` JSON per lorebook scope.
- [x] Export `rag` markdown packs per lorebook scope.
- [x] Add output path templates and collision checks.
- [x] Add deterministic file naming and stable serialization rules.

## Phase 4: Lorebooks UI in Obsidian

- [x] Add Lorebooks management view/panel.
- [x] Show discovered scopes, counts, and validation warnings.
- [x] Add actions: per-scope Build/Export, Open Output Folder.
- [x] Add drill-down debug info: why note is in/out of each scope.

## Phase 5: Live/Near-Live Query Layer (Writing Assistant Foundation)

- [x] Add incremental index refresh on note changes.
- [x] Add query pipeline combining `world_info` triggers + `rag` retrieval.
- [x] Add token-budgeted context assembly.
- [x] Add first "Continue Story with Context" command.
- [x] Wire "Continue Story with Context" to provider-backed completion generation.
- [x] Add story-note frontmatter scope selection for completion context.
- [x] Stream completion output directly into editor while generation is running.
- [x] Add generation status telemetry (state, scopes, token usage, selected context items) in manager view.
- [x] Add completion context-window controls (`contextWindowTokens`, `promptReserveTokens`) and active budget trimming.

## Phase 6: Canonical SQLite Pack Pipeline

- [x] Add per-scope SQLite pack export as canonical format.
- [x] Add scope output path resolution for SQLite packs.
- [x] Keep downstream exports (`world_info`, `rag`) generated from canonical scope pack pipeline.

## Phase 7: Embedding-Based RAG Foundation

- [x] Add provider adapters (OpenRouter, Ollama, OpenAI-compatible).
- [x] Add one-file-per-hash embedding cache keyed by model/instruction/chunking signature.
- [x] Add deterministic chunking (`auto|note|section`) for RAG documents.
- [x] Add optional semantic boosting in live query pipeline with lexical fallback.
- [x] Add embedding/chunking settings in plugin settings UI.

## Phase 8: Hardening and Quality

- [ ] Add fixtures for hierarchical tags and cascaded scope behavior.
- [ ] Add fixtures for mixed `world_info`/`rag` routing.
- [ ] Add performance profiling for large vaults.
- [ ] Add compatibility tests for non-English and edge-case metadata.
- [ ] Tune default ranking weights using representative fixtures.

## Phase 9: World Info Auto-Summary (Future)

- [ ] Add optional automatic summary generation for `world_info` entries.
- [ ] Add review/approval workflow before summary replacement.
- [ ] Preserve deterministic export after summary acceptance.
- [ ] Add tests for manual `summary` precedence over generated summaries.

## Phase 10: Story Chat Panel (Next)

- [ ] Add a persistent Story Chat view in Obsidian workspace (non-modal).
- [ ] Add per-chat lorebook selection controls (multi-select scopes).
- [ ] Add "manual context only" mode (no automatic lorebook retrieval).
- [ ] Show live context inspector for each turn (what was added and why).
- [ ] Add send/stop/regenerate controls with streaming output.
- [ ] Add tests for chat state persistence and deterministic context assembly.

## Phase 11: Graph-First Retrieval Engine (Primary)

- [ ] Replace primary retrieval path with seed-match + graph expansion over `world_info`.
- [ ] Implement deterministic seed detection from keywords/aliases/titles.
- [ ] Implement bounded hop expansion with score decay and stable tie-breaks.
- [ ] Add budget-aware summary tier selection (`short` -> `medium` -> `full`).
- [ ] Add retrieval explainability artifacts (seed reason, path, score factors, budget cutoff).
- [ ] Add fixture-backed tests for multi-hop inclusion behavior and determinism.

## Phase 12: Optional Retrieval Extensions (Fallback/Advanced)

- [ ] Keep embedding-based retrieval as optional fallback when seed confidence is low.
- [ ] Add policy setting for fallback activation (`off|auto|always`).
- [ ] Add tool-call retrieval hooks for model-driven context fetch (`search_entries`, `expand_neighbors`, `get_entry`).
- [ ] Add hard limits for tool-call count/tokens/time per generation turn.
- [ ] Add tests for fallback determinism and tool-call safety constraints.

## Open Questions

- [ ] Should embedding fallback be global or per-lorebook configurable?
- [ ] What minimum seed-confidence threshold should trigger fallback retrieval?
- [ ] Should graph expansion use only wikilinks first, or also explicit relation fields in frontmatter?
- [ ] For chat mode, should lorebook selection persist per-note, per-workspace, or per-chat thread?
- [ ] Should lorebook scope tags in note body be supported, or frontmatter tags only?

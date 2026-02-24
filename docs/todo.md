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
- [x] Add actions: Build, Export, Open Output Folder.
- [x] Add drill-down debug info: why note is in/out of each scope.

## Phase 5: Live/Near-Live Query Layer (Writing Assistant Foundation)

- [x] Add incremental index refresh on note changes.
- [x] Add query pipeline combining `world_info` triggers + `rag` retrieval.
- [x] Add token-budgeted context assembly.
- [x] Add first "Continue Story with Context" command.

## Phase 6: Hardening and Quality

- [ ] Add fixtures for hierarchical tags and cascaded scope behavior.
- [ ] Add fixtures for mixed `world_info`/`rag` routing.
- [ ] Add performance profiling for large vaults.
- [ ] Add compatibility tests for non-English and edge-case metadata.
- [ ] Tune default ranking weights using representative fixtures.

## Open Questions

- [ ] Should parent scopes always include child-scope `rag` docs in `cascade` mode, or be independently filtered?
- [ ] Should `world_info` and `rag` have independent per-scope token budgets?
- [ ] Should lorebook scope tags in note body be supported, or frontmatter tags only?

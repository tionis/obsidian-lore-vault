# LoreVault Implementation Todo

Reference design: `docs/planning.md`.

## Phase 0: Rename and Positioning

- [ ] Rename plugin-facing labels from "Lorebook Converter" to "LoreVault".
- [ ] Update `manifest.json` name/description and docs naming.
- [ ] Add migration note for users upgrading from old naming.

## Phase 1: Tag-Driven Lorebook Discovery

- [ ] Implement discovery of lorebook scopes from `#lorebook/...` tags.
- [ ] Add deterministic scope ordering.
- [ ] Implement membership mode setting: `exact` vs `cascade`.
- [ ] Add tests for scope expansion and membership.

## Phase 2: Dual Section Build (`world_info` + `rag`)

- [ ] Add routing logic:
  - `keywords` present -> `world_info`
  - no `keywords` -> `rag`
- [ ] Add `retrieval` override (`auto|world_info|rag|both|none`).
- [ ] Build per-lorebook outputs for both sections.
- [ ] Add tests for routing and output determinism.

## Phase 3: Export Outputs

- [ ] Export `world_info` JSON per lorebook scope.
- [ ] Export `rag` markdown packs per lorebook scope.
- [ ] Add output path templates and collision checks.
- [ ] Add deterministic file naming and stable serialization rules.

## Phase 4: Lorebooks UI in Obsidian

- [ ] Add Lorebooks management view/panel.
- [ ] Show discovered scopes, counts, and validation warnings.
- [ ] Add actions: Build, Export, Open Output Folder.
- [ ] Add drill-down debug info: why note is in/out of each scope.

## Phase 5: Live/Near-Live Query Layer (Writing Assistant Foundation)

- [ ] Add incremental index refresh on note changes.
- [ ] Add query pipeline combining `world_info` triggers + `rag` retrieval.
- [ ] Add token-budgeted context assembly.
- [ ] Add first "Continue Story with Context" command.

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

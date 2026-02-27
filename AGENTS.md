# AGENTS.md

## Purpose

This repository is evolving from **Lorebook Converter** into **LoreVault**.

LoreVault compiles Obsidian notes into scoped context packs for story generation:

- `world_info` (triggered, compact entries; SillyTavern World Info style)
- `rag` (retrieval docs; Data Bank / generic RAG style)

The goal is not maximum extraction.  
The goal is **predictable, high-quality context retrieval for writing workflows**.

---

## Product Model

### Canonical unit

A `lorebook` (LoreVault terminology) is a scoped package identified by hierarchical tags:

- `#lorebook/universe`
- `#lorebook/universe/yggdrasil`
- `#lorebook/universe/yggdrasil/factions`

### Sections per lorebook

Each lorebook has:

- `world_info`
- `rag`

### Initial routing rule (MVP)

- Notes with `keywords`/`key` -> `world_info`
- Notes without keywords -> `rag`
- Optional override:

```yaml
retrieval: auto   # auto | world_info | rag | both | none
```

---

## Source of Truth

1. Obsidian notes are source of truth.
2. Frontmatter + tags drive inclusion and behavior.
3. LoreVault exports deterministic artifacts.
4. User can tune downstream in SillyTavern as needed.

---

## Core Assumptions

- Frontmatter-first metadata model.
- Hierarchical lorebook tags drive scope membership.
- Legacy `# Field: value` parsing and `# Root` marker workflows are deprecated.
- Determinism is mandatory.

---

## Engineering Priorities

1. Correctness of scope assignment and routing (`world_info` vs `rag`)
2. Deterministic output (stable order, IDs, formatting)
3. Debuggability (clear inclusion/exclusion and routing reasons)
4. Real-vault performance (hundreds/thousands of notes)
5. Writing-assistant capabilities (near-live query support)
6. UI polish

---

## Determinism Invariants

Unless intentionally changed and documented:

- Same vault + same config => same outputs
- Stable file traversal and target expansion order
- Stable tie-breaking in ranking
- Stable serialization format
- No duplicate keys/aliases per entry
- UTF-8 safe output

Any intentional invariant change must include fixture updates and migration notes.

---

## Frontmatter and Metadata Expectations

Expected frontmatter fields include (case-insensitive where practical):

- `title`, `comment`
- `aliases`
- `tags`
- `keywords` / `key`
- `summary`
- `type`
- `lorebook` (boolean/object)
- `exclude`
- `retrieval`
- optional root hints (`root`, `lorebookRoot`)

Tags are first-class. Prefer tag-driven scoping over folder heuristics.

---

## Ranking and Retrieval

- Graph ranking still matters for `world_info` ordering.
- Use deterministic root resolution and tie-breaks.
- Optimize for retrieval quality and token economy, not entry count.
- Keep `rag` output chunk-friendly and structurally coherent.

---

## Debuggability Requirements

Important decisions should be explainable:

- why note was included/excluded from a lorebook scope
- why note routed to `world_info`, `rag`, or both
- which tags/frontmatter fields were used
- why entry order was assigned

Debug output is a product feature, not optional logging.

---

## Testing Strategy

Use fixture-backed regression tests as contract.

Minimum expectations:

- hierarchical tag scope behavior
- `world_info`/`rag` routing behavior
- wikilink normalization and ambiguous basename handling
- deterministic ranking/order
- frontmatter edge cases and exclusion rules

Any bug fix should add a fixture/test.

---

## Non-Goals

Do not turn this project into:

- a generic Obsidian sync engine
- a full SillyTavern replacement
- a note editor
- an unconstrained RAG platform

Keep focus on context compilation, export quality, and writing-assistant context assembly.

---

## Implementation Guidance

Before coding:

1. Read `docs/planning.md` and `docs/todo.md`
2. Check current fixtures/tests
3. Confirm determinism impact

While coding:

- prefer small, isolated changes
- keep backwards compatibility unless intentionally migrating
- surface non-obvious behavior in docs/debug output
- avoid hidden heuristics without override controls

When changing routing/selection heuristics:

- state rationale
- provide before/after example
- update fixtures/tests/docs

---

## Documentation Maintenance Requirements

Documentation is part of the feature contract.

For any behavior or UX change, agents must update docs in the same change set:

1. `README.md` for user-visible behavior changes
2. `docs/documentation.md` for detailed functional behavior
3. `docs/technical-reference.md` for architecture/contracts/code-level behavior
4. `docs/installation-guide.md` when setup, commands, or settings change
5. `docs/todo.md` when roadmap/phase status changes

If the change affects in-app guidance, agents must also update embedded help:

- `src/lorevault-help-view.ts`
- relevant settings copy in `src/settings-tab.ts`

Documentation updates must be:

- explicit about new/changed defaults
- explicit about migration or compatibility impacts
- consistent across user-facing and technical docs
- included before finalizing the task

---

## Roadmap Source

Planning and implementation roadmap live here:

- `docs/planning.md`
- `docs/todo.md`

These documents define the active direction for agents.

---

## Final Principle

Optimize for downstream writing quality:

- better retrieval precision
- lower context bloat
- deterministic, inspectable behavior

Not for maximum extraction volume.

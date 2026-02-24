# LoreVault Planning

## Rename Direction

Current name: **LoreVault** (renamed from Lorebook Converter).

Rationale:

- Clarifies this is a broader context system, not only a single ST lorebook exporter.
- Fits the new model where each lore scope contains multiple retrieval mechanisms.

## Core Product Model

`Lorebook` (LoreVault terminology) is a scoped package identified by hierarchical tags.

Each lorebook has two sections:

- `world_info`: trigger-based entries (SillyTavern World Info/Lorebook behavior).
- `rag`: retrieval documents (SillyTavern Data Bank / generic RAG behavior).

## Scope and Membership

Primary source-of-truth for scope: hierarchical tags like:

- `#lorebook/universe`
- `#lorebook/universe/yggdrasil`
- `#lorebook/universe/yggdrasil/factions`

Notes are assigned to lorebooks based on these tags.

Membership modes (planned):

- `exact`: note belongs only to exact tag scope.
- `cascade`: note also belongs to ancestor scopes.

## Routing Between `world_info` and `rag`

MVP routing rule:

- Note has `keywords`/`key` -> include in `world_info`.
- Otherwise -> include in `rag`.

Override field:

```yaml
retrieval: auto   # auto | world_info | rag | both | none
```

Behavior details:

- `world_info` uses compact content (prefer `summary` when present).
- `rag` uses full markdown body for richer retrieval context.

## Frontmatter Role

Frontmatter remains metadata control, including:

- title/comment/aliases
- keywords
- summary
- trigger settings
- retrieval override
- optional root hints

Selection for lorebook scope should be tag-first, not folder-rule-first.

## Multi-Output Strategy

For each resolved lorebook scope:

- export `world_info` JSON
- export `rag` markdown pack

Outputs remain deterministic and stable for Git diffs.

## Obsidian UX Direction

Add a Lorebooks management view:

- list discovered lorebooks from tags
- show counts (`world_info`, `rag`, total notes)
- show warnings (missing keywords, empty scope, collisions)
- actions: build, export, open output path

## Writing Assistant Direction (Second Major Change)

Goal: turn LoreVault into an LLM writing assistant inside Obsidian.

Needed capabilities:

- near-live index updates as notes change
- query-time context assembly from `world_info` + `rag`
- token budgeting and deterministic context ordering
- story-focused prompts and insert-at-cursor workflows

## Constraints

- Keep deterministic export and traceable debug behavior.
- Keep Obsidian-native workflows first (tags/frontmatter/links).
- Support downstream SillyTavern first; keep other RAG destinations compatible.

## Implementation Principles

- Build iteratively with migration safety.
- Keep old behavior only as temporary compatibility mode where required.
- Every heuristic should have explicit override and debug output.

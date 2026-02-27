# LoreVault Planning

## Roadmap Pivot (2026-02-27)

LoreVault will pivot to a graph-first writing assistant model.

Approved direction:

- add an in-editor story chat panel where users can:
  - enable/disable lorebooks as context sources
  - run with no lorebooks and manual context only
  - inspect exactly which context was injected and why
- make graph + `world_info` retrieval the primary context strategy
- treat embedding-based `rag` as optional fallback, not the default retrieval path
- preserve deterministic ranking and explainability for every retrieval decision

Rationale:

- narrative writing benefits more from controllable entity/lore retrieval than broad chunk recall
- graph expansion from explicitly mentioned entities gives predictable context growth
- users need inspectable context composition during live generation/chat, not opaque retrieval

## Execution Priority Update (2026-02-27)

Current execution sequence:

1. finish Story Chat validation and boundary hardening
2. implement graph-first retrieval core
3. implement long-form story memory layers
4. add optional fallback/tool-call retrieval extensions
5. run broad hardening/performance tuning across the stack
6. implement optional world_info auto-summary workflow

Priority note:

- legacy hardening tasks and auto-summary are still roadmap items
- they are intentionally sequenced after graph-first core delivery so optimization targets are stable

## Scope Boundaries

LoreVault core should optimize for context engineering and writing-assistant retrieval.

Out of core scope:

- human reading bundle targets (EPUB/PDF/print-style books)
- full publishing/asset-packaging workflows

Recommended direction:

- keep LoreVault focused on context packs, chat, and generation tooling
- optionally build a separate companion plugin for human-oriented bundling
- companion plugin can consume tag/page selectors and export book-style artifacts with bundled assets

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

- export canonical LoreVault SQLite pack (`.db`)
- derive downstream outputs from the SQLite pack:
  - `world_info` JSON
  - `rag` markdown pack

Outputs remain deterministic and stable for Git diffs.

## Canonical SQLite Pack

Primary export format is a SQLite pack per scope containing:

- scope metadata
- `world_info` entries
- `rag` documents
- `rag` chunks
- optional chunk embeddings

Downstream targets should read from this pack format instead of re-parsing vault content.

## Embedding-Based RAG

RAG retrieval should support semantic ranking with embeddings, while keeping lexical fallback.

Provider model:

- backend adapters:
  - OpenRouter
  - Ollama
  - OpenAI-compatible endpoints
- default model: `qwen/qwen3-embedding-8b`

Cache model:

- one file per hash record for sync-friendly storage
- cache key includes:
  - chunk text hash
  - provider + model
  - instruction
  - chunking signature

Chunking:

- `auto` heuristic (short note -> single chunk; longer -> heading-aware chunks)
- override modes:
  - `note`
  - `section`

## Future: World Info Auto-Summary

Add automatic summary generation for `world_info` entries as a future phase.

Constraints:

- opt-in and review-first
- deterministic output once accepted
- preserve manual `summary` override precedence

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
- query-time context assembly from graph-expanded `world_info`
- token budgeting and deterministic context ordering
- story-focused prompts and insert-at-cursor workflows
- chat workflow for interactive story discussion with selectable lorebooks/manual context

## Graph-First Retrieval Strategy

Primary retrieval loop:

1. detect seed entities via `keywords`, aliases, and title matches in recent story text
2. score direct matches as first-order context candidates
3. expand one or two graph hops from matched entries (wikilinks/relations)
4. apply score decay per hop and deterministic tie-breaks
5. assemble within token budget using summary tiers (`short` -> `medium` -> `full`)

Scoring inputs (planned):

- direct keyword/alias match strength
- graph distance from seed entities
- explicit priority/order fields
- scope membership strength
- optional recency boost from active document context

Debug output must explain:

- seed match reasons
- expansion path (`A -> B -> C`)
- score contribution per factor
- final inclusion/exclusion due to token budget

## Long-Form Story Strategy

Long-form support should be explicit and deterministic, not folder-guess-heavy.

Canonical unit:

- chapter note (or scene note) with stable metadata

Recommended metadata (frontmatter-first):

- `storyId`: stable story identifier
- `chapter`: chapter/scene index
- `chapterTitle`: optional display title
- `arc`: optional grouping label
- `previousChapter`: optional explicit link/path
- `nextChapter`: optional explicit link/path
- `lorebooks`/scope selectors for context boundaries

Conventions:

- folder layout is optional convenience, not source of truth
- frontmatter/link graph takes precedence over folder heuristics

Context layering for generation/chat:

1. local writing window (near cursor, current chapter)
2. chapter memory (rolling summaries of prior chapters/scenes)
3. story graph memory (entity/lore expansion from `world_info`)
4. optional fallback retrieval (embeddings/tool calls when confidence is low)

This keeps short-term coherence (scene continuity) and long-term coherence (story/world consistency) while staying inspectable.

## Optional Retrieval Extensions

Non-primary, opt-in layers:

- embedding fallback retrieval when graph/entity confidence is low
- tool-call retrieval during generation/chat (`search_entries`, `expand_neighbors`, `get_entry`)
- intermediary summary generation for oversized contexts with explicit traceability

## Constraints

- Keep deterministic export and traceable debug behavior.
- Keep Obsidian-native workflows first (tags/frontmatter/links).
- Support downstream SillyTavern first; keep other RAG destinations compatible.

## Implementation Principles

- Build iteratively with migration safety.
- Keep old behavior only as temporary compatibility mode where required.
- Every heuristic should have explicit override and debug output.

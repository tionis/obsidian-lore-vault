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

## Execution Priority Update (2026-02-28)

Current execution sequence:

1. finish structured-merge conflict UX refinement in story-delta workflows
2. add export freshness controls (manual vs background, scoped incremental rebuild policy)
3. complete user-facing terminology migration (`thread` -> `story`) with compatibility aliases
4. reduce full-vault rescans in panel rendering paths via shared scope metadata cache/index
5. close Lorebook Auditor parity gaps (duplicate actions docs/tests)
6. keep provider pricing sync and reconciliation as far-future (integration dependent)
7. continue long-tail hardening/performance work on large vaults

Priority note:

- core retrieval/chat foundations are in place; current work is stabilization and UX consistency
- advanced provider pricing sync/reconciliation remains far-future and requires tighter OpenRouter usage/pricing integration
- story/wiki import and update foundations are implemented; remaining work is merge UX and operator control polish

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

## Auto-Summary Workflows (`world_info` + chapter memory) - Implemented

LoreVault now supports optional generated-summary workflows for both:

- `world_info` entries (compact trigger content)
- chapter notes used by long-form chapter-memory injection

Current constraints:

- opt-in and review-first
- deterministic output once accepted
- preserve manual `summary` override precedence
- explicit traceability for generated-vs-manual summary source

Chapter-memory specific behavior:

- generation should be hash-aware and re-run only when chapter content materially changes
- summary writes should target note `## Summary` sections with explicit user approval
- chapter-memory layer must keep deterministic fallback (first paragraph under `## Summary` -> `frontmatter summary` fallback -> excerpt)

## Future: Cost Management and Usage Tracking

Add optional cost estimation/tracking to make API spend easier to plan and audit.

Constraints:

- implemented scope includes usage hooks, deterministic ledger, pricing provenance, manager rollups/warnings, and JSON/CSV report export
- implemented scope includes configurable budget warnings for operation/model/scope dimensions
- remaining advanced work is far-future (after core retrieval/memory architecture stabilizes)
- prioritize OpenRouter integration first for usage + pricing metadata
- keep behavior deterministic for stored usage/cost records
- expose clear estimated vs actual cost labels when full provider pricing data is unavailable

## Future: Inbound Wiki Import and Story Extraction

Add reverse-direction workflows to create Obsidian wiki pages from existing external context assets.

Current progress:

- SillyTavern lorebook import command/panel is implemented with deterministic preview + note generation.
- Story extraction command/panel and deterministic chunked extraction pipeline are implemented (preview/apply flow).

Two command-driven panels:

- `Import SillyTavern Lorebook`
- `Extract Wiki Pages from Story`

Shared panel inputs:

- target folder where generated wiki pages will be created
- default tags to apply to all generated pages
- lorebook name, also converted into a lorebook tag

### Lorebook JSON Import Panel

Workflow:

- user pastes SillyTavern lorebook JSON into a text field
- parser validates and normalizes entries
- importer generates/updates wiki pages with deterministic metadata (`keywords`/`key`, tags, optional aliases/comments) and writes compact summaries to note `## Summary` sections
- importer writes deterministic page names and update order

### Story Extraction Panel

Workflow:

- user pastes story markdown into a text field
- pipeline chunks story text deterministically
- LLM processes chunks sequentially with schema-constrained JSON output
- extraction prompt enforces wiki page structure (title, summary, keywords, content blocks, merge intent)
- after each chunk, pipeline injects already-generated page state (or uses tool calls) so later chunks can extend existing pages
- final merge writes/updates wiki pages deterministically in target folder

Constraints:

- deterministic output ordering and merge behavior
- explicit conflict strategy (append/merge/overwrite policy)
- strict schema validation with recoverable error handling per chunk

## Future: Mobile Compatibility

Roadmap document:

- `docs/mobile-compatibility-plan.md`

Target direction:

- remove Node/Electron-only filesystem dependencies from core runtime paths
- keep deterministic output behavior between desktop and mobile
- support vault-relative exports/cache paths on mobile
- reject absolute filesystem export paths in favor of deterministic vault-relative outputs

## Story-Driven Wiki Update Workflow (Phase 15 Foundation)

Current status:

- foundation implemented via command/panel: `Apply Story Delta to Existing Wiki`
- deterministic chunked extraction reused from story extraction pipeline
- deterministic page matching + policy-driven update planning (`safe_append`/`structured_merge`)
- low-confidence update gating with preview warnings
- dry-run diff preview per planned change is implemented
- per-change approval selection + apply-selected workflow is implemented

Next increment:

- structured-merge conflict UX refinement (dedicated conflict review and override controls)

Goal:

- keep lore/wiki pages synchronized with story changes after drafting
- avoid full re-import when only incremental updates are needed

This is distinct from story -> wiki extraction:

- extraction creates/bootstraps pages from raw story text
- story-driven update targets existing pages and proposes deltas/edits

Shared internals:

- deterministic chunking
- schema-constrained LLM extraction
- merge/conflict handling primitives

Distinct requirements:

- deterministic page matching against existing notes
- per-change confidence/rationale output
- dry-run diff preview and approval before writes
- idempotent update application (reruns should not duplicate changes)

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

## Story Steering Additions (Completed Baseline)

To better match proven writing workflows (for example SillyTavern/NovelAI-style steering),
LoreVault should add explicit context staging controls instead of relying on implicit prompt assembly.

Current status:

- inline shorthand directives are implemented for completion/chat (`[LV: ...]`, `<!-- LV: ... -->`)
- implemented constraints: strict-prefix parsing, near-cursor scope, deterministic dedupe/order, per-turn caps, and export/import/update exclusion
- explicit steering layers are implemented as a single note-level `Author Note` plus inline directives for both Story Chat and editor continuation
- placement policy is implemented for author-note and inline-directive layers (`system`, `pre-history`, `pre-response`) via Writing Completion settings
- deterministic staged reservations + overflow trimming are implemented with fixed trim order
- inspector traces now include per-layer token usage/headroom and overflow rationale
- continuity-state controls are implemented (plot threads, open loops, canon deltas, per-group inclusion toggles) in Story Chat and continuation frontmatter
- note-level steering workspace is implemented:
  - dedicated Story Writing panel (combined writing control surface)
  - story-note `authorNote` frontmatter linking to markdown Author Note files
  - native Obsidian note editing for Author Note content
  - merged with chat/continuation steering assembly
  - lorebook scope selection resolves from story-note frontmatter first, then Author Note frontmatter
- LLM-assisted Author Note rewrite actions are implemented:
  - optional per-run update prompt to steer what should change
  - rewrite context includes linked story notes + lorebook context + current Author Note
  - review/edit modal shows current-vs-proposed Author Note diff before applying
- story text completion now supports explicit stop control (`Stop Active Generation` command + editor-menu stop while running)
- optional operation log captures full LLM request/response payloads for completion and planner calls

Planned/active steering primitives:

- explicit steering layers:
  - note-level author-note markdown block (user-defined structure)
- optional inline shorthand directives with strict prefix:
  - accepted syntax: `[LV: ...]` and `<!-- LV: ... -->`
  - non-prefixed bracket notes are treated as normal prose and ignored by steering parser
  - directives are parsed from active-story near-cursor context only
  - directives are surfaced as an explicit inspector layer
- configurable placement for each layer (`system`, pre-history, pre-response context)
- deterministic token-budget partitioning per layer with clear reserves and headroom
- deterministic overflow policy (fixed trim/compress order)
- continuity-state layer (active threads, unresolved commitments, canon deltas)

Directive safety constraints:

- directive parsing must be deterministic (document order + stable dedupe)
- directives must not leak into lore exports or wiki import/update extraction pipelines
- directive count/tokens should be capped per turn to avoid prompt abuse/bloat

Hashing migration direction (implemented):

- sync deterministic hashing remains available for internal deterministic helpers
- async runtime hashing (`sha256HexAsync`) is WebCrypto-backed (`crypto.subtle`)
- runtime hash-dependent pipelines have been migrated to async hashing call paths
- async helper no longer silently falls back to sync hashing when WebCrypto is unavailable

Inspector requirements for this phase:

- show final assembled layer order
- show token consumption and remaining headroom by layer
- show exactly what was trimmed/compressed and why

This work is tracked as Phases 20-21 in `docs/todo.md`.

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
- Story Chat agent tool loop for bounded lorebook/story/steering reads and optional write actions (`search_lorebook_entries`, `get_lorebook_entry`, `search_story_notes`, `read_story_note`, `get_steering_scope`, optional writes)
- intermediary summary generation for oversized contexts with explicit traceability

## Future: Retrieval Quality Scoring and Tuning

Goal:

- quantify retrieval quality and optimize tunables with reproducible evaluation, not anecdotal tuning

Planned approach:

1. build deterministic benchmark fixtures:
   - `query -> relevant note ids`
   - optional explicit non-relevant ids for precision/noise checks
2. compute composite quality score per run:
   - ranking quality (`nDCG@k`)
   - coverage (`Recall@k`)
   - routing precision (`world_info` vs fallback decisions)
   - token-efficiency penalties (context bloat/noise)
3. run parameter sweeps over retrieval tunables:
   - graph expansion (`maxGraphHops`, `graphHopDecay`, backlink boost)
   - fallback behavior (`off|auto|always`, threshold)
   - budget/body-lift thresholds and ratios
4. select candidates with held-out benchmark validation to limit overfitting
5. keep output deterministic and explainable (score breakdown + selected config + run seed)

Notes:

- begin with grid/random search; add Bayesian optimization only when tunable dimensionality justifies it
- this remains offline/operator tooling first, not an always-on runtime auto-tuner

## Constraints

- Keep deterministic export and traceable debug behavior.
- Keep Obsidian-native workflows first (tags/frontmatter/links).
- Support downstream SillyTavern first; keep other RAG destinations compatible.

## Working Defaults (Decision Log)

Unless overridden in a later roadmap decision:

- embedding fallback policy is configured globally (not per-lorebook yet)
- auto fallback seed threshold remains `120`
- graph expansion is wikilinks-first
- chat scope/context selection persists per conversation note
- chapter ordering prefers explicit `chapter` index before link/path tie-breaks
- chapter memory summaries are chapter-level by default
- low-confidence story-driven wiki updates are queued for manual review

## Implementation Principles

- Build iteratively with migration safety.
- Keep old behavior only as temporary compatibility mode where required.
- Every heuristic should have explicit override and debug output.

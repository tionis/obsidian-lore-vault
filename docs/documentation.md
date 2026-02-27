# LoreVault Documentation

## Overview

LoreVault compiles Obsidian notes into deterministic context exports.

Current runtime export targets per scope:

- canonical LoreVault SQLite pack (`.db`)
- SillyTavern-style `world_info` JSON
- `rag` markdown pack

## Compatibility

- Plugin id: `lore-vault`
- Plugin name: `LoreVault`
- Minimum Obsidian version: `0.15.0`
- Desktop only (`isDesktopOnly: true`)

## Conversion Pipeline

When you run **Build Active Lorebook Scope** or **Build/Export Scope**:

1. Collect all markdown files
2. Resolve lorebook scopes from hierarchical tags
3. Parse frontmatter + markdown body
4. Route notes into `world_info`, `rag`, or both
5. Build wikilink graph for `world_info` entries
6. Compute deterministic `order`
7. Build canonical SQLite pack (`world_info`, `rag`, chunks, embeddings)
8. Export scoped `world_info` JSON + scoped `rag` markdown

## Tag Scoping

Selection is driven by hierarchical tags under a configurable prefix:

- default prefix: `lorebook`
- examples:
  - `#lorebook/universe`
  - `#lorebook/universe/yggdrasil`
  - `#lorebook/universe/yggdrasil/factions`

Settings:

- `tagPrefix`
- `activeScope`
- `membershipMode` (`exact` | `cascade`)
- `includeUntagged`

Behavior:

- `exact`: only notes with matching scope tag are included
- `cascade`: notes in child scopes are also included in ancestor scope exports
- notes with frontmatter `exclude: true` are always skipped
- empty `activeScope`: no configured fallback scope
- export command builds one scope at a time:
  - active file lorebook scope first
  - otherwise configured `activeScope`
- manager view discovers all scopes and provides per-scope build actions

## Frontmatter Parsing

Structured metadata is frontmatter-first.

Key fields:

- `title` / `comment`
- `aliases`
- `keywords` / `key`
- `summary`
- `trigger_method`
- `selectiveLogic`
- `probability`
- `depth`
- `group`
- `exclude`
- `root` / `lorebookRoot`
- `retrieval`

Content:

- markdown body (frontmatter stripped)
- overridden by `summary` when present

## Retrieval Routing

Default (`retrieval: auto`):

- note has `keywords`/`key` -> `world_info`
- note has no `keywords`/`key` -> `rag`

Overrides:

- `retrieval: world_info`
- `retrieval: rag`
- `retrieval: both`
- `retrieval: none`

## Root Behavior

Hierarchy root is:

1. explicit frontmatter root (`root: true` / `lorebookRoot: true`) in deterministic file order
2. otherwise inferred deterministically from graph connectivity

## Wikilink Normalization

Supported link forms:

- `[[Page]]`
- `[[Page|Alias]]`
- embedded wikilinks

Normalization:

- `\` -> `/`
- strip `#...` refs
- strip `.md`
- trim whitespace

Ambiguous basename mappings are removed to avoid incorrect edge links.

## Ranking / Order

Order uses weighted normalized metrics:

- hierarchy depth
- in-degree
- PageRank
- betweenness
- out-degree
- total degree
- file depth

Computation:

- `order = max(1, floor(score))`
- ties resolved deterministically by ascending UID offsets

## Testing

```bash
npm run build
npm test
```

Fixture coverage includes:

- graph-order determinism
- wikilink normalization and ambiguity handling
- lorebook scope selection (`exact` + `cascade`)
- retrieval routing mode parsing and target resolution
- output path resolution/collision checks
- rag markdown export ordering
- rag chunking determinism

## Output Naming Rules

Given configured downstream output subpath + SQLite output directory:

- SQLite pack file: `<sqliteOutputDir>/<scope-slug>.db` (default: `lorebooks/<scope-slug>.db`)
- world info file: `<sqliteOutputDir>/<downstreamSubpath>.json` (default subpath: `sillytavern/lorevault.json`)
- rag file: `<sqliteOutputDir>/<downstreamSubpath>.rag.md`

Downstream naming:

- if downstream subpath contains `{scope}`: replace token with scope slug
- otherwise append `-<scope-slug>` before extension

SQLite path behavior:

- if SQLite output setting is a directory: write `<dir>/<scope-slug>.db`
- if SQLite output setting is a `.db` file path: append `-<scope-slug>` unless `{scope}` is present
- downstream exports are always written under the SQLite scope directory (for example `lorebooks/sillytavern/...`)
- absolute downstream subpaths are normalized to file basename under SQLite root

Output build fails fast if path collisions are detected.

## Embeddings and Semantic RAG

Configurable embedding providers:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Default model:

- `qwen/qwen3-embedding-8b`

Caching:

- one-file-per-hash cache records
- cache key includes:
  - chunk text hash
  - provider/model
  - instruction
  - chunking signature

Chunking modes:

- `auto` (heuristic)
- `note`
- `section`

Live query combines:

- lexical scoring
- optional semantic boost from chunk embeddings

## Writing Completion

Command: `Continue Story with Context`
Also available in markdown editor right-click menu as `LoreVault: Continue Story with Context`.

Provider options:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Settings:

- enable/disable completion
- provider, endpoint, api key, model
- system prompt
- temperature
- max output tokens
- context window tokens
- prompt reserve tokens
- timeout

Story frontmatter scope override:

- keys: `lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`
- value format:
  - list: `['universe', 'universe/yggdrasil']`
  - comma-separated string: `universe, universe/yggdrasil`
  - accepts `lorebook/<scope>` and `#lorebook/<scope>` forms
- behavior:
  - values are normalized and deduplicated deterministically
  - each selected scope is queried and combined into completion context
  - completion token budget is split across selected scopes
  - context budgets are trimmed iteratively if selected context exceeds input budget

## LoreVault Manager UI

Command: `Open LoreVault Manager` (opens a persistent right-side workspace panel)

Capabilities:

- lists discovered scopes with deterministic ordering in compact cards
- separates generation monitor from scope actions for clearer layout
- shows counts:
  - included notes
  - `world_info` entries
  - `rag` documents
- generation monitor details:
  - current generation state (`idle|preparing|retrieving|generating|error`)
  - active scopes
  - provider/model
  - context window and token usage
  - selected `world_info` and `rag` items used for the active/last run
- warns when scopes have no included notes or no entries in one section
- actions:
  - `Build/Export` per scope
  - `Inspect Routing` per scope
  - `Open Routing Debug` (toolbar)
  - `Open Output Folder` (opens SQLite output root)

## Routing Debug UI

Command: `Open LoreVault Routing Debug`

Capabilities:

- opens a dedicated workspace view with more horizontal space for routing diagnostics
- scope selector for switching debug target
- full inclusion/routing table for selected scope:
  - note path
  - inclusion/exclusion reason
  - retrieval mode and keyword presence
  - resolved route (`world_info`, `rag`, both, or none)
  - detected lorebook scopes

## Live Query Layer (MVP)

Command: `Continue Story with Context`

Runtime behavior:

- initializes an in-memory context index at plugin load
- subscribes to vault changes (`create`, `modify`, `delete`, `rename`)
- applies debounced near-live refresh for affected scopes
- supports full rebuild when settings change or export completes

Query behavior:

- query text source: active editor content up to cursor (last window)
- scope resolution:
  - first lorebook scope tag on active file, if present
  - otherwise configured `activeScope`
  - otherwise first discovered scope
- scoring:
  - `world_info`: keyword matches + constant/priority boosts
  - `rag`: term overlap in title/path/content
- completion:
  - builds a prompt from scope context + recent story window
  - calls configured completion provider with streaming enabled
  - inserts streamed generated continuation text at cursor
- deterministic tie-breakers:
  - `world_info`: score desc, order desc, uid asc
  - `rag`: score desc, path asc, title asc, uid asc

Token budgeting:

- uses completion context budget (`contextWindowTokens - maxOutputTokens`) and lorebook token budget cap (`defaultLoreBook.tokenBudget`)
- reserves headroom via `promptReserveTokens`
- trims story window to keep minimum context capacity
- splits budget between sections (`world_info` 60%, `rag` 40%)
- iteratively shrinks per-scope context budget if total selected context exceeds input budget
- skips entries/documents that would exceed section budget
- context block is used for generation input and is not inserted into the note

## Story Chat Panel

Command: `Open Story Chat`

Current behavior:

- opens a persistent workspace view (non-modal)
- includes an in-chat generation monitor (state, scopes, token usage, output progress)
- supports streaming send/stop controls
- stores per-chat context controls:
  - selected lorebook scopes
  - `Use Lorebook Context` toggle
  - manual context text
  - specific note references (`path`, basename, or `[[wikilink]]`)
- shows live resolved/unresolved preview for specific note references
- allows manual-context-only operation by disabling lorebook context or selecting no scopes
- supports per-message actions:
  - `Edit` past user/assistant messages
  - `Fork Here` to save branch snapshots at any turn
  - `Regenerate` on latest assistant turn
- provides fork snapshot controls to load/delete alternate conversation branches
- persists chat transcript, controls, and fork snapshots in plugin data

Turn context assembly:

- optional lorebook retrieval for selected scopes
- optional manual context block
- optional specific-note context blocks resolved from note references
- recent chat history window
- deterministic context inspector metadata attached to assistant turns:
  - selected scopes
  - resolved specific note paths
  - unresolved note references
  - context token estimate
  - selected `world_info` and `rag` item labels

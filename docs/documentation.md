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

When building multiple scopes:

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

## LoreVault Manager UI

Command: `Open LoreVault Manager` (opens a persistent right-side workspace panel)

Capabilities:

- lists discovered scopes with deterministic ordering
- shows counts:
  - included notes
  - `world_info` entries
  - `rag` documents
- warns when scopes have no included notes or no entries in one section
- actions:
  - `Build/Export Scope`
  - `Open Output Folder` (opens SQLite output root)
- debug drill-down per scope:
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
- deterministic tie-breakers:
  - `world_info`: score desc, order desc, uid asc
  - `rag`: score desc, path asc, title asc, uid asc

Token budgeting:

- uses lorebook token budget (`defaultLoreBook.tokenBudget`)
- splits budget between sections (`world_info` 60%, `rag` 40%)
- skips entries/documents that would exceed section budget
- emits deterministic markdown context block

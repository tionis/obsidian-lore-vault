# LoreVault

Obsidian plugin that compiles Obsidian notes into scoped context exports for SillyTavern and RAG workflows.

## Current Status

- Desktop-only plugin (`manifest.json` uses `isDesktopOnly: true`)
- Hierarchical lorebook tag scoping (`#lorebook/...`) with exact/cascade membership
- Canonical SQLite pack export per scope (`.db`)
- Stable per-scope manifest export (`.manifest.json`) for downstream tooling contracts
- Dual exports per scope: `world_info` JSON and `rag` markdown
- Optional embedding-based semantic RAG with hash-cache
- Graph-first retrieval with configurable RAG fallback policy (`off|auto|always`)
- Optional LLM completion generation for story continuation
- Deterministic story-thread resolution (`storyId` + `chapter` + prev/next refs) with prior-chapter memory injection
- Story Chat panel with per-chat lorebook scope selection and manual-context mode
- Dedicated routing debug panel for inclusion/routing diagnostics
- Dedicated query simulation panel for multi-scope retrieval simulation
- Embedded user help panel (`Open LoreVault Help`)
- Frontmatter retrieval routing (`auto|world_info|rag|both|none`)
- Deterministic processing, ordering, and tie-breaking
- Fixture-backed regression tests for graph ordering, wikilinks, lorebook scoping, retrieval routing, and output naming

## Migration Notes

- Plugin id is now `lore-vault`.
- Install/update path should be `.obsidian/plugins/lore-vault/`.
- If you previously used `.obsidian/plugins/lorebook-converter/`, move the plugin files to the new folder.

## Source Selection (Hierarchical Tags)

The converter scans all markdown files and maps notes to lorebook scopes by tag namespace.

Example tags:

- `#lorebook/universe`
- `#lorebook/universe/yggdrasil`
- `#lorebook/universe/yggdrasil/factions`

Settings:

- `tagPrefix`: lorebook namespace prefix (default `lorebook`)
- `activeScope`: optional target scope (`universe/yggdrasil`)
- `membershipMode`:
  - `exact`: only exact scope membership
  - `cascade`: include ancestor and descendant scopes in the same branch
- `includeUntagged`: include notes without lorebook tags

Notes with frontmatter `exclude: true` are always skipped.

Build behavior:

- `Build Active Lorebook Scope` resolves one scope at a time:
  - first lorebook scope on the active file
  - otherwise configured `activeScope`
- `Open LoreVault Manager` lists all discovered scopes and provides per-scope `Build/Export Scope`.

## Frontmatter Parsing Model

Structured fields are read from frontmatter only. Legacy `# Field: value` parsing is no longer used.

Supported examples:

```yaml
---
tags: [lorebook/universe/yggdrasil]
title: "Aurelia"
aliases: ["The Radiant Sphere"]
keywords: ["Aurelia", "Radiant Sphere"]
summary: "Compact override content for this entry."
trigger_method: selective
selectiveLogic: 0
probability: 100
depth: 4
root: true
---
```

Entry content defaults to the markdown body (frontmatter block removed).  
If `summary` is present, it overrides entry content.

## Retrieval Routing

Default routing (`retrieval: auto`):

- `keywords` or `key` present -> `world_info`
- no `keywords`/`key` -> `rag`

Per-note override:

```yaml
---
retrieval: auto   # auto | world_info | rag | both | none
---
```

Routing behavior:

- `world_info` uses compact entry content (`summary` when present, else note body)
- `rag` uses the full note body (frontmatter removed)

## Root Handling

- Optional explicit root: `root: true` (or `lorebookRoot: true`) in frontmatter
- If no explicit root exists, the plugin infers one deterministically from graph connectivity

## Link Resolution

- Detects `[[Page]]`, `[[Page|Alias]]`, and embedded wikilinks
- Normalizes targets by:
  - stripping heading/block refs (`#...`)
  - stripping `.md`
  - converting `\` to `/`
- Notes are mapped by full path and basename
- Ambiguous basenames are dropped from basename lookup to avoid wrong links

## Ranking / Order

Order uses weighted normalized metrics:

- hierarchy depth (BFS from root)
- in-degree
- PageRank
- betweenness
- out-degree
- total degree
- file depth

Details:

- `order = max(1, floor(weighted_score))`
- ties are broken deterministically by ascending UID offsets

## Output Files

For each built scope, LoreVault writes:

- `<sqliteOutputDir>/<scope-slug>.db` -> canonical SQLite pack (default dir: `lorebooks/`)
- `<sqliteOutputDir>/<scope-slug>.manifest.json` -> deterministic scope manifest for downstream tooling
- `<sqliteOutputDir>/<downstreamSubpath>.json` -> `world_info` (default subpath: `sillytavern/lorevault.json`)
- `<sqliteOutputDir>/<downstreamSubpath>.rag.md` -> `rag`

Downstream filenames are scope-specific. If the downstream subpath does not contain `{scope}`, LoreVault appends a scope slug:

- `lorebooks/sillytavern/lorevault-universe.json`
- `lorebooks/sillytavern/lorevault-universe.rag.md`

If downstream subpath contains `{scope}`, the token is replaced by the scope slug.  
Export aborts if two scopes resolve to the same output path.

## Canonical Pack and Embeddings

SQLite pack includes:

- `world_info` entries
- `rag` documents
- chunked `rag` text segments
- optional chunk embeddings

Embedding backends:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Default embedding model: `qwen/qwen3-embedding-8b`.

Embedding cache is one-file-per-hash so it syncs better across devices and avoids frequent recomputation.

## LoreVault Manager

Use command `Open LoreVault Manager` to open the persistent right-sidebar panel for scope inspection and operations.

Manager features:

- per-scope counts (included notes, `world_info`, `rag`)
- scope warnings when sections are empty
- generation monitor (running state, active scopes, token budget, selected context items, output progress)
- `Build/Export` action per scope
- `Inspect Routing` action per scope
- toolbar shortcuts to open routing and query simulation diagnostics

## Routing Debug

Use command `Open LoreVault Routing Debug` to open a dedicated diagnostics view.

Routing debug features:

- scope selector
- lorebook contents panel for `world_info` entries (keywords, trigger params, collapsible content)
- note-level inclusion/exclusion reasons
- retrieval mode and keyword presence
- resolved route (`world_info`, `rag`, both, or none)
- detected scope tags per note

## Query Simulation

Use command `Open LoreVault Query Simulation` to open a dedicated retrieval simulation view.

Query simulation features:

- multi-scope selection (simulate across multiple lorebooks at once)
- token budget split across selected scopes
- optional override controls (`maxGraphHops`, `graphHopDecay`, RAG fallback policy/threshold, world_info/rag limits)
- selected `world_info` diagnostics (score breakdown, path/reasons, included content tier)
- selected `rag` diagnostics (scores and matched terms)

## Writing Assistant Commands (MVP)

Command: `Continue Story with Context`

Behavior:

- builds/refreshes an in-memory scope index
- watches note create/modify/delete/rename events and performs near-live refresh
- resolves optional chapter-memory context from prior chapters using story frontmatter (`storyId`, `chapter`, `chapterTitle`, `previousChapter`, `nextChapter`)
- queries retrieval layers from current editor context:
  - `world_info` by graph-first seed + expansion relevance
  - `rag` by fallback policy (`off|auto|always`) and relevance
- applies token-budgeted context assembly
- sends context + story window to configured completion provider
- streams generated continuation text into the editor at cursor (no raw context dump)
- updates status bar while running (`preparing`, `retrieving`, `generating`, `error`, `idle`)
- reports active scopes and pulled `world_info`/`rag` items at generation start
- adds a right-click editor context-menu action: `LoreVault: Continue Story with Context`

Configure generation under Settings -> LoreVault -> Writing Completion.
Key completion controls include context window tokens and prompt reserve tokens for stricter budget management.

Story-level scope override (frontmatter):

```yaml
---
lorebooks:
  - universe
  - universe/yggdrasil
---
```

Accepted keys: `lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`.

## Embedded Help

Command: `Open LoreVault Help`

Provides an in-plugin overview of:

- scope/tag setup
- retrieval and fallback behavior
- build/export artifacts
- story completion/chat workflow
- links to repository docs and roadmap files

## Story Chat (Phase 10 Foundation)

Command: `Open Story Chat`

Current capabilities:

- persistent right-sidebar chat panel
- in-chat generation monitor (state, scopes, context/output token usage)
- conversation selector (dropdown) with `New Chat` creation
- streaming assistant responses
- per-chat lorebook scope selection (including none)
- `Use Lorebook Context` toggle
- manual context block (for manual-only or mixed mode)
- specific notes context via note picker list (`Add Note`, `Add Active`, remove per item)
- each chat/fork is saved as a markdown note under `LoreVault/chat`
- chat conversation folder is configurable in settings (`Story Chat Conversation Folder`)
- message-level actions: `Edit`, `Fork Here`, and `Regenerate` (latest assistant message)
- regenerate appends a new assistant message version; users can switch active versions
- per-response context inspector (scopes, specific notes, unresolved refs, token estimate, `world_info`/`rag` items)

Story Chat state is persisted primarily in conversation notes, with settings storing active conversation path.

## Development

```bash
npm install
npm run build
npm test
```

See:

- `docs/approach.md`
- `docs/documentation.md`
- `docs/technical-reference.md`
- `docs/installation-guide.md`
- `docs/profile-schema.md`
- `docs/planning.md`
- `docs/todo.md`

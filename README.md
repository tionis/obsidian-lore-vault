# LoreVault

Obsidian plugin that compiles Obsidian notes into scoped context exports for SillyTavern and RAG workflows.

## Current Status

- Desktop-only plugin (`manifest.json` uses `isDesktopOnly: true`)
- Hierarchical lorebook tag scoping (`#lorebook/...`) with exact/cascade membership
- Dual exports per scope: `world_info` JSON and `rag` markdown
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
  - `cascade`: include descendant scopes in parent scope exports
- `includeUntagged`: include notes without lorebook tags

Notes with frontmatter `exclude: true` are always skipped.

If `activeScope` is empty, LoreVault discovers all scopes under the configured prefix and builds one export set per scope.

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

- `<base>.json` -> `world_info`
- `<base>.rag.md` -> `rag`

If multiple scopes are built and the output path does not contain `{scope}`, LoreVault appends a scope slug:

- `vault-lorevault-universe.json`
- `vault-lorevault-universe.rag.md`

If output path contains `{scope}`, the token is replaced by the scope slug.  
Export aborts if two scopes resolve to the same output path.

## LoreVault Manager

Use command `Open LoreVault Manager` to open the persistent right-sidebar panel for scope inspection and operations.

Manager features:

- per-scope counts (included notes, `world_info`, `rag`)
- scope warnings when sections are empty
- `Build/Export Scope` and `Build/Export All Scopes` actions
- `Open Output Folder` action
- debug drill-down table showing why each note is included/excluded and how it is routed

## Writing Assistant Commands (MVP)

Command: `Continue Story with Context`

Behavior:

- builds/refreshes an in-memory scope index
- watches note create/modify/delete/rename events and performs near-live refresh
- queries both retrieval layers from current editor context:
  - `world_info` by keyword/trigger relevance
  - `rag` by term-overlap relevance
- applies token-budgeted context assembly
- inserts a deterministic context block plus a continuation draft heading at cursor

## Development

```bash
npm install
npm run build
npm test
```

See:

- `docs/documentation.md`
- `docs/installation-guide.md`
- `docs/profile-schema.md`
- `docs/planning.md`
- `docs/todo.md`

# LoreVault Documentation

## Overview

LoreVault compiles Obsidian notes into deterministic context exports.

Current runtime export target is SillyTavern-style `world_info` JSON, with tag-scoped selection.

## Compatibility

- Plugin id: `lorebook-converter` (kept for migration stability)
- Plugin name: `LoreVault`
- Minimum Obsidian version: `0.15.0`
- Desktop only (`isDesktopOnly: true`)

## Conversion Pipeline

When you run **Build LoreVault Export**:

1. Collect all markdown files
2. Select files based on hierarchical lorebook tags
3. Parse frontmatter + markdown body into entries
4. Build wikilink graph
5. Compute deterministic `order`
6. Export lorebook JSON

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

Content:

- markdown body (frontmatter stripped)
- overridden by `summary` when present

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

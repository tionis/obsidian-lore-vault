# LoreVault

Obsidian plugin that compiles Obsidian notes into scoped context exports for SillyTavern and RAG workflows.

## Current Status

- Desktop-only plugin (`manifest.json` uses `isDesktopOnly: true`)
- Hierarchical lorebook tag scoping (`#lorebook/...`) with exact/cascade membership
- Deterministic processing, ordering, and tie-breaking
- Fixture-backed regression tests for graph ordering, wikilinks, and lorebook scoping

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

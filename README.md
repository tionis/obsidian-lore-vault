# Lorebook Converter

Obsidian plugin that exports vault notes into SillyTavern-compatible lorebook JSON.

## Current Status

- Desktop-only plugin (`manifest.json` uses `isDesktopOnly: true`)
- Frontmatter-driven source selection and field parsing
- Deterministic processing, ordering, and tie-breaking
- Fixture-backed regression tests for graph ordering, wikilinks, and source selection

## Source Selection (Frontmatter + Rules)

The converter scans all markdown files, then applies selection rules:

1. Explicit frontmatter exclusion always skips a note:
   - `exclude: true`
   - `lorebook: false`
   - `lorebook: { enabled: false }`
2. Folder/tag include and exclude rules from plugin settings are applied
3. If `requireLorebookFlag` is enabled (default), note frontmatter must enable lorebook usage:
   - `lorebook: true`
   - `lorebook: [ ... ]` (non-empty)
   - `lorebook: { ... }` unless explicitly disabled

Rules are path/tag based and deterministic.

## Frontmatter Parsing Model

Structured fields are read from frontmatter only. Legacy `# Field: value` parsing is no longer used.

Supported examples:

```yaml
---
lorebook: true
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
- `docs/todo.md`

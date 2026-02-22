# Lorebook Converter Documentation

## Overview

Lorebook Converter compiles Obsidian markdown notes into SillyTavern lorebook JSON.

Current architecture is:

- frontmatter-driven metadata and inclusion
- deterministic graph + ranking pipeline
- configurable folder/tag source-selection rules

## Compatibility

- Plugin id: `lorebook-converter`
- Minimum Obsidian version: `0.15.0`
- Desktop only (`isDesktopOnly: true`)

## Conversion Pipeline

When you run **Convert Vault to Lorebook**:

1. Collect all markdown files
2. Filter files using frontmatter + selection rules
3. Parse selected files into lorebook entries
4. Build a directed graph from wikilinks
5. Compute entry `order`
6. Export lorebook JSON

All file traversal is deterministic (`path` sorted).

## Source Selection Rules

Rules are configured in Settings under **Source Selection Rules**.

### Rule Inputs

- `requireLorebookFlag` (boolean)
- `includeFolders` (list of folder prefixes)
- `excludeFolders` (list of folder prefixes)
- `includeTags` (list of tags)
- `excludeTags` (list of tags)

### Inclusion Logic

A note is excluded immediately if frontmatter says:

- `exclude: true`
- `lorebook: false`
- `lorebook: { enabled: false }`
- `lorebook: { exclude: true }`

Then folder and tag rules are applied:

- excluded folders/tags remove the note
- include folders/tags must match when configured

If `requireLorebookFlag` is true (default), note frontmatter must enable lorebook:

- `lorebook: true`
- `lorebook: [ ... ]` (non-empty)
- `lorebook: { ... }` (unless explicitly disabled)

## Frontmatter Parsing

Structured metadata is frontmatter-only.

Legacy `# Field: value` parsing is removed.

### Key Fields

- `title` / `comment`
- `aliases`
- `keywords` / `key`
- `keysecondary`
- `summary`
- `trigger_method`
- `selectiveLogic`
- `probability`
- `depth`
- `group`
- `exclude`
- `root` or `lorebookRoot`

### Content Rules

- Markdown body is used as entry content (frontmatter stripped)
- `summary` overrides body content when present

### Type Handling

- booleans: standard true/false style values
- numbers: numeric parsing for numeric fields
- arrays: comma-separated strings or YAML lists

## Trigger Mode and Selective Logic

Trigger mode is normalized to exactly one:

- `constant`
- `vectorized`
- `selective`

`selectiveLogic` supports `0..3`:

- `0` AND ANY
- `1` AND ALL
- `2` NOT ANY
- `3` NOT ALL

Legacy text forms like `OR` and `AND` are normalized.

## Root Behavior

Root used for hierarchy metric is chosen as:

1. Explicit frontmatter root (`root: true` or `lorebookRoot: true`), first in deterministic file order
2. If none exists, inferred deterministically from graph connectivity (highest in-degree, then total degree, then lowest UID)

## Wikilink Normalization

Detected forms:

- `[[Page]]`
- `[[Page|Alias]]`
- embedded wikilinks (e.g. `![[Page]]`)

Normalization:

- convert `\` to `/`
- strip refs after `#`
- strip trailing `.md`
- trim whitespace

Indexing:

- each entry maps by normalized full path + basename
- ambiguous basenames are removed from basename lookup

## Ranking / Order

`order` is based on weighted normalized metrics:

- hierarchy depth
- in-degree
- PageRank
- betweenness
- out-degree
- total degree
- file depth

Computation:

- `order = max(1, floor(score))`
- equal orders are resolved deterministically by ascending UID offsets

## Export

Output includes:

- `entries` dictionary keyed by UID string
- lorebook `settings`

Before serialization:

- `wikilinks` are removed
- default entry values are filled where needed
- trigger mode is normalized

Path behavior:

- relative output path -> vault adapter write
- absolute output path -> Node `fs` write

## Testing

```bash
npm run build
npm test
```

Current fixture-backed coverage includes:

- graph-order determinism
- wikilink normalization and ambiguity handling
- source-selection rule behavior

## Known Limitations

- Basename-only links can be unresolved when names collide (full-path links recommended)
- Frontmatter parsing relies on Obsidian cache interpretation for runtime metadata

# Lorebook Converter Documentation

## Overview

Lorebook Converter exports Obsidian markdown notes into a SillyTavern lorebook JSON file.

Primary goals:

- stable/deterministic exports
- practical link-driven prioritization
- configurable defaults for lorebook and entry fields

## Compatibility

- Obsidian plugin id: `lorebook-converter`
- Minimum Obsidian version: `0.15.0`
- Platform: desktop only (`isDesktopOnly: true`)

## Conversion Pipeline

When you run **Convert Vault to Lorebook**, the plugin does:

1. Collect all markdown files from the vault
2. Find a root file (if available)
3. Parse valid source notes into lorebook entries
4. Build a directed graph from wikilinks
5. Calculate `order` using graph and folder metrics
6. Export JSON to the configured output path

File processing order is deterministic (`path`-sorted).

## Source Note Selection

A markdown file is treated as a source note only if at least one of these is true:

1. It has a top-level field line in this form: `# Field: value`
2. It contains a line exactly matching `# Root`
3. Its YAML frontmatter contains `lorebook: true`

Notes that do not match any of the above are skipped.

## Root Selection

Root file selection order:

1. First markdown file (in sorted path order) containing `# Root`
2. Fallback to a vault-root file named one of:
   - `Root.md`
   - `root.md`
   - `index.md`
   - `World.md`
   - `world.md`

If no root is found, hierarchy depth is effectively `0` for all nodes.

## Field Parsing Rules

## Field Syntax

- Top-level fields use: `# Name: value`
- Parsing is case-insensitive on field names
- Spaces in field names are normalized out (`Trigger Method` -> `triggermethod`)

## Content Extraction

### If `# Content:` exists

- Content starts at `# Content:`
- Inline text on the same line is included
- Content continues until the next top-level field line (`# Something: ...`)
- Markdown headings like `## Heading` are preserved

### If `# Content:` does not exist

- If any top-level field lines exist, content is the note with those field lines removed
- Otherwise, content is the entire note text

## Type Coercion

- Arrays: `key`, `keysecondary`, `keywords` are split on commas
- Booleans: known boolean fields or literal `true`/`false`
- Numbers: known numeric fields or numeric-looking values

## Normalization / Compatibility

- `keywords` is used as `key` if `key` is missing
- `title` is used as `comment` if `comment` is missing
- Trigger method is normalized so only one of:
  - `constant`
  - `vectorized`
  - `selective`

## Selective Logic

Supported values:

- `0` => AND ANY
- `1` => AND ALL
- `2` => NOT ANY
- `3` => NOT ALL

Legacy text values are normalized where possible (`OR`, `AND`, etc.).

## Wikilink Parsing and Graph Mapping

## Detected Link Forms

- `[[Page]]`
- `[[Page|Alias]]`
- embeds like `![[Page]]` (the inner wikilink is parsed)

## Target Normalization

For graph linking, targets are normalized by:

- converting `\` to `/`
- stripping heading/block refs after `#`
- stripping trailing `.md`
- trimming whitespace

Example:

- `[[Characters\Alice.md#Bio]]` -> `Characters/Alice`

## Mapping Strategy

Each parsed note is indexed by:

1. normalized full path
2. normalized basename

If multiple notes share the same basename, basename mapping is removed as ambiguous. Full-path mapping remains.

## Ranking / Order Calculation

`order` is calculated from a weighted sum of normalized metrics:

- hierarchy depth (BFS from root)
- in-degree
- PageRank
- betweenness centrality
- out-degree
- total degree
- folder depth

Formula behavior:

- `score = Σ(weight_i * normalized_metric_i)`
- `order = max(1, floor(score))`
- ties are broken deterministically by ascending UID with small offsets

No randomization is used in tie-breaking.

## Export Behavior

## Entry Defaults

Before serialization, each entry is normalized:

- exactly one trigger mode is active
- missing `selectiveLogic`, `probability`, `depth`, `groupWeight` are filled from settings

## Output Structure

Exports:

- `entries` dictionary keyed by UID string
- `settings` object with lorebook defaults

Internal `wikilinks` are excluded from the final JSON.

## Output Path Handling

- Relative path: written via Obsidian vault adapter (inside vault)
- Absolute path: written via Node `fs` (desktop)

## Settings UI Notes

Configurable groups:

- output path
- default lorebook settings
- default entry settings
- graph metric weights

Default trigger method is mutually exclusive and saved as one of constant/vectorized/selective.

## Testing

Run:

```bash
npm run build
npm test
```

Current fixture-backed regression coverage includes:

- deterministic tie behavior in graph ordering
- wikilink normalization and ambiguous basename handling

## Known Limitations

- Only top-level `# Field: value` syntax is parsed as structured metadata
- Basename-only links are unresolved when basename collisions exist
- Frontmatter parsing is currently only used for opt-in detection (`lorebook: true`)

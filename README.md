# Lorebook Converter

Obsidian plugin that exports vault notes into SillyTavern-compatible lorebook JSON.

## Current Status

- Desktop-only plugin (`manifest.json` sets `isDesktopOnly: true`)
- Deterministic processing and tie-breaking
- Fixture-backed regression tests for ranking determinism and wikilink resolution

## How Source Notes Are Selected

The converter scans all markdown files in the vault, then includes a file only if one of these is true:

1. It contains at least one top-level field line like `# Field: value`
2. It contains a line exactly matching `# Root`
3. Its frontmatter contains `lorebook: true`

Files are processed in deterministic `path` order.

## Parsing Rules

- Field format: `# Field Name: value` (case-insensitive)
- `# Content:` handling:
  - If present, content is taken from that field to the next top-level field line
  - Markdown headings like `## Heading` are preserved
- Without `# Content:`, content becomes the note text with top-level field lines removed
- `# Keywords:` and `# Key:` are parsed as comma-separated arrays
- `# Selective Logic:` supports:
  - `0` = AND ANY
  - `1` = AND ALL
  - `2` = NOT ANY
  - `3` = NOT ALL
  - Legacy text values (`OR`, `AND`, etc.) are normalized

## Link Resolution Rules

- Wikilink patterns: `[[Page]]`, `[[Page|Alias]]`, and embeds like `![[Page]]`
- For graph linking, targets are normalized by:
  - stripping heading/block refs (`#...`)
  - stripping `.md`
  - converting `\` to `/`
- Each note is mapped by full path and basename
- If two notes share the same basename, basename lookup is marked ambiguous and removed; full-path links continue to work

## Root Selection

Root is selected in this order:

1. First file (by sorted path) containing a line `# Root`
2. Fallback vault-root file name match: `Root.md`, `root.md`, `index.md`, `World.md`, `world.md`

If no root is found, hierarchy depth contributes `0` for all notes.

## Ranking / Order Calculation

Order is computed from a weighted sum of normalized metrics:

- hierarchy depth (from root via BFS)
- in-degree
- PageRank
- betweenness
- out-degree
- total degree
- file depth

Implementation details:

- `order = max(1, floor(weighted_score))`
- ties are broken deterministically by ascending UID (`+1`, `+2`, ...)

## Output Behavior

- Exports `entries` + lorebook-level `settings`
- Internal `wikilinks` are removed from exported entries
- Trigger mode is normalized to exactly one of constant/vectorized/selective
- Missing defaults are filled from plugin settings before serialization
- Relative output path writes inside vault; absolute output path writes via Node `fs`

## Development

```bash
npm install
npm run build
npm test
```

Detailed docs:

- `docs/documentation.md`
- `docs/installation-guide.md`

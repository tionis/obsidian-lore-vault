# Multi-Target Profile Schema (Draft v1)

This document defines the initial profile schema for producing multiple focused outputs from a single vault.

Current implementation status:

- schema types and deterministic template expansion are implemented
- full runtime wiring into export pipeline is the next step

## Goals

- one canonical source vault
- multiple focused outputs (core, per-world, per-subpack)
- deterministic expansion and output naming
- shared selector language across output targets

## Config File

Default path (draft): `sillynotes.config.yaml` at vault/plugin root.

See repository example:

- `sillynotes.config.yaml`

## Top-Level Keys

```yaml
version: 1
frontmatter: ...
targets: [...]
```

### `version`

Schema version integer. Current draft uses `1`.

### `frontmatter`

Declares field names used for expansion/selectors.

```yaml
frontmatter:
  worldField: world
  factionField: factions
  profileField: lorebookProfiles
```

### `targets`

Array of target templates.

## Target Template Shape

```yaml
- id: world:{world}
  description: One focused lorebook per world.
  expansion:
    variable: world
    valuesFromFrontmatterField: world
  selector:
    mode: all
    includeTags: [canon]
    excludeTags: [draft]
    includeFolders: [Worlds]
    excludeFolders: [Templates]
    includeFrontmatter:
      world: "{world}"
  outputs:
    lorebookJson:
      enabled: true
      outputPath: exports/lorebooks/world-{world}.json
    ragMarkdown:
      enabled: true
      outputPath: exports/databank/world-{world}.md
```

## Expansion Model

Expansion is optional:

- no `expansion`: single target (e.g. `core`)
- with `expansion`: one target per unique value from a frontmatter field

Determinism requirements:

- expansion values are deduplicated
- expansion values are sorted lexicographically
- template order is preserved

Result example for worlds `Aurelia`, `Nexus`:

- `world:Aurelia`
- `world:Nexus`

## Selector Semantics

Selectors are declarative filters applied per target:

- `mode`: `all` or `any` (default planned: `all`)
- `includeTags` / `excludeTags`
- `includeFolders` / `excludeFolders`
- `includeFrontmatter` / `excludeFrontmatter`

Templated values are allowed in frontmatter predicates (`{world}`).

## Output Targets

Each target can emit one or both:

- `lorebookJson`
- `ragMarkdown`

Each output type uses:

```yaml
enabled: true
outputPath: exports/path.ext
```

`outputPath` supports interpolation (`{world}`).

## Initial Target Set

The first recommended set for large vaults:

1. `core`
2. `world:{world}`
3. `world:{world}:factions`

This is included in:

- `sillynotes.config.yaml`

## Implemented Code Surface

Typed schema + expansion resolver:

- `src/profile-schema.ts`

Regression tests:

- `tests/profile-schema.test.ts`

## Next Implementation Step

Wire `sillynotes.config.yaml` into runtime export so command execution can:

1. load/validate profile config
2. resolve expanded targets
3. apply selector per target
4. emit configured outputs for each target

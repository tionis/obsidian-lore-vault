# LoreVault

LoreVault is an Obsidian plugin for deterministic writing context assembly.

It turns tagged notes into scoped lorebooks, exports canonical packs, and provides writing/chat workflows that inject the right context while keeping the selection inspectable.

## Compatibility

- Plugin id: `lore-vault`
- Minimum Obsidian version: `1.11.4`
- Desktop and mobile supported (`isDesktopOnly: false`)

## What LoreVault Does

- Builds lorebook scopes from hierarchical tags (`#lorebook/...` by default).
- Exports one canonical SQLite pack per scope.
- Exports downstream scope files (`world_info` JSON and `rag` markdown projection).
- Runs graph-first retrieval for story continuation and chat.
- Supports optional embedding-assisted fallback retrieval.
- Provides a unified Story Writing panel for continuation, author-note workflow, chapter actions, and live generation/cost telemetry.
- Provides a Story Chat panel with per-conversation context controls.
- Keeps retrieval/debug behavior deterministic and inspectable.

## Quick Start

1. Add lorebook tags to relevant notes (for example `#lorebook/universe/yggdrasil`).
2. Add frontmatter metadata (`keywords`, `summary`, aliases) to improve retrieval quality.
3. Open `LoreVault Manager` and run `Build/Export` for your target scope.
4. Open `Story Writing Panel`.
5. Link an author note from your story note (`authorNote: [[...]]`) using `Open/Create Author Note` or `Link Author Note`.
6. Use `Continue Story` to generate at the cursor.

## Core Note Model

| Concept | Where it lives | Purpose |
| --- | --- | --- |
| Lorebook scope membership | Tags (`#lorebook/...`) | Determines scope inclusion |
| Story-to-author-note link | Story frontmatter `authorNote` | Anchors writing instructions |
| Author-note completion profile | Author note frontmatter `completionProfile` | Optional per-story model profile override |
| Story lorebook selection | Story frontmatter `lorebooks` | Selects scopes for continuation/chat |
| Chapter ordering | `chapter`, `previousChapter`, `nextChapter` | Determines chapter threading/memory |
| Inline directives | Story body (`<!-- LV: ... -->` or `[LV: ...]`) | Turn-level writing guidance |

## Frontmatter Examples

### Lore entry note

```yaml
---
tags: [lorebook/universe/yggdrasil]
title: "Aurelia"
aliases: ["The Radiant Sphere"]
keywords: [aurelia, radiant sphere]
summary: "Compact retrieval summary."
retrieval: auto
---
```

### Story chapter note

```yaml
---
authorNote: [[LoreVault/author-notes/chronicles-main-author-note]]
lorebooks: [universe/yggdrasil]
chapter: 7
chapterTitle: "Crossing the Spine"
previousChapter: [[story/ch06-the-fallout]]
nextChapter: [[story/ch08-the-reckoning]]
---
```

### Author note (optional explicit typing)

```yaml
---
lvDocType: authorNote
lorebooks: [universe/yggdrasil]
completionProfile: preset-openrouter-main
---
```

## Story Writing Workflow

Command: `Open Story Writing Panel`

The panel groups writing actions into three rows:

- `Continue Story` (switches to `Stop` while generating), `Insert Directive`
- `Open/Create Author Note`, `Link Author Note`, `Rewrite Author Note`
- `Generate Chapter Summary`, `Create Next Chapter`

The panel also shows:

- active note + linked author note state
- linked stories when an author note is active
- active completion model
- device profile selected from dropdown applies immediately (disabled with `Overridden by Author Note` when author-note override is active)
- command `Set Author Note Completion Profile` updates author-note frontmatter `completionProfile` override
- generation status and token usage
- selected context items (`world_info` + fallback)
- selected lorebooks from linked Author Note (interactive add + per-item remove)
- device-local cost profile label configured in settings (usage metadata tagging; auto-derived from API key hash when empty)
- collapsible cost breakdown (session/day/week/month/project) in the same panel section as the profile selector

## Story Chat Workflow

Command: `Open Story Chat`

Per-conversation context controls are ordered as:

1. Lorebooks
2. Author Notes
3. Chapters and Raw Notes
4. Manual Context

Additional behavior:

- `Open Conversation` picker + `New Chat`
- markdown-rendered messages
- edit/fork/regenerate message actions
- chat sessions are saved as readable markdown notes with frontmatter + `## User` / `## Model` transcript sections
- optional bounded tool-calling (search/read lorebooks and selected notes, read/update linked author note)
- per-response context inspector and layer/token diagnostics

## Continuation Behavior (High Level)

`Continue Story with Context`:

1. Reads near-cursor story text.
2. Resolves story lorebooks from story frontmatter (`lorebooks`, aliases) or linked author note frontmatter fallback.
3. Resolves linked author note content.
4. Parses inline directives from strict forms (`[LV: ...]`, `<!-- LV: ... -->`).
5. Builds layered context (chapter memory, graph-selected `world_info`, optional fallback entries).
6. Streams continuation text into the editor at the cursor.

Notes:

- Inline directives are treated as instruction comments in prompt staging.
- Long query windows for embeddings are chunked and averaged deterministically.
- If embedding calls fail, LoreVault falls back to lexical retrieval instead of aborting generation.

## Build and Export Outputs

For each scope:

- `lorebooks/<scope-slug>.db` (canonical SQLite pack)
- `lorebooks/sillytavern/<scope-slug>.json` (`world_info`, default pattern `sillytavern/{scope}.json`)
- `lorebooks/sillytavern/<scope-slug>.rag.md` (`rag` projection)

Output naming remains deterministic; collisions fail the build.

## Key Commands

Core:

- `Build Active Lorebook Scope`
- `Open LoreVault Manager`
- `Open LoreVault Lorebook Auditor`
- `Open LoreVault Query Simulation`
- `Open LoreVault Help`

Writing:

- `Continue Story with Context`
- `Stop Active Generation`
- `Open Story Writing Panel`
- `Open Story Chat`
- `Open or Create Linked Author Note`
- `Link Existing Author Note`
- `Rewrite Author Note`
- `Insert Inline Directive at Cursor`
- `Create Next Story Chapter`
- `Split Active Story Note into Chapter Notes`
- `Split Active Story Note into Chapter Notes (Pick Folder)`
- `Generate Chapter Summary (Active Note)`

Quality and utility:

- `Generate World Info Summary (Active Note)`
- `Generate Keywords (Active Note)`
- `Generate World Info Summaries (Active Scope)`
- `Generate Chapter Summaries (Current Story)`
- `Run Text Command on Selection`

Import and updates:

- `Import SillyTavern Lorebook`
- `Extract Wiki Pages from Story`
- `Apply Story Delta to Existing Wiki`

Operations and reporting:

- `Open LLM Operation Log Explorer`
- `Open Cost Analyzer`
- `Export Usage Report (JSON)`
- `Export Usage Report (CSV)`

## Logging and Cost Tracking

- Operation log is enabled by default and captures full LLM request/response payloads.
- Embedding backend call logging is enabled by default.
- Operation logs are namespaced by cost profile (one JSONL file per profile suffix).
- Default retention is `10000` entries per profile log file.
- Operation Log Explorer includes a cost-profile selector and defaults to the active device profile.
- Optional usage ledger tracks requests/tokens/cost with session/day/week/month/project aggregation.
- Completion and embedding API keys are stored via Obsidian Secret Storage (not persisted in `data.json`).
- LoreVault only creates missing secrets; it never overwrites an existing secret value.
- Secret IDs are user-configurable; you can pick existing IDs in settings to reuse one secret across multiple presets.
- Each completion preset has its own `Completion API Secret Name` used to load that preset's API key.
- Active completion preset and cost-profile label are device-local (Obsidian local storage), not shared vault settings.
- Budget warnings are evaluated per selected cost profile.
- Cost Analyzer view provides per-profile breakdowns (totals + by-operation/model/scope/source).

## Development

```bash
npm install
npm run check:mobile-runtime
npm run build
npm run lint
npm test
```

Release automation (maintainers):

```bash
npm run release:version -- <version>
```

This updates `manifest.json` + `versions.json`, creates `release <version>` commit, creates tag `<version>`, and pushes branch + tag.

## Documentation

- [docs/documentation.md](docs/documentation.md)
- [docs/technical-reference.md](docs/technical-reference.md)
- [docs/installation-guide.md](docs/installation-guide.md)
- [docs/sqlite-pack-schema.md](docs/sqlite-pack-schema.md)
- [docs/planning.md](docs/planning.md)
- [docs/todo.md](docs/todo.md)

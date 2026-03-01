# LoreVault

LoreVault is an Obsidian plugin for deterministic writing context assembly.

It turns tagged notes into scoped lorebooks, exports canonical packs, and provides writing/chat workflows that inject the right context while keeping the selection inspectable.

## Compatibility

- Plugin id: `lore-vault`
- Minimum Obsidian version: `1.1.0`
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
- current completion model
- generation status and token usage
- selected context items (`world_info` + fallback)
- selected lorebooks (add/remove/all/none)
- collapsible cost breakdown (session/day/week/month/project)

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
- `lorebooks/sillytavern/<name>-<scope-slug>.json` (`world_info`)
- `lorebooks/sillytavern/<name>-<scope-slug>.rag.md` (`rag` projection)

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
- `Export Usage Report (JSON)`
- `Export Usage Report (CSV)`

## Logging and Cost Tracking

- Optional operation log captures full LLM request/response payloads.
- Optional embedding backend call logging can be enabled for retrieval debugging.
- Optional usage ledger tracks requests/tokens/cost with session/day/week/month/project aggregation.
- Budget warnings are available for configured thresholds.

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

# LoreVault

Obsidian plugin that compiles Obsidian notes into scoped context exports for writing workflows.

## Current Status

- Desktop and mobile compatible (`manifest.json` uses `isDesktopOnly: false`)
- Hierarchical lorebook tag scoping (`#lorebook/...`) with exact/cascade membership
- Canonical SQLite pack export per scope (`.db`)
- Unified lore-entry model per scope (single canonical entry set)
- Downstream exports per scope: `world_info` JSON and fallback markdown projection
- Optional embedding-based fallback retrieval with hash-cache
- Graph-first retrieval with configurable fallback policy (`off|auto|always`)
- Optional backlink-aware graph expansion toggle for retrieval hops
- Optional model-driven retrieval tool hooks (`search_entries`, `expand_neighbors`, `get_entry`) with per-turn safety limits
- Optional LLM completion generation for story continuation
- Ribbon shortcut for `Continue Story with Context` (mobile-friendly one-tap access)
- Prompt-driven selection text commands with optional lore context and diff-based apply confirmation
- Optional LLM summary workflows (world_info + chapter) with review/approval and in-note summary-section writes
- Experimental cost tracking ledger for completion usage (tokens + provider cost metadata + fallback USD estimates)
- Deterministic story-thread resolution (`storyId` + `chapter` + prev/next refs) with prior-chapter memory injection
- Story Chat panel with per-chat lorebook scope selection and manual-context mode
- Dedicated lorebook auditor panel for user-facing quality checks
- Dedicated query simulation panel for multi-scope retrieval simulation
- Embedded user help panel (`Open LoreVault Help`)
- Frontmatter retrieval mode (`auto|world_info|rag|both|none`, with `none` as hard exclusion)
- Deterministic processing, ordering, and tie-breaking
- Unicode-aware retrieval tokenization for non-English keywords/titles
- Fixture-backed regression tests for graph ordering, wikilinks, lorebook scoping, retrieval routing, and output naming

Mobile rollout notes:

- export/cache paths must be vault-relative (absolute filesystem paths are rejected).
- see `docs/mobile-compatibility-plan.md` for the compatibility matrix and QA checklist.

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
  - `cascade`: include ancestor and descendant scopes in the same branch
- `includeUntagged`: include notes without lorebook tags

Notes with frontmatter `exclude: true` are always skipped.

Build behavior:

- `Build Active Lorebook Scope` resolves one scope at a time:
  - first lorebook scope on the active file
  - otherwise configured `activeScope`
- `Open LoreVault Manager` lists all discovered scopes and provides per-scope `Build/Export Scope`.

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
If a `## Summary` section is present, LoreVault reads only the first paragraph under that heading as summary content.  
If section summary is missing, LoreVault falls back to frontmatter `summary`, then note body content.

## Retrieval Routing

Default routing (`retrieval: auto`):

- note is included as a canonical lore entry (`world_info` + fallback projection)
- `retrieval: none` is the only hard exclusion mode

Per-note override:

```yaml
---
retrieval: auto   # auto | world_info | rag | both | none
---
```

Routing behavior:

- `world_info` uses compact entry content (`## Summary` section when present, else frontmatter `summary`, else note body)
- live retrieval can upgrade high-score entries to full note body when budget allows (falls back to lexical/semantic excerpt lift when needed)
- embedding/lexical fallback retrieval pulls additional entries from the same canonical entry set when seed confidence is weak

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
- defaults are tuned via representative fixtures (`fixtures/graph/default-weights-representative.json`)

## Output Files

For each built scope, LoreVault writes:

- `<sqliteOutputDir>/<scope-slug>.db` -> canonical SQLite pack (default dir: `lorebooks/`)
- `<sqliteOutputDir>/<downstreamSubpath>.json` -> `world_info` (default subpath: `sillytavern/lorevault.json`)
- `<sqliteOutputDir>/<downstreamSubpath>.rag.md` -> `rag`

`sqliteOutputDir` must be vault-relative (absolute filesystem paths are not supported).
`downstreamSubpath` must also be vault-relative.

Downstream filenames are scope-specific. If the downstream subpath does not contain `{scope}`, LoreVault appends a scope slug:

- `lorebooks/sillytavern/lorevault-universe.json`
- `lorebooks/sillytavern/lorevault-universe.rag.md`

If downstream subpath contains `{scope}`, the token is replaced by the scope slug.  
Export aborts if two scopes resolve to the same output path.

## Canonical Pack and Embeddings

SQLite pack includes:

- `world_info` entries
- `rag` documents
- chunked `rag` text segments
- optional chunk embeddings
- source note metadata (paths/tags/retrieval mode/summary/body hashes)
- note-level centroid embeddings (derived from chunk embeddings)
- build metadata in `meta` table (schema/build signatures/settings snapshots/counts)

Schema reference:

- `docs/sqlite-pack-schema.md`

Embedding backends:

- OpenRouter
- Ollama
- OpenAI-compatible endpoints

Default embedding model: `qwen/qwen3-embedding-8b`.

Embedding cache is one-file-per-hash so it syncs better across devices and avoids frequent recomputation.

## LoreVault Manager

Use command `Open LoreVault Manager` to open the persistent right-sidebar panel for scope inspection and operations.

Manager features:

- per-scope counts (included notes, entries, missing-keyword entries)
- scope warnings when sections are empty
- generation monitor (running state, active scopes, token budget, selected context items, output progress)
- usage and cost monitor (session/day/project totals, unknown-cost counts, budget warnings, top operation/model breakdown)
- `Build/Export` action per scope
- `Open Auditor` action per scope
- toolbar shortcuts to open the lorebook auditor and query simulation diagnostics

## Lorebook Auditor

Use command `Open LoreVault Lorebook Auditor` to open a dedicated diagnostics view.

Lorebook auditor features:

- scope selector
- lorebook contents panel for `world_info` entries (keywords, trigger params, collapsible content)
- quality audit table (risk score + reasons) using missing-keyword/thin-content heuristics and embedding similarity where available
- per-row actions for audit items (`Open` and `Generate Keywords` for missing-keyword notes)
- bulk keyword generation from selected missing-keyword entries
- keyword generation always opens a review step before writing frontmatter

## Query Simulation

Use command `Open LoreVault Query Simulation` to open a dedicated retrieval simulation view.

Query simulation features:

- multi-scope selection (simulate across multiple lorebooks at once)
- token budget split across selected scopes
- optional override controls (`maxGraphHops`, `graphHopDecay`, backlink expansion, fallback policy/threshold, world_info/fallback limits, body-lift knobs)
- selected `world_info` diagnostics (score breakdown, path/reasons, tier counts, included content tier)
- body-lift decision trace (applied/skipped reason per entry with score/hop/tier transition)
- selected fallback diagnostics (scores and matched terms)

## Writing Assistant Commands (MVP)

Command: `Continue Story with Context`

Behavior:

- builds/refreshes an in-memory scope index
- watches note create/modify/delete/rename events and performs near-live refresh
- resolves optional chapter-memory context from prior chapters using story frontmatter (`storyId`, `chapter`, `chapterTitle`, `previousChapter`, `nextChapter`)
- queries retrieval layers from current editor context:
  - `world_info` by graph-first seed + expansion relevance
  - fallback entries by policy (`off|auto|always`) and relevance
  - optional tool-retrieved layer for targeted entry fetches within call/token/time caps
- applies token-budgeted context assembly
- stages explicit steering layers (pinned instructions, story notes, scene intent, inline directives)
- steering layer placement is configurable (`system` | `pre-history` | `pre-response`)
- parses strict inline directives from near-cursor story text (`[LV: ...]`, `<!-- LV: ... -->`)
- ignores non-prefixed bracket text (for example `[Editor Note: ...]`)
- injects inline directives as a dedicated steering layer with per-turn count/token caps
- supports optional continuation frontmatter steering keys (`lvPinnedInstructions`, `lvStoryNotes`, `lvSceneIntent`)
- supports continuation continuity-state frontmatter lists/toggles:
  - lists: `lvPlotThreads`, `lvOpenLoops`, `lvCanonDeltas`
  - toggles: `lvIncludePlotThreads`, `lvIncludeOpenLoops`, `lvIncludeCanonDeltas`
- sends context + story window to configured completion provider
- streams generated continuation text into the editor at cursor (no raw context dump)
- updates status bar while running (`preparing`, `retrieving`, `generating`, `error`, `idle`)
- reports active scopes and pulled `world_info`/fallback items at generation start
- adds right-click editor context-menu actions:
  - `LoreVault: Continue Story with Context`
  - `LoreVault: Run Text Command on Selection` (only when editor selection is non-empty)
  - `LoreVault: Generate Keywords` (for lorebook-tagged notes)
  - `LoreVault: Generate World Info Summary` (only when note has lorebook scope tags)
  - `LoreVault: Generate Chapter Summary` (only when note has chapter/story frontmatter)
- mobile note: `Continue Story with Context` is also registered as an editor action command for mobile editor menus.

Configure generation under Settings -> LoreVault -> Writing Completion.
Key completion controls include context window tokens and prompt reserve tokens for stricter budget management.
Cost Tracking settings can optionally record usage/cost entries to `.obsidian/plugins/lore-vault/cache/usage-ledger.json`.
Use commands `Export Usage Report (JSON)` and `Export Usage Report (CSV)` for deterministic report exports.

## Text Commands

Command palette:

- `Run Text Command on Selection`

Editor context menu:

- `LoreVault: Run Text Command on Selection` (shown only when text is selected)

Behavior:

- opens a prompt modal with:
  - prompt template selection from prompt-note files in your configured prompt folder
  - editable custom prompt text
  - per-run toggle for lorebook context injection
- submits selected text + prompt (and optional lore context) to the configured completion model
- returns transformed text only
- by default opens a review modal with original text + diff preview before apply
- optional auto-accept can apply directly without review

Settings path: `Settings -> LoreVault -> Text Commands`

- auto-accept toggle
- default lore-context toggle
- context token budget
- text-command system prompt
- prompt notes folder path
- create default prompt notes action (creates markdown prompt templates with frontmatter)

## Auto Summary Commands (Phase 9)

Commands:

- `Generate Keywords (Active Note)`
- `Generate World Info Summary (Active Note)`
- `Generate Chapter Summary (Active Note)`
- `Generate World Info Summaries (Active Scope)`
- `Generate Chapter Summaries (Current Story)`

Right-click editor menu:

- `LoreVault: Generate Keywords` appears for notes tagged into a lorebook scope.
- `LoreVault: Generate World Info Summary` appears for notes tagged into a lorebook scope.
- `LoreVault: Generate Chapter Summary` appears for notes with story/chapter frontmatter.

Behavior:

- uses configured completion provider/model to propose a compact summary
- opens review modal before acceptance
- review action:
  - `Write Summary Section`: write/update `## Summary` section in the note body
- precedence:
  - world_info content: first paragraph under `## Summary` -> `frontmatter summary` (fallback) -> note body
  - chapter memory: first paragraph under `## Summary` -> `frontmatter summary` (fallback) -> deterministic excerpt

Story-level scope override:

- Preferred: set `Active Lorebooks` in Story Steering scope notes (`global`/`thread`/`chapter`/`note`).
- Frontmatter keys remain supported as fallback.

Frontmatter fallback example:

```yaml
---
lorebooks:
  - universe
  - universe/yggdrasil
---
```

Accepted keys: `lorebooks`, `lorebookScopes`, `lorevaultScopes`, `activeLorebooks`.

## Embedded Help

Command: `Open LoreVault Help`

Provides an in-plugin overview of:

- scope/tag setup
- retrieval and fallback behavior
- build/export artifacts
- story completion/chat workflow
- direct actions to open import/extraction/lorebook-update panels

## Inbound Wiki Panels (Phase 14)

Commands:

- `Import SillyTavern Lorebook`
- `Extract Wiki Pages from Story`
- `Apply Story Delta to Existing Wiki`

Current behavior:

- `Import SillyTavern Lorebook` opens a panel with:
  - target folder (manual path or `Browse` existing folder picker)
  - default tags
  - lorebook name (converted into a lorebook tag)
  - pasted lorebook JSON input
- importer supports preview + deterministic note generation and create/update writes.
- imported notes map ST entry fields to frontmatter/body:
  - `keywords` from `key`
  - `aliases` from `keysecondary`
  - `title/comment` when present
  - derived `## Summary` section (frontmatter `summary` is legacy fallback input only)
  - default + lorebook tags

Story extraction behavior:

- deterministic story chunking (heading-aware + size constrained)
- per-chunk LLM extraction with strict JSON response validation
- iterative context injection of already-extracted page state between chunks
- deterministic safe-merge policy (`summary` merge + keyword/alias union + unique content block append)
- target folder can be selected by path or `Browse` picker
- generated/updated page summaries are written into note `## Summary` sections
- generated pages use structured note layout: top `# Title`, then `## Summary`, then sectioned body (`## Backstory`/`## Overview`/`## Details` based on page key)
- extraction/update title sanitization strips type-label prefixes like `Character:` / `Location:` / `Faction:` from display titles
- preview first, then explicit apply to write pages

Story delta behavior (Phase 15 foundation):

- updates existing notes in a target folder (optional tag filter)
- target folder can be selected by path or `Browse` picker
- accepts story markdown directly or from a selected story note path
- low-confidence operation gating (preview warnings + skipped operation count)
- deterministic matching to existing pages by `pageKey` then title fallback
- policy modes:
  - `safe_append` (default): preserve existing metadata and append unique durable updates
  - `structured_merge`: also merge summary/keywords/aliases deterministically
- dry-run diff previews per planned change
- per-change approval checkboxes with `Apply Selected`

## Story Chat (Phase 10 Foundation)

Command: `Open Story Chat`

Current capabilities:

- persistent right-sidebar chat panel
- in-chat generation monitor (state, scopes, context/output token usage)
- conversation selector (dropdown) with `New Chat` creation
- streaming assistant responses
- per-chat lorebook scope selection (including none)
- `Use Lorebook Context` toggle
- manual context block (for manual-only or mixed mode)
- per-chat steering fields (pinned instructions, story notes, scene intent)
- per-chat continuity controls (plot threads, open loops, canon deltas, per-group inclusion toggles)
- specific notes context via note picker list (`Add Note`, `Add Active`, remove per item)
- each chat/fork is saved as a markdown note under `LoreVault/chat`
- chat conversation folder is configurable in settings (`Story Chat Conversation Folder`)
- message-level actions: `Edit`, `Fork Here`, and `Regenerate` (latest assistant message)
- regenerate appends a new assistant message version; users can switch active versions
- per-response context inspector (scopes, specific notes, unresolved refs, token estimate, `world_info`/`rag` items)
- per-response layer budget/overflow inspector (`reserved`, `used`, `headroom`, trim rationale)
- per-response continuity inspector (included threads/open loops/canon deltas)
- chapter memory shown in layer trace indicates summary source (`section`, `frontmatter`, or `excerpt`)

Story Chat state is persisted primarily in conversation notes, with settings storing active conversation path.

## Development

```bash
npm install
npm run check:mobile-runtime
npm run build
npm test
```

See:

- `docs/approach.md`
- `docs/documentation.md`
- `docs/technical-reference.md`
- `docs/installation-guide.md`
- `docs/profile-schema.md`
- `docs/planning.md`
- `docs/todo.md`

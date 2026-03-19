# LoreVault Technical Reference

This document is the implementation-level reference for core architecture and runtime behavior.

## Core Runtime Components

- `src/main.ts`
  - plugin lifecycle
  - command/ribbon registration
  - export pipeline orchestration
  - completion orchestration
  - effective completion-profile resolution (`author note completionProfile -> device preset -> base settings` for Story Writing; `chat preset -> device preset -> base settings` for Story Chat and Story Starter)
  - Story Writing and Story Chat profile resolution are separate paths; Story Chat preset state is not consulted for Story Writing generations
  - API key hydration via Obsidian Secret Storage (completion, embeddings, preset keys) with user-defined secret IDs; plugin only creates missing secrets and never overwrites existing values
  - device-local profile state via Obsidian local storage (active Story Writing preset, active Story Chat preset, and optional cost profile label; auto API-key hash fallback when blank)
  - lorebook fork utility (`Fork Active Lorebook`): deterministic branch copy + internal link rewrite + retagging
  - lore-delta maintenance utility (`Apply Lore Delta to Existing Wiki` / `Open Lore Delta`): idea-brief driven multi-note update planning with focused-note rewrite gating
  - story-chat turn orchestration
  - worker-backed LLM operation log persistence (`operationLog` settings) with local SQLite storage, legacy per-cost-profile JSONL fallback/import, and explorer-view refresh hooks
- `src/operation-log-store.ts` + `src/internal-db-worker.ts`
  - operation-log storage abstraction and worker-owned SQLite runtime
  - backend selection (`OPFS` when available, otherwise `IndexedDB`)
  - legacy JSONL import/fallback and per-profile retention pruning
  - internal DB worker source is bundled into `main.js` and launched via blob URL so Obsidian Sync only needs the normal plugin artifact
- `src/live-context-index.ts`
  - near-live lorebook indexing
  - lorebook pack rebuild strategy
  - per-query context assembly dispatch
- `src/context-query.ts`
  - graph-first `world_info` retrieval
  - optional/fallback entry retrieval over the same canonical lore-entry set
  - token budgeting and tiering
  - explainability artifacts
- `src/retrieval-tool-hooks.ts`
  - model-driven retrieval tool loop (`search_entries`, `expand_neighbors`, `get_entry`)
  - deterministic local tool execution and context rendering
  - per-turn safety limits (calls/tokens/time)
- `src/completion-provider.ts`
  - completion adapters (OpenRouter/Ollama/OpenAI-compatible)
  - generic OpenAI-style tool planner helper used by retrieval hooks and Story Chat agent tools
  - per-call operation log emission hooks (full request/response payloads + errors + aborts)
- `src/scope-pack-builder.ts`
  - deterministic note processing
  - graph ranking
  - fallback chunk generation
  - optional embeddings
- `src/story-chat-view.ts` + `src/story-chat-document.ts`
  - persistent chat UI
  - note-backed conversation persistence
  - device-level chat completion preset selection with conversation snapshot metadata
  - message versions/regeneration/forking
  - empty failed assistant turns persist as retryable error versions with status/error metadata, and those empty placeholders are filtered out of future prompt history
- `src/lorevault-story-starter-view.ts`
  - premise-to-draft panel (`Open Story Starter`)
  - optional lorebook retrieval before generation
  - editable planned-write preview/apply for story note + linked author note
- `src/story-starter.ts`
  - strict JSON prompt contract for story-starter generation
  - deterministic response parsing and story/author-note materialization
  - placeholder warning detection for generated outputs
- `src/story-steering.ts` + `src/story-steering-view.ts`
  - note-level author-note storage resolved from story frontmatter `authorNote` link
  - `authorNote` frontmatter accepts quoted or unquoted Obsidian wikilinks (including YAML-parsed nested-array forms)
  - Story Writing panel combines writing controls, generation monitor, lorebook controls, context-item inspection, and compact cost summary
  - panel actions are grouped: continue/stop + inline directive, author-note controls (open/create/link/rewrite), and chapter controls (summary + next chapter)
  - panel context is sticky to the last active markdown story note, so focusing the Story Writing pane does not clear linked author-note/lorebook state
  - when an Author Note is active, panel lists linked chapters/stories
  - markdown editing remains native Obsidian note editing for Author Note content
  - single note-level author-note layer only (no global/story/chapter scope hierarchy)
  - lorebook selection reads linked Author Note frontmatter first, then story-note frontmatter fallback
  - linked-story detection is driven by story-note `authorNote` references (supports multi-story shared author notes)
  - LLM-assisted author-note rewrite flow with optional per-run update prompt
  - extraction sanitization mode (`strict` vs `off`) for lorebook-fact filtering
  - markdown-backed author-note parse/serialize (frontmatter preserved on body writes)
  - effective author-note merge for chat/continuation prompt assembly
  - author-note completion profile override is managed by command (`Set Author Note Completion Profile`) and persisted as frontmatter `completionProfile`
  - device completion profile selection is a direct dropdown (no apply button) and shares a combined profile+cost section with cost breakdown
  - panel stop-mode/selector locking is keyed to in-flight generation states only; terminal `error` telemetry remains visible without keeping controls locked
  - Writing Completion preset settings persist provider/request options per preset, including prompt-caching, provider-routing, and reasoning/thinking
- `src/lorevault-cost-analyzer-view.ts`
  - profile-scoped cost analysis panel (totals + by-operation/model/lorebook/source breakdowns)
- `src/lorebook-scope-cache.ts`
  - shared metadata/scope cache reused by manager/steering/auditor UI
  - explicit invalidation on vault and settings mutations
- `src/author-note-rewrite-modal.ts`
  - optional user instruction capture for Author Note rewrite requests
- `src/text-command-review-modal.ts`
  - review/edit approval modal used for Author Note rewrite diff/apply
- `src/lorebooks-routing-debug-view.ts`
  - scope inclusion/routing diagnostics
  - world_info content inspection
  - quality-audit table + keyword-generation actions
- `src/lorebooks-query-simulator-view.ts`
  - multi-scope retrieval simulation
  - retrieval knob overrides for debugging/tuning
- `src/story-thread-resolver.ts`
  - story/chapter metadata parsing
  - deterministic thread ordering (metadata + prev/next links)
- `src/story-chapter-management.ts`
  - `##`-section chapter split helpers for monolithic story notes
  - deterministic chapter-note frontmatter/body render helpers
  - managed frontmatter upsert for `chapter/chapterTitle/previousChapter/nextChapter` (+ optional explicit `storyId`)
- `src/chapter-summary-store.ts`
  - rolling chapter-summary cache (`## Summary` section -> frontmatter fallback -> excerpt fallback)
- `src/summary-utils.ts`
  - summary normalization and world_info content resolution
- `src/callout-utils.ts`
  - Obsidian callout normalization/removal helpers for LLM staging
  - `lv-thinking` callout rendering for persisted reasoning blocks
- `src/inline-directives.ts`
  - strict-prefix inline directive parse/strip helpers plus in-place tag rendering (`[LV: ...]`, `<!-- LV: ... -->` -> `<inline_story_directive>`)
  - prompt-cleanup support for stripping configured ignored callout types before directive render/strip
- `src/prompt-staging.ts`
  - deterministic prompt-segment budgeting
  - fixed-order overflow trimming with locked-layer protection
  - per-layer usage/headroom metadata helpers
- `src/summary-review-modal.ts`
  - review/approval UI for generated summary candidates with side-by-side source diff preview
- `src/hash-utils.ts`
  - deterministic hashing and identifier normalization (`@noble/hashes` sync + WebCrypto async)
  - `sha256HexAsync` requires WebCrypto (`crypto.subtle`) at runtime
- `src/scope-pack-metadata.ts`
  - deterministic scope-pack metadata snapshot/signature assembly
  - note-level embedding centroid derivation from chunk embeddings
  - canonical SQLite `meta` row generation/content signatures
- `src/quality-audit.ts`
  - deterministic per-entry risk scoring (missing keywords, thin content, embedding similarity)
- `src/keyword-utils.ts`
  - keyword model-output parsing and deterministic frontmatter keyword upsert helpers
- `src/text-command-modal.ts`
  - prompt/template selection modal for selection rewrite commands
- `src/source-diff.ts` + `src/source-diff-view.ts`
  - deterministic source-diff hunk builder (LCS with bounded fallback)
  - side-by-side diff renderer with context-window omission markers and truncation guardrails
- `src/text-command-review-modal.ts` + `src/text-command-diff.ts`
  - live side-by-side review/apply flow for selection edits and Author Note rewrites
- `src/cost-utils.ts`
  - usage-cost estimation helpers (`provider_reported` vs `estimated` vs `unknown`)
- `src/usage-ledger-store.ts`
  - persistent usage ledger storage with deterministic entry shape/order
  - immutable vault record files for shared history + local SQLite indexing when available
- `src/usage-ledger-report.ts`
  - deterministic aggregation/snapshot + CSV serialization
- `src/sillytavern-import.ts`
  - deterministic ST lorebook parse + wiki note materialization + apply writes
  - shared payload parser also accepts embedded `character_book` entry shapes (`keys`, `secondary_keys`, `enabled`)
- `src/sillytavern-character-card.ts`
  - ST character-card parser (`.png` `ccv3/chara` metadata + `.json` payloads)
  - deterministic card-field normalization (v1/v2/v3 shapes)
  - deterministic source write-back helpers (payload patch + `.png` metadata upsert with CRC-safe chunk re-encode)
  - rewrite prompt/response schema helpers (story/author-note + character-only wiki extraction)
  - event-injection prompt/response schema helpers (selected greeting/event -> revised story + optional author-note guidance)
  - persona-aware prompt context + placeholder detection/helpers for SillyTavern `{{...}}` macros
  - freeform author-note markdown passthrough (`authorNoteMarkdown`) with prompt-driven guidance
  - rewrite prompt emphasizes preserving dense source detail (description/personality/scenario/system constraints) and permits longer author-note outputs when needed
  - image-card avatar propagation into generated story notes (`characterCardAvatar` frontmatter + `![[...]]` embed)
  - story+author-note import plan builder with optional character-page extraction + optional embedded-lorebook conversion
- `src/lorevault-import-view.ts`
  - import panel UI (`Import SillyTavern Lorebook` + `Import SillyTavern Character Card`)
  - lorebook list add/remove UX (interactive picker + Enter-to-add)
  - character-card file picker sourced from configured character-card source folder
  - optional embedded-lorebook/character-page extraction toggles
  - character-card planned-write editor (editable path + content before apply)
  - model rewrite/extraction stages for character-card import with completion usage/operation-log hooks
  - known limitation: character-card rewrite/extraction currently submits one prompt per stage (no chunked/map-reduce fallback for oversized cards)
  - target-folder default sourced from shared setting `defaultLorebookImportLocation`
  - staged progress reporting for parse/build/apply
- `src/character-card-bases-view.ts`
  - custom Bases view registration id `lorevault-character-bases-view` (`LoreVault Characters`)
  - card-grid rendering of Bases query rows for character-card metadata notes
  - avatar resolution from wikilink/markdown-link/image URL sources
  - click-to-preview avatar modal for larger image inspection
  - field visibility integrates Bases property-order visibility with view-level toggles
  - summary-focused rendering for generated catalog fields (`cardSummary`, themes/tone, scenario focus, hook, stale marker)
  - markdown-rendered long fields (`Personality`, `Description`, `Scenario`) read from managed details-block markdown
  - per-view options (`maxCards`, `largeAvatars`, visibility toggles)
- `src/character-card-summary.ts`
  - prompt contract + response parsing for strict JSON character-card catalog summaries
  - structured fields: summary paragraph, themes, tone, scenario focus, writer hook
- `src/main.ts`
  - `Sync Character Card Library` command: source-folder scan -> meta-note upsert (`lvDocType: characterCard`)
  - `Write Back Character Card Source` command: active `characterCard` meta note -> source `.png`/`.json` payload update with hash staleness guard
  - `Inject Character Card Event` command: resolve linked card/meta greetings, pick event, request story+author-note rewrite, then review/apply
  - meta-note lifecycle: create/update by `cardPath`, mark `status: missing_source` when source disappears (no delete)
  - sync also maintains a managed markdown details block (`LV_BEGIN_CHARACTER_CARD_DETAILS`/`LV_END_CHARACTER_CARD_DETAILS`) for readable long-form card fields
  - sync preserves existing local avatar embeds in details markdown (for localized image workflows) and otherwise uses canonical source-card avatar links
  - details block is versioned (`LV_CHARACTER_CARD_DETAILS_VERSION`) and tracked in frontmatter (`characterCardDetailsVersion`)
  - details block layout is summary-first and includes avatar embed at top when available
  - alternate/group-only greeting fields are rendered as numbered `####` subheadings per greeting variant (parser remains compatible with prior bullet-list formatting)
  - synced meta frontmatter carries compact indexing metadata (identity/tags/source/lorebook stats) and duplicated summary fields; long prose/message/prompt fields are stored in details markdown instead of frontmatter
  - optional summary generation pipeline with operation-log + usage-ledger tracking (`character_card_summary`)
  - hash-aware summary persistence (`cardSummaryForHash`) and stale markers (`cardSummaryStale`) to avoid accidental overwrite during sync
  - Bases integration: `registerBasesView` hooks `LoreVault Characters` custom renderer when Bases core plugin is enabled
  - helper lookup used by character-card import to inject story frontmatter backlink (`characterCardMeta: [[...]]`)
- `src/lorevault-story-extract-view.ts`
  - extraction panel (`Extract Wiki Pages from Story`) with preview/apply flow
  - explicit completion profile selection + chunk/apply progress status
  - target-folder default sourced from shared setting `defaultLorebookImportLocation`
- `src/story-extraction.ts`
  - deterministic chunking
  - per-chunk extraction prompt/validation
  - iterative merge pipeline and final page rendering
  - final render pass assigns note paths first, then adds deterministic Obsidian wikilinks between generated pages when unambiguous title/alias mentions are found in summaries/body markdown
  - progress callbacks for chunk and render stages
- `src/lorevault-story-delta-view.ts`
  - story delta update panel (`Apply Story Delta to Existing Wiki`) with preview/apply flow
  - conflict review rows + decision persistence (`accept`/`reject`/`keep_both`)
  - explicit completion profile selection + chunk/apply progress status
- `src/lorevault-operation-log-view.ts` + `src/operation-log.ts`
  - operation-log explorer UI (`Open LLM Operation Log Explorer`)
  - SQLite-backed query UI with legacy JSONL parsing/coercion for fallback/import diagnostics
  - filter/search and full payload inspection for completion/planner calls
- `src/story-delta-update.ts`
  - deterministic chunked delta extraction
  - low-confidence gating
  - existing page matching and idempotent merge planning
  - deterministic conflict extraction from update diff churn
  - shared side-by-side diff preview generation for planned page writes
  - progress callbacks for chunk and render stages
- `src/lorebook-scope-suggest-modal.ts`
  - shared interactive lorebook picker modal

## Export Pipeline Contract

Per lorebook, LoreVault writes:

- canonical SQLite pack: `<lorebook>.db`
- downstream world info JSON
- downstream fallback markdown projection

Storage contract:

- SQLite export/read paths are vault-relative and use Obsidian adapter binary IO.
- Absolute filesystem export paths are intentionally rejected.
- export freshness policy supports `manual`, `on_build`, and `background_debounced` with impacted-lorebook rebuild queueing in background mode.

Canonicality:

- SQLite is the source of truth for downstream tooling.
- Downstream exporters should consume SQLite artifacts rather than vault markdown.

### SQLite Schema

Canonical schema documentation lives in:

- `docs/sqlite-pack-schema.md`

Highlights:

- canonical lore data tables:
  - `world_info_entries`
  - `rag_documents`
  - `rag_chunks`
  - `rag_chunk_embeddings`
  - `source_notes`
  - `note_embeddings`
- deterministic ordering contract per table
- rich `meta` keys for schema/build/settings/content signatures
- embeddings included at chunk and note levels for downstream reuse

## Retrieval Engine

### World Info (Primary)

Implemented in `src/context-query.ts`.

Flow:

1. detect seed matches from:
  - `key` / `keywords`
  - aliases (`keysecondary` when present)
  - entry comment/title token and phrase matches
  - Unicode-aware tokenization (non-English keywords/titles are supported)
2. build deterministic adjacency graph from wikilink-normalized relations
  - optional backlink-aware reverse expansion can be enabled in retrieval settings
3. run bounded hop expansion from seeds
4. apply hop decay and accumulate score factors
5. rank with deterministic tie-breaks:
  - `score DESC`
  - `hopDistance ASC`
  - `entry.order DESC`
  - `uid ASC`

Score factors:

- `seed`
- `graph`
- `constant`
- `order`

Default graph-priority weights are tuned and regression-locked by representative fixtures:

- fixture: `fixtures/graph/default-weights-representative.json`
- test: `tests/default-weights-calibration.test.ts`

Explainability includes:

- seed reasons
- selected path (`uid -> uid -> ...`)
- per-entry score breakdown
- budget cutoff diagnostics

### Fallback Retrieval (Secondary)

Fallback retrieval remains available and configurable.

Fallback policy (`settings.retrieval.ragFallbackPolicy`):

- `off`
- `auto`
- `always`

`auto` uses `ragFallbackSeedScoreThreshold` and no/weak seed selection heuristics.

Fallback ranking:

- lexical score over entry title/path/content projections
- optional semantic boost from embeddings cache/chunk vectors
- query embedding uses deterministic long-text chunking + weighted-average vector merge
- embedding-call failures degrade to lexical fallback (query continues without semantic boosts)
- optional semantic paragraph reranking for world_info body excerpt fallback
- deterministic tie-breaks: `score DESC`, then `path/title/uid`

### Tool Retrieval Hooks (Optional Advanced Layer)

Tool-driven retrieval is opt-in (`settings.retrieval.toolCalls.enabled`) and executed after graph/fallback assembly with remaining budget.

Available hooks:

- `search_entries`: lexical lookup over `world_info` titles/keywords/content
- `expand_neighbors`: bounded wikilink-neighbor expansion from a seed entry
- `get_entry`: targeted fetch by `uid` (+ optional lorebook)

Execution model:

- completion provider is used as planner (`tool_choice=auto`) for OpenAI-compatible providers
- planner emits tool calls
- LoreVault executes calls locally over deterministic lorebook catalogs
- selected entries are rendered into a bounded `Tool Retrieval Context` block

Hard limits per turn:

- `maxCallsPerTurn`
- `maxResultTokensPerTurn`
- `maxPlanningTimeMs`

If a limit is reached, tool loop stops deterministically and trace output records stop reason.

### Story Chat Agent Tool Layer (Optional)

Story Chat has a separate bounded tool loop (`settings.storyChat.toolCalls.*`) that runs before final chat response generation.

Available tools:

- lorebook read/search (selected lorebooks only):
  - `search_lorebook_entries`
  - `get_lorebook_entry`
- linked-story/manual-note read/search:
  - `search_story_notes`
  - `read_story_note`
- active note-level author-note read/update (selection is implicit):
  - `get_steering_scope`
  - `update_steering_scope`
- optional lorebook note creation:
  - `create_lorebook_entry_note`

Boundary contract:

- no whole-vault traversal; tools are restricted to:
  - selected lorebooks
  - linked story note set (story thread + manually selected note refs)
  - the active note-level author note (`note`)
- write tools require:
  - `settings.storyChat.toolCalls.allowWriteActions = true`
  - explicit write intent in current user turn (deterministic heuristic gate)

Turn metadata contract:

- tool loop traces, call summaries, and write summaries are persisted in assistant turn `contextMeta`
- context inspector renders these as separate rows (`chat tools: calls/writes`, `chat tool trace`)

## Budgeting and Content Tiering

`world_info` and fallback budgets are split from the per-query token budget.

World info tiering:

- initial inclusion at `short`
- opportunistic upgrade to `medium`
- opportunistic upgrade to `full`
- high-score entries first try `full_body` lift with full note body when budget allows
- if full note body does not fit, lift falls back to deterministic excerpt selection
- excerpt selection uses lexical paragraph scoring and optional embedding-based semantic paragraph boosts
- upgrades only occur when budget permits
- body-lift explainability records per-entry decision status (`applied` / specific skip reason)

Budget diagnostics:

- dropped-by-budget count
- dropped-by-limit count
- dropped entry UIDs

## Long-Form Story Memory

### Frontmatter Schema

Supported keys (case-insensitive normalization):

- `authorNote` (primary thread anchor)
- `completionProfile` (optional Author Note-only completion preset id override)
- `chapter`
- `chapterTitle`
- `previousChapter` / `prevChapter` / `previous` / `prev`
- `nextChapter` / `next`
- `storyId` (optional fallback anchor when `authorNote` is absent)

### Thread Resolution

`src/story-thread-resolver.ts`:

- parses story nodes from frontmatter
- scopes by `authorNote` link anchor first, then explicit `storyId` fallback
- applies deterministic ordering by:
  - explicit chapter index where available
  - prev/next edge constraints
  - stable path tie-breaks

If graph order is incomplete/cyclic, resolver falls back to deterministic chapter/path ordering.

### Chapter Memory Injection

`src/main.ts` (`continueStoryWithContext`, `runStoryChatTurn`):

- resolves current note thread
- selects bounded prior chapters with deterministic budget-adaptive depth
- resolves summary snippets through rolling chapter summary cache/store
  - prefers `## Summary` section
  - then frontmatter `summary`
  - then deterministic body-head excerpt
- when chapter-memory budget is large enough, injects additional bounded style excerpts from the most recent prior chapters
- optional semantic chapter recall injects a bounded `## Related Past Scenes` block:
  - source prior chapters are chunked deterministically (heading-aware + overlap controls)
  - query text comes from active query/story window context
  - chunks are embedded/scored by cosine similarity, then hybrid-ranked with recency blend
  - bounded by max chunks, per-chapter cap, min similarity threshold, and reserved chapter-memory budget share
- high-context models receive larger chapter-memory budgets, deeper prior-chapter windows, and more/larger recent style excerpts
- `completion.continuityAggressiveness` (`balanced` | `aggressive`) selects the chapter-memory budget profile used by both continue-story and chat flows
- `completion.semanticChapterRecall` controls the optional semantic layer:
  - `enabled`
  - `maxSourceChapters`
  - `maxChunks`
  - `maxChunksPerChapter`
  - `chunkMaxChars`
  - `chunkOverlapChars`
  - `minSimilarity`
  - `recencyBlend`
  - `budgetShare`
- default values are tuned for large-context continuity (`enabled: true`, `maxSourceChapters: 40`, `maxChunks: 10`, `maxChunksPerChapter: 2`, `chunkMaxChars: 1800`, `chunkOverlapChars: 220`, `minSimilarity: 0.16`, `recencyBlend: 0.28`, `budgetShare: 0.32`)
- chapter-memory lineage can traverse linked prior chapters across author-note boundaries via chapter refs; author-note steering injection remains scoped to the active note's linked author note
- injects `<story_chapter_memory>` block before lorebook context in continuation and chat prompts

This provides a dedicated chapter-memory layer before graph retrieval.

### Chapter Authoring Utilities

Runtime commands in `src/main.ts`:

- `Split Active Story Note into Chapter Notes`
- `Split Active Story Note into Chapter Notes (Pick Folder)`
- `Create Next Story Chapter`
- `Fork Story from Active Note`
- `Fork Active Lorebook`

Contracts:

- split utility reads active note markdown, treats first `#` as story heading, and splits chapters by `##` headings.
- split output writes deterministic chapter note frontmatter fields:
  - `authorNote` link to the shared Author Note
  - `chapter`
  - `chapterTitle`
  - `previousChapter`
  - `nextChapter`
  - optional explicit `storyId` if source note already defines one
- create-next utility is gated on active note chapter metadata and:
  - creates a new chapter note in the active note folder
  - updates active note `nextChapter`
  - sets new note `previousChapter` to active note
  - links new note to the same Author Note as the active note
- create-next chapter is exposed in Story Writing panel and command palette (not editor context menu).
- fork-story utility:
  - prompts for a new note name (prefilled with source note name, must differ)
  - creates fork note in the same folder as the source note
  - creates a new derived Author Note for the fork and links the fork to it
  - copies source Author Note markdown/frontmatter verbatim into the new Author Note
  - preserves forked story-note frontmatter, rewrites `authorNote` to the new forked Author Note link, and removes forward-link keys (`nextChapter`/`next`)
- fork-lorebook utility:
  - resolves source lorebook from active note lorebook first, then configured active lorebook
  - prompts for new lorebook + target folder (`<Default Lorebook Import Location>/<new-lorebook>` prefill)
  - copies all notes in the selected lorebook branch into the target folder with deterministic path allocation
  - rewrites internal wikilinks/markdown links to point to copied forked notes
  - strips old lorebook inline tags from body text and rewrites frontmatter tags to the new lorebook

## Auto Summary Internals (Phase 9)

Generation entrypoints in `src/main.ts`:

- `Generate World Info Summary (Active Note)`
- `Generate Chapter Summary (Active Note)`
- `Generate World Info Summaries (Active Lorebook)`
- `Generate Chapter Summaries (Current Story)`

Flow:

1. read note body (`stripFrontmatter`)
2. build constrained prompt with summary mode (`world_info` or `chapter`)
3. call completion provider (non-stream request)
4. normalize summary text (`world_info`: single paragraph with optional cap; set cap to `0` to disable truncation. `chapter`: multi-paragraph allowed, no hard length cap)
5. show review modal with edit + accept options
6. write accepted summary into note `## Summary` section (`chapter` multi-paragraph summaries use `LV_BEGIN/LV_END` markers)
7. request index/view refresh and chapter-summary cache invalidation for affected note

Precedence contract:

- world_info entry content: summary section content (`LV_BEGIN/LV_END` block when present, otherwise first paragraph) -> `frontmatter summary` fallback -> note body
- chapter memory summary: summary section content (`LV_BEGIN/LV_END` block when present, otherwise first paragraph) -> `frontmatter summary` fallback -> deterministic excerpt; optional recent-chapter style excerpts are appended when budget allows (expanded on high-context models)

## Text Command Internals

Entrypoints in `src/main.ts`:

- command: `Run Text Command on Selection`
- command: `Review Pending Text Command Edit`
- editor menu action: `LoreVault: Run Text Command on Selection`

Flow:

1. capture selected editor range + source text
2. open prompt modal (`src/text-command-modal.ts`)
3. optionally retrieve lore context (lorebook/frontmatter resolution mirrors continuation behavior)
4. call completion provider with text-command system prompt + user prompt payload
5. optionally record usage ledger entry (`operation = text_command_edit`)
6. build a captured target snapshot (file path + selection range + original text) for safe later apply
7. if auto-accept is off and the original editor selection is still active, open review modal with side-by-side source diff (`src/text-command-review-modal.ts`)
8. if focus moved elsewhere or the review modal closes without explicit discard, push the result into an in-memory pending-review queue and expose it through `Review Pending Text Command Edit` plus a status-bar indicator
9. apply replacement against the active editor when it still matches the captured snapshot; otherwise fall back to file-level guarded replacement and keep the review pending if the target drifted

Settings contract (`ConverterSettings.textCommands`):

- `autoAcceptEdits` (default false)
- `defaultIncludeLorebookContext`
- `maxContextTokens`
- `systemPrompt`
- `promptsFolder` (markdown prompt-note directory)

Prompt note frontmatter contract (per note in `promptsFolder`):

- `promptKind: text_command` (or `textcommand`)
- `title`/`name` (optional display name)
- `id` (optional stable template id)
- `includeLorebookContext: true|false` (default from settings)

Built-in fallback templates (used when no prompt notes are found) include:

- `Canon Consistency Pass`
- `Scene Consistency Pass` (internal scene continuity pass)
- `Remove LLMisms` (AI-style cleanup pass for mirrored contrast framing, signposting, meta filler, inflated abstraction, and overly even cadence)

## Story Chat Persistence

Conversation persistence is note-backed in `storyChat.chatFolder`.

Stored structure:

- `agent-session` frontmatter (`session_id`, title/timestamps, selected lorebooks/refs, continuity flags)
- `completion_preset_id` frontmatter value persisted as a snapshot of the active device Story Chat profile when saved
- conversation context section (`Manual Context`)
- per-conversation author-note refs (`note:*`)
- per-conversation chapter/raw note refs
- per-conversation lorebook selection
- per-turn transcript sections (`## User` / `## Model`)
- message versions with active version selector
- assistant message info table includes generation/profile/context summary rows
- full assistant turn context metadata is persisted in collapsed `Context Meta` metadata callouts with fenced `yaml` payloads
- optional context inspector metadata on assistant versions (including steering source resolution, effective completion profile/model, and agent tool traces/calls/writes)

Story Chat UI behavior:

- active conversation is shown as title text
- conversation switching uses an interactive picker (`Open Conversation`) instead of an always-expanded dropdown
- message content is rendered as markdown in-chat

Parsing and serialization logic is centralized in `src/story-chat-document.ts` and covered by tests.
Legacy single-code-block (` ```lorevault-chat `) chat payload parsing is removed; only `agent-session` note format is accepted.

## Inline Directive and Callout Cleanup Contract

Inline steering directives are implemented as optional in-text shorthand for generation/chat.

Accepted directive forms:

- bracket directive: `[LV: <instruction>]`
- html comment directive: `<!-- LV: <instruction> -->`

Parser and staging constraints (implemented):

- only strict-prefix `LV:` directives are parsed
- configured ignored callout types are stripped before note markdown is rendered/cleaned for LLM-bound prompt blocks
- default ignored callout types are `lv-thinking`, `lv-ignore`, and `note`
- directives are converted in-place where they appear in staged context blocks (story window, chat history/manual context, etc.)
- non-`LV:` HTML comments are removed from staged prompt blocks
- deterministic parse order follows source document order within each rendered block
- system prompt explicitly instructs model to follow `<inline_story_directive>` tags
- inspector traces include resolved directive summaries

Reasoning persistence constraints:

- Story Writing inserts returned reasoning into the note as a collapsed `lv-thinking` callout immediately before the streamed continuation when reasoning is enabled and `exclude !== true`
- Story Chat continues to store/render reasoning separately as Thinking metadata rather than feeding it back into subsequent history

Exclusion constraints:

- directive markers/content must be excluded from:
  - lorebook export artifacts
  - summary extraction/generation source text
  - story extraction and story-delta wiki update source payloads

Testing contract:

- fixture coverage for directive parsing variants
- deterministic ordering/dedupe assertions
- inspector layer visibility assertions
- exclusion assertions for export/import/update pipelines

## In-Plugin User Documentation

Embedded docs view:

- view id: `lorevault-help-view`
- file: `src/lorevault-help-view.ts`
- command: `Open LoreVault Help`
- settings shortcut button: `Open LoreVault Help`

This is the primary user-facing in-plugin guide for command flow and feature behavior.

## Cost Tracking (Phase 13)

Implemented scope:

- completion provider usage capture hooks for:
  - active-note continuation stream
  - story chat stream
  - summary generation requests
- usage metadata recorded when provider response includes token usage fields
- optional ledger persistence (`settings.costTracking.enabled`)
- fallback USD estimation via configured per-million token rates
- optional per-model pricing overrides (`provider + wildcard model pattern`)
- Story Writing panel compact usage/cost monitor (session/day/week/month/project totals + warnings)
- Cost Analyzer panel for full per-profile breakdowns
- usage report export commands:
  - `Export Usage Report (JSON)`
  - `Export Usage Report (CSV)`

Core contracts:

- configured ledger path defaults to `.obsidian/plugins/lore-vault/cache/usage-ledger.json`
- if the configured ledger path ends with `.json`, that file is treated as a legacy import source and the canonical shared record root is the sibling path without the suffix
- canonical usage-ledger storage is one immutable JSON file per normalized record grouped by UTC date under `YYYY/MM/DD`
- the local internal SQLite DB indexes canonical usage-ledger records for fast querying when available; the vault record files remain the cross-device source of truth
- ledger sync strategy is vault-event-driven after the initial/root-change reconciliation: LoreVault performs one full canonical scan for the active ledger root, then applies create/modify events incrementally and triggers a full source-root replacement only for deletes, renames, or legacy-ledger file changes
- Cost Analyzer report snapshots now come from SQLite aggregate queries (`SUM`/`GROUP BY`) when the local DB is available; warning text is still assembled in JS over those aggregate result sets so the user-visible budget semantics remain unchanged
- plugin-level known-cost-profile discovery is memoized and invalidated only when relevant device state, settings, or ledger data changes so Operation Log Explorer / Cost Analyzer refreshes do not rebuild the same option lists on every reload
- operation-log search uses an `fts5` side table (`operation_log_search`) joined against summary-row queries, and SQLite result pages now fetch `limit + 1` rows to report “more available” without running an exact `COUNT(*)` on every reload
- lorebook note metadata now lives behind an incremental path-aware cache; manager/routing/query views and live-context file-scope bookkeeping reuse that cache instead of calling `collectLorebookNoteMetadata()` across the whole vault after each markdown mutation
- Story Chat keeps its own view-local markdown-file indexes (sorted files, basename lookup, author-note candidates, chapter candidates, conversation summaries) and invalidates them lazily on vault refreshes instead of rescanning `getMarkdownFiles()` for every picker open
- usage-ledger local-index maintenance now includes stale-source-root pruning on ledger-path changes plus settings-driven `rebuild` / `reset` actions wired through the shared internal DB client
- Cost Analyzer status text now includes usage-ledger local-index freshness (`backend`, `synced ... ago`, pending record count, stale-root count) so lag is visible outside the settings tab
- storage-troubleshooting commands now call the same plugin methods as the settings buttons: local-index rebuild, full local-DB reset, forced legacy-ledger import, and file-explorer reveal of the canonical ledger root
- usage report output dir defaults to `.obsidian/plugins/lore-vault/reports`
- record fields are normalized and sorted deterministically on persist
- cost source is explicit per record:
  - `provider_reported`
  - `estimated`
  - `unknown`
- pricing provenance is explicit per record:
  - `pricingSource` (`provider_reported` | `model_override` | `default_rates` | `none`)
  - `pricingRule` (matched override/default rule label)
  - `pricingSnapshotAt` (normalized timestamp when rate snapshot was taken)
- effective estimate rates are stored per row:
  - `inputCostPerMillionUsd`
  - `outputCostPerMillionUsd`
- day rollups use UTC day boundaries
- report warnings support per-cost-profile budgets at:
  - day/session
  - operation
  - provider:model
  - lorebook
- usage snapshots and warnings are scoped to the selected cost profile; full exports remain all-profiles
- report CSV row ordering is deterministic (`timestamp ASC`, `id ASC`)

Current non-goals in this phase:

- provider pricing auto-sync

## LLM Operation Log

Optional debugging surface (`settings.operationLog.*`):

- `enabled`: toggles persistence
- `path`: vault-relative legacy JSONL base path used for fallback writes, legacy import, and raw-file inspection
- `maxEntries`: retention cap per cost profile (oldest entries trimmed deterministically)
- `includeEmbeddings`: optional embedding backend request/response logging (`kind: embedding`)

Captured records include:

- completion calls (`requestStoryContinuation`)
- streaming completion calls (`requestStoryContinuationStream`)
- completion tool-planner calls (`createCompletionToolPlanner`)
- embedding backend calls (`requestEmbeddings`) when `includeEmbeddings` is enabled

Each record stores:

- operation metadata (id, kind, operation name, provider/model, timing, status/abort)
- full request payload content (messages/tool definitions)
- attempt-level request/response payloads and errors
- final text output (when available)
- parsed usage report (when available)

Explorer surface:

- command: `Open LLM Operation Log Explorer`
- view type: `lorevault-operation-log-view`
- queries the local internal SQLite store when available and falls back to the configured legacy JSONL path otherwise
- list refreshes preload the current result page from SQLite/JSONL as summary rows only; the full normalized record is fetched on first row expansion, heavier request/attempt/final-text sections are only rendered into the DOM when those subsections are opened, and SQLite-backed searches rely on FTS plus a `hasMore` probe instead of exact count queries for truncated pages
- text-bearing payload/detail fields render in readonly inputs/textareas with per-field `Copy` buttons instead of mixed paragraph/pre formatting
- shows the active backend (`OPFS`, `IndexedDB`, or `JSONL fallback`) and malformed-line diagnostics when fallback/import parsing encounters bad lines
- per-entry inspection includes parsed request message/tool sections (newline-preserving textboxes), attempt payloads/responses/errors, final output text, and normalized record JSON

## Phase 14 Import/Extraction (Current Progress)

Implemented:

- inbound SillyTavern lorebook JSON import command/view
- inbound SillyTavern character-card import command/view (`.png` + `.json`)
- linked-story character-card event-injection command (`Inject Character Card Event`) with greeting/event picker and review-first rewrite apply
- character-card library sync command/view model (`Sync Character Card Library`)
- character-card source write-back command (`Write Back Character Card Source`) with hash-staleness guard against unsynced source edits
- deterministic entry normalization and sorting
- deterministic character-card field normalization across v1/v2/v3 shapes
- deterministic file naming/path allocation
- deterministic frontmatter/body mapping for generated wiki pages (summary persisted in `## Summary` section)
- deterministic story+author-note note mapping for character-card rewrite output
- character-card rewrite prompting tuned for richer source-detail retention and longer author-note guidance when needed
- deterministic story-to-character-card-meta backlink injection (`characterCardMeta`) when a synced meta note exists
- optional character-only wiki-page extraction mapping for character-card imports (`<target>/characters/<name>.md`)
- preview and apply import flows
- staged import progress reporting (parse/build/apply with per-file write updates)
- story extraction command/view with preview/apply workflow
- deterministic chunking and per-chunk schema-constrained extraction
- iterative existing-page state injection between chunks
- deterministic merge behavior (single summary-candidate replacement, set unions, unique content append)
- merged story summaries are written to note `## Summary` sections (legacy frontmatter summary treated as fallback input)
- generated extraction notes auto-link clear cross-page title/alias mentions to the actual generated note paths (`[[folder/file-stem|Display Text]]`) so downstream wikilink graph ranking can use the extracted relationships immediately
- extraction chunk/render progress callbacks surfaced in panel UI

## Phase 15 Story Delta Updates (Current Progress)

Implemented:

- story-delta command/view (`Apply Story Delta to Existing Wiki`)
- alias command `Open Lorebook Update` (same view target)
- source story input from inline markdown or source-note mode (`note` | `chapter` | `story`) with picker
- chapter/story source modes expand deterministically from selected note using story-thread resolution
- deterministic target-page loading from folder with optional scope-tag filter
- deterministic chunking reuse (`splitStoryMarkdownIntoChunks`)
- schema-constrained delta operations including confidence + rationale
- low-confidence operation skip policy with warnings/preview counts
- deterministic operation matching (`pageKey` first, title fallback, then deterministic create)
- dry-run diff generation for each planned change (deterministic side-by-side source hunks with bounded context)
- per-change approval selection in panel and `Apply Selected` writes only approved changes
- merge policies:
  - `safe_append`: preserve metadata on existing notes, append unique content blocks
  - `structured_merge`: deterministic summary replacement (recency-biased, confidence-aware), keyword/alias union, and unique content append
- idempotence guard: duplicate content blocks are not appended on rerun
- safe-append guard: existing notes without frontmatter stay frontmatter-free
- fixture-backed tests for parsing, gating, deterministic paths, and idempotence behavior
- story-delta chunk/render progress callbacks surfaced in panel UI

Conflict review UX is now integrated in the panel:

- conflict decisions (`accept`/`reject`/`keep_both`) are made directly next to inline side-by-side diffs
- processed conflicts/changes are visibly marked and can be hidden after apply

## Phase 15.5 Lore Delta Maintenance (Current Progress)

Implemented:

- lore-delta command/view (`Apply Lore Delta to Existing Wiki`)
- alias command `Open Lore Delta` (same view target)
- source idea input from inline markdown or idea-note mode with picker/active-note shortcuts
- deterministic target-page loading from selected lorebooks plus optional focused target notes
- focused target-note snapshots (full note-body excerpts) injected separately from candidate-page metadata
- schema-constrained lore-delta operations including `updateMode` (`merge` vs `rewrite`), confidence, and rationale
- merge policies:
  - `section_merge`: summary replacement (single best candidate), keyword/alias union, and section-aware body merge keyed by `##` headings
  - `rewrite_focused`: same general merge behavior, but explicitly focused target notes may request full managed-body rewrites
- rewrite safety gate: rewrite requests for non-focused notes are downgraded to section merge with preview warnings
- optional create-note disable gate (`Allow New Notes` off)
- dry-run diff generation, conflict review, per-change approval, and `Apply Selected` reuse the same deterministic preview/apply flow as story delta
- fixture-backed tests for parsing, section-aware merges, focused rewrites, rewrite downgrade behavior, and create-disabled gating

## Determinism Requirements (Implementation)

Critical deterministic areas:

- scope discovery order
- output path resolution and collision checks
- graph ranking tie-breaks
- retrieval ranking/tie-breaks
- story-thread ordering

Any behavior change in these areas must be accompanied by:

- test/fixture updates
- docs updates (`README.md`, `docs/documentation.md`, this file)
- roadmap/todo adjustment when applicable

Mobile runtime safety gate:

- `npm run check:mobile-runtime` fails if `src/` imports Node core modules (`node:*`, `fs`, `path`, `crypto`, etc.)
- CI/release workflows run this guard before build/test

## Release Version Automation

Repo release command:

```bash
npm run release:version -- <x.y.z>
```

Implementation: `scripts/release-version.mjs`

Contract:

- validates strict semver (`x.y.z`) and enforces target version > `manifest.json` current version
- requires current branch to match target push branch (default `main`)
- checks for existing tag conflicts before mutating files
- updates `manifest.json` `version` and appends deterministic sorted `versions.json` entry
- runs `git add manifest.json versions.json`
- creates commit message `release <version>`
- creates tag `<version>`
- pushes both branch and tag in one command (`git push origin main <version>` by default)
- supports guarded operation flags:
  - `--dry-run` for no-write preview (no file or git mutations)
  - `--remote`, `--branch` for non-default upstream targets
  - `--allow-dirty` to bypass clean-working-tree enforcement

## Large-Vault Profiling

Use the deterministic profiling command for synthetic large-vault baselines:

```bash
npm run profile:large-vault
```

Optional environment variables:

- `LOREVAULT_PROFILE_ENTRIES` (default `3000`)
- `LOREVAULT_PROFILE_AVG_LINKS` (default `5`)
- `LOREVAULT_PROFILE_CONTENT_CHARS` (default `420`)
- `LOREVAULT_PROFILE_RUNS` (default `3`)

The profile reports average timing for graph build, ranking, and context query assembly.

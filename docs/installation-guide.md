# LoreVault Plugin Installation Guide

This guide will help you install the LoreVault plugin for Obsidian.

## Prerequisites

- [Obsidian](https://obsidian.md/) (version 1.11.4 or higher)
- Desktop or mobile environment
- A basic understanding of file management
- Comfort with accessing hidden folders (like `.obsidian`)

## Installation Steps

### Method 1: Manual Installation

1. **Download the plugin files**
   - Create a new folder named `lore-vault` in your Obsidian vault's plugins directory:
     - Path: `.obsidian/plugins/lore-vault/`
   - Place the following files in this folder:
     - `main.js` (compiled JavaScript file)
     - `manifest.json` (plugin metadata)
     - `styles.css` (styling for the plugin)

2. **Create the plugin directory structure**
   ```
   YourVault/
   ├── .obsidian/
   │   ├── plugins/
   │   │   ├── lore-vault/
   │   │   │   ├── main.js
   │   │   │   ├── manifest.json
   │   │   │   └── styles.css
   ```

3. **Enable the plugin**
   - Open Obsidian
   - Go to Settings (gear icon in the lower left)
   - Navigate to "Community plugins"
   - Disable "Safe mode" if it's enabled
   - Find "LoreVault" in your list of installed plugins
   - Toggle the switch to enable it

4. **Verify installation**
   - You should now see LoreVault ribbon icons in the left sidebar (build lorebook + manager + story chat + story writing)
   - The command palette (Ctrl+P or Cmd+P) should include:
     - "Build Active Lorebook"
     - "Open LoreVault Manager" (opens right sidebar panel)
     - "Open LoreVault Lorebook Auditor" (opens dedicated lorebook audit panel)
     - "Open LoreVault Query Simulation" (opens dedicated retrieval simulation panel)
     - "Open Story Chat" (opens right sidebar panel)
     - "Open Story Starter" (opens dedicated story-starter panel)
     - "Open Story Writing Panel" (opens right sidebar panel)
     - "Open LoreVault Help" (opens embedded help/documentation panel)
     - "Continue Story with Context"
     - "Run Text Command on Selection"
     - "Review Pending Text Command Edit" (appears when a saved text-command result is waiting)
     - "Generate Keywords (Active Note)"
     - "Generate World Info Summary (Active Note)"
     - "Generate Chapter Summary (Active Note)"
     - "Fork Story from Active Note"
     - "Generate World Info Summaries (Active Lorebook)"
     - "Generate Chapter Summaries (Current Story)"
     - "Export Usage Report (JSON)"
     - "Export Usage Report (CSV)"
     - "Import SillyTavern Lorebook"
     - "Import SillyTavern Character Card"
     - "Inject Character Card Event"
     - "Sync Character Card Library"
     - "Write Back Character Card Source"
     - Bases view type "LoreVault Characters" available in Bases view selector
     - "Extract Wiki Pages from Story"
     - "Fork Active Lorebook"
     - "Apply Story Delta to Existing Wiki"
     - "Open Lorebook Update"
     - "Apply Lore Delta to Existing Wiki"
     - "Open Lore Delta"
     - "Create LoreVault Entry Template"

### Method 2: Building from Source

If you prefer to build the plugin from source:

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/lore-vault.git
   ```

2. **Install dependencies**
   ```bash
   cd lore-vault
   npm install
   ```

3. **Build and validate**
   ```bash
   npm run build
   npm test
   npm run profile:large-vault
   ```

4. **Copy the built files to your Obsidian vault**
   - Copy the `main.js`, `manifest.json`, and `styles.css` files from the build directory to `.obsidian/plugins/lore-vault/` in your vault

5. **Enable the plugin in Obsidian** (same as in Method 1, Step 3)

## Post-Installation Configuration

1. **Configure plugin settings**
   - Go to Settings → LoreVault
   - Configure top `Device Local Settings` first:
     - `Active Completion Preset (This Device)`
     - `Device Cost Profile Label`
   - Set `Downstream Export Path Pattern` for exports (`world_info` JSON + fallback markdown projection; default `sillytavern/{lorebook}.json`)
   - Set `Default Lorebook Import Location` (default `LoreVault/import`) used by Import, Story Extraction, and Lorebook Fork defaults
   - Optional: configure canonical SQLite output directory (default `lorebooks/`, one `<lorebook>.db` per lorebook; folder picker available; vault-relative paths only)
   - Optional: include `{lorebook}` (or legacy `{scope}`) in downstream subpath for per-lorebook templating (otherwise LoreVault appends `-<lorebook-slug>` automatically)
   - Configure Lorebook Selection (`tagPrefix`, `activeScope`, `membershipMode`, `includeUntagged`)
   - Optional: configure Writing Completion (provider, endpoint, API key, model, prompt)
   - API keys are stored via Obsidian Secret Storage (not in plugin `data.json`)
   - LoreVault only creates missing secrets and never overwrites existing secret values
   - Secret IDs are configurable; use `Pick Existing` to reuse one stored secret across multiple presets
   - Each completion preset has its own `Completion API Secret Name` used for that preset's key
   - Optional: create model presets (`New Preset`, `Clone Current`, `Delete Selected`); preset edits auto-save and active preset selection is device-local (not synced between devices)
   - Optional: set a device-local cost profile label for usage metadata tagging (if empty, LoreVault auto-derives one from API key hash)
   - Optional: configure Story Chat tool calling (`Enable Story Chat Tool Calls`, call/token/time limits, optional write-action gate)
   - LLM Operation Log is enabled by default (including embedding backend calls); LoreVault prefers a local SQLite-backed store and keeps `10000` entries per cost profile by default
   - Current builds inline the internal DB worker into `main.js`, so there are no extra worker/asset files to sync for operation-log storage
   - Optional: open `LLM Operation Log Explorer` from settings (or command palette) to inspect/search captured calls by cost profile
   - Optional: configure Retrieval tuning (`Fallback Retrieval Policy`, seed threshold, max graph hops, graph hop decay)
   - Optional: enable Retrieval Tool Hooks (`search_entries`, `expand_neighbors`, `get_entry`) and set per-turn safety limits (call cap, tool-result token cap, planning time cap)
   - Optional: tune completion context budgets (`max output tokens`, `context window tokens`, `prompt reserve tokens`)
   - Optional: configure `Ignored LLM Callout Types` for note-local markdown that should stay in notes but be removed from LLM prompts (default: `lv-thinking`, `lv-ignore`, `note`)
   - Optional: set `Story Continuity Aggressiveness` (`Balanced` or `Aggressive`) to control how much prior chapter memory/style carryover is injected
   - Optional: configure `Semantic Chapter Recall` (under Writing Completion) to toggle/tune embedding-based related prior-scene recall (`Related Past Scenes`) with controls for chapter/chunk limits, chunk sizing, similarity threshold, recency blend, and budget share (enabled by default with a large-context tuned profile)
   - Optional: configure Auto Summaries (summary input cap + optional world_info output cap; default output cap is `0` to disable truncation)
   - Optional: enable Cost Tracking, set fallback USD-per-1M token rates, optional model pricing overrides, report output directory, and optional budget warnings (daily/session/operation/model/lorebook) per selected `Budget Cost Profile`
   - Optional: configure embeddings backend/cache/chunking for semantic fallback retrieval
   - Adjust priority weights if needed

2. **Try creating a template**
   - Press Ctrl+P (or Cmd+P on Mac) to open the command palette
   - Type "Create LoreVault Entry Template" and select it
   - Fill in the form and create your first template

3. **Build your vault export**
   - Ensure your notes use hierarchical lorebook tags like `#lorebook/universe/...`
   - Notes are included as canonical lore entries by default
   - Use frontmatter `retrieval: none` to exclude a note from retrieval/export
   - Use command "Build Active Lorebook" (or the build ribbon icon) to export the active note lorebook
   - Use "Open LoreVault Manager" for discovered lorebooks and per-lorebook build actions
   - Use "Open LoreVault Lorebook Auditor" for lorebook quality diagnostics
   - In Lorebook Auditor, use Quality Audit to detect missing keywords and run reviewed keyword generation for one or many notes
   - Use "Open LoreVault Query Simulation" to simulate retrieval across one or multiple lorebooks with override knobs
   - Monitor the progress bar as your vault is converted

4. **Use writing-assistant context insertion**
   - Open a story note in editor view
   - Optional: define story lorebooks in frontmatter (for example `lorebooks: [universe, universe/yggdrasil]`)
   - Place cursor where you want to continue
   - Run command "Continue Story with Context" or use right-click in editor -> `LoreVault: Continue Story with Context`
   - Use right-click in non-author-note markdown notes -> `LoreVault: Insert Inline Directive` to insert `<!-- LV: ... -->` at the cursor, even before an author note is linked
   - If needed, stop an active run with command `Stop Active Generation` (also available in editor menu while running)
   - LoreVault queries token-budgeted context (`world_info` + fallback entries) and streams generated continuation text
   - If tool hooks are enabled, LoreVault can add a bounded tool-retrieved context layer before generation
   - If the active note defines long-form story metadata (`authorNote` link, `chapter`, optional prev/next refs), LoreVault injects bounded prior chapter memory before lorebook context, scaling prior-chapter depth when context budget is larger
   - `Story Continuity Aggressiveness` in settings controls how strongly chapter memory expands (depth + style excerpts) in both Continue Story and Story Chat
   - Optional semantic chapter recall can inject `Related Past Scenes` from prior chapter chunks when enabled in settings
   - With embeddings enabled, long query windows are chunked and averaged for semantic query embedding; if embedding calls fail, LoreVault continues with lexical retrieval fallback
   - Link your story note to an Author Note via frontmatter `authorNote: [[path/to/author-note]]` (or run `Open or Create Linked Author Note`)
   - Quoted and unquoted Obsidian wikilinks are both supported for `authorNote`
   - Optional (character-card import only): set `Persona Note` in the import panel to bake protagonist/user context into generated story + author note output
   - Optional: run `Open Story Starter` to turn an idea + brainstorm notes into a chapter-1 story note and linked author note before you begin manual drafting
   - Author Note content is edited directly in the linked note (native Obsidian editor)
   - Optional: set `completionProfile: <preset-id>` in Author Note frontmatter (or via command `Set Author Note Completion Profile`) to override the completion profile for linked story operations
   - `Rewrite Author Note` supports an optional change prompt and shows a side-by-side source diff review before apply
   - Lorebook selection for continuation/chat resolves from linked Author Note frontmatter first, then story-note frontmatter fallback (no active-lorebook fallback)
   - The Story Writing panel keeps using the last active markdown story note even when the panel itself is focused, so linked Author Note and lorebook state stay available while you use the panel controls
   - In Story Writing panel, the device completion profile is selected from a dropdown and applies immediately
   - Writing Completion settings under the selected preset, including thinking/reasoning options, persist with that preset when you switch profiles
   - Story Chat profile selection is separate and does not affect `Continue Story`; Story Writing uses author-note override first, then its own device preset, then base settings
   - Cost profile label is configured in settings (not in Story Writing panel)
   - Inline instruction comments are supported as `[LV: ...]` and `<!-- LV: ... -->`; LoreVault renders them in-place as `<inline_story_directive>` tags during prompt assembly
   - Configured ignored callout types are stripped before note text is sent to the LLM; defaults are `lv-thinking`, `lv-ignore`, and `note`
   - If thinking/reasoning is enabled and `Exclude Reasoning from Response` is off, `Continue Story` stores returned reasoning in a collapsed `lv-thinking` callout before the continuation text
   - Long-form chapter QoL commands:
     - `Split Active Story Note into Chapter Notes`
     - `Split Active Story Note into Chapter Notes (Pick Folder)`
     - `Create Next Story Chapter`
     - `Fork Story from Active Note`
   - Story Writing Panel action groups:
     - `Continue Story` (toggles to `Stop` during generation) + `Insert Directive`
     - `Open/Create Author Note`, `Link Author Note`, `Rewrite Author Note`
     - `Generate Chapter Summary`, `Create Next Chapter`, `Fork Story`
   - Use command `Open LLM Operation Log Explorer` to inspect full completion/planner/embedding payloads and current storage backend status without leaving Obsidian; the explorer preloads the current result page as summary rows, fetches full row detail on first expansion, heavy payload sections only render when opened, text/json fields include `Copy` buttons, and SQLite-backed searches use FTS with first-page reporting instead of exact recounts on every refresh
   - Use command `Open Cost Analyzer` for per-profile cost breakdowns and budget warnings; shared usage-ledger records live in the vault, and LoreVault accelerates queries with a local SQLite index that stays in sync from vault events after its initial ledger scan and computes analyzer totals with DB aggregate queries
   - Lorebook Manager, Routing Debug, and Query Simulation refreshes now reuse an incremental lorebook metadata cache, so routine note edits do not require a full markdown-note rescan before those views update
   - Story Chat note pickers reuse cached markdown-file indexes and conversation summaries between vault refreshes instead of rescanning all notes on each open
   - In settings, use `Refresh Status`, `Rebuild Local Indexes`, and `Reset Local DB` to inspect/repair the worker-backed local SQLite store without manual file deletion
   - `Open Cost Analyzer` now also shows local index freshness (`backend`, `synced ... ago`, pending updates, stale roots) alongside the selected profile summary
   - The same maintenance workflow is available from the command palette: `Rebuild Local Indexes`, `Reset Local DB`, `Import Legacy Usage Ledger Now`, `Show Canonical Usage Ledger Folder`
   - Open "Open Story Writing Panel" for writing controls + generation/cost telemetry, or "Open Story Chat" for in-chat telemetry

5. **Open embedded help**
   - Run command `Open LoreVault Help`
   - Help opens in the main editor area as a tab
   - Use it as the in-plugin quick reference for setup, retrieval behavior, and export artifacts
   - Use the built-in buttons to open lorebook import, story extraction, and lorebook update panels

6. **Optional: Generate and approve summaries**
   - Open a note and run:
     - `Generate World Info Summary (Active Note)` for lore entry summary candidate
     - `Generate Chapter Summary (Active Note)` for chapter memory summary candidate
   - For batch workflows:
     - `Generate World Info Summaries (Active Lorebook)`
     - `Generate Chapter Summaries (Current Story)`
   - In the review modal:
     - `Write Summary Section` writes/updates the `## Summary` section in the note body
   - LoreVault uses precedence:
     - world_info: summary section content (`LV_BEGIN/LV_END` block when present, otherwise first paragraph) -> `frontmatter summary` (fallback) -> body
     - chapter memory: summary section content (`LV_BEGIN/LV_END` block when present, otherwise first paragraph) -> `frontmatter summary` (fallback) -> excerpt
   - Chapter summaries are not hard-length capped; multi-paragraph chapter summaries are wrapped with `<!-- LV_BEGIN_SUMMARY -->` and `<!-- LV_END_SUMMARY -->` in `## Summary`.

7. **Optional: Run text commands on selection**
   - Select text in editor
   - Right-click and run `LoreVault: Run Text Command on Selection` (or run command palette action `Run Text Command on Selection`)
   - Choose/edit prompt template and optional lorebook-context toggle
   - Built-in defaults include `Canon Consistency Pass`, `Scene Consistency Pass` (internal scene continuity checks), and `Remove LLMisms` (common AI-style cleanup)
   - Prompt templates are markdown notes from your prompt folder (`Text Command Prompt Notes Folder` in settings)
   - If you stay on the original selection, review the side-by-side diff modal and click `Apply Edit` (unless auto-accept is enabled)
   - If the result finishes after you move elsewhere, or if the review modal is dismissed, reopen it with `Review Pending Text Command Edit` or the LoreVault status-bar review indicator
   - Configure defaults in Settings -> LoreVault -> `Text Commands`

8. **Use Story Chat (Phase 10 foundation)**
   - Run command "Open Story Chat"
   - Use `Open Conversation` to interactively switch chats; use `New Chat` to create one
   - Set `Chat Completion Profile` once for this device (shared across conversations), or leave it unset to use device/default completion settings
   - Optional: set the conversation note folder in Settings -> LoreVault -> `Story Chat Conversation Folder`
   - Select lorebooks to use via the add/remove list (leave empty for manual-only chat)
   - Optional: add manual context text in the panel
   - Optional: add author notes via `Add Author Note` and remove list items as needed
   - Optional: add chapter/raw notes via `Add Chapter` / `Add Note` and remove list items as needed
   - Optional: enable Story Chat tool calls in settings to allow bounded lorebook/story/steering tools during chat turns
   - Send prompts and watch streamed responses
   - Assistant message metadata shows the profile/model that generated each response
   - Use message actions: `Edit`, `Fork Here`, and `Regenerate` (latest assistant message)
   - Use message version selectors to switch between regenerated assistant variants
   - Each chat/fork is stored as a markdown note in `LoreVault/chat`
   - Conversation notes use a readable session format (frontmatter + `## User` / `## Model` sections)
   - Assistant context metadata in saved notes is kept in collapsed `Context Meta` callouts (fenced `yaml`) plus expanded Message Info table rows
   - Expand per-turn context inspector blocks to see selected lorebooks, resolved notes, pulled items, retrieval tool-hook traces, and chat agent tool call/write traces

9. **Import Existing SillyTavern Assets (Phase 14)**
  - Run command `Import SillyTavern Lorebook`
  - Set target folder (prefilled from `Default Lorebook Import Location`, manual path or `Browse`) and default tags
  - Select lorebooks in the list UI (delete per item, add interactively, or add custom lorebook with Enter in the inline text field)
  - Optional: pick a completion profile in the panel
  - Paste lorebook JSON in the panel text field
  - Click `Preview` to inspect planned file paths
  - Watch staged progress updates (parse/build/apply) and per-file write progress during import
  - Imported summaries are written to note `## Summary` sections
  - Click `Import` to create/update generated wiki notes deterministically
  - For character cards:
    - Optional setup: configure `Character Card Source Folder` and `Character Card Meta Folder` in settings
    - Optional setup: enable `Auto-Generate Card Summaries on Sync` (and choose a summary completion profile if desired)
    - Optional setup: run `Sync Character Card Library` to create/update `lvDocType: characterCard` meta notes for source cards
    - Optional: edit card fields in a synced `characterCard` meta note and run `Write Back Character Card Source` to push them into the source `.png`/`.json` card
    - If write-back reports stale source hash, run `Sync Character Card Library` first, then retry write-back
    - Synced card meta notes include a readable `Character Card Details` markdown section block for long fields, with numbered subheadings for alternate/group-only greeting variants
    - Run command `Import SillyTavern Character Card` (or switch import type in the same panel)
    - Pick a `.png`/`.json` card file from the vault
    - If the card has multiple first/alternate greetings, choose the opening scene in the greeting picker
    - Keep/adjust completion profile for rewrite
    - Optional: enable/disable embedded lorebook import
    - Optional: enable `Extract Character Wiki Page` to generate one character-only lorebook page from scenario/card context
    - Rewrite output uses freeform `authorNoteMarkdown` (no enforced section template in plugin post-processing)
    - Rewrite prompt preserves high-detail card constraints (description/personality/scenario/system prompts) and allows longer author-note output when needed
    - If a synced character-card meta note exists, generated story frontmatter includes `characterCardMeta: [[...]]` backlink target
    - Later, on a linked story note, run `Inject Character Card Event` to select another greeting/event and review/apply a story rewrite (plus optional linked author-note rewrite)
    - In preview, review and edit planned write paths/content before apply
    - Preview and import generated story note + linked author note (+ optional character wiki page and embedded lorebook notes)
    - Optional: in a Base filtered to character meta notes, switch to the `LoreVault Characters` view for avatar-card rendering and markdown/HTML field display

10. **Extract Wiki Pages from Story (Phase 14)**
   - Run command `Extract Wiki Pages from Story`
   - Set target folder (prefilled from `Default Lorebook Import Location`, manual path or `Browse`), default tags, lorebook name, chunk/extraction limits, and completion profile
   - Paste story markdown
   - Click `Preview Extraction` to run chunked LLM extraction with deterministic merge preview
   - Monitor live chunk-stage progress while preview runs
   - Inspect planned pages and chunk diagnostics
   - Extracted summaries are written to note `## Summary` sections
   - Generated notes also add deterministic Obsidian wikilinks to other extracted pages when their titles or strong aliases are clearly mentioned, using the generated note paths as the actual link targets
   - Click `Apply Preview` to write generated/updated wiki pages with live per-file progress

11. **Apply Story Delta to Existing Wiki (Phase 15 foundation)**
   - Run command `Apply Story Delta to Existing Wiki` (or alias `Open Lorebook Update`)
   - Provide story markdown directly or set `Source Story Note Path` (via `Pick Note` or `Use Active Note`)
   - Choose `Source Range`: `note` (single note), `chapter` (selected chapter note), or `story` (full story thread from selected note)
   - Select one or more lorebooks in `Lorebooks to Consider` (interactive add + custom Enter-to-add)
   - Pick completion profile for lorebook-update preview calls
   - Set `New Note Target Folder` (manual path or `Browse`) for create operations
   - Choose update policy:
     - `safe_append` (default): preserve existing metadata on existing pages
     - `structured_merge`: update summary-section/keywords/aliases (summary uses single-candidate replacement, not concatenation)
   - Set low-confidence threshold (operations below threshold are skipped in preview)
   - Click `Preview Story Delta` to inspect planned create/update writes
   - Monitor live chunk-stage progress while preview runs
   - Review per-change side-by-side dry-run diffs
   - Select approved changes and click `Apply Selected` (live per-file apply progress)

12. **Apply Lore Delta to Existing Wiki**
   - Run command `Apply Lore Delta to Existing Wiki` (or alias `Open Lore Delta`)
   - Paste an idea brief directly or set `Idea Note Path` (via `Pick Note` or `Use Active Note`)
   - Select one or more lorebooks in `Lorebooks to Consider`
   - Optionally add focused target notes when you want a specific page to receive a structural rewrite instead of only merged canon additions
   - Choose update policy:
     - `section_merge`: merge into matching headings while preserving untouched sections
     - `rewrite_focused`: allow full managed-body rewrites for focused target notes
   - Set `Allow New Notes` depending on whether the idea may need a brand new lore page
   - Click `Preview Lore Delta`, inspect diffs/conflicts, then `Apply Selected`

13. **Fork Lorebook**
   - Run command `Fork Active Lorebook`
   - Source lorebook is resolved from the active note lorebook (or configured `Active Lorebook`)
   - Enter a new lorebook and target folder (default: `<Default Lorebook Import Location>/<new-lorebook>`)
   - LoreVault copies lorebook notes, rewrites internal links to copied notes, removes old lorebook tags, and applies the new lorebook tag

## Troubleshooting

- **Plugin doesn't appear in settings**: Make sure all files are in the correct location and properly named
- **Command palette commands don't appear**: Try restarting Obsidian
- **Conversion fails**: Check the console (Ctrl+Shift+I) for error messages
- **Character-card import fails on very large cards**:
  - current rewrite/extract flow is single-request (not chunked), so oversized card payloads can exceed model context limits
  - use a larger-context completion profile or trim card fields before import
- **Plugin doesn't recognize files**:
  - Ensure notes are tagged under your configured lorebook tag prefix (default `#lorebook/...`)
  - Check active lorebook and membership mode settings
  - Check explicit exclusion flag (`exclude: true`) in frontmatter

## Updates

Since this is a manual installation, you'll need to manually update the plugin when new versions are released:

1. Download the latest version
2. Replace the files in your `.obsidian/plugins/lore-vault/` directory
3. Restart Obsidian

Maintainer release command (repository workflow):

```bash
npm run release:version -- <version>
```

This command validates version progression, updates `manifest.json`/`versions.json`, creates commit `release <version>`, tags `<version>`, and pushes branch + tag to `origin main` by default.

## Need Help?

If you encounter any issues with installation or usage, please:

1. Check the README and DOCUMENTATION files
2. Look for error messages in the developer console (Ctrl+Shift+I)
3. Reach out through the GitHub repository's issues section

---

Once installed, you're ready to start building lorebook-based LoreVault exports from your Obsidian notes.

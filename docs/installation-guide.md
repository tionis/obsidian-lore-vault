# LoreVault Plugin Installation Guide

This guide will help you install the LoreVault plugin for Obsidian.

## Prerequisites

- [Obsidian](https://obsidian.md/) (version 0.15.0 or higher)
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
   - You should now see LoreVault ribbon icons in the left sidebar (build scope + manager + story chat + story writing)
   - The command palette (Ctrl+P or Cmd+P) should include:
     - "Build Active Lorebook Scope"
     - "Open LoreVault Manager" (opens right sidebar panel)
     - "Open LoreVault Lorebook Auditor" (opens dedicated lorebook audit panel)
     - "Open LoreVault Query Simulation" (opens dedicated retrieval simulation panel)
     - "Open Story Chat" (opens right sidebar panel)
     - "Open Story Writing Panel" (opens right sidebar panel)
     - "Open LoreVault Help" (opens embedded help/documentation panel)
     - "Continue Story with Context"
     - "Run Text Command on Selection"
     - "Generate Keywords (Active Note)"
     - "Generate World Info Summary (Active Note)"
     - "Generate Chapter Summary (Active Note)"
     - "Generate World Info Summaries (Active Scope)"
     - "Generate Chapter Summaries (Current Story)"
     - "Export Usage Report (JSON)"
     - "Export Usage Report (CSV)"
     - "Import SillyTavern Lorebook"
     - "Extract Wiki Pages from Story"
     - "Apply Story Delta to Existing Wiki"
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
   - Set `Downstream Export Path Pattern` for exports (`world_info` JSON + fallback markdown projection; default `sillytavern/lorevault.json`)
   - Optional: configure canonical SQLite output directory (default `lorebooks/`, one `<scope>.db` per lorebook; folder picker available; vault-relative paths only)
   - Optional: include `{scope}` in downstream subpath for per-scope templating (otherwise LoreVault appends `-<scope-slug>` automatically)
   - Configure Lorebook Scope (`tagPrefix`, `activeScope`, `membershipMode`, `includeUntagged`)
   - Optional: configure Writing Completion (provider, endpoint, API key, model, prompt)
   - Optional: create model presets and select an active completion preset for quick A/B comparison
   - Optional: configure Story Chat tool calling (`Enable Story Chat Tool Calls`, call/token/time limits, optional write-action gate)
   - Optional: enable LLM Operation Log (full request/response debug logs), choose log path/retention, and optionally include embedding backend calls
   - Optional: open `LLM Operation Log Explorer` from settings (or command palette) to inspect/search captured calls in-plugin
   - Optional: configure Retrieval tuning (`Fallback Retrieval Policy`, seed threshold, max graph hops, graph hop decay)
   - Optional: enable Retrieval Tool Hooks (`search_entries`, `expand_neighbors`, `get_entry`) and set per-turn safety limits (call cap, tool-result token cap, planning time cap)
   - Optional: tune completion context budgets (`max output tokens`, `context window tokens`, `prompt reserve tokens`)
   - Optional: configure Auto Summaries (summary input/output character caps)
   - Optional: enable Cost Tracking, set fallback USD-per-1M token rates, optional model pricing overrides, report output directory, and optional budget warnings (daily/session/operation/model/scope)
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
   - Use command "Build Active Lorebook Scope" (or the build ribbon icon) to export the active note scope
   - Use "Open LoreVault Manager" for discovered scopes and per-scope build actions
   - Use "Open LoreVault Lorebook Auditor" for scope quality diagnostics
   - In Lorebook Auditor, use Quality Audit to detect missing keywords and run reviewed keyword generation for one or many notes
   - Use "Open LoreVault Query Simulation" to simulate retrieval across one or multiple scopes with override knobs
   - Monitor the progress bar as your vault is converted

4. **Use writing-assistant context insertion**
   - Open a story note in editor view
   - Optional: define story scopes in frontmatter (for example `lorebooks: [universe, universe/yggdrasil]`)
   - Place cursor where you want to continue
   - Run command "Continue Story with Context" or use right-click in editor -> `LoreVault: Continue Story with Context`
   - Use right-click in story notes -> `LoreVault: Insert Inline Directive` to insert `<!-- LV: ... -->` at the cursor
   - If needed, stop an active run with command `Stop Active Generation` (also available in editor menu while running)
   - LoreVault queries token-budgeted context (`world_info` + fallback entries) and streams generated continuation text
   - If tool hooks are enabled, LoreVault can add a bounded tool-retrieved context layer before generation
   - If the active note defines long-form story metadata (`authorNote` link, `chapter`, optional prev/next refs; `storyId` optional fallback), LoreVault injects bounded prior chapter memory before lorebook context, scaling prior-chapter depth when context budget is larger
   - With embeddings enabled, long query windows are chunked and averaged for semantic query embedding; if embedding calls fail, LoreVault continues with lexical retrieval fallback
   - Link your story note to an Author Note via frontmatter `authorNote: [[path/to/author-note]]` (or run `Open or Create Linked Author Note`)
   - Author Note content is edited directly in the linked note (native Obsidian editor)
   - `Rewrite Author Note` supports an optional change prompt and shows a diff review before apply
   - Lorebook scope selection for continuation/chat resolves from story-note frontmatter first, then Author Note frontmatter (no active-scope fallback)
   - Inline instruction comments are supported as `[LV: ...]` and `<!-- LV: ... -->` and are injected as an explicit steering layer
   - Long-form chapter QoL commands:
     - `Split Active Story Note into Chapter Notes`
     - `Split Active Story Note into Chapter Notes (Pick Folder)`
     - `Create Next Story Chapter` (also appears in editor context menu for notes with chapter frontmatter)
   - Story Writing Panel also includes `Link Author Note` and `Create Next Chapter` actions
   - Use command `Open LLM Operation Log Explorer` to inspect full completion/planner payloads (and optional embedding payloads) without leaving Obsidian
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
     - `Generate World Info Summaries (Active Scope)`
     - `Generate Chapter Summaries (Current Story)`
   - In the review modal:
     - `Write Summary Section` writes/updates the `## Summary` section in the note body
   - LoreVault uses precedence:
     - world_info: first paragraph under `## Summary` -> `frontmatter summary` (fallback) -> body
     - chapter memory: first paragraph under `## Summary` -> `frontmatter summary` (fallback) -> excerpt

7. **Optional: Run text commands on selection**
   - Select text in editor
   - Right-click and run `LoreVault: Run Text Command on Selection` (or run command palette action `Run Text Command on Selection`)
   - Choose/edit prompt template and optional lorebook-context toggle
   - Prompt templates are markdown notes from your prompt folder (`Text Command Prompt Notes Folder` in settings)
   - Review diff modal and click `Apply Edit` (unless auto-accept is enabled)
   - Configure defaults in Settings -> LoreVault -> `Text Commands`

8. **Use Story Chat (Phase 10 foundation)**
   - Run command "Open Story Chat"
   - Use the conversation dropdown at the top to switch chats; use `New Chat` to create one
   - Optional: set the conversation note folder in Settings -> LoreVault -> `Story Chat Conversation Folder`
   - Select lorebook scopes to use (or disable lorebook context for manual-only chat)
   - Optional: add manual context text in the panel
   - Optional: add specific note references using `Add Note` or `Add Active`; remove list items as needed
   - Optional: enable Story Chat tool calls in settings to allow bounded lorebook/story/steering tools during chat turns
   - Send prompts and watch streamed responses
   - Use message actions: `Edit`, `Fork Here`, and `Regenerate` (latest assistant message)
   - Use message version selectors to switch between regenerated assistant variants
   - Each chat/fork is stored as a markdown note in `LoreVault/chat`
   - Expand per-turn context inspector blocks to see selected scopes, resolved notes, pulled items, retrieval tool-hook traces, and chat agent tool call/write traces

9. **Import Existing Lorebook JSON (Phase 14)**
  - Run command `Import SillyTavern Lorebook`
  - Set target folder (manual path or `Browse`), default tags, and lorebook name
  - Paste lorebook JSON in the panel text field
  - Click `Preview` to inspect planned file paths
  - Imported summaries are written to note `## Summary` sections
  - Click `Import` to create/update generated wiki notes deterministically

10. **Extract Wiki Pages from Story (Phase 14)**
   - Run command `Extract Wiki Pages from Story`
   - Set target folder (manual path or `Browse`), default tags, lorebook name, and chunk/extraction limits
   - Paste story markdown
   - Click `Preview Extraction` to run chunked LLM extraction with deterministic merge preview
   - Inspect planned pages and chunk diagnostics
   - Extracted summaries are written to note `## Summary` sections
   - Click `Apply Preview` to write generated/updated wiki pages

11. **Apply Story Delta to Existing Wiki (Phase 15 foundation)**
   - Run command `Apply Story Delta to Existing Wiki`
   - Provide story markdown directly or set `Source Story Note Path` (via `Pick Note` or `Use Active Note`)
   - Choose `Source Scope`: `note` (single note), `chapter` (selected chapter note), or `story` (full story thread from selected note)
   - Select one or more lorebook scopes in `Lorebooks to Consider`
   - Set `New Note Target Folder` (manual path or `Browse`) for create operations
   - Choose update policy:
     - `safe_append` (default): preserve existing metadata on existing pages
     - `structured_merge`: merge summary-section/keywords/aliases where confidence is high
   - Set low-confidence threshold (operations below threshold are skipped in preview)
   - Click `Preview Story Delta` to inspect planned create/update writes
   - Review per-change dry-run diff previews
   - Select approved changes and click `Apply Selected`

## Troubleshooting

- **Plugin doesn't appear in settings**: Make sure all files are in the correct location and properly named
- **Command palette commands don't appear**: Try restarting Obsidian
- **Conversion fails**: Check the console (Ctrl+Shift+I) for error messages
- **Plugin doesn't recognize files**:
  - Ensure notes are tagged under your configured lorebook tag prefix (default `#lorebook/...`)
  - Check active scope and membership mode settings
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

Once installed, you're ready to start building scoped LoreVault exports from your Obsidian notes.

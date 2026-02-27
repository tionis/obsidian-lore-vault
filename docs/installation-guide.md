# LoreVault Plugin Installation Guide

This guide will help you install the LoreVault plugin for Obsidian.

## Prerequisites

- [Obsidian](https://obsidian.md/) (version 0.15.0 or higher)
- Desktop environment (plugin is desktop-only)
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
   - You should now see LoreVault ribbon icons in the left sidebar (build scope + manager + story chat)
   - The command palette (Ctrl+P or Cmd+P) should include:
     - "Build Active Lorebook Scope"
     - "Open LoreVault Manager" (opens right sidebar panel)
     - "Open LoreVault Routing Debug" (opens dedicated routing diagnostics panel)
     - "Open LoreVault Query Simulation" (opens dedicated retrieval simulation panel)
     - "Open Story Chat" (opens right sidebar panel)
     - "Open LoreVault Help" (opens embedded help/documentation panel)
     - "Continue Story with Context"
     - "Run Text Command on Selection"
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
   - Set `Downstream Export Path Pattern` for exports (`world_info` JSON + `rag` markdown; default `sillytavern/lorevault.json`)
   - Optional: configure canonical SQLite output directory (default `lorebooks/`, one `<scope>.db` per lorebook; folder picker available)
   - Optional: include `{scope}` in downstream subpath for per-scope templating (otherwise LoreVault appends `-<scope-slug>` automatically)
   - Configure Lorebook Scope (`tagPrefix`, `activeScope`, `membershipMode`, `includeUntagged`)
   - Optional: configure Writing Completion (provider, endpoint, API key, model, prompt)
   - Optional: create model presets and select an active completion preset for quick A/B comparison
   - Optional: configure Retrieval tuning (`RAG Fallback Policy`, seed threshold, max graph hops, graph hop decay)
   - Optional: enable Retrieval Tool Hooks (`search_entries`, `expand_neighbors`, `get_entry`) and set per-turn safety limits (call cap, tool-result token cap, planning time cap)
   - Optional: tune completion context budgets (`max output tokens`, `context window tokens`, `prompt reserve tokens`)
   - Optional: configure Auto Summaries (summary input/output character caps)
   - Optional: enable Cost Tracking, set fallback USD-per-1M token rates, set report output directory, and optional daily/session budget warnings
   - Optional: configure embeddings backend/cache/chunking for semantic RAG
   - Adjust priority weights if needed

2. **Try creating a template**
   - Press Ctrl+P (or Cmd+P on Mac) to open the command palette
   - Type "Create LoreVault Entry Template" and select it
   - Fill in the form and create your first template

3. **Build your vault export**
   - Ensure your notes use hierarchical lorebook tags like `#lorebook/universe/...`
   - Notes with `keywords`/`key` are routed to `world_info`; notes without keywords are routed to `rag` by default
   - Use frontmatter `retrieval: auto|world_info|rag|both|none` to override per note
   - Use command "Build Active Lorebook Scope" (or the build ribbon icon) to export the active note scope
   - Use "Open LoreVault Manager" for discovered scopes and per-scope build actions
   - Use "Open LoreVault Routing Debug" for full note-level inclusion/routing diagnostics
   - Use "Open LoreVault Query Simulation" to simulate retrieval across one or multiple scopes with override knobs
   - Monitor the progress bar as your vault is converted

4. **Use writing-assistant context insertion**
   - Open a story note in editor view
   - Optional: define story scopes in frontmatter (for example `lorebooks: [universe, universe/yggdrasil]`)
   - Place cursor where you want to continue
   - Run command "Continue Story with Context" or use right-click in editor -> `LoreVault: Continue Story with Context`
   - LoreVault queries token-budgeted context (`world_info` + `rag`) and streams generated continuation text
   - If tool hooks are enabled, LoreVault can add a bounded tool-retrieved context layer before generation
   - If the active note defines long-form story metadata (`storyId`, `chapter`, optional prev/next refs), LoreVault injects bounded prior chapter memory before lorebook context
   - Open "Open LoreVault Manager" for global generation overview, or "Open Story Chat" for in-chat generation telemetry

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
   - Review diff modal and click `Apply Edit` (unless auto-accept is enabled)
   - Configure defaults in Settings -> LoreVault -> `Text Commands`

8. **Use Story Chat (Phase 10 foundation)**
   - Run command "Open Story Chat"
   - Use the conversation dropdown at the top to switch chats; use `New Chat` to create one
   - Optional: set the conversation note folder in Settings -> LoreVault -> `Story Chat Conversation Folder`
   - Select lorebook scopes to use (or disable lorebook context for manual-only chat)
   - Optional: add manual context text in the panel
   - Optional: add specific note references using `Add Note` or `Add Active`; remove list items as needed
   - Send prompts and watch streamed responses
   - Use message actions: `Edit`, `Fork Here`, and `Regenerate` (latest assistant message)
   - Use message version selectors to switch between regenerated assistant variants
   - Each chat/fork is stored as a markdown note in `LoreVault/chat`
   - Expand per-turn context inspector blocks to see selected scopes, resolved notes, pulled items, and tool-hook layer traces

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
   - Provide story markdown directly or set `Source Story Note Path` and click `Use Active Note`
   - Set target wiki folder (manual path or `Browse`) and optional scope tag filter
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

## Need Help?

If you encounter any issues with installation or usage, please:

1. Check the README and DOCUMENTATION files
2. Look for error messages in the developer console (Ctrl+Shift+I)
3. Reach out through the GitHub repository's issues section

---

Once installed, you're ready to start building scoped LoreVault exports from your Obsidian notes.

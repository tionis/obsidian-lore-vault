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
   - You should now see LoreVault ribbon icons in the left sidebar (build scope + manager)
   - The command palette (Ctrl+P or Cmd+P) should include:
     - "Build Active Lorebook Scope"
     - "Open LoreVault Manager" (opens right sidebar panel)
     - "Continue Story with Context"
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
   ```

4. **Copy the built files to your Obsidian vault**
   - Copy the `main.js`, `manifest.json`, and `styles.css` files from the build directory to `.obsidian/plugins/lore-vault/` in your vault

5. **Enable the plugin in Obsidian** (same as in Method 1, Step 3)

## Post-Installation Configuration

1. **Configure plugin settings**
   - Go to Settings → LoreVault
   - Set downstream output subpath for exports (`world_info` JSON + `rag` markdown; default `sillytavern/lorevault.json`)
   - Optional: configure canonical SQLite output directory (default `lorebooks/`, one `<scope>.db` per lorebook)
   - Optional: include `{scope}` in downstream subpath for per-scope templating (otherwise LoreVault appends `-<scope-slug>` automatically)
   - Configure Lorebook Scope (`tagPrefix`, `activeScope`, `membershipMode`, `includeUntagged`)
   - Optional: configure Writing Completion (provider, endpoint, API key, model, prompt) for LLM continuation
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
   - Monitor the progress bar as your vault is converted

4. **Use writing-assistant context insertion**
   - Open a story note in editor view
   - Optional: define story scopes in frontmatter (for example `lorebooks: [universe, universe/yggdrasil]`)
   - Place cursor where you want to continue
   - Run command "Continue Story with Context"
   - LoreVault queries token-budgeted context (`world_info` + `rag`) and inserts generated continuation text

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

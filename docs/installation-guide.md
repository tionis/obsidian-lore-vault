# Lorebook Converter Plugin Installation Guide

This guide will help you install the Lorebook Converter plugin for Obsidian.

## Prerequisites

- [Obsidian](https://obsidian.md/) (version 0.15.0 or higher)
- Desktop environment (plugin is desktop-only)
- A basic understanding of file management
- Comfort with accessing hidden folders (like `.obsidian`)

## Installation Steps

### Method 1: Manual Installation

1. **Download the plugin files**
   - Create a new folder named `lorebook-converter` in your Obsidian vault's plugins directory:
     - Path: `.obsidian/plugins/lorebook-converter/`
   - Place the following files in this folder:
     - `main.js` (compiled JavaScript file)
     - `manifest.json` (plugin metadata)
     - `styles.css` (styling for the plugin)

2. **Create the plugin directory structure**
   ```
   YourVault/
   ├── .obsidian/
   │   ├── plugins/
   │   │   ├── lorebook-converter/
   │   │   │   ├── main.js
   │   │   │   ├── manifest.json
   │   │   │   └── styles.css
   ```

3. **Enable the plugin**
   - Open Obsidian
   - Go to Settings (gear icon in the lower left)
   - Navigate to "Community plugins"
   - Disable "Safe mode" if it's enabled
   - Find "Lorebook Converter" in your list of installed plugins
   - Toggle the switch to enable it

4. **Verify installation**
   - You should now see a book icon in the left sidebar ribbon
   - The command palette (Ctrl+P or Cmd+P) should include "Convert Vault to Lorebook" and "Create Lorebook Entry Template"

### Method 2: Building from Source

If you prefer to build the plugin from source:

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/obsidian-lorebook-converter.git
   ```

2. **Install dependencies**
   ```bash
   cd obsidian-lorebook-converter
   npm install
   ```

3. **Build and validate**
   ```bash
   npm run build
   npm test
   ```

4. **Copy the built files to your Obsidian vault**
   - Copy the `main.js`, `manifest.json`, and `styles.css` files from the build directory to `.obsidian/plugins/lorebook-converter/` in your vault

5. **Enable the plugin in Obsidian** (same as in Method 1, Step 3)

## Post-Installation Configuration

1. **Configure plugin settings**
   - Go to Settings → Lorebook Converter
   - Set the output path for your Lorebook JSON file
   - Configure Source Selection Rules (folder/tag filters and lorebook flag requirement)
   - Adjust priority weights if needed

2. **Try creating a template**
   - Press Ctrl+P (or Cmd+P on Mac) to open the command palette
   - Type "Create Lorebook Entry Template" and select it
   - Fill in the form and create your first template

3. **Convert your vault**
   - Ensure your markdown files match one of the source-selection rules (see `docs/documentation.md`)
   - Click the book icon in the sidebar or use the command palette to start conversion
   - Monitor the progress bar as your vault is converted

## Troubleshooting

- **Plugin doesn't appear in settings**: Make sure all files are in the correct location and properly named
- **Command palette commands don't appear**: Try restarting Obsidian
- **Conversion fails**: Check the console (Ctrl+Shift+I) for error messages
- **Plugin doesn't recognize files**:
  - Ensure frontmatter enables lorebook usage (`lorebook: true`) when `requireLorebookFlag` is enabled
  - Verify folder/tag rules are not excluding your note
  - Check for explicit exclusion flags (`exclude: true`, `lorebook: false`)

## Updates

Since this is a manual installation, you'll need to manually update the plugin when new versions are released:

1. Download the latest version
2. Replace the files in your `.obsidian/plugins/lorebook-converter/` directory
3. Restart Obsidian

## Need Help?

If you encounter any issues with installation or usage, please:

1. Check the README and DOCUMENTATION files
2. Look for error messages in the developer console (Ctrl+Shift+I)
3. Reach out through the GitHub repository's issues section

---

Once installed, you're ready to start converting your Obsidian notes into Lorebook format!

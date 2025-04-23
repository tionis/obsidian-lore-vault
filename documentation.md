# Lorebook Converter Plugin Documentation

## Table of Contents
- [Introduction](#introduction)
- [Installation](#installation)
- [Setting Up Your Notes](#setting-up-your-notes)
- [Converting to Lorebook](#converting-to-lorebook)
- [Plugin Settings](#plugin-settings)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Introduction

The Lorebook Converter Plugin converts your Obsidian notes into a Lorebook JSON format that can be used with AI text generators. It preserves the relationships between your notes and calculates appropriate priorities to ensure the most relevant information is made available to the AI.

## Installation

### Manual Installation
1. Download the latest release from the GitHub repository
2. Extract the zip file into your vault's `.obsidian/plugins` folder
3. Enable the plugin in Obsidian's Community Plugins settings

### From Community Plugins (Coming Soon)
1. Open Obsidian Settings
2. Navigate to Community Plugins
3. Search for "Lorebook Converter"
4. Click Install and then Enable

## Setting Up Your Notes

For a note to be recognized as a Lorebook entry, it must follow this specific format:

```markdown
# Title: Your Entry Title
# Keywords: keyword1, keyword2, keyword3
# Overview: Brief description of what this entry covers

# Trigger Method: selective
# Probability: 75
# Depth: 4

# Content:
The main content of your entry goes here...

## Additional Information
- Add more details
- Include relevant context
- Link to related entries using [[Wiki Links]]
```

### Creating Entry Templates

1. Use the Command Palette (`Ctrl+P` or `Cmd+P`) to run "Create Lorebook Entry Template"
2. Fill in the details in the popup form
3. Click "Generate Template"

This will either create a new file or replace the content of your active note with the template.

### Required Fields

- **Title**: The name of your entry
- **Keywords**: Comma-separated terms that will trigger this entry
- **Content**: The main information to be included

### Optional Fields

- **Overview**: Brief description of the entry
- **Trigger Method**: How the entry is triggered (options: selective, constant, vectorized)
- **Probability**: Chance of the entry being included (0-100)
- **Depth**: Scanning depth for this entry (1-10)

## Converting to Lorebook

There are two ways to convert your vault to a Lorebook:

1. Click the book icon in the left sidebar ribbon
2. Use the Command Palette to run "Convert Vault to Lorebook"

The conversion process:
1. Scans your vault for properly formatted notes
2. Builds a relationship graph based on wiki links
3. Calculates priorities using graph metrics
4. Exports everything to a JSON file

Progress is shown in a notification with a progress bar.

## Plugin Settings

Settings can be accessed from Obsidian's Settings panel under "Lorebook Converter".

### Output Path
Set where the Lorebook JSON file will be saved. By default, it's saved in your vault root with the name of your vault (e.g., `MyVault.json`).

### Priority Weights
Adjust how different factors affect entry priority in the Lorebook:

- **Hierarchy**: Distance from root document
- **In-Degree**: Number of incoming links to a document
- **PageRank**: Overall importance in the network
- **Betweenness**: Importance as a connector node
- **File Depth**: Position in the folder hierarchy
- **Out-Degree**: Number of outgoing links
- **Total Degree**: Total number of links (in + out)

Higher weights give that factor more influence on the final order.

## How It Works

### Root Document
The plugin looks for a root document (Root.md, root.md, index.md, World.md, or world.md) as the starting point for hierarchy calculations. If none is found, it determines the root based on other graph metrics.

### Graph Analysis
The plugin builds a directed graph where:
- Each node is a document
- Each edge represents a wiki link from one document to another

It then performs various graph analysis operations:
1. **Hierarchy**: BFS traversal from the root
2. **In-Degree**: Count of incoming links
3. **PageRank**: Google's algorithm for page importance
4. **Betweenness Centrality**: Frequency of appearing on shortest paths
5. **File Structure**: Depth in folder hierarchy

### Priority Calculation
Entry priority is calculated as a weighted sum of normalized metrics. Lower order numbers (higher priority) appear earlier in the Lorebook.

## Troubleshooting

### Notes Not Converting
- Check if your notes follow the required format with `# Title:`, `# Keywords:`, and `# Content:` sections
- Ensure your markdown is properly formatted with no syntax errors

### Missing Relationships
- Make sure you're using wiki links `[[Like This]]` to connect notes
- Check that linked notes also follow the Lorebook entry format

### Export Errors
- Check if the output path is valid and accessible
- Ensure you have write permissions to the destination folder

## Development

This plugin is written in TypeScript and uses:
- Obsidian API
- Graphology for graph operations
- The Electron framework (via Obsidian)

To build from source:
1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` for development (watches for changes)
4. Run `npm run build` for production build

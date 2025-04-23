# Lorebook Converter

An Obsidian plugin that converts your vault's markdown files into a Lorebook JSON format.

## What is a Lorebook?

A Lorebook is a collection of entries that provide context for AI text generation. Each entry contains keywords that trigger the inclusion of relevant information in the AI's context window. This plugin automatically converts your Obsidian notes into this format, preserving relationships between notes and calculating appropriate priority scores.

## Features

- Converts markdown files with specific formatting into Lorebook entries
- Builds a relationship graph based on wikilinks between notes
- Calculates entry priorities using graph theory metrics:
  - Hierarchy (distance from root document)
  - In-degree (how many documents link to a note)
  - PageRank (overall importance in the network)
  - Betweenness (importance as a connector node)
  - File depth in folder structure
- Customizable weights for different metrics
- Preserves note metadata like keywords, probability, and depth settings

## Installation

1. Download the latest release from the GitHub repository
2. Extract the zip file into your Obsidian vault's `.obsidian/plugins` folder
3. Enable the plugin in Obsidian's Community Plugins settings

## Usage

### 1. Format Your Notes

Each note should follow this structure to be properly converted:

```markdown
# Title: Note Title
# Keywords: keyword1, keyword2, keyword3
# Overview: Brief description of the note

# Trigger Method: selective
# Probability: 75
# Depth: 4

# Content:
The actual content of your note goes here...
```

See the template file for a complete example.

### 2. Convert to Lorebook

1. Open your Obsidian vault
2. Click the book icon in the left sidebar, or use the command "Convert Vault to Lorebook" from the command palette
3. The plugin will process your notes and create a Lorebook JSON file

### 3. Settings

You can customize the plugin behavior in the settings:

- **Output Path**: Where to save the Lorebook JSON file
- **Priority Weights**: Adjust how different factors affect entry priority
  - Higher weights for Hierarchy prioritize notes closer to your root document
  - Higher weights for In-Degree prioritize frequently referenced notes
  - Experiment with different weight combinations for optimal results

## How Priority Works

The plugin calculates entry priorities using a weighted combination of metrics:

1. **Hierarchy**: Distance from root document (typically index.md, Root.md, or World.md)
2. **In-Degree**: Number of incoming links to a document
3. **PageRank**: Google's algorithm for determining page importance
4. **Betweenness**: How often a node appears on shortest paths between other nodes
5. **File Depth**: Position in the folder hierarchy
6. **Out-Degree**: Number of outgoing links
7. **Total Degree**: Total number of links (in + out)

Higher priority entries (lower order numbers) appear earlier in the AI's context window, making them more foundational to generation.

## Development

If you want to contribute to the plugin:

1. Clone the repository
2. Install dependencies with `npm install`
3. Make your changes
4. Build with `npm run build`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

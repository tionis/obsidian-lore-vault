### What is this?
This is a simple plugin for Obsidian that I use for exporting [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) or [Lorebooks](https://docs.chub.ai/docs/advanced-setups/lorebooks) for use with AI roleplaying and chatbot systems like SillyTavern.

### But why?
I built this tool mostly because I was disappointed with what the current offers were for visualizing the information kept within World Info / Lorebooks, with many of the current tools using simple nested lists. This means that it can be difficult to visualize how interconnected the various entries of the Lorebook are, and the potential consequences to context-size utilization that can arise due to recursive Lorebook calls. Additionally, I wanted to use this as a chance to stress-test using LLMs to generate and debug code with minimal operator intervention, with my main "role" in this instance being feeding the LLM with organizational notes in order to make it easier to debug any problems that did arise.

### What does it do?
The system is pretty simple at it's core. It takes .md files that follow some formatting rules, and converts them into a .json that can be used as World Info for SillyTavern. 

However, in addition to the .md to .json conversion, the system is capable of calculating the Priority or Order of a particular entry based on a variety of metrics that users can tweak the weighting of based on there preferences. This system creates a graph from the given .md files using embedded wikilinks within to determine the edges of the graph. From there, we can calculate a wide variety of metrics. Currently, there are 7 different metrics you can adjust the weighting for, they are as follows:
- Hierarchy: How close a file is to a designated "root" document, with closer documents scoring higher.
- In Degree: How many links point towards a document, so documents that are frequently referenced are scored higher.
- Page Rank: A measurement of the overall importance of a file based on it's graph centrality, with the documents score increasing based on it's importance.
- Betweenness: How important this document is as a connector or bridge between different parts of the graph.
- Out Degree: How many outgoing links a document has. So, documents that reference a bunch of other documents have higher importance.
- Total Degree: The total number of incoming and outgoing links a document has.
- File Depth: How deep within the file or folder hierarchy a document is, with deeper files scoring higher values. Meant to increase the score of more specific documents

### TODO:
- [ ] .json importing: Enable users to import World Info.
- [ ] tune default weightings: The current default weightings aren't ideal, and I need to tune them some. However, users can already modify weighting on their own, so it's not a priority.
- [ ] fix template exporter: The user should be able to generate a template file that they can use as a base for any World Info entries they want to make.

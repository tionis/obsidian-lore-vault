# LoreVault Approach Summary

This document summarizes the current product and architecture direction.

## Product Focus

LoreVault is a writing-assistant context engine for Obsidian.

Primary goals:

- deterministic context assembly
- inspectable retrieval decisions
- high-quality story coherence during generation/chat

Non-goals for core plugin:

- human publishing outputs (EPUB/PDF/print-style books)
- full publishing/asset bundling workflows

If needed, publishing should be a separate companion plugin that consumes LoreVault exports and selectors.

## Core Model

A lorebook scope is defined by hierarchical tags (`#lorebook/...`).

Per scope, LoreVault compiles:

- `world_info` style entries (compact, triggerable lore facts)
- optional retrieval artifacts and downstream exports

Canonical export remains SQLite per scope, with deterministic naming and ordering.

## Retrieval Direction

Primary retrieval strategy is graph-first over `world_info`:

1. detect seed entities from current text (`keywords`, aliases, title matches)
2. score direct matches
3. expand 1-2 hops through graph relations/wikilinks
4. apply deterministic decay/tie-breaks
5. assemble context under token budget using summary tiers

Embedding retrieval is kept as optional fallback when seed confidence is low.

## Writing UX Direction

LoreVault will provide a persistent Story Chat panel where users can:

- select active lorebook scopes per chat
- run manual-context-only sessions
- stream model output
- inspect context provenance for each turn

Context inspector requirements:

- what was included
- why it was included
- which layer contributed it
- what was excluded due to budget

## Long-Form Story Strategy

Long-form support is explicit and frontmatter-first.

Recommended metadata:

- `storyId`
- `chapter`
- optional `chapterTitle`
- optional `arc`
- optional `previousChapter` / `nextChapter`
- lorebook scope selectors

Conventions:

- folders are optional convenience
- frontmatter + links are source of truth

Context layering for long-form generation/chat:

1. local writing window (current scene/chapter)
2. rolling chapter memory summaries
3. graph-expanded lore memory
4. optional fallback retrieval

This balances short-term continuity and long-term consistency.

## Engineering Invariants

- same vault + same settings => same output/context decisions
- stable traversal, scoring, and serialization order
- clear debug traces for inclusion/exclusion and ranking
- fixture-backed tests for behavior contracts

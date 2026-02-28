# LoreVault SQLite Pack Schema

This document defines the canonical LoreVault scope-pack format (`.db`).

Status:

- Canonical export format
- Deterministic contract for downstream tools
- Designed to be usable without direct vault access

## Versioning

- `meta.schema_version` is the database schema version.
- Current version: `2`.
- Consumers should read `meta.schema_version` first and branch behavior if needed.

## Design Goals

- Self-contained lorebook package per scope
- Deterministic ordering and serialization
- Provenance metadata for source notes
- Embeddings included to reduce redundant recomputation

## Deterministic Ordering Contract

- `world_info_entries`: `ORDER BY order_value DESC, uid ASC`
- `rag_documents`: `ORDER BY path ASC, title ASC, uid ASC`
- `rag_chunks`: `ORDER BY path ASC, chunk_index ASC`
- `rag_chunk_embeddings`: `ORDER BY chunk_id ASC, provider ASC, model ASC`
- `source_notes`: `ORDER BY uid ASC`
- `note_embeddings`: `ORDER BY uid ASC, provider ASC, model ASC`

## Table Overview

- `meta`: key/value build and schema metadata
- `world_info_entries`: canonical world-info entries
- `rag_documents`: note-level fallback documents
- `rag_chunks`: deterministic chunk projection of `rag_documents`
- `rag_chunk_embeddings`: chunk embedding vectors
- `source_notes`: source-note provenance + full note body/summary metadata
- `note_embeddings`: note-level embedding centroids derived from chunk embeddings

## `meta` Table

Schema:

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Core keys:

- `format` = `lorevault.scope-pack`
- `schema_version`
- `scope`
- `generated_at`
- `plugin_id`
- `plugin_version`
- `build_mode` (`single_scope` | `multi_scope`)
- `source_file_count`
- `source_note_count`
- `explicit_root_uid` (empty string when absent)
- `settings_signature`
- `content_signature`

Count keys:

- `world_info_entries_count`
- `rag_documents_count`
- `rag_chunks_count`
- `rag_chunk_embeddings_count`
- `source_notes_count`
- `note_embeddings_count`

Settings snapshot keys (JSON):

- `settings_snapshot_json`
- `settings_tag_scoping_json`
- `settings_retrieval_json`
- `settings_embeddings_json`
- `settings_summaries_json`
- `settings_weights_json`
- `settings_default_entry_json`

Embedding profile key:

- `embedding_profiles_json` (`["provider::model::dimensions", ...]`)

## `world_info_entries`

```sql
CREATE TABLE world_info_entries (
  uid INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  order_value INTEGER NOT NULL,
  comment TEXT NOT NULL,
  content TEXT NOT NULL,
  key_json TEXT NOT NULL,
  keysecondary_json TEXT NOT NULL,
  entry_json TEXT NOT NULL
);
```

Notes:

- `entry_json` stores full canonical entry object for downstream compatibility.
- `key_json`/`keysecondary_json` are redundant convenience projections.

## `rag_documents`

```sql
CREATE TABLE rag_documents (
  uid INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL
);
```

Notes:

- `uid` aligns with `world_info_entries.uid` / `source_notes.uid` when applicable.

## `rag_chunks`

```sql
CREATE TABLE rag_chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_uid INTEGER NOT NULL,
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);
```

## `rag_chunk_embeddings`

```sql
CREATE TABLE rag_chunk_embeddings (
  chunk_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  cache_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  PRIMARY KEY (chunk_id, provider, model)
);
```

Notes:

- `vector_json` is a JSON array of float values.
- A chunk can have multiple embeddings (different provider/model combinations).

## `source_notes`

```sql
CREATE TABLE source_notes (
  uid INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  basename TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  lorebook_scopes_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  keysecondary_json TEXT NOT NULL,
  retrieval_mode TEXT NOT NULL,
  include_world_info INTEGER NOT NULL,
  include_rag INTEGER NOT NULL,
  summary_source TEXT NOT NULL,
  summary TEXT NOT NULL,
  summary_hash TEXT NOT NULL,
  note_body TEXT NOT NULL,
  note_body_hash TEXT NOT NULL,
  wikilinks_json TEXT NOT NULL,
  modified_time INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL
);
```

Notes:

- This table makes packs usable without vault files.
- `summary_source`: `section` | `frontmatter` | `body`.
- `include_world_info` / `include_rag`: `0` or `1`.
- `*_json` columns are deterministic JSON arrays.

## `note_embeddings`

```sql
CREATE TABLE note_embeddings (
  uid INTEGER NOT NULL,
  scope TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  aggregation TEXT NOT NULL,
  source_chunk_count INTEGER NOT NULL,
  cache_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  PRIMARY KEY (uid, provider, model)
);
```

Notes:

- `aggregation` currently: `mean_normalized`.
- These are note-level centroids derived from chunk embeddings.
- Downstream tools can use note-level vectors first, then drill into chunk vectors.

## JSON Column Contracts

`entry_json`:

- Full `LoreBookEntry` object as exported by LoreVault.

`settings_snapshot_json`:

- Snapshot of the settings that influence pack content:
  - tag scoping
  - ranking weights
  - default entry options
  - retrieval settings
  - summary settings
  - non-secret embeddings settings

## Migration Notes

### `v1` -> `v2`

Added:

- `source_notes` table
- `note_embeddings` table
- richer `meta` keys for build/settings/content signatures

Existing v1 tables remain available.

## Consumer Guidance

- Prefer SQLite pack data over re-reading vault markdown.
- Validate `schema_version` and `format` before processing.
- Use `meta.content_signature` for cache invalidation.
- Use `note_embeddings` and `rag_chunk_embeddings` to avoid re-embedding unchanged content.

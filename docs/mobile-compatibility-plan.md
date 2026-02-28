# LoreVault Mobile Compatibility Plan

## Goal

Enable LoreVault to run on Obsidian Mobile while preserving deterministic behavior and keeping desktop workflows intact.

Current state:

- `manifest.json` sets `isDesktopOnly: false`.
- Runtime export/cache paths are adapter-based and vault-relative.

## Scope

In scope:

- Run core LoreVault features on mobile:
  - scope discovery
  - context assembly
  - story continuation/chat
  - import/extraction/update panels
  - in-vault exports
- Keep deterministic output parity across desktop/mobile.

Out of scope (initial mobile delivery):

- Desktop-specific optimizations that depend on Node APIs.

## Technical Constraints

Mobile-safe assumptions:

- Use Obsidian `vault.adapter` APIs for file IO.
- Use vault-relative paths only.
- Use POSIX-style path normalization (`/`) instead of Node `path`.

Avoid on mobile:

- `fs.*` direct calls
- Node `path.*` for path resolution semantics
- `adapter.getBasePath()` reliance

## Feature Compatibility Matrix

`Build/Export`:

- Keep `.db` + downstream outputs in vault-relative output directories.
- Reject absolute filesystem output paths with clear validation errors.

Embedding cache:

- Keep one-file-per-hash strategy.
- Store under vault-relative cache directory only.

SQLite pack read/write:

- Replace Node file access with adapter binary read/write.

Story/chat/completion:

- No fundamental blocker; depends on provider endpoint/network only.

## Workstreams

### 1) IO Abstraction Layer

Create a single storage layer used by exporters/readers/caches:

- `exists(path)`
- `mkdirp(path)`
- `readText(path)` / `writeText(path, data)`
- `readBinary(path)` / `writeBinary(path, data)`
- vault-relative path normalization helpers

Deliverable:

- No direct `fs` calls in runtime code paths used by normal plugin operations.

### 2) Exporter Migration

Migrate these modules to adapter-backed IO:

- `src/lorebook-exporter.ts`
- `src/rag-exporter.ts`
- `src/sqlite-pack-exporter.ts`
- `src/sqlite-pack-reader.ts`
- `src/embedding-cache.ts`
- `src/sqlite-cli.ts` (or replace with mobile-safe utility)

Deliverable:

- All export/cache paths function with vault-relative paths on mobile.
- Status: complete.

### 3) Path Handling Cleanup

- Remove dependence on Node `path` where not required.
- Centralize path normalization in vault-path utilities.
- Keep deterministic path generation identical between platforms.

Deliverable:

- Same scope -> same relative output paths on desktop and mobile.
- Status: complete for mobile-executed runtime paths.

### 4) UX/Settings Gating

- Add capability checks (`mobile`/`desktop`) in settings/UI.
- Clarify vault-relative path requirements in settings/help.
- Add explicit notes in settings/help for mobile limitations.

Deliverable:

- No silent failures from unsupported settings on mobile.

### 5) Manifest Flip and Rollout

- `isDesktopOnly` set to `false`.
- Mobile support rollout enabled.

Deliverable:

- Plugin loads and runs on mobile with core workflows.
- Status: manifest flipped.

## QA and Acceptance Criteria

Unit/integration:

- Add tests for mobile-safe path resolution and adapter IO usage.
- Add regression tests for deterministic export naming across platforms.

Manual QA (mobile + desktop):

- Build scope export writes `.db`, `.json`, `.rag.md` in vault.
- Story extraction preview/apply works.
- Story delta preview/apply works.
- Story continuation and chat generation work.
- Embedding cache read/write works (when enabled).

Release criteria:

- No Node-only runtime API usage in mobile-executed paths.
- No desktop regressions in export/read/write behavior.
- Docs/help updated for compatibility and limitations.

## Risks

- SQLite binary IO edge cases across adapters.
- Large export memory footprint on mobile devices.
- Path normalization regressions when removing Node `path`.

Mitigations:

- Keep fixture-backed determinism tests.
- Add targeted stress tests for large scope exports.
- Roll out in phases with explicit fallback notices.

## Proposed Implementation Order

1. IO abstraction + adapter-backed binary/text helpers. (done)
2. Migrate SQLite exporter/reader. (done)
3. Migrate embedding cache and remaining exporters. (done)
4. Settings/UI capability gating. (done)
5. QA matrix completion. (ongoing hardening)
6. Flip `isDesktopOnly` to `false`. (done)

## Completion Notes

- Runtime export/cache IO no longer depends on Node `fs` or `adapter.getBasePath()`.
- Runtime path handling for mobile-executed code paths no longer depends on Node `path`.
- Export/cache configuration is validated as vault-relative for deterministic cross-platform behavior.
- Remaining work is QA hardening and performance tuning on large mobile vaults.

# AOS Wiki — Writes, Change Events, Namespaces, and App Seeding

**Status:** draft
**Date:** 2026-04-12
**Layer:** AOS (platform)
**Depends on:** existing wiki module (`src/commands/wiki*.swift`), existing pub/sub channel machinery

## Purpose

The AOS wiki today is effectively read-only at the platform boundary: files live on disk, an indexer populates `wiki.db`, and the content server serves pages. There is no write API, no change broadcast, and no convention for how multiple applications share the wiki namespace without colliding.

This spec adds the platform primitives that let applications — starting with Sigil — treat the wiki as a live, multi-tenant knowledge store. It does not define any application-specific page types; those are the application's concern.

## Non-goals

- No application-specific schemas (agent, character, appearance, etc.). Applications define their own conventions.
- No access-control enforcement. Namespaces are convention, not permission.
- No cross-wiki federation. There is one wiki per AOS mode; namespaces divide it internally.
- No wiki migration tooling beyond a one-time relocation of existing pages into `platform/`.

## Model

One wiki per AOS runtime mode (`~/.config/aos/{mode}/wiki/`), as today. Internally, the top-level directories are **namespaces** owned by either the platform or a named application.

```
~/.config/aos/{mode}/wiki/
  platform/        # AOS platform knowledge (formerly entities/, concepts/, plugins/)
    entities/
    concepts/
    plugins/
  sigil/           # Owned by Sigil application
    ...
  <app>/           # Owned by <app>
    ...
```

Users may read or edit any namespace freely. The boundary is convention and is expected to be respected by applications.

## Platform changes

### 1. Namespace relocation (one-time migration)

Existing `entities/`, `concepts/`, `plugins/` directories move to `platform/entities/`, `platform/concepts/`, `platform/plugins/`. The indexer's path resolution updates accordingly. Content server and existing read paths are unaffected if they address by full relative path.

A small migration routine runs at daemon startup: if the legacy flat directories exist and `platform/` does not, move them. Idempotent.

### 2. Write API

Add a wiki write endpoint to the daemon's existing HTTP content server surface. Applications write markdown pages by full path (including namespace prefix).

- `PUT /wiki/<path>` with markdown body. Creates or overwrites.
- `DELETE /wiki/<path>`. Removes file and index entry.
- Frontmatter parsing happens on the server side so `pages.type`, `name`, `tags` stay consistent.
- Writes trigger re-index of the affected path and broadcast a change event (see §3).

Authentication is not in scope for this spec. The content server is already localhost-only; applications authenticate implicitly by being on-box.

### 3. Change event channel

A new pub/sub channel `wiki_page_changed` on the daemon. Payload:

```json
{
  "path": "sigil/agents/default.md",
  "type": "agent",
  "op": "updated"
}
```

`op` is one of `created`, `updated`, `deleted`. Fires on:

- Writes via the new write API.
- Direct filesystem edits detected by an FSEvents watcher on the wiki directory. Debounced by a short quiet window (50-100ms) to coalesce rapid successive writes.

Subscribers filter by path prefix themselves — the channel is un-filtered at the platform level.

### 4. First-boot seed helper

A small helper callable from any application's startup path:

```swift
// Pseudo-signature; exact Swift API decided during implementation.
AOSWiki.seedIfAbsent(namespace: "sigil", files: [
  ("agents/default.md", bundledContent)
])
```

Semantics:
- For each `(relativePath, content)`, if `~/.config/aos/{mode}/wiki/<namespace>/<relativePath>` does not exist, write it. If it does exist, leave it alone.
- Never overwrites. Users' edits are never clobbered.
- Works before or after the daemon is running; uses direct filesystem writes, not the write API.

Applications ship their starter files as bundled resources and call this helper during their own initialization.

## Acceptance criteria

1. **Namespace migration.** Fresh daemon startup on an existing install relocates `entities/`, `concepts/`, `plugins/` to under `platform/`. Indexer reindexes. `aos://wiki/platform/entities/sigil.md` serves correctly; the old path returns 404.
2. **Write API.** `PUT /wiki/test/hello.md` with markdown body creates the file, indexes it, and is readable via the content server immediately.
3. **Change event fires on API write.** Subscriber to `wiki_page_changed` receives a payload with `path="test/hello.md"`, `op="created"` after the write in (2).
4. **Change event fires on direct filesystem write.** Editing `~/.config/aos/{mode}/wiki/test/hello.md` in a text editor broadcasts `wiki_page_changed` with `op="updated"`. Debounce coalesces a save-on-every-keystroke editor into a single event.
5. **Seed helper idempotent.** Calling `seedIfAbsent` with a file that already exists is a no-op (no overwrite, no change event). Calling it with a missing file writes it once and emits a `created` event.
6. **Delete.** `DELETE /wiki/test/hello.md` removes the file, removes the index row, fires `op="deleted"`.

## Failure modes

- **FSEvents latency.** macOS coalesces FSEvents; the broadcast may lag a rapid write by up to ~100ms. Acceptable — no subscriber currently needs sub-frame wiki update latency.
- **Disk full / permission denied on write.** Write API returns 500 with a structured error payload. Daemon logs. No change event fires.
- **Malformed frontmatter.** Indexer logs, stores the page with `type=null`. Page is still readable; search by type excludes it.
- **Race between API write and direct filesystem edit of the same file.** Last writer wins; two change events fire. Subscribers must be idempotent in their re-apply logic. This is acceptable — the alternative (locking) is disproportionate.

## Testing

- Unit: frontmatter parser roundtrips known fixtures; write API validates path (no `..`, no absolute).
- Integration: boot daemon, subscribe to channel, exercise each acceptance criterion scenario end-to-end.
- Migration test: prepare a fixture wiki with flat layout, boot daemon, assert relocation and reindex.

## Open questions

- Should the write API support partial updates (PATCH), or is PUT-overwrite sufficient? **Recommendation:** PUT-only for v1. Applications read, modify, write. Keeps semantics simple.
- Should deletes be soft (trash directory) or hard? **Recommendation:** hard. Users have the file system and git if they want history.

## Follow-on work (out of scope)

- Access control / per-namespace write permissions.
- Cross-machine sync.
- Wiki versioning or history beyond the user's own git habits.

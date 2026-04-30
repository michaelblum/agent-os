# Recipe: Content Root Hygiene

Use this recipe when AOS canvases load local web surfaces through `aos://...`,
especially from temporary branches or worktrees.

## Rule

Repo-mode canonical roots belong to the active repo:

- `toolkit` -> `packages/toolkit`
- `sigil` -> `apps/sigil`

Temporary worktrees should not leave these names pointed at disposable paths.
If a temporary harness needs its own content, prefer an explicit non-canonical
root name or restore the canonical root before cleanup.

## Checks

Before diagnosing a canvas as a rendering bug, verify the content boundary:

```sh
./aos content status --json
./aos content wait --root toolkit --auto-start
```

`content wait` validates that required roots exist on disk and, in repo mode,
that canonical roots point at the current checkout unless
`AOS_ALLOW_EXTERNAL_CANONICAL_CONTENT_ROOTS=1` is set for an explicit override.
Status-item toolkit utilities use the same fast root validation before making a
utility visible; on failure they show an inline AOS diagnostic instead of
loading the stale `aos://` URL into a WebView.

When `content.roots.*` changes, restart the repo daemon before expecting the
live content server to use the new map:

```sh
./aos set content.roots.toolkit packages/toolkit
./aos service restart --mode repo
./aos ready
```

## Failure Shape

If a canvas shows a raw HTTP error such as
`Not Found: /toolkit/components/canvas-inspector/index.html`, treat it as a
content-root or daemon-lifecycle problem until proven otherwise. The common
causes are:

- the root path no longer exists
- the root points to a different worktree than the active repo
- config was updated but the daemon has not restarted, so the live server still
  has the old map

The correct repair is to reset the root to the current repo, restart the daemon,
and relaunch or refresh the canvas.

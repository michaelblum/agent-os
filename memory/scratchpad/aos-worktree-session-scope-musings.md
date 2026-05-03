---
name: aos-worktree-session-scope-musings
status: raw-musings
updated: 2026-05-02
connects_to: ./aos CLI, AOS daemon, content roots, visual harnesses, Sigil
---

# AOS Worktree and Session Scope Musings

## Context

During Sigil Session Vitality Lab work, the active AOS daemon was serving content
from the dirty root checkout while implementation and tests were running from a
clean worktree. Config readback could say `content.roots.sigil` pointed at a new
path, but the running content server could still behave like it had stale roots.
That made a valid unmerged lab page appear broken until it was loaded through a
temporary HTTP server pinned to the clean worktree.

There was also a human/perception mismatch: AOS listed multiple avatar canvases,
but Michael only saw one avatar. That means "canvas exists" is not enough
diagnostic evidence for "human-visible object is present." Canvases can be
transparent, overlapped, same-looking, offscreen, on another display, suspended,
or visually hidden under another surface.

## Plausible Future Model

AOS probably wants one singleton daemon per macOS user session because display
capture, input taps, permissions, status item behavior, and window levels are
global OS resources. Multiple daemons would likely fight over those resources.

The daemon may still need a lighter "session scope" concept underneath it. A
scope could own canvases, content roots, logs, temporary worktree serving, and
cleanup rules for one agent/dev run. This would let two worktrees be active
without pretending each one owns the whole display daemon.

Snapshots are plausible only as declarative workspace snapshots, not Docker-like
process snapshots. A realistic snapshot could record canvases, URLs, content
roots, channels, terminal/tmux handles, and app restore hints. It should not
claim to freeze WKWebView heaps, the cursor, Accessibility trust, or the macOS
window server.

## Conservative Next Slice

Do not start with full session architecture.

The useful non-disruptive fix is smaller:

- Detect and report stale content roots when config and active content serving
  disagree.
- Give visual harnesses a first-class "serve this worktree" path instead of
  hand-rolling temporary HTTP servers during unmerged UI verification.
- Add ownership/source metadata to canvases so diagnostics can say which
  worktree/session created a surface.
- Improve visible-state diagnostics: distinguish registered canvas, loaded page,
  pixel-bearing canvas, suspended canvas, offscreen canvas, and obscured/covered
  canvas where possible.
- Fix or file the `show to-front` help/implementation mismatch separately.

## Why This Scope

This addresses the concrete failure without freelancing into a broad control
plane rewrite. It also keeps the current repo model intact: global daemon and
global content roots can remain the default, while harnesses get a safer override
for worktree-local verification.

Revisit broader session scopes only after the same class of collision happens
again, or after visual harness worktree binding exposes a clear need for
namespaced ownership and cleanup.
what 
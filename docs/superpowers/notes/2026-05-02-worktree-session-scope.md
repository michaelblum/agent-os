# Worktree Session Scope Idea Capture

**Date:** 2026-05-02
**Status:** Idea capture and diagnostic guidance. This is not an implementation
plan and should not add command surface by itself.

## Prompt

During Sigil Session Vitality Lab work, AOS exposed a practical weakness around
dirty root checkouts, clean worktrees, and daemon-owned display state. The active
daemon could keep serving content from one checkout while implementation and
tests were running from another. Config readback could look correct, but the
running content server could still behave as if it had stale roots.

That made a valid unmerged lab page look broken until it was loaded through a
temporary HTTP server pinned to the clean worktree.

There was also a human/perception mismatch: AOS listed multiple avatar canvases,
but the human-visible desktop appeared to show only one. That means "canvas is
registered" is not enough evidence for "the human can see a distinct object."
Canvases can be transparent, overlapped, visually identical, offscreen, on
another display, suspended, or hidden below another surface.

## Working Conclusion

AOS probably wants one singleton daemon per macOS user session. Display capture,
input taps, Accessibility permissions, status item behavior, window levels, and
content serving are global OS-facing resources. Running multiple independent
daemons would make ownership and recovery harder, not easier.

That does not mean every agent run or worktree should share one undifferentiated
bucket of state. The daemon likely needs a lighter session or owner scope
underneath it. A scope could own canvases, content roots, logs, temporary
worktree serving, and cleanup rules for one agent or developer run while still
using the singleton daemon as the OS resource owner.

## Snapshot Boundary

Snapshots are plausible only as declarative workspace snapshots, not
Docker-style process snapshots. A realistic AOS snapshot could record canvases,
URLs, content roots, channel subscriptions, terminal or tmux handles, session
identifiers, and app restore hints.

It should not claim to freeze WKWebView heaps, cursor state, Accessibility
trust, Input Monitoring trust, or the macOS window server.

## Conservative Next Slice

Do not start with a broad session control plane.

The useful non-disruptive work is smaller:

- Detect and report stale content roots when config and active content serving
  disagree.
- Give visual harnesses a first-class "serve this worktree" path instead of
  hand-rolling temporary HTTP servers during unmerged UI verification.
- Attach ownership/source metadata to canvases so diagnostics can say which
  worktree, process, harness, or session created a surface.
- Improve visible-state diagnostics by distinguishing registered canvas, loaded
  page, pixel-bearing canvas, suspended canvas, offscreen canvas, and
  obscured/covered canvas where possible.
- Treat `show to-front` help/implementation mismatch as a separate small fix if
  it still exists.

## Relationship To Current Work

PR #195 added optional canvas owner metadata: `consumer_id`, `harness`, `pid`,
`cwd`, `worktree_root`, and `runtime_mode`. That is a good first primitive for
this problem because it lets diagnostics explain who created a surface without
requiring a new daemon architecture.

The provider session catalog and telemetry work gives AOS a provider-neutral way
to describe agent sessions. Future session scope should build on those contracts
instead of introducing a parallel identity model.

## Design Pressure

The model should stay agent-first. Humans should not have to manually pass a
lease or scope identifier on every command. AOS can infer useful identity from
process metadata, cwd, worktree root, explicit canvas owner fields, environment
variables set by harnesses, and TTL-backed registration records.

Explicit tokens may still be useful for trusted long-running clients, but they
should be a protocol detail or harness concern, not a repetitive human CLI tax.

## Exit Criteria For Revisiting

Revisit broader session scopes only when at least one of these is true:

- stale root or worktree collisions recur after first-class harness serving
  exists;
- multiple active worktrees need simultaneous display state and cleanup;
- session catalog or telemetry consumers need ownership information that canvas
  owner metadata cannot express;
- remote or secondary clients need to resume, pause, or inspect an existing AOS
  session through the daemon.

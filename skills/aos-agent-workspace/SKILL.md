---
name: aos-agent-workspace
description: Retired broad saved-workspace skill. Use aos-desktop, aos-saved-workspace, aos-canvas-vision, aos-focus-sessions, and aos-verification for installable AOS desktop guidance.
retired: true
---

# AOS Agent Workspace

This broad skill is retired as installable guidance. It mixed desktop,
saved-ref, canvas, browser, native AX, and verification details in one large
surface, which now competes with the direct desktop CLI model.

Use the narrower current skills instead:

- `skills/aos-desktop/SKILL.md` for desktop/app/window/native AX workflows.
- `skills/aos-saved-workspace/SKILL.md` for saved snapshots and refs.
- `skills/aos-canvas-vision/SKILL.md` for regions, xray, labels, canvas refs,
  and coordinate fallback.
- `skills/aos-focus-sessions/SKILL.md` for focus channels and session
  lifecycle.
- `skills/aos-verification/SKILL.md` for recapture, refs diff/expect, gates,
  and Work Records.

Durable contracts remain in `docs/api/aos.md`,
`docs/api/aos-capabilities.md`, and
`shared/schemas/aos-agent-workspace-v0.md`. Saved-ref proof remains covered by
`tests/agent-workspace-saved-ref.sh`.

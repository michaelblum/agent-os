# AOS Desktop Command Vocabulary Decision

Date: 2026-07-07

This is the M4 vocabulary decision for issue #587.

## Decision

Do not add a new `aos desktop` command noun or `desktop:<target>` target
namespace in this slice.

Keep the stable primitive model:

- `aos see` for perception and saved captures;
- `aos do` for actions;
- `aos focus` for session/channel lifecycle;
- `aos show` for overlay/display surfaces.

Use `docs/api/aos-capabilities.md` and installable AOS desktop skills to teach
the desktop Playwright model. If new desktop ergonomics are needed, prefer
source-manifest-backed semantic verbs under `aos do` after each verb has a
fail-closed design.

## Rationale

- AOS already has desktop control primitives; the current problem is
  discoverability and missing semantic verbs, not a missing top-level noun.
- A new `aos desktop` alias would duplicate existing command families and make
  help/manifests/tests harder to keep synchronized.
- A `desktop:<target>` namespace would introduce a competing target grammar
  before app/window/Space identity is stable enough to defend.
- Missing verbs such as close/minimize/activate/quit need TCC, focus, minimized
  window, and Space behavior designed first.

## Follow-Up Criteria

Add a semantic desktop verb only when all of these are true:

- source manifest, help, parser, dispatch, docs, and tests can stay
  synchronized;
- dry-run or preflight can identify the target and blockers before mutation;
- TCC, focus, minimized window, and Space constraints fail closed;
- the command returns structured errors for unsupported or ambiguous state;
- live native proof is approval-gated when real input or desktop state is
  required.

Candidate future verbs remain:

- `aos do activate-app`;
- `aos do quit-app`;
- `aos do hide-app` and `aos do unhide-app`;
- `aos do close-window`;
- `aos do minimize-window`;
- `aos do maximize-window` and `aos do restore-window`;
- `aos do fullscreen-window`;
- `aos do menu`;
- a read-only Space state command before any Space-switching command.

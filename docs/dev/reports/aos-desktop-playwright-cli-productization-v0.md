# AOS Desktop Playwright CLI Productization Report

Date: 2026-07-07

## Scope

Issue: https://github.com/michaelblum/agent-os/issues/587
Status at closeout readback: open, updated `2026-07-07T02:28:31Z`.

Objective: make the current AOS docs, installable skills, capability map, and
proof fixture teach "Playwright CLI, but for the desktop" without adding a new
command noun or vendoring Playwright CLI skills.

## Local Commits

- `aeb930e4` - Productize AOS desktop capability skills.
- `bff8f69f` - Retire broad AOS desktop guidance skills.

Review ranges:

- First slice: `95af44c5..aeb930e4`.
- Follow-up remediation: `aeb930e4..bff8f69f`.
- Full local stack: `95af44c5..bff8f69f`.
- Current local end: `HEAD`.

## Product Artifacts

- Capability map and desktop control inventory:
  `docs/api/aos-capabilities.md`.
- Playwright-to-AOS mapping and follow-up card seeds:
  `docs/design/aos-desktop-playwright-cli-map.md`.
- Vocabulary decision: `docs/design/aos-desktop-command-vocabulary-decision.md`.
  No new `aos desktop` command noun or `desktop:<target>` namespace was added.
- Installable skill registry: `skills/registry.json`.
- Cold-agent proof fixture:
  `tests/fixtures/aos-skills/cold-agent-forward-proof-v0.json`.

Added or productized installable skills:

- `aos-core-orientation`
- `aos-runtime-readiness`
- `aos-desktop`
- `aos-saved-workspace`
- `aos-canvas-vision`
- `aos-focus-sessions`
- `aos-browser`
- `aos-verification`
- `aos-operator-annotations`
- `aos-work-records`
- `aos-recipes`
- `aos-command-surface-maintenance`

Retired broad root skills:

- `aos-agent-workspace`
- `browser-adapter`

## Validation

Passed:

- `node scripts/aos-skills-validate.mjs --json`
- `node --test tests/aos-skills*.test.mjs tests/aos-desktop-capabilities.test.mjs tests/active-authority-pointers.test.mjs`
- `node scripts/generate-command-manifests.mjs --check`
- `bash tests/help-contract.sh`
- `node --test tests/execution-model-terminology-contract.test.mjs`
- `AOS_DISABLE_DAEMON_AUTOSTART=1 AOS_BYPASS_PERMISSIONS_SETUP=1 ./aos skills list --json`
- `AOS_DISABLE_DAEMON_AUTOSTART=1 AOS_BYPASS_PERMISSIONS_SETUP=1 ./aos help --json`
- `AOS_DISABLE_DAEMON_AUTOSTART=1 AOS_BYPASS_PERMISSIONS_SETUP=1 ./aos help do --json`
- `bash tests/external-command-dispatch.sh`
- `bash tests/external-parser-flags.sh`
- `node --test tests/schemas/*.test.mjs`
- `AOS_DISABLE_DAEMON_AUTOSTART=1 AOS_BYPASS_PERMISSIONS_SETUP=1 ./aos graph windows`
- `git diff --check HEAD`

Live `./aos graph windows` returned `status: success` with current window rows.

## Residuals

- Issue #587 remains open. This local stack does not close or comment on the
  GitHub issue.
- Missing semantic desktop verbs remain follow-up candidates, not implemented
  commands: app activate/quit/hide/unhide, window close/minimize/maximize/
  restore/fullscreen, menu invocation, Space state/switching.
- M8 runtime/command changes were intentionally skipped because the M4 decision
  keeps `see`/`do`/`focus`/`show` as the public primitive model and requires
  fail-closed designs before new semantic verbs.
- Live native mutation proof was not run. The current proof is deterministic and
  avoids real input, TCC prompts, browser mutation, and desktop state mutation.

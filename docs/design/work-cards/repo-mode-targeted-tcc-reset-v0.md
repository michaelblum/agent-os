# Repo Mode Targeted TCC Reset V0

## Tracker

- Operator evidence artifact:
  `/var/folders/hm/d5_18wks38q0lrdhtjpkpw8h0000gq/T/aos-tcc-reset-agent-user-path-20260514T165655Z-22734`
- Manual dry-run artifact:
  `/var/folders/hm/d5_18wks38q0lrdhtjpkpw8h0000gq/T/aos-tcc-reset-agent-user-path-20260514T165551Z-21029`
- Current guarded manual harness:
  `tests/manual/tcc-reset-agent-user-path.sh`
- Related command implementation:
  `src/commands/operator.swift`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
TCC state, or prior Foreman/Operator context. Rediscover state before editing.

## Goal

Close the repo-mode TCC reset blocker found by Operator: the normal
`./aos permissions reset-runtime --mode repo` path safely stops the daemon, but
then fails with:

```text
tccutil: No such bundle identifier "aos": The operation couldn't be completed. (OSStatus error -10814.)
```

Make the repo-mode reset behavior honest and safer without using service-wide
TCC reset. Prefer a real targeted reset path that affects only repo-mode AOS. If
macOS cannot target the bare repo binary, classify that explicitly and route the
normal fallback to stopped-daemon manual removal/re-add, not break-glass service
reset.

## Read First

- `AGENTS.md`
- `src/CLAUDE.md`
- `docs/api/aos.md`, permission/readiness section
- `tests/manual/tcc-reset-agent-user-path.sh`
- `tests/input-tap-readiness.sh`
- `src/commands/operator.swift`, especially `permissionsResetRuntimeCommand`,
  `tccIdentifierForRuntime`, and `permissionResetFallbackLines`
- `build.sh`
- `scripts/package-aos-runtime`

## Rediscover State

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
./aos service status --mode repo --json
/usr/bin/codesign -dv ./aos 2>&1 | sed -n '1,80p'
man tccutil 2>/dev/null | col -b | sed -n '1,120p'
./aos dev recommend --json
```

Current evidence to re-check:

- `codesign -dv ./aos` reports `Identifier=aos`, `Signature=adhoc`,
  `Info.plist=not bound`.
- `tccutil(1)` documents `tccutil reset service [bundle_id]`; the Operator run
  showed `tccutil reset All aos` fails because `aos` is not a LaunchServices
  bundle identifier.

## Required Behavior

### Normal Recovery Must Not Affect Other Apps

Do not use or recommend service-wide TCC resets for this slice. The break-glass
path remains guarded by `--allow-service-reset --emergency-ack-other-apps`, but
this work must not make it part of normal readiness, normal docs, or normal
Operator testing.

### Targeted Reset Should Be Real Or Explicitly Unavailable

Choose the safest small implementation after inspection:

- If a repo-mode targetable identity can be created without a broad runtime
  architecture change, implement it and make `permissions reset-runtime --mode
  repo` use that identity.
- If the bare repo binary cannot be targeted by `tccutil` without affecting
  other apps, make the command classify that state explicitly. The output should
  say the daemon is stopped and targeted reset is unavailable for the bare repo
  binary, then route to the stopped-daemon manual fallback.

Do not leave the command pretending that `tccutil reset All aos` is a viable
normal reset path when the local platform rejects it.

### Human Handoff Must Stay Safe

When targeted reset is unavailable or fails:

- report that the managed daemon has already been stopped, or report if stop
  failed;
- tell the agent/human not to remove permissions unless `running=false`;
- keep `./aos ready --post-permission` as the return check;
- mention service-wide reset only as emergency-only, not as the next normal
  action.

## Suggested Implementation Areas

Likely files:

- `src/commands/operator.swift`
  - parse/response shape for `permissions reset-runtime`;
  - target identity derivation;
  - fallback notes and next actions;
- `tests/input-tap-readiness.sh`
  - deterministic expectations for dry-run, targeted-unavailable, and emergency
    guard;
- `tests/manual/tcc-reset-agent-user-path.sh`
  - if output classification changes;
- `docs/api/aos.md`, `AGENTS.md`, `src/CLAUDE.md`
  - only if user-facing contract changes;
- `build.sh` or packaging scripts only if you choose a narrow, justified
  repo-mode targetable identity approach.

## Hard Boundaries

- Do not run actual service-wide TCC reset.
- Do not remove/re-add macOS privacy rows manually.
- Do not ask Michael for break-glass recovery.
- Do not broaden into installed-mode packaging, Sigil, gateway, or canvas work
  unless the targetable identity fix truly requires a narrow packaging change.
- Do not modify unrelated dirty state such as `.claude/skills/` or
  `skills/plan-retirement-audit/SKILL.md`.

## Verification

Run focused deterministic checks first:

```bash
./aos dev recommend --json
bash tests/input-tap-readiness.sh
bash tests/manual/tcc-reset-agent-user-path.sh --dry-run
bash tests/help-contract.sh
git diff --check
```

If Swift sources change, run:

```bash
./aos dev build
```

Do not run the disruptive full manual TCC harness. If the fix needs live
validation, report an Operator follow-up handoff instead.

## Completion Report

Report back to Foreman with:

- files changed;
- whether a real repo-mode targeted reset is now possible, or why it is
  explicitly classified unavailable;
- exact command output shape for the failure/unavailable case;
- tests run with pass/fail results;
- whether `./aos dev build` ran;
- final repo daemon status;
- whether an Operator follow-up is needed.

# Dock Shared Harness V0

## Goal

Centralize duplicated Foreman, GDI, and Operator dock hook mechanics into a
small shared `.docks` harness while preserving dock-local persona files, AOS
entry-path guidance, `AGENTS.md`, `.codex/config.toml`, and local override
ability.

## Scope

- Add `.docks/harness/` with a shared hook runner.
- Add `.docks/{foreman,gdi,operator}/dock.json` for dock metadata.
- Convert dock session-start and stop hooks into thin wrappers around the
  shared harness.
- Preserve dock-local pre/post hook room for bespoke behavior.
- Replace clipboard-themed stop speech with neutral stop notices:
  `Foreman finished.`, `GDI finished.`, and `Operator finished.`
- Represent GDI handoff policy in `dock.json` metadata without changing
  `scripts/dock-handoff-clipboard` behavior in this slice.
- Keep AOS calls bounded so hook failures do not wait for Codex's 20 second
  timeout.
- Do not introduce OpenAI Agents SDK integration, a workflow engine, a broad
  voice rewrite, runtime permission changes, Swift changes, Employer Brand
  artifact changes, or Surface Inspector work.

## Design

The shared runner is `.docks/harness/dock-hook-runner.sh`. Dock-local
`hooks/session-start.sh` and `hooks/stop.sh` remain the Codex hook targets, but
only exec the shared runner with the phase and dock name. This keeps the Codex
hook surface dock-local while removing duplicated AOS registration, voice bind,
and stop-notice speech mechanics.

Each dock owns a `dock.json` with role, harness, bounded timeout, neutral stop
notice, handoff policy, and voice filters. `voice.voice_slot` is a 1-based
ordinal over the current speakable AOS voice registry. Stop hooks use
`./aos say --voice-slot <n> "<notice>"` for neutral notices and do not call
`./aos voice bind` or `./aos voice final-response` for normal stop speech.

Dock-local extension points are executable optional scripts under each dock's
`hooks/` directory:

- `pre-session-start.sh`
- `post-session-start.sh`
- `pre-stop.sh`
- `post-stop.sh`

The shared runner pipes the original hook payload to those scripts, bounds
their runtime with the same hook timeout, ignores their failures, and still
emits Codex hook success JSON.

## Verification

Run:

```bash
bash tests/dock-hook-isolation.sh
bash tests/dock-handoff-clipboard.sh
bash tests/help-contract.sh
git diff --check
```

Focused coverage should verify dock.json validation, shared harness usage, stop
notices, bounded fake-AOS behavior, and GDI handoff metadata.

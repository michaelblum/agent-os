# Dock Shared Harness V0

## Goal

Centralize duplicated Foreman, Implementer, and Operator dock hook mechanics into a
small shared `.docks` harness while preserving dock-local persona files, AOS
tooling-context guidance, `AGENTS.md`, `.codex/config.toml`, and local override
ability.

## Scope

- Add `Foreman hook scripts` with a shared hook runner.
- Add `.docks/{foreman,implementer,operator}/session metadata` for dock metadata.
- Convert dock stop hooks into thin wrappers around the shared harness. The
  accepted current model is Stop-only; startup hooks are intentionally absent.
- Preserve dock-local pre/post hook room for bespoke behavior.
- Replace clipboard-themed stop speech with neutral stop notices:
  `Foreman finished.`, `Implementer finished.`, and `Operator finished.`
- Represent Implementer handoff policy in `session metadata` metadata without changing
  `scripts/dock-handoff-clipboard` behavior in this slice.
- Keep AOS calls bounded so hook failures do not wait for Codex's 20 second
  timeout.
- Do not introduce OpenAI Agents SDK integration, a workflow engine, a broad
  voice rewrite, runtime permission changes, Swift changes, Employer Brand
  artifact changes, or Surface Inspector work.

## Design

The shared runner is `.docks/foreman/hooks/stop.sh`. Dock-local
`hooks/stop.sh` scripts remain the Codex hook targets and only exec the shared
runner with the `stop` phase and dock name. This keeps the Codex hook surface
dock-local while removing duplicated stop-notice speech mechanics and avoiding
stale startup registration state.

Each dock owns a `session metadata` with role, harness, bounded timeout, neutral stop
notice, handoff policy, and voice filters. `voice.voice_slot` is a 1-based
ordinal over the current speakable AOS voice registry. Stop hooks use
`./aos say --voice-slot <n> "<notice>"` for neutral notices and do not call
`./aos voice bind` or `./aos voice final-response` for normal stop speech.

Dock-local extension points are executable optional scripts under each dock's
`hooks/` directory:

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

Focused coverage should verify session metadata validation, shared harness usage, stop
notices, bounded fake-AOS behavior, and Implementer handoff metadata.

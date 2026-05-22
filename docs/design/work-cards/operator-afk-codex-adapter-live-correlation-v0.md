# Operator AFK Codex Adapter Live Correlation V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one supervised bridge-backed Codex launch from the GDI
  dock root, then exercise the accepted launch-attempt Codex adapter
  correlation path against live bridge evidence and explicit read-only Codex
  metadata.
- Source artifacts:
  - `docs/design/work-cards/afk-launch-attempt-codex-adapter-integration-v0.md`
  - `docs/design/work-cards/afk-codex-provider-session-adapter-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Expected branch/output: stay local on the current worktree/branch. Make no
  source, docs, config, provider config, gateway, dock profile, hook, GitHub,
  push, or PR changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read by the adapter through explicit `--codex-home`. Do
not edit, delete, move, or clean up provider-owned Codex files.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
```

Stop if the worktree is dirty or if `HEAD` and
`docs/durable-agent-cognition-v0` do not resolve to the same SHA.

If repo-mode TCC or input-tap readiness blocks, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns, run:

```bash
./aos ready --post-permission
```

## Live Bridge Run

Start one bridge process with a free local port, preferring `17866`:

```bash
SIGIL_AGENT_TERMINAL_PORT=17866 \
SIGIL_AGENT_TMUX_SESSION=afk-codex-adapter-live \
SIGIL_AGENT_CWD=/Users/Michael/Code/agent-os/.docks/gdi \
SIGIL_AGENT_COMMAND='codex --no-alt-screen' \
SIGIL_AGENT_TERMINAL_DRIVER=process \
node apps/sigil/codex-terminal/server.mjs
```

If the port is busy, use the next free port and report it. Do not retry more
than once for non-port failures.

Verify `/health` reports:

- `defaultCwd`: `/Users/Michael/Code/agent-os/.docks/gdi`
- `driver`: `process`

Use `/ensure` for:

- session: `afk-codex-adapter-live`
- cwd: `/Users/Michael/Code/agent-os/.docks/gdi`
- command: `codex --no-alt-screen`
- force: `true`

Record `launch_observed_at` as an ISO timestamp when `/ensure` returns or when
the provider visibly starts. Capture one `/snapshot` after launch.

Send at most one harmless no-op/status prompt only if the provider session id
or Codex metadata is not visible after a short wait. The prompt must ask for
status only and must explicitly say not to edit files. Stop if Codex requires
credentials, login, auth repair, or an unsafe confirmation.

## Prototype Correlation Probe

Create a temporary packet JSON with:

```json
{
  "packet_id": "operator-afk-codex-adapter-live-correlation",
  "source_artifact": "docs/design/work-cards/operator-afk-codex-adapter-live-correlation-v0.md",
  "requested_recipient": "gdi",
  "cwd": "/Users/Michael/Code/agent-os",
  "worktree": "/Users/Michael/Code/agent-os",
  "required_start_ref": "docs/durable-agent-cognition-v0",
  "provider_hint": "codex",
  "result_route": [{ "kind": "local_artifact_path", "ref": "stdout" }],
  "external_publication_policy": "local-only",
  "timeout_or_lease": { "lease": "current supervised Operator run" },
  "goal": "supervised live Codex adapter correlation smoke"
}
```

Create a temporary bridge visibility fixture from the observed `/health`,
`/ensure`, and `/snapshot` payloads. Include `catalog.launch_observed_at`.

If a provider session id was independently observed from the bridge snapshot,
title, or provider status text, include it in the fixture text or pass it via
`--provider-session-id`. Do not pass a catalog/all-cwd candidate id as the
provider session id unless it was independently observed from the launched
provider.

Run:

```bash
node scripts/afk-launch-attempt-prototype.mjs \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --json \
  --timestamp <iso-now> \
  --launch-observed-at <launch_observed_at> \
  --bridge-visibility-fixture <temp-bridge-visibility.json> \
  --codex-home /Users/Michael/.codex
```

The explicit `--codex-home /Users/Michael/.codex` is allowed for this
supervised read-only live probe. Do not use real Codex metadata in committed
tests or fixtures.

## Optional Catalog Context

If needed to explain a `not_observed`, `multiple_candidates`, or `wrong_cwd`
result, query:

```text
/sessions?cwd=/Users/Michael/Code/agent-os/.docks/gdi&provider=codex
/sessions?provider=codex&all_cwd=true
```

Report counts, current candidate ids, cwd, and `updated_at`. Preserve all-cwd
candidates as context; do not promote them into provider session ids.

## Stop Conditions

- Stop as `human_needed` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the bridge cannot
  start after one port retry, or Codex launch requires credentials or auth.
- Stop as `partial_pass` if the provider launches and the prototype records a
  structured `not_observed`, `wrong_cwd`, or `multiple_candidates` adapter
  status without repo mutation.
- Stop as `pass` if the prototype records `matched_by_provider_session_id` or
  `matched_by_cwd_time_window`, includes `codex://threads/<id>` and
  `codex-thread:<id>` refs, and cleanup succeeds.

## Cleanup

Before reporting:

- stop the bridge process;
- verify the chosen port is no longer reachable;
- remove temp packet and bridge visibility files;
- leave provider-owned Codex transcript/catalog files untouched;
- run `git status --short --branch`.

## Evidence To Return

- Branch, HEAD, durable alias SHA, and after-state
  `git status --short --branch`.
- Exact commands run and pass/fail results.
- Bridge port, health summary, ensure result, snapshot summary, and
  `launch_observed_at`.
- Whether a provider session id was independently observed, and from which
  source.
- Prototype record summary:
  - `lifecycle_state`
  - `provider_acceptance.status`
  - `provider_acceptance.provider_session_id`
  - `codex_adapter.status`
  - `codex_adapter.correlation_status`
  - `codex_adapter.matched_thread_id`
  - `codex_adapter.candidate_thread_ids`
  - `evidence.observed_refs`
  - `catalog.status`
  - `telemetry.status`
  - mismatch codes
- Cleanup proof.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned Codex transcript/catalog
  creation called out separately.

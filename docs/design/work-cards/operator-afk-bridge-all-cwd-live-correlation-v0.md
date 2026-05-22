# Operator AFK Bridge All-CWD Live Correlation V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one supervised live Sigil bridge correlation smoke on
  the accepted all-cwd catalog-scope checkpoint, proving whether
  `/sessions?provider=codex&all_cwd=true` can find the current Codex provider
  session without guessing `.docks/operator`.
- Source artifact:
  `docs/design/work-cards/afk-bridge-catalog-scope-correction-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Required start state: the ref must include this Operator card and the
  accepted all-cwd catalog-scope checkpoint.
- Expected branch/output: stay local on the current worktree/branch. Make no
  source, docs, config, gateway, dock profile, hook, GitHub, push, or PR
  changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog evidence may be created by the
supervised launch. Do not edit provider transcripts or provider config
directly. Remove temp files and bridge processes before reporting.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
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

If time allows before live launch, also run:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
```

## Live Bridge Run

Start one bridge process with a free local port, preferring `17865`:

```bash
SIGIL_AGENT_TERMINAL_PORT=17865 \
SIGIL_AGENT_TMUX_SESSION=afk-bridge-all-cwd-proof \
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

- session: `afk-bridge-all-cwd-proof`
- cwd: `/Users/Michael/Code/agent-os/.docks/gdi`
- command: `codex --no-alt-screen`
- force: `true`

Record `launch_observed_at` as an ISO timestamp when the provider visibly
starts or the ensure call returns. Send only a harmless no-op or minimal status
prompt if needed to get the provider session visible. Do not ask the provider
to edit files.

## Catalog Proof

Query the requested-cwd catalog:

```text
/sessions?cwd=/Users/Michael/Code/agent-os/.docks/gdi&provider=codex
```

Report `scope`, `cwd_filter`, record count, newest record id, newest
`updated_at`, and whether any record is current relative to
`launch_observed_at`.

Query the explicit all-cwd catalog:

```text
/sessions?provider=codex&all_cwd=true
```

Report `scope`, `cwd_filter`, record count, current candidate ids with cwd and
`updated_at`, and whether it found a current provider session outside
`.docks/gdi`.

If one current all-cwd candidate is selected, call:

```text
/session-inspector?cwd=<candidate.cwd>&provider=codex&session_id=<candidate.id>
```

Report sanitized cwd, branch, model, source file path, diagnostics, and
telemetry status. If multiple candidates are current, report ambiguity and do
not overclaim.

Optionally run the existing prototype classifier against a temp catalog fixture
built from the all-cwd payload. Use a temp packet with:

```json
{
  "dock": "gdi",
  "provider_hint": "codex",
  "cwd": "/Users/Michael/Code/agent-os",
  "source_artifact": "docs/design/work-cards/afk-bridge-catalog-scope-correction-v0.md",
  "required_start_ref": "docs/durable-agent-cognition-v0"
}
```

Pass `--provider-session-id <selected-id>` only when exactly one current
all-cwd candidate is selected, plus `--launch-observed-at <timestamp>`. Report
`provider_acceptance.status`, `catalog.status`, `telemetry.status`, and
mismatch codes.

## Stop Conditions

- Stop as `human_needed` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the bridge cannot
  start after one port retry, or Codex launch requires credentials or
  interactive auth not available in the supervised session.
- Stop as `partial_pass` if the all-cwd endpoint works but live provider launch
  does not create a current visible catalog record.
- Stop as `pass` if the all-cwd endpoint returns reviewable current-session
  evidence without an ad hoc observed-cwd guess and cleanup succeeds.

## Evidence To Return

- Branch, HEAD, durable alias SHA, and after-state
  `git status --short --branch`.
- Exact commands run and pass/fail results.
- Bridge port, health payload summary, ensure result, and launch timestamp.
- Requested-cwd catalog summary and explicit all-cwd catalog summary.
- Inspector/classifier outputs, if available.
- Cleanup proof: bridge killed, port no longer reachable, and no leftover
  bridge or Codex process from this run.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned transcript/catalog creation
  called out separately.

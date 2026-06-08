# Operator Run: AFK Work Queue Single Item Live Proof V0

**Status:** Ready for Operator

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run
- Single next goal: live-prove that a one-item AFK work queue can launch real
  Codex through the guarded AFK live path, complete, clean up, and write a
  queue-shaped receipt.
- Source artifact:
  `docs/design/work-cards/afk-work-queue-single-item-live-plumbing-v0.md`
- Provider work ref:
  `docs/design/work-cards/afk-work-queue-single-item-live-provider-sentinel-v0.md`
- Required start ref: `origin/main` with this Operator card and provider
  sentinel card present.
- Output expectation: no source changes, no branch changes, no PR, no GitHub
  issue/project mutation, no provider transcript body reads. Return a concise
  Operator report with exact evidence.

## Boundary

This is a real provider launch. It is approved for exactly one Codex/Implementer
provider launch through the one-item AFK work queue path.

Do not use bridge/provider/cleanup fixtures. Do not pass `--i-am-present`.
Do not run multi-item queue live execution.

## Preflight

From `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready --post-permission
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

Stop if:

- `HEAD` does not equal `origin/main`;
- worktree is dirty before the proof;
- readiness is not `ready=true mode=repo daemon=reachable tap=active`;
- preflight tests fail.

## Packet Setup

Create a temporary directory and local JSON files for one queue item.

The packet must include:

- `packet_id`: stable unique proof id for this run;
- `source_artifact`:
  `docs/design/work-cards/afk-work-queue-single-item-live-provider-sentinel-v0.md`
- `requested_recipient`: `implementer`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: the exact SHA from `git rev-parse HEAD`
- `provider_hint`: `codex`
- `result_route`: `[{ "kind": "local_artifact_path", "ref": "stdout" }]`
- `external_publication_policy`: `local-only`
- `goal`: a concise live proof goal for the provider sentinel.

The queue must be:

```json
{
  "queue_id": "operator-afk-work-queue-single-item-live-proof-v0",
  "items": [
    {
      "item_id": "provider-sentinel",
      "packet_ref": "<absolute path to packet.json>"
    }
  ]
}
```

The AFK authorization must allow exactly this one local run:

- `max_provider_launches`: `1`
- `allowed_docks`: `["implementer"]`
- `allowed_providers`: `["codex"]`
- `allowed_work_refs`:
  `["docs/design/work-cards/afk-work-queue-single-item-live-provider-sentinel-v0.md"]`
- `allow_branch_push`: `false`
- `allowed_branch_policy.allow_main_mutation`: `false`
- `external_publication_policy`: `none`
- `result_route`: `stdout`
- absolute `authorized_at` and `expires_at` values with a short proof window.

## Live Command

Run exactly one live queue command, with no fixtures:

```bash
./aos dev afk-session-trigger \
  --afk-work-queue "$QUEUE_JSON" \
  --afk-authorization "$AUTHORIZATION_JSON" \
  --afk-live-launch \
  --provider codex \
  --dock implementer \
  --json \
  --out "$OUTPUT_JSON"
```

## Required Evidence

Report:

- command exit code;
- receipt `record_type`, top-level `status`, and `mismatches`;
- `queue.selected_item_id`;
- `queue.items[0].live_status`;
- `dispatch.provider_launch_allowed`;
- `live_queue_item.single_packet_status`;
- `terminal_substrate.status`;
- `provider_acceptance.status`;
- provider session id if present in bounded metadata;
- cleanup status;
- result route status;
- proof token observed only in bounded receipt/prompt/source-artifact fields if
  present; do not read or paste provider transcript bodies;
- final `git status --short --branch`;
- readiness after cleanup.

## Cleanup

Remove the temporary packet, queue, authorization, and output files after
extracting the bounded evidence.

Verify proof-owned bridge/session/processes were cleaned up or are unreachable
if the receipt includes those facts. Do not kill unrelated pre-existing Codex,
Sigil, or AOS processes.

## Hard Boundaries

- Do not read provider transcript bodies.
- Do not edit source, docs, config, provider stores, gateway/dock runtime, or
  Codex configuration.
- Do not create branches, commits, PRs, GitHub issues, or project mutations.
- Do not run more than one live queue launch.
- Do not perform multi-item queue execution.
- Do not use fixtures.

## Completion Report Required

Return:

- classification: pass/fail/blocked;
- preflight results;
- exact live command shape, without dumping sensitive temp file contents;
- receipt evidence listed above;
- cleanup evidence;
- final git/readiness state;
- explicit boundary statement.

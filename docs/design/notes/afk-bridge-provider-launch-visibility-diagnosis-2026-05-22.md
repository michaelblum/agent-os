# AFK Bridge Provider Launch Visibility Diagnosis

**Date:** 2026-05-22
**Status:** docs-only diagnosis

## Summary

The remaining gap is provider-launch acceptance visibility, not catalog scope.
The accepted `/sessions?provider=codex&all_cwd=true` behavior can find current
Codex sessions outside the requested cwd, and the launch-attempt prototype now
keeps unrelated all-cwd current sessions as context instead of binding them as
the bridge-launched provider session id.

The bridge-backed `.docks/gdi` Codex launch still lacked a machine-observed
provider session id and lacked a current `.docks/gdi` provider catalog record.
Current evidence points to a missing launch-side acceptance/correlation surface:
the bridge can observe terminal substrate facts before the catalog appears, but
the provider catalog only becomes visible after provider-owned transcript
metadata exists and is readable.

## Accepted Facts

From
`docs/design/notes/manual-afk-receipts/2026-05-22-bridge-backed-provider-launch-gdi-partial.md`:

- `apps/sigil/agent-terminal/launch.sh --new-codex --restart` did not produce a
  reachable health endpoint for the requested wrapper command; the Operator saw
  `curl: (52) Empty reply from server` and then `/health` failed to connect.
- The fallback `apps/sigil/codex-terminal/server.mjs` process-driver bridge was
  healthy on port `17862` with `defaultCwd`
  `/Users/Michael/Code/agent-os/.docks/gdi`.
- `/ensure` created session `afk-provider-smoke` using driver `process`.
- Codex launched visibly from `.docks/gdi`; terminal-visible facts included
  Codex CLI `0.133.0`, cwd `.docks/gdi`, branch
  `gdi/afk-launch-attempt-protot...`, model `gpt-5.5`, repo head `81af5f0e`,
  and clean git status.
- The provider session id was not machine-observed for that launch.
- `/input` accepted a no-op prompt, but `/snapshot` showed terminal repaint/tip
  text rather than a readable submitted prompt or provider response.
- `/sessions?cwd=/Users/Michael/Code/agent-os/.docks/gdi&provider=codex`
  returned only stale pre-existing evidence; newest observed stale id
  `019e4e49-9d18-7531-9859-3b834f034d14` was updated
  `2026-05-22T06:11:41Z`, before the current run around `2026-05-22T12:58Z`.
- `/session-inspector` worked for a stale catalog-visible id and returned
  telemetry, but current-launch catalog and telemetry remained not observed.

From
`docs/design/work-cards/operator-afk-bridge-all-cwd-live-correlation-v0.md`:

- The later supervised bridge run on port `17865` had `defaultCwd`
  `/Users/Michael/Code/agent-os/.docks/gdi`, driver `process`, and `/ensure`
  result `{"ok":true,"session":"afk-bridge-all-cwd-proof","created":true,"driver":"process"}`.
- Requested-cwd catalog query returned records for `.docks/gdi`, but none were
  current relative to launch time `2026-05-22T15:52:38Z`; newest was
  `019e5058-3743-79c1-bf67-476fcbf0fd72` updated
  `2026-05-22T15:44:25.259Z`.
- Explicit all-cwd catalog query returned a current Codex candidate outside
  `.docks/gdi`: id `019e5062-42f2-7340-beda-e2295ebf7f41`, cwd
  `/Users/Michael/Code/agent-os/.docks/operator`, updated
  `2026-05-22T15:54:01.463Z`.
- `/session-inspector` for that all-cwd candidate reported cwd
  `/Users/Michael/Code/agent-os/.docks/operator`, branch
  `gdi/dock-handoff-chat-shape-correction-v0`, model `gpt-5.5`, diagnostics
  `[]`, and telemetry present.
- That all-cwd candidate is accepted as the supervising Operator session, not as
  the bridge-launched `.docks/gdi` provider session.

From
`docs/design/work-cards/afk-all-cwd-unrelated-candidate-classification-v0.md`:

- The prototype now records unrelated current all-cwd candidates under
  `catalog.unrelated_current_session_refs`.
- Without an independently observed provider session id, the `.docks/gdi`
  launch remains classified as `catalog_current_launch_not_observed`.
- True wrong-cwd behavior remains reserved for an independently supplied
  provider session id whose catalog record reports a different cwd.

## Current Code Surfaces

### Provider Catalog

`packages/host/src/session-catalog.ts` makes a Codex session visible when
`scanCodexSessions` finds a matching `rollout-*.jsonl` file under
`~/.codex/sessions` or `~/.codex/archived_sessions`, and
`parseCodexRolloutFile` can read early JSONL lines containing
`type === "session_meta"`. The `session_meta.payload` must provide a usable
session id and cwd, or the filename must supply the id while `session_meta`
supplies cwd. `finalizeRecord` drops incomplete records that lack
`session_id`, `cwd`, `updated_at`, or `resume_command`.

The catalog can observe provider, session id, cwd, optional branch,
timestamps, source file, and resume command. It cannot observe a bridge launch
before the provider writes discoverable metadata. It also cannot prove that a
current all-cwd record belongs to the bridge launch unless the provider session
id or other launch-side evidence binds it.

### Bridge `/sessions`

`apps/sigil/codex-terminal/server.mjs` exposes `/sessions` by calling
`listProviderSessions`. By default it filters to the bridge default cwd or the
explicit `cwd` query. With `all_cwd=true`, it intentionally omits the cwd
filter and returns all matching provider sessions. The endpoint can report
`scope` and `cwd_filter`, but it is still a catalog view, not a launch receipt.

### Bridge Terminal Substrate

`apps/sigil/codex-terminal/server.mjs` can observe `defaultSession`,
`defaultCwd`, selected driver, `tmuxAvailable`, `scriptAvailable`,
`pythonAvailable`, `/ensure` session and driver, process/tmux handle, ensured
cwd, command, and `/snapshot` text. These facts exist before any provider
catalog record appears.

The bridge cannot currently parse Codex title/status text into structured
provider acceptance fields. It also does not expose a provider session id from
the terminal. In the Operator receipt, `/snapshot` did not provide a readable
prompt/response despite the provider visibly starting.

### Launch Wrappers

`apps/sigil/agent-terminal/launch.sh` owns the canonical Sigil wrapper launch,
and `apps/sigil/codex-terminal/launch.sh` is now the historical compatibility
wrapper that delegates to it. The canonical launcher can set `CWD_TARGET`,
canonical `AGENT_TERMINAL_*` bridge env, `SESSION`, `PORT`, content roots, start
the bridge, call `/ensure`, and open the canvas. The Operator evidence shows
the wrapper path itself failed health for one run, while direct fallback server
startup worked.

That makes wrapper health a real defect to investigate, but it is not enough to
explain the catalog gap because the fallback bridge did start Codex visibly and
still did not observe a current `.docks/gdi` catalog record or provider
session id.

### Session Inspector And Telemetry

`apps/sigil/codex-terminal/session-inspector.mjs` requires an existing catalog
record. It reads the record's `source_file` tail and invokes
`packages/host/src/session-telemetry.ts` extractors. For Codex, telemetry comes
from provider-local transcript records such as
`payload.type === "token_count"`.

The inspector can prove telemetry for catalog-visible sessions. It cannot
discover or inspect a launched provider session that is not yet catalog-visible.

### Launch-Attempt Prototype

`scripts/afk-launch-attempt-prototype.mjs` already has a deterministic
no-provider path. It observes bridge terminal substrate with a harmless Node
command and can classify catalog fixtures, including unrelated all-cwd
candidates. It does not launch Codex, Claude, Gemini, or another provider, and
it does not provide launch-side provider acceptance from a real provider
terminal.

## Classification

Classification: `provider_acceptance_unobserved_before_catalog_match`.

Confidence: medium-high.

The absence of a current `.docks/gdi` catalog record is most likely not a wrong
cwd/provider filter and not expected all-cwd endpoint behavior. The accepted
all-cwd run proves the all-cwd endpoint can find a current Codex session, and
the current all-cwd candidate was correctly identified as unrelated Operator
session evidence.

The absence is also not proven to be simple catalog latency. The requested-cwd
catalog had stale `.docks/gdi` records but no current one across the Operator
observation window, and no independently observed provider session id existed
to poll or match.

The most concrete cause is that the process-driver bridge can start a visible
provider terminal but does not yet produce structured provider-acceptance
evidence. The provider catalog depends on provider-owned transcript metadata
appearing later. Until either a provider session id, terminal title/status parse,
or launch-side receipt field exists, the system has no machine-owned key to
distinguish "provider started but transcript metadata not yet cataloged" from
"provider started in the terminal but did not create a usable session_meta
record".

Secondary findings:

- Launch wrapper health needs a separate repair or fixture because
  `agent-terminal/launch.sh` failed while direct `server.mjs` fallback worked.
- Bridge snapshot/title parsing is promising because terminal-visible cwd,
  branch, model, version, head, and clean status existed for the human, but the
  current `/snapshot` evidence was too weak to capture prompt/response or a
  provider session id.
- Provider transcript discovery cannot be made the first visibility surface
  without preserving an explicit `not_observed` state, because real transcript
  reads are provider-owned and may lag or drift.

## Machine-Observable Facts Before Catalog Match

Currently observable from the bridge before a provider catalog match:

- selected provider by launch command or wrapper flag, such as
  `codex --no-alt-screen`;
- intended command from `AGENT_TERMINAL_COMMAND`, `/health` defaults, `/ensure`
  input, and session command tracking;
- intended cwd from `AGENT_TERMINAL_CWD`, `/health.defaultCwd`, `/ensure.cwd`, and
  process/tmux session tracking;
- terminal substrate driver, process/tmux handle, session name, and bridge
  health;
- `/snapshot` text, though current evidence says it may be repaint/tip text
  rather than durable prompt/response;
- for the deterministic prototype only, catalog and telemetry absence against
  empty fixture roots.

Not currently machine-observable from the bridge before catalog match:

- provider session id for the bridge-launched Codex process;
- provider-accepted cwd, branch, model, version, or head as structured fields;
- reliable prompt/response receipt from `/snapshot`;
- catalog `source_file` or telemetry refs for the current launch.

Human-observed terminal title/status facts can include cwd, branch, model,
version, head, and clean status, but they are not yet AOS-owned evidence.

## Recommended Next Slice

Owner: GDI implementation, routed and reviewed by Foreman.

Implement a provider-free bridge launch-visibility fixture around explicit
launch-side acceptance fields, using the bridge terminal surface as the input
shape. The slice should not launch a real provider. It should add a small
parser/classifier or prototype fixture that can consume a synthetic bridge
snapshot/title/health bundle and emit:

- selected provider;
- command;
- intended cwd;
- terminal driver and session handle;
- structured title/status observations when present, such as cwd, branch,
  model, version, and head;
- `provider_session_id: not_observed` when no id is parseable;
- catalog status left as `not_observed` or `catalog_current_launch_not_observed`
  until a separate catalog fixture binds the launch;
- mismatch code `provider_acceptance_unobserved` or equivalent when terminal
  substrate exists but provider acceptance fields are absent.

This should become the launch-side receipt field that catalog polling can later
enrich. Catalog polling/matching is the follow-on slice once the launch attempt
has a stable bridge/session key and explicit provider-acceptance absence state.

Wrapper health repair should be a separate slice unless the fixture exposes a
minimal deterministic wrapper-start bug. The wrapper failure is important, but
the fallback evidence shows wrapper health is not the only reason provider
launch visibility is missing.

## Deterministic Fixture Shape

Use synthetic files or inline fixtures only. Do not launch Codex, Claude,
Gemini, or another provider, and do not read real provider transcripts.

Suggested fixture bundle:

```json
{
  "bridge": {
    "health": {
      "ok": true,
      "defaultSession": "afk-bridge-all-cwd-proof",
      "defaultCwd": "/Users/Michael/Code/agent-os/.docks/gdi",
      "driver": "process"
    },
    "ensure": {
      "ok": true,
      "session": "afk-bridge-all-cwd-proof",
      "created": true,
      "driver": "process"
    },
    "command": "codex --no-alt-screen",
    "snapshot": {
      "session": "afk-bridge-all-cwd-proof",
      "driver": "process",
      "command": "process",
      "text": "Codex CLI 0.133.0\\ncwd .docks/gdi\\nbranch gdi/example\\nmodel gpt-5.5\\n"
    }
  },
  "catalog": {
    "requested_cwd_sessions": [],
    "all_cwd_sessions": [
      {
        "provider": "codex",
        "session_id": "019e5062-42f2-7340-beda-e2295ebf7f41",
        "cwd": "/Users/Michael/Code/agent-os/.docks/operator",
        "updated_at": "2026-05-22T15:54:01.463Z"
      }
    ],
    "launch_observed_at": "2026-05-22T15:52:38Z"
  },
  "expected": {
    "terminal_substrate.status": "observed",
    "provider_acceptance.status": "provider_acceptance_unobserved",
    "provider_acceptance.provider_session_id": "not_observed",
    "catalog.status": "catalog_current_launch_not_observed",
    "catalog.unrelated_current_session_refs[0].cwd": "/Users/Michael/Code/agent-os/.docks/operator"
  }
}
```

Add a companion true-positive fixture where a synthetic snapshot/title includes
a parseable provider session id, and the requested-cwd catalog fixture contains
that same id with cwd `.docks/gdi`. That fixture should prove the later catalog
polling path can bind an observed provider id without launching a provider.

## Non-Goals

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not run another supervised live bridge proof for this diagnosis.
- Do not read, write, delete, or depend on real provider transcripts.
- Do not mutate provider config, gateway state, dock profiles, hooks, GitHub
  state, pushes, or PRs.
- Do not make Sigil the owner of AFK provider lifecycle.
- Do not weaken the accepted all-cwd endpoint behavior.
- Do not weaken unrelated all-cwd candidate classification or true
  wrong-cwd classification.
- Do not implement scheduler, gateway routes, broker integration, result-route
  delivery, committed generated receipts, or schemas in the next fixture slice.

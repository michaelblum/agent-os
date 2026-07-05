# `aos` CLI API

Consumer-facing reference for the unified `aos` binary.

Use this doc when you are:

- writing agents that shell out to `aos`
- building wrappers around `aos`
- reviewing changes that affect the public CLI contract

For architecture and philosophy, see [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Repo Development Entry Points

When you are developing inside the `agent-os` repo, invoke the binary as
`./aos`, not bare `aos`.

Start here:

```bash
./aos ready
./aos dev recommend --json
./aos help <command> [--json]
./aos introspect review
```

`./aos ready` is the primary runtime readiness entrypoint. It starts/checks the
managed daemon and exits non-zero when AOS is not ready. Use `./aos status` for
a read-only runtime snapshot after that. Use `doctor`, `daemon-snapshot`, and
`clean` when you need deeper diagnostics or explicit cleanup, not as the default
first move.

For live repo work, `./aos` is also the first control plane for canvases, Agent
Terminal surfaces, dock communication, input routing, and runtime inspection.
Avoid raw daemon HTTP calls, direct PTY/tmux control, launchd probes, or
state-file inspection unless the AOS surface is missing or broken, the task is
testing that lower-level adapter, or the AOS control surface itself is under
repair. Treat those bypasses as scoped diagnostics and say why they were needed.

Use `./aos dev classify --json` and `./aos dev recommend --json` to route repo
changes through the manifest-backed developer workflow before choosing a build,
test, canvas reload, or readiness loop. Use `./aos dev build`
instead of raw `bash build.sh` unless `./aos` is missing or the build surface is
itself under repair. The build path avoids rebuilding the TCC-owning repo-mode
binary unless Swift runtime input content changed, the output is missing or in
the wrong mode, or the caller passes `--force`. When it does rebuild, it emits a
`Rebuilt: ./aos` marker and plays the configured system rebuild alert. Use
`./aos dev gh` for GitHub operations from repo
sessions; it shells out to the authenticated local `gh` CLI and does not fall
back to connector-backed GitHub tools.

## Contract

`aos` is a single binary with Unix-style subcommand groups.

The binary exposes platform primitives, not product policy. For surfaces, the
daemon should provide native lifecycle, display, input, content, and routing
capabilities that any consumer can build on. The default AOS panel/windowing
policy belongs in `packages/toolkit/`, not in app code and not as
Sigil-specific branches inside the daemon. A consumer may use toolkit
windowing, customize it, or bypass it for non-panel surfaces.

Examples:

```bash
aos see cursor
aos show create --id demo --at 100,100,300,200 --html '<div>hello</div>'
aos do click 500,300
aos say "Hello"
aos tell handoff "task complete"
aos listen handoff
```

### Success / Failure

Success is emitted on `stdout` with exit code `0`.

```json
{
  "status": "success"
}
```

Failure is emitted on `stderr` with exit code `1`.

```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE"
}
```

Consumers should treat the JSON envelope and exit code as the contract, not incidental log text.

## Top-Level Surface

The current top-level commands are:

| Command | Role |
| --- | --- |
| `aos launch` | manifest-backed source-owned app launcher |
| `aos ready` | front-door readiness gate; starts/checks AOS and reports blockers |
| `aos status` | read-only runtime/session status snapshot |
| `aos recipe` | source-backed executable recipes: list, explain, dry-run, run |
| `aos ops` | compatibility alias for `aos recipe`; removal gate: no remaining repo docs, scripts, generated indexes, packaged resources, tests, or known external callers require the old noun |
| `aos work-record` | Work Record discovery, report-only verification, recovery guidance, repair/attempt planning, controlled fixture repair execution, non-executing replacement proposals, explicit-root replacement writing, repair finalization, and external source supersession lookup/indexing |
| `aos see` | Perception: cursor state, captures, observation streams, zones |
| `aos do` | Action: mouse, keyboard, AX actions, AppleScript, session mode |
| `aos show` | Projection: canvas create/update/remove/list/eval/render |
| `aos focus` | Focus-channel management |
| `aos gate` | Human input gates and local gate record readback |
| `aos graph` | Display/window graph queries |
| `aos introspect` | Session self-review over recent `./aos` usage |
| `aos help` | Registry and command-specific help |
| `aos say` | Voice output |
| `aos voice` | registry-backed voice catalog, assignments, providers, and session bindings |
| `aos tell` | Communication output: human, channel, or direct session routing |
| `aos listen` | Communication input: channel or direct session reads/follow |
| `aos wiki` | local knowledge-base workflows |
| `aos config` | Discoverable runtime configuration (`get`, `set`, dump) |
| `aos set` | Runtime configuration |
| `aos content` | Content-server status |
| `aos serve` | Unified daemon |
| `aos service` | launchd lifecycle for the daemon |
| `aos experience` | active AOS experience-layer status, activation, and deactivation |
| `aos runtime` | packaged runtime utilities |
| `aos permissions` | preflight and onboarding |
| `aos doctor` | detailed runtime and permission diagnostics |
| `aos clean` | explicit stale daemon / canvas cleanup |
| `aos reset` | cleanup/reset workflows |
| `aos daemon-snapshot` | daemon state snapshot |
| `aos inspect` | live AX inspector overlay |
| `aos log` | log overlay |

## Target And Handle Ladder

Use the narrowest handle that preserves semantic identity:

1. Saved refs are the primary model-facing handles for normal observe-act
   loops: `ref:<snapshot-id>:<ref-id>`, with bare `ref:<ref-id>` only when the
   workspace can resolve it unambiguously.
2. Direct current-host refs address live browser and canvas targets:
   `browser:<session>/<ref>` and `canvas:<canvas-id>/<ref>`.
3. Coordinate fallback uses raw `x,y` plus `--state-id <id>` when an action was
   chosen from a prior perception state.
4. Native AX direct actions use selector flags such as `--pid`, `--role`, and
   filters; there is no current public `ax:` CLI target grammar.

Semantic Targets are structured perception records that contain refs, bounds,
roles, names, state, and provenance. They report what can be resolved inside a
target; they are not a separate address grammar. Window, channel, browser, and
canvas ids remain resource ids or role-flag values, not competing target
dialects.

## Core Usage Patterns

### 1. Perceive, Then Act

```bash
aos see capture browser:work --save --mode som --workspace default
aos see snapshots --workspace default --json
aos see refs --workspace default --query Save --json
aos do click ref:<snapshot-id>:r2 --workspace default --dry-run
aos do click ref:<snapshot-id>:r2 --workspace default
```

Typical consumer loop:

1. Save compact perception with `aos see capture --save`.
2. Read compact snapshots with `aos see snapshots` when choosing prior saved
   state; snapshot entries include `capture_source`, `capture_target`,
   `target`, and saved `query` without opening heavy payloads.
3. Read compact refs with `aos see refs`; use its structured
   `recommended_next` descriptors for the scoped dry-run action.
4. Compare saved snapshots with `aos see refs --diff <from>..<to>` when a
   compact ref-level post-action check is enough; add
   `--expect change|no-change` when a recipe or shell needs a non-zero exit on
   mismatch, or repeat
   `--expect-ref <ref>=added|removed|changed|unchanged|present|missing` for
   ref postconditions.
5. Dry-run the saved-ref action and inspect `resolution_status`.
6. Dispatch only if the ref validates or reacquires.
7. Use structured `recommended_next` descriptors and
   `recommended_next_command` when a fresh saved capture is needed before
   reusing refs from the surface.

Saved capture uses the same capture-source contract as ordinary capture: supply
a positional target such as `browser:work` or a source flag such as
`--region <rect>`, `--canvas <id>`, or `--channel <id>`. These source forms are
mutually exclusive. If no positional target or source flag is supplied, capture
defaults to `main`. `--save` is the mutation switch that persists local
workspace state. New saved captures persist compact
`capture_source.argv` so post-action refresh recommendations can reconstruct
the original positional or source-flag capture scope.

Saved agent workspaces live under
`~/.config/aos/{repo|installed}/agent-workspaces/<workspace>/`, or
`$AOS_STATE_ROOT/{repo|installed}/agent-workspaces/<workspace>/` when the state
root is overridden. Compact stdout includes counts, artifact refs, compact refs,
`capture_source`, `capture_target`, `capture_mode`, resolution classes, backend confidence,
identity facts, hint facts, current address facts, warnings, known limits, and
structured `conformance` including native `no_foreground` claim fields and
`target_uncertainty`, plus file paths.
Full capture JSON, screenshots, base64 payloads, AX/browser element arrays, and
semantic target arrays stay file-backed under the snapshot directory. The saved
workspace contract is `aos.agent-workspace.v0`; see
`shared/schemas/aos-agent-workspace-v0.md`.
Saved capture writes are staged under `snapshots/.staging/`, marked with
`committed.json`, and then atomically renamed into `snapshots/<snapshot-id>/`.
Readback and `index.json` rebuilds only use committed snapshots, so partial or
staged writes do not become valid workspace state.

Workspace selection is command-scoped. For saved workspace reads and actions,
`--workspace <id>` wins; otherwise `AOS_AGENT_WORKSPACE` selects a workspace;
otherwise AOS uses `default`. No daemon-held current workspace exists, and
`aos see workspace use <id>` is not a current command. `aos see workspaces`
lists all local workspaces without consulting `AOS_AGENT_WORKSPACE`; cleanup
commands require explicit workspace or snapshot ids. This keeps parallel agents
from mutating hidden shared workspace state. Any future session-bound default
must first define a multi-agent-safe contract.

Current wait/assertion boundary: saved workspaces do not expose
`aos see capture --wait-for-change`, `aos see capture --until-stable`,
or `aos see assert`. Use structured `recommended_next` descriptors and
`recommended_next_command` plus a fresh saved capture for re-perception. Use
`aos see refs --diff <from>..<to>` only for compact saved-ref comparison between
two existing snapshots. `--expect change|no-change` makes that compact diff a
machine-checkable gate with `REF_DIFF_EXPECTATION_FAILED` on mismatch;
`--expect-ref <ref>=added|removed|changed|unchanged|present|missing` gates one
saved ref inside the same compact diff and can be repeated. A single ref gate
reports `diff.ref_expectation`; multiple ref gates report
`diff.ref_expectations[]`. These expectations are still not a wait loop or full
assertion engine. Use
`aos show wait` only for canvas readiness, Recipe assertions only for command
JSON checks, and Work Record postconditions for durable evidence checks. Future
saved wait/assert commands need manifest help, parser, schema/doc, and drift
tests before public use.

Capture modes are explicit:

- `--mode ax`: tree-oriented refs where the backend can supply them.
- `--mode vision`: screenshot-oriented capture with image/base64 artifacts
  saved under `artifacts/`.
- `--mode som`: screen-object mode; currently xray-backed where available.

Saved refs use `ref:<snapshot-id>:<ref-id>` or bare `ref:<ref-id>`. The scoped
form is preferred. Bare refs resolve only when unambiguous inside the workspace.
`REF_AMBIGUOUS` returns candidate snapshot refs plus safe `aos see refs ...`
inspection commands; `REF_NOT_FOUND` returns the relevant refs inspection
command. These resolver failures happen before mutation and do not require user
approval.
Saved-ref mutation follows a backend action matrix. AOS canvas `reacquirable`
refs can route `click` and `set-value` through the current canvas resolver.
Browser `snapshot_scoped` `click`, `fill`, `hover`, `scroll`, `drag`, `type`,
and `key` refs run fresh xray validation plus page, frame, navigation, role,
title, label, context, and enabled-state checks. Text-compatible `type` and
`key` refs use the same current-target validation as browser `fill`.
`current_validation.current_target` includes current
bounds when xray provides them; bounds movement alone is tolerated when the
saved page/frame/navigation and element identity facts still validate. Dry-run
reports `reacquired` when that validation is sufficient for real dispatch;
non-dry-run then routes through the underlying `browser:<session>/<ref>` action
target and returns a saved-ref execution envelope with `current_validation`,
`underlying_result`, `post_action`, structured `post_action.recommended_next`,
and `recommended_next_command`. Missing,
stale, ambiguous, disabled, changed, or identity-drifted current targets fail
closed before dispatch:

The examples below mix backend-specific saved-ref forms. The `press` and
`focus` examples require stable `native_ax` refs with durable native identity
facts and an actionable producer verdict; browser and AOS canvas refs fail
closed for those actions.

```bash
aos do click ref:<snapshot-id>:r1 --workspace default --dry-run
aos do set-value ref:<snapshot-id>:r2 --workspace default --value "42" --dry-run
aos do fill ref:<snapshot-id>:r3 "buy groceries" --workspace default --dry-run
aos do hover ref:<snapshot-id>:r4 --workspace default --dry-run
aos do scroll ref:<snapshot-id>:r4 0,-200 --workspace default --dry-run
aos do drag ref:<snapshot-id>:r4 ref:<snapshot-id>:r5 --workspace default --dry-run
aos do press ref:<snapshot-id>:r6 --workspace default --dry-run
aos do focus ref:<snapshot-id>:r6 --workspace default --dry-run
```

After a dry-run returns a safe status such as `reacquired`, `resolved`, or
`direct_ax_ready`, dispatch by rerunning the exact saved-ref command without
`--dry-run`; do not remove `--dry-run` for validation-required, blocked,
unsupported, or low-confidence refs.

Saved-ref browser drag requires two saved browser refs from the same snapshot
and browser session, and validates both endpoints before any dispatch.
Native AX
`volatile` refs are inspection-only and report known limits instead of claiming
no-foreground saved-action safety. This V0 foundation is not completion of the
full native saved-ref proof or native no-foreground conformance.
`conformance.no_foreground.claim` is `not_claimed` for those refs; focus,
cursor, and Space preservation are `unverified`; permission state is the
captured native permission value when present, otherwise `unknown`; and fallback
flags are false because volatile native refs do not attempt saved-ref mutation.
Native AX refs also report `target_uncertainty.status:
blocked_missing_native_identity` until saved capture includes durable identity
and validation facts such as app PID, window id, an actual AX identifier,
enabled state, action names, permission state, and a captured baseline for
focus, cursor, and Space state, plus an actionable
`native_saved_ref_evidence` producer verdict.
Their `identity_facts` preserve the strongest available captured native hints,
including `role`, `title`, `label`, `value`, `enabled`, `focused`, `bounds`,
`context_path`, `app_pid`, `app_name`, `window_id`,
`ax_identifier_or_stable_path`, `action_names`, `permission_state`, `app_hint`,
and `window_hint`; these may be listed in `available_identity_facts`, but they
are not durable enough for saved-ref mutation while the focus/cursor/Space
baseline or producer verdict is missing.
The corresponding missing-fact identifiers are `app_pid`, `window_id`,
`ax_identifier`, `enabled`, `action_names`,
`permission_state`, `focus_cursor_space_baseline`, and
`native_saved_ref_evidence`; `enabled` is unsatisfied unless the captured value
is `true`, `permission_state` is unsatisfied unless the captured value is
`granted`, and `native_saved_ref_evidence` is unsatisfied unless the producer
marks it actionable with complete known-limit facts.
When a native capture includes that full durable identity contract with
`enabled: true`, `permission_state: granted`, a captured baseline, and
`native_saved_ref_evidence` as an actionable verdict, the saved ref can become
`stable` and support only capture-declared native `press`, `focus`, and
`set-value`. The Swift producer emits native known-limit facts for visible
native AX captures, including concrete off-Space, minimized-window,
custom-control, canvas/game-surface, and focus-mismatch signals. Without
complete known-limit evidence, or when those facts contain a blocker, the saved
ref remains `volatile`.
Stable actions convert the saved facts to the existing direct AX selector flags,
report
`direct_ax_ready` / `requires_direct_ax_current_matching`, and return the
direct AX wrapper response under `underlying_result`. Native `focus` and
`set-value` responses include direct post-action verification fields such as
`execution.ax_focused_after`, `execution.ax_value_after`, and
`execution.ax_value_matches_request` when the primitive can read them back.
They report `live_dispatch_proven_no_foreground_not_claimed` for the live
dispatch proof status, while still reporting `not_claimed` no-foreground
safety.
Stable native saved-ref dispatch preserves `fallback_used` and
`foreground_fallback_required` from the direct AX wrapper inside
`underlying_result.conformance.no_foreground`; fallback success remains
foreground fallback evidence, not no-foreground proof.
Path-only `stable_path` evidence remains inspection/readback evidence in v0; it
does not make a native saved ref stable until the native action selector grows a
real path-matching primitive.
When durable native identity facts are present but the captured native
`action_names` do not map to v0 `press`, `focus`, or `set-value`, the ref
remains `volatile` with
`native_action_matrix_unsupported` and
`blocked_unsupported_native_action` rather than reporting missing identity.
When those durable facts are present but the capture reports an off-Space
window, minimized window, custom control, canvas/game surface, or focus mismatch,
the ref remains `volatile` with
`native_known_limit_blocked` and `blocked_native_known_limit`. The captured
native known-limit fields are preserved in `identity_facts` when present:
`space_state`, `off_space`, `window_state`, `minimized`, `control_kind`,
`custom_control`, `surface_kind`, `canvas_surface`, `focus_state`, and
`focus_cursor_space_baseline.focus`. Those states fail closed until a
backend-owned validation path and approval-gated live proof can defend them.
Saved-ref `conformance.proof` records the backend proof story. Browser and AOS
canvas supported refs report `deterministic_contract_tests_passed` with local
test evidence. Stable native AX saved refs and direct AX wrapper responses
report `live_dispatch_proven_no_foreground_not_claimed`; volatile or known-limit
native AX refs still report `approval_gated_live_proof_not_run` with approval
gates for the blocked live proof.

Backend conformance levels are intentionally explicit:

| backend/path | supported saved-ref surface | conformance level | proof status | evidence or gate |
| --- | --- | --- | --- | --- |
| `aos_canvas` | `reacquirable` `click` and `set-value` | `deterministic_contract_tests` | `deterministic_contract_tests_passed` | `tests/agent-workspace-canvas-refs.sh` and `tests/agent-workspace-saved-ref.sh` |
| `browser` | `snapshot_scoped` `click`, `fill`, `hover`, `scroll`, `drag`, `type`, and `key` | `deterministic_contract_tests` | `deterministic_contract_tests_passed` | `tests/agent-workspace-browser-refs.sh` and `tests/agent-workspace-saved-ref.sh` |
| `native_ax` stable saved refs | durable-identity plus producer-verdict `press`, `focus`, and `set-value` | `native_saved_ref_contract_tests_plus_approval_gates` | `live_dispatch_proven_no_foreground_not_claimed` | `tests/agent-workspace-native-refs.sh` and `tests/manual/native-ax-saved-ref-live-proof.sh` and `docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md` |
| direct AX one-shot wrappers | `--pid` / `--role` `press`, `focus`, and `set-value` | `native_primitive_response_plus_wrapper_contract` | `live_dispatch_proven_no_foreground_not_claimed` | `tests/agent-workspace-native-refs.sh` and `tests/manual/native-ax-saved-ref-live-proof.sh` and `docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md` |
| `native_ax` volatile or known-limit refs | inspection/readback only | `known_limit_contract` | `approval_gated_live_proof_not_run` | known-limit assertions in `tests/agent-workspace-native-refs.sh` plus HITL live smoke, TCC/manual runtime flow, native repo-mode artifact rebuild, explicit no-foreground/focus/cursor/Space baseline verification |
| `coordinate_fallback` | diagnostic/fallback-only refs | `known_limit_contract` | `known_limit_refusal_tested` | refused-before-dispatch assertions in `tests/agent-workspace-browser-refs.sh` and `tests/agent-workspace-canvas-refs.sh` and `tests/agent-workspace-native-refs.sh` |

Browser runtime resolution is deterministic. `scripts/lib/playwright-cli-runtime.mjs`
is the public script-policy owner for browser helpers and proof harnesses.
`src/browser/playwright-version-check.swift` is the intentional
native/bootstrap mirror resolver for the hidden `aos browser _check-version`
adapter while Swift still owns that bootstrap check. Both resolvers must keep
the same minimum `@playwright/cli` version and discovery order:
`AOS_PLAYWRIGHT_CLI`, then repo-local `node_modules/.bin/playwright-cli`, then
the repo-owned `scripts/aos-playwright-cli` wrapper, then `playwright-cli` on
`PATH`. Consolidation is deferred unless a future native bootstrap extraction
removes the need for Swift to resolve the browser runtime directly. `aos
browser _check-version` returns structured JSON for the selected executable
path, discovery source, version, minimum version, and failures such as
`PLAYWRIGHT_CLI_NOT_FOUND`, `PLAYWRIGHT_CLI_TOO_OLD`, and
`PLAYWRIGHT_CLI_PROBE_FAILED`.

Guarded-live browser saved-ref proof lives in
`tests/manual/cross-backend-saved-ref-regression-proof.sh`. In
`AOS_SAVED_REF_PROOF_MODE=guarded-live`, the harness serves a local browser
fixture, captures browser saved refs, dispatches `click` and `fill` through
saved-ref validation, writes post-action readback artifacts, and emits a
report-only browser fill Work Record under
`$proof_root/browser/work-record/fill-work-record.json` with a verifier report
and compact summary beside it. If runtime resolution fails, browser rows stay
`blocked_runtime` with the resolver JSON as evidence instead of a vague PATH
failure.

Native `open`/`toggle`, explicit `type`/`key` saved-ref attempts that include
`--workspace` or `--snapshot`, and other unsupported saved-ref forms fail closed
with structured JSON until the action grammar has a backend-owned current target
validation path. Plain native `type` / `key` arguments such as literal
`ref:...` text remain direct command input unless the caller supplies an
explicit saved-ref scope. See
`shared/schemas/aos-agent-workspace-v0.md` for the full action grammar matrix.

Post-action and revalidation recommendations are target-aware. A saved browser
ref captured from `browser:todo` in `som` mode recommends:

```bash
aos see capture browser:todo --save --workspace <workspace> --mode som
```

If the saved capture stored a query, the recommendation carries the same
`--query` value. `coordinate_fallback` is a diagnostic/fallback-only resolution
class in this slice; normal saved capture generation does not emit coordinate
fallback refs, and coordinate-backed saved-ref mutation must warn or refuse.

Diagnostic and fallback paths are still available when compact saved refs do not
have parity or when an agent explicitly needs pixels, raw images, or coordinate
proof:

```bash
aos see cursor
aos see capture main --base64
aos see capture --canvas surface-inspector --perception --out /tmp/inspector.png
aos see capture --region 1172,442,320,480 --perception --out /tmp/inspector.png
aos do click 500,300
```

Cleanup is explicit:

```bash
aos see workspace prune default --older-than 7d --dry-run --json
aos see snapshot delete <snapshot-id> --workspace default --i-understand-local-artifacts --json
aos see workspace delete default --i-understand-local-artifacts --json
```

### 2. Ask For Bounded Human Input

`aos gate ask` presents a bounded structured decision through the gate service and writes the terminal result to stdout as JSON.

```bash
aos gate ask "Continue?"
aos gate ask --preset approve_deny --title "Run disruptive test?" --timeout 30
aos gate ask --request gate-request.json
aos gate ask --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"yes_no_with_escape"}}'
```

The request contract is `aos.gate.request.v1`. A successful answer returns the typed response object. A human dismissal returns `{ "result": null, "status": "dismissed" }`; a deadline returns `{ "result": null, "status": "timeout" }`. Operational failures exit non-zero with a machine-readable gate error code on stderr.

Every terminal outcome appends one `aos.gate.record.v1` metadata record under the active runtime state root: `~/.config/aos/{repo|installed}/gate/records.jsonl`, or `$AOS_STATE_ROOT/{repo|installed}/gate/records.jsonl` when that override is set. Records include gate id, prompt title, source metadata, receptor, field kinds, timeout, lifecycle timestamps, elapsed time, resolution/status, and operational error details when present. Prompt bodies and answer payloads are redacted by default; callers must opt in with `--store-response` or `metadata.record_response: true` to persist the answer payload.

Read records without presenting a gate:

```bash
aos gate records --json
aos gate records --limit 20 --json
aos gate records --id gate-abc123 --json
aos gate records --status answered --json
```

The readback payload is `aos.gate.records.readback.v1` and includes the JSONL path, count, and matching records.

Create a deferred gate when the current agent turn should end before the human
responds:

```bash
aos gate defer --request gate-request.json --session-id codex-123 --harness codex --json
aos gate defer --request gate-request.json --session-id codex-123 --harness codex --show --json
aos gate defer --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"approve_deny"}}' --session-id codex-123 --harness codex
```

`aos gate defer` writes one `aos.gate.continuation.v1` JSON file under the
active runtime state root and returns immediately with
`aos.gate.defer.create-response.v1`. Deferred continuations are stored at
`~/.config/aos/{repo|installed}/gate/continuations/<continuation_id>.json`, or
`$AOS_STATE_ROOT/{repo|installed}/gate/continuations/<continuation_id>.json`
when a state-root override is set. The record captures the gate id, prompt
title, redacted source metadata, session id, harness/provider hint, dock, cwd,
branch, HEAD SHA, dirty summary, lifecycle state, resume policy, resume
entrypoint metadata, and `auto_resume=false`. The entrypoint is an adapter
identifier such as `codex_exec_adapter`, not an executable path; the V0 daemon
does not invoke it directly. Prompt bodies and submitted answer payloads are
not persisted by default.

Submit a deferred gate from a local bridge or future UI receptor:

```bash
aos gate submit --continuation-id gate-cont-abc123 --request submission.json --json
aos gate submit --continuation-id gate-cont-abc123 --json '{"decision":"approve"}'
```

Submit loads the pending continuation, marks it `submitted` exactly once, appends
one terminal `aos.gate.record.v1` record, and writes one human-authored
`aos.gate.resume-event.v1` under
`~/.config/aos/{repo|installed}/gate/resume-events/<event_id>.json`. Duplicate
submits are idempotent and return the existing resume event rather than creating
another one. The resume event is provider-neutral: Codex is represented only by
the `harness`/`provider` values, `codex_exec` adapter hint, and
`codex_exec_adapter` continuation entrypoint metadata. V0 implementations must
treat `resume.auto_resume` as false regardless of value. Use `--store-response`
only when the answer payload should be persisted in the continuation, resume
event, and terminal gate record.

Read continuations without changing them:

```bash
aos gate continuations --json
aos gate continuations --limit 50 --json
aos gate continuations --id gate-cont-abc123 --json
aos gate continuations --status pending --json
```

The readback payload is `aos.gate.continuations.readback.v1` and includes the
continuation directory, count, and matching records.

Guided user-signal sessions extend deferred gates for visual "show me what you
mean" checkpoints. The durable record is
`aos.guided-user-signal.session.v1`, stored under
`$AOS_STATE_ROOT/{repo|installed}/guided-user-signal/sessions/` by toolkit
helpers. A record links the source operation, source surface, guidance media,
one daemon-owned click/point/region/annotation capture, optional gate record or
continuation id, optional resume event id/path, lifecycle state, runtime mode,
and redaction policy. V0 does not add a separate CLI command; AOS-hosted
surfaces use toolkit workbench helpers for visual policy and the existing
`gate.submit` bridge when a gate question is attached.

Full-screen or live desktop mouse ownership is a daemon/native input primitive,
not a WebView policy. V0 records name `input_region` as the concrete daemon
primitive when bounded regions are enough and reserve
`daemon_native_full_screen_input_capture` as the authoritative future primitive
for full-screen capture.

### Repo Development Workflow

`aos dev` is the developer workflow router for this repo. `classify` and
`recommend` are read-only and do not start the daemon.

```bash
./aos dev classify --json
./aos dev recommend --json
./aos dev recommend --paths src/main.swift,packages/toolkit/runtime/canvas.js --json
./aos dev capabilities list --json
./aos dev capabilities explain dev.github.issue_comment --json
./aos dev capabilities explain dev.github.pr_checks --json
./aos dev docks list --json
./aos dev docks capabilities foreman --json
./aos dev build
./aos dev gh context --json
./aos dev gh issue list --state open --limit 50 --milestone v0 --json
./aos dev gh label list --limit 50 --search governance --json
./aos dev gh pr list --state all --limit 30 --json
./aos dev gh issue comment 298 --body-file /tmp/comment.md
./aos dev gh issue create --title "Follow-up tracker" --body-file /tmp/issue.md
./aos dev gh issue close 298 --reason completed
./aos dev gh issue edit 298 --remove-label lane:active --add-label lane:parked
./aos dev gh pr merge 410 --merge --match-head-commit abc123
./aos dev gh ci inspect --pr 298 --json
./aos dev gh review-comments --pr 298 --json
```

`classify` reports changed files, matched rules, classes, actions, and whether
the set is hot-swappable or TCC-sensitive. `recommend` adds ordered commands
and verification steps. The rules live in `docs/dev/workflow-rules.json` and
are validated by `shared/schemas/dev-workflow-rules.schema.json`.

`build` wraps the repo `build.sh`, forces `--no-restart` unless the caller has
already passed it, and reports whether the repo-mode `./aos` binary was rebuilt
or only re-signed in JSON mode. Rebuild detection is content-based for Swift
runtime inputs, not mtime-based, and build-tooling edits alone do not replace
the TCC-owning binary. Dock hooks do not automate post-build TCC handling: they
do not reset permissions, open System Settings, show a human-needed surface,
write completed-build markers, or inject provider input. Repo-mode binary
rebuilds are Foreman-owned and intentionally rare; successful rebuilds play a
system alert sound so Michael can notice the TCC-sensitive event.

`capabilities` is read-only discovery over
`docs/dev/agent-capabilities.json`. It lists or explains typed agent
capabilities, including whether a capability uses a typed AOS surface or an
explicit raw-process adapter. It does not execute capabilities or grant
permissions.

`docks` is read-only discovery over `.docks/*/dock.json`. It lists or explains
dock profiles and can resolve a dock's profile against
`docs/dev/agent-capabilities.json` for the active capability route. This keeps
dock identity, route defaults, and allowed capability classes explicit without
turning the profile into a rigid executor.

`dev gh` is the repo GitHub control surface. It deliberately uses the real
`gh` executable from `PATH`, the user's existing `gh` authentication, and the
local git checkout to infer `owner/repo` unless `--repo owner/name` is supplied.
Direct operations such as `issue list`, `issue view`, `issue comment`,
`issue create`, `issue close`, `issue edit`, `label list`, `pr list`, `pr view`,
`pr checks`, `pr comment`, and `pr merge` forward to `gh` and preserve its exit
behavior. List operations expose the repo-safe inventory filters Foreman and
GDI need most often: issue and PR lists support `--state`, `--limit`,
`--label`, `--author`, `--assignee`, and `--search`, plus issue-specific
`--milestone` and PR-specific `--base`, `--head`, and `--draft`; label lists
support `--limit`, `--search`, `--sort`, and `--order`. Write operations are
non-interactive: `issue create` requires `--title` and `--body-file`,
`issue close` requires an issue number and optionally accepts `--reason`, and
`issue edit` requires an issue number and at least one explicit edit flag:
`--add-label`, `--remove-label`, `--add-assignee`, `--remove-assignee`,
`--milestone`, `--title`, or `--body-file`. `pr merge` requires a PR number
and exactly one of `--squash`, `--merge`, or `--rebase`; use
`--match-head-commit` when merging a reviewed head. The
composite helpers cover repo-specific repeated loops:
`ci inspect` reads PR checks and fetches failed GitHub Actions logs when the
check links to an Actions run, while `review-comments` uses `gh api graphql` to
read review-thread resolution state.

### Wiki Repo Docs Projection

`aos wiki project-docs` projects a curated manifest of canonical Git docs into
the runtime wiki as generated orientation pages:

```bash
./aos wiki project-docs --dry-run --json
./aos wiki project-docs --manifest docs/wiki/repo-docs-projection-v0.json
```

The source-controlled V0 manifest lives at
[`docs/wiki/repo-docs-projection-v0.json`](../wiki/repo-docs-projection-v0.json).
Generated pages are written under `aos/concepts/repo-doc-*.md` so the existing
wiki index, search, show, and graph surfaces can see them without adding a new
namespace. Each page uses `type: repo_doc` and carries `generated: true`,
`projection: repo_docs_v0`, `source_path`, `source_hash`, `source_type`, tags,
and controlled concepts. The page body repeats that Git docs are canonical,
records source metadata, includes deterministic concept links to related
projected pages, and embeds the source Markdown content without summarization.

### 2. Create a Persistent Canvas

```bash
aos show create \
  --id demo \
  --at 100,100,320,200 \
  --interactive \
  --html '<div style="padding:16px;color:white">hello</div>'
```

Common follow-ups:

```bash
aos show update --id demo --at 150,120,320,200
aos show eval --id demo --js 'document.body.style.opacity = "0.7"'
aos show remove --id demo
```

`show remove --id <root>` is the daemon-facing cleanup primitive for a selected
canvas lifecycle tree. Removing a root canvas removes cascade-owned child
canvases and daemon input regions owned by those canvases. Children created
with `cascade: false` are detached and preserved, and unrelated canvases such as
developer/admin tools remain untouched because they are outside the selected
tree. Toolkit resources that are not daemon state, such as shared
DesktopWorld-stage layers, must be cleaned up by their toolkit resource scope;
see [toolkit/runtime.md](./toolkit/runtime.md).

### Reload an Existing Canvas From Current Content

When you change web assets under an active content root, reload the existing
canvas by updating it to the same `aos://` URL, then gate on `show wait`:

```bash
aos show update --id inspector --url 'aos://toolkit/components/inspector-panel/index.html'
aos show wait --id inspector --manifest inspector-panel
```

This is the canonical reload workflow for existing URL-backed canvases. It does
not remove or recreate the canvas, so unrelated developer/admin surfaces such as
`surface-inspector` are not disturbed. When the update only supplies `--url`,
AOS preserves the canvas id, frame, DesktopWorld segments/track/surface when
applicable, scope, interactivity, window level, parent relationship, and any
active TTL timer. The page reloads through the current active content server
root for the URL host.

If the content root is not live, make that explicit before reloading:

```bash
aos content wait --root toolkit --auto-start
```

Topic worktrees should use branch-scoped root names from
`scripts/aos-content-scope.sh` or pass explicit root query parameters where the
surface supports them. Do not overwrite canonical `content.roots.toolkit` or
`content.roots.sigil` from a topic worktree just to refresh a canvas.

For inline `--html` or `--file` canvases, `show update --html ...` or
`show update --file ...` replaces the content in place. `--file` is resolved by
the CLI at update time, so repeat the `--file` update after editing the file.
Use `show wait` after either form when the reloaded page has a readiness
manifest or observable JavaScript condition.

### 3. Load Toolkit Content Through the Content Server

Use the canonical `toolkit` root for `main` or installed examples. Topic
worktrees should use branch-scoped root names so one singleton daemon can serve
multiple sessions without root collisions.

```bash
aos set content.roots.toolkit packages/toolkit
aos content wait --root toolkit --auto-start
aos show create \
  --id inspector \
  --at 100,100,320,250 \
  --interactive \
  --url 'aos://toolkit/components/inspector-panel/index.html'
aos show wait --id inspector --manifest inspector-panel
aos show post --id inspector --event '{"type":"inspector-panel/bootstrap","payload":{"note":"hello"}}'
```

### 4. Coordinate Through Channels or Direct Session Messaging

```bash
aos tell handoff "task complete"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
aos tell --who
aos listen handoff
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
```

## Subcommand Reference

## IPC Contract

Wire-level request/response contract between the CLI and daemon is specified in
[`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md). Agents and
tools that talk to the daemon directly (SDKs, MCP adapters) should use the v1
envelope there.

## `aos see`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `cursor` | inspect what is under the cursor |
| `capture` | capture a target display/window/region |
| `observe` | stream perception events from the daemon |
| `list` | enumerate capture/display targets |
| `selection` | interactive region selection |
| `zone` | zone helpers |

Shorthand capture is supported:

```bash
aos see main
aos see external 1
aos see capture --canvas surface-inspector --perception
aos see capture --canvas sigil-radial-menu --xray
aos see capture --region 1172,442,320,480 --perception
```

Useful capture modifiers include:

- `--window` to restrict `user_active`/window captures to the window frame
- `--region <x,y,w,h>` for explicit CG-coordinate regions
- `--canvas <id>` / `--channel <id>` for surface-relative captures
- `--exclude-window <CGWindowID>` to omit specific windows from a display/region capture
- `--perception` to attach spatial metadata alongside the image payload

Capture responses include an opaque `state_id` such as `see_abc123def456`.
Work-record and recipe layers can carry that id into the next action as the
perception state the agent acted from. The id is a correlation handle, not a
stable object reference or cache key.

`aos see cursor` returns the cursor point, display ordinal, the frontmost
visible window under the cursor when available, and an optional AX `element`.
When present, the element includes `role`, `title`, `label`, `value`, `enabled`,
`bounds`, raw `action_names`, raw `settable_attributes`, and raw
`ancestor_chain` entries. It does not synthesize user-facing capability labels
or breadcrumb vocabulary in the binary. Toolkit and app layers derive labels,
lineage, and normalized capabilities such as `press`, `focus`, `set_value`,
`scroll`, `increment`, or `decrement` from those raw AX facts. The
capture-pipeline cursor response uses the same raw AX element fields when it can
resolve the element explicitly under the cursor.

`--xray` returns raw visible bounded AX elements in `elements`; the daemon does
not role-whitelist them into an "interactive" vocabulary. Display, region, and
surface captures traverse visible app windows that intersect the captured region;
window captures stay scoped to the captured window owner. For AOS-owned canvas
captures, `aos see capture --canvas <id> --xray` also runs a fixed semantic
target probe inside that canvas and returns `semantic_targets`. Those entries
use the canonical `agent_ui_target` envelope: top-level `ref`, `state_id`,
`surface`, `role`, `name`, `kind`, `enabled`, `target`, `state`, `actions`,
`extension`, `provenance`, and `reacquisition`. `ref` is the state-scoped
action handle. Durable machine identity lives in `target.target_id` scoped by
`target.owner_namespace`; human labels, accessible text, local DOM ids, canvas
id, parent canvas id, local geometry, metadata, and the
`canvas:<canvas-id>/<ref>` action-routing string are presentation,
provenance/current-address, or hint fields. They are not durable identity. The
current V0 producer emits or consumes descriptor fields when it can derive them;
older or partial AOS-owned surfaces may omit some fields until their producers
migrate. The probe does not use caller-supplied JavaScript; `show eval` remains
a developer diagnostic bridge, not the agent perception contract.

See [`shared/schemas/aos-semantic-targets.md`](../../shared/schemas/aos-semantic-targets.md)
for the response shape.

`--perception` augments the capture response with:

- global capture bounds
- local capture bounds in the emitted image
- composite capture scale
- per-display surface segments when a region/canvas/channel spans multiple displays
- a `spatial-topology` snapshot for the same moment

## `aos show`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `create` | create a canvas |
| `update` | mutate an existing canvas |
| `remove` | remove one canvas |
| `remove-all` | remove all canvases |
| `list` | list active canvases |
| `get` | fetch one canvas by id |
| `exists` | existence check for one canvas |
| `eval` | run JavaScript in a canvas |
| `render` | render HTML to an image without a persistent canvas |
| `listen` | persistent daemon stream / command pipe |
| `ping` | daemon liveness |
| `to-front` | raise canvas z-order |
| `post` | channel message post |

`create` accepts the main consumer-facing placement/content modes:

- `--id <name>`
- `--at x,y,w,h`
- `--html <html>`
- `--file <path>`
- `--url <url>`
- `--interactive`
- `--focus`
- `--ttl <duration>`
- `--scope connection|global` (default: `global`)
- `--track union`
- `--surface desktop-world` — canonical alias for `--track union`
- `--anchor-browser browser:<session>/<ref>`
- `--anchor-window <id>`
- `--anchor-channel <id>`
- `--offset x,y,w,h`

`--surface desktop-world` and legacy `--track union` create one logical
DesktopWorld surface backed by one physical segment per active display. The
canvas keeps a single `id`; `show list` exposes a `segments` array with ordered
`{display_id,index,dw_bounds,native_bounds}` entries. Normal panels and `--at`
canvases are unchanged and do not carry `segments`. Existing normal canvases
cannot be converted into DesktopWorld surfaces with `show update`; remove and
recreate the canvas so it boots with the segmented backing.

`show list` and `show get` also expose `windowNumbers`, the native macOS window
number or numbers backing a canvas. Perception commands use this to keep
canvas-scoped captures and `--xray` AX traversal attached to the intended AOS
surface instead of falling back to the frontmost app.

Anchor flags are placement roles, not separate target dialects.
`--anchor-browser` consumes a browser Target-with-Ref, while `--anchor-window`
and `--anchor-channel` consume resource ids. The display subsystem resolves the
input into an Anchor Binding for placement. `show update` accepts the same
anchor flags when a surface needs to be re-anchored after browser scroll,
navigation, or layout changes.

### Show/See/Do Surface Loop

Use `aos show create`, `aos show update`, and `aos show remove` for persistent
canvas lifecycle. Use `aos show render` for one-shot image rendering without a
persistent canvas or action handle.

To inspect and act on a live AOS surface, capture the current canvas host and
carry the returned target handle forward:

```bash
aos see capture --canvas <id> --xray --save --workspace <workspace>
aos do click canvas:<canvas-id>/<ref> --state-id <id>
aos do set-value canvas:<canvas-id>/<ref> --value <value>
aos do drag canvas:<canvas-id>/<ref> --by <dx>,<dy>
```

`semantic_targets[].provenance.do_target` is the direct current-host action
handle when present. Saved workspace refs from the same capture use
`ref:<snapshot-id>:<ref-id> --workspace <workspace>` for replayable model-facing
handles. Both paths use the same target ladder; there is no separate `show:`,
`surface:`, or `anchor:` action grammar.

Verify through a fresh `aos see capture --canvas <id> --xray --save
--workspace <workspace>` when the proof is about model-visible state. `aos show
eval --id <id> --js ...` is a developer diagnostic bridge for repo-owned canvas
state; show eval is not a target dialect and is not a substitute for semantic
target evidence unless the check is intentionally reading that owned state.

Surface Inspector and annotation support surfaces must carry the same evidence
model. Bundles such as `annotation-snapshot.json` can record Surface Inspector
context and semantic target projections, but they should point back to
`semantic_targets`, `provenance.do_target`, saved refs, and capture artifacts
instead of inventing private surface addresses.

## `aos recipe`

`recipe` is the source-backed executable recipe surface. It sits above
primitive verbs such as `status`, `show`, and `see`, and it can also run
repo-owned helper scripts through typed `shell` blocks. It keeps primitive
command and script references visible so agents can inspect what will run.
`aos ops` remains a compatibility alias while old callers are retired; see
[ADR-0013](../adr/0013-aos-execution-model-v0.md) for the AOS Execution Model
and alias removal gate.

| Subcommand | Purpose |
| --- | --- |
| `list` | list discoverable source-backed recipes |
| `explain <id>` | show the structured recipe plan |
| `dry-run <id>` | statically expand and validate a recipe without side effects |
| `run <id>` | execute a recipe |

V1 examples:

```bash
aos recipe list --json
aos recipe explain runtime/status-snapshot --json
aos recipe dry-run runtime/status-snapshot --json
aos recipe run runtime/status-snapshot --json
aos recipe dry-run sigil/start --json
```

`recipe dry-run` is static in v1: it does not start daemons, create canvases,
mutate resources, or run read-only observation probes. It validates the recipe,
resolves declared resources, verifies external help-manifest command
references and static repo shell script paths, and returns the planned blocks,
resource ownership, parameters, and cleanup plan. Without `--json`, it emits a
concise text plan.

Recipes may use repeatable
`aos see refs --diff <from>..<to> --expect-ref <ref>=...` gates as compact
postcondition steps after a fresh saved capture. That command remains a
saved-ref diff gate over two existing snapshots; recipe assertions can inspect
`diff.ref_expectation` or `diff.ref_expectations[]`, while Work Records should
cite the command output as immutable evidence rather than treating the recipe as
replay or repair authority.

Work Record v0 has a deterministic saved-ref bridge above the primitive command
surface. Toolkit tests can build a report-only Work Record from structured
evidence for:

```text
see --save -> do ref --dry-run -> do ref -> see --save -> diff/readback -> cleanup
```

The record preserves the selected Saved Ref, resolved underlying target,
backend, strategy, fallback flag, State IDs, recommended next capture command,
immutable before/dry-run/action/after/cleanup evidence, and verifier health.
Stale or ambiguous saved-ref validation is classified as `repairable` or
`blocked` according to the recorded evidence; cleanup or postcondition failure
is recorded without rewriting historical evidence. This bridge does not turn
`aos do` into a macro recorder and does not authorize autonomous replay or
repair.

## `aos work-record`

`aos work-record` is the model-facing Work Record v0 command family. Most
commands are read-only: they can discover records from canonical fixture roots
or explicit `--root` files/directories, read a record by id or path, run the
named report-only verifier profile, explain conservative recovery guidance, and
emit read-only Repair Plan, Workflow Gate Authorization, Repair Attempt Plan,
Replacement Proposal, Source Supersession Index lookup, Guided Recovery report,
or compact evidence bundle JSON. `repair guide` composes the current status,
Repair Plan, optional gate authorization, optional Attempt Artifact validation,
optional finalization dry-run, and optional supersession lookup into one
non-executing recovery report with exact command descriptors. `repair bundle`
materializes the guide/report/planning side of that recovery report under an
explicit operator-owned `--output-root`; it is a handoff bundle writer, not a
repair executor, finalizer, gate submitter, replay loop, or auto-resume surface.
The narrow mutating exceptions are `repair execute`, which runs only an allowlisted
deterministic repo-command/file-fixture operation under an explicit
`--execution-root` and writes a Repair Attempt Artifact under an explicit
`--artifact-root`; `replacement-proposal write`, which writes only a new
replacement Work Record under an explicit `--output-root`; `supersession
write`, which writes only an external relationship entry under an explicit
`--index-root`; and `repair finalize`, which composes a successful Repair
Attempt Artifact into one replacement Work Record plus one Source Supersession
Index entry under explicit roots.

```bash
aos work-record list --json
aos work-record read work-record:workflow-open-wiki-sigil-2026-05-05 --json
aos work-record verify shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json --json
aos work-record status work-record:workflow-open-wiki-sigil-2026-05-05 --json
aos work-record plan-repair work-record:repairable-stale-saved-ref-2026-07-04 --json
aos work-record plan-attempt shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --json
aos work-record plan-attempt shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --authorization workflow-gate-authorization.json --json
aos work-record repair guide shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --json
aos work-record repair guide source.json --authorization workflow-gate-authorization.json --attempt-plan repair-attempt-plan.json --attempt-artifact repair-attempt-artifact.json --replacement-root /tmp/work-records --index-root /tmp/work-record-index --json
aos work-record repair bundle shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --output-root /tmp/aos-work-record-repair-bundle --dry-run --json
aos work-record repair bundle source.json --output-root /tmp/aos-work-record-repair-bundle --authorization workflow-gate-authorization.json --json
aos work-record repair bundle status --bundle-root /tmp/aos-work-record-repair-bundle --json
aos work-record repair bundle status --bundle-parent /tmp/aos-recovery-bundles --json
aos work-record repair bundle inspect /tmp/aos-work-record-repair-bundle --json
aos work-record repair execute --attempt-plan repair-attempt-plan.json --execution-root /tmp/aos-exec --artifact-root /tmp/aos-artifacts --dry-run --json
aos work-record repair execute --attempt-plan repair-attempt-plan.json --execution-root /tmp/aos-exec --artifact-root /tmp/aos-artifacts --json
aos work-record repair finalize --source source.json --attempt-plan repair-attempt-plan.json --attempt-artifact repair-attempt-artifact.json --replacement-root /tmp/work-records --index-root /tmp/work-record-index --dry-run --json
aos work-record repair finalize --source source.json --attempt-plan repair-attempt-plan.json --attempt-artifact repair-attempt-artifact.json --replacement-root /tmp/work-records --index-root /tmp/work-record-index --json
aos work-record attempt-artifact validate repair-attempt-artifact.json --json
aos work-record attempt-artifact build --input repair-attempt-outcome-input.json --json
aos work-record replacement-proposal build --source shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --attempt-plan repair-attempt-plan.json --attempt-artifact repair-attempt-artifact.json --json
aos work-record replacement-proposal validate replacement-proposal.json --json
aos work-record replacement-proposal write replacement-proposal.json --output-root /tmp/work-records --dry-run --json
aos work-record replacement-proposal write replacement-proposal.json --output-root /tmp/work-records --json
aos work-record supersession write --source source.json --replacement replacement.json --index-root /tmp/work-record-index --dry-run --json
aos work-record supersession lookup --source source.json --index-root /tmp/work-record-index --json
aos work-record supersession validate source-supersession-entry.json --json
aos work-record gate-request shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --json
aos work-record gate-check shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json --gate-record gate-record.json --json
aos work-record export work-record:workflow-open-wiki-sigil-2026-05-05 --json
```

The current verifier profile is
`aos.verifier.work-record.v0.report-only`. It reads Work Records and returns a
fresh diagnostic report with `mutates_record:false`; it does not patch
evidence, rewrite Claims, repair refs, or replay actions. Embedded
`claim_results[]` remain historical record contents and are reported
separately from the current verifier output.

`status` returns the Work Record health verdict, failure classes, diagnostics,
evidence refs used by the verifier, and recovery guidance for `valid`, `stale`,
`repairable`, `blocked`, `impossible`, `superseded`, and `retired`. Guidance is
conservative: stale and repairable records point to re-perception/re-resolution
or a named workflow gate; blocked records name missing evidence, permission,
runtime, cleanup, or postcondition blockers; valid records do not recommend
redundant live proof loops; and impossible, retired, or superseded records do
not offer replay as the next step.

`plan-repair` consumes the same fresh report-only verifier output and emits a
`work_record.repair_plan` envelope. It is a proposal surface only:
`mutates_record:false`, `executes_actions:false`, and
`automatic_replay_allowed:false`. The plan separates current report-derived
health from embedded historical health, carries failure classes, blockers,
diagnostics, evidence refs, required workflow gates, proposed read-only or
approval-gated steps, descriptive candidate patches, and command descriptors
that are not executed by the planner. Valid records get no repair plan;
stale/repairable records require fresh perception or re-resolution before any
future gated mutation; blocked records name the blocker; and impossible,
superseded, or retired records avoid repair and replay.

`gate-request` turns the current read-only Repair Plan into an
`aos.gate.request.v1` request for one required Workflow gate. It is read-only
and does not call `aos gate ask`, `aos gate defer`, or `aos gate submit`.
Generated requests include source Work Record id/path, Repair Plan
schema/digest identity, Workflow gate id, gated step/candidate patch ids,
current report-derived health, an `approve_deny` decision field, and metadata
linking the request to Work Record repair planning. The request asks only for
authorization of a future gated attempt; it does not execute repair, apply a
candidate patch, replay actions, or mutate the source Work Record.
The command returns a provenance envelope; pass its nested `gate_request` object
to `aos gate ask` or `aos gate defer`.

`gate-check` reads an existing terminal `aos.gate.record.v1` record,
`aos.gate.resume-event.v1` file, or submitted deferred continuation id and
returns `work_record.workflow_gate_authorization` JSON. Status values are
`not_required`, `pending`, `authorized`, `denied`, `dismissed`, `timeout`,
`stale`, `mismatch`, `insufficient_evidence`, and `unsupported`. Positive
authorization requires a matching source Work Record, matching Repair Plan
identity, matching Workflow gate, and an inspectable affirmative stored answer.
A terminal `answered` record without stored response payload is
`insufficient_evidence`; use `--store-response` or
`metadata.record_response:true` when the gate response must later prove
authorization. Authorization sets `authorizes_future_attempt:true` only for
positive approval and always reports `executes_repair:false` and
`mutates_record:false`.

`plan-attempt` consumes the current Repair Plan plus either a supplied
`work_record.workflow_gate_authorization` JSON file or enough gate input to
derive one (`--gate-record`, `--resume-event`, or `--continuation-id`). It
emits `work_record.repair_attempt_plan` with schema version
`2026-07-work-record-repair-attempt-plan-v0`. Status values are
`not_required`, `ready`, `blocked_authorization_required`,
`blocked_authorization_denied`, `blocked_authorization_insufficient`,
`blocked_precondition`, `stale`, `mismatch`, and `unsupported`. The plan
includes source Work Record identity, current Repair Plan schema/version/digest,
current authorization identity when supplied, stable attempt identity,
preconditions, planned operations, candidate patch refs, recommended command
descriptors, evidence requirements, postconditions, cleanup expectations,
rollback expectations, risk, and known limits.

`ready` means only "safe to hand to a future explicit executor." The command
does not execute repair, replay UI actions, apply candidate patches, run
recommended commands, patch execution maps, mutate Work Records, or auto-resume
agents. Positive readiness requires the current Repair Plan to validate, source
and Repair Plan identities to match the supplied authorization, every mutating
planned operation to have an authorized matching Workflow gate, representable
preconditions, unapplied candidate patches, and unexecuted recommended
commands. Missing, denied, dismissed, timeout, insufficient, stale, wrong
record, wrong plan, wrong gate, invalid, and unsupported authorization all fail
closed.

`repair guide` is the Guided Recovery Workflow V0 surface. It accepts a source
Work Record plus optional `--authorization`, `--gate-record`, `--resume-event`,
or `--continuation-id`; optional `--attempt-plan`; optional
`--attempt-artifact`; optional `--execution-root`, `--artifact-root`,
`--replacement-root`, and `--index-root`; and returns
`work_record.repair_guided_recovery` with schema version
`2026-07-work-record-repair-guided-recovery-v0`. The guide classifies the
current recovery stage, carries summaries of the lower-level reports it used,
names blockers and missing inputs, recommends deterministic artifact paths, and
emits command descriptors with `id`, `purpose`, `command`, `argv`,
`mutates_state`, approval/root requirements, expected output, next stage, and
`not_run_by_guide:true`. Descriptors whose JSON stdout must become a later
artifact include `stdout_artifact`, `save_stdout_to`, and downstream
`requires_saved_output_from` fields; `argv` remains the direct process
invocation and never relies on shell redirection. `command` and
`persistence_command` are display-only shell-quoted text derived from `argv`
and the structural saved-output fields; consumers execute `argv` directly and
must not parse either display string.

Guide stages are `valid_no_repair_needed`, `superseded`,
`retired_or_impossible`, `repair_plan_unavailable`, `gate_required`,
`authorization_pending`, `authorization_denied`,
`authorization_insufficient`, `attempt_plan_blocked`, `ready_to_plan_attempt`,
`ready_to_execute`, `attempt_artifact_invalid`, `ready_to_finalize`,
`finalization_blocked`, `finalized`, and `unsupported`. `ready_to_plan_attempt`
means the Repair Attempt Plan is ready in memory but still needs persisted JSON
stdout before execute can be ready. `ready_to_execute` with `stage_status:"ready"`
requires a supplied `--attempt-plan`, `--execution-root`, and `--artifact-root`;
otherwise it is blocked with matching `missing_inputs`. `ready_to_finalize` is
reported only after a supplied Attempt Artifact validates and finalization
dry-run can compute the replacement and supersession outputs; `finalized` is
reported only when supersession lookup resolves a readable replacement with
status output.

`repair guide`, `repair bundle`, `repair bundle inspect`, and each
`repair bundle status` row include a compact `recovery_summary` object for
scan-first continuation. Consumers should read `recovery_summary.state`,
`why`, `source_work_record`, `bundle_root`, `guide_stage`,
`guide_stage_status`, `next`, `artifacts`, `safety`, and
`diagnostic_codes` before drilling into full guide reports, manifests,
descriptors, artifacts, or diagnostics. `next.argv` is the only executable
continuation form; display strings remain display-only. Invalid, missing,
unsupported, or unknown summaries do not expose a safe continuation argv.
Incomplete bundle-owned artifacts or descriptors, digest mismatches,
descriptor mismatches, invalid manifests, path escapes, forbidden artifacts,
unsupported schemas, missing roots, and unknown inspection statuses fail closed
without `next.command_id` or `next.argv`. Inspection summaries and lifecycle
status rows use the same classifier for `ready`, `blocked`, `finalized`,
`invalid`, `missing`, `unsupported`, and `unknown`.
`safety` reports that inspectors did not run commands, bundles did not write
replacement or supersession outputs, live UI is not involved, and automatic
replay is not allowed. The summary is derived from existing validated guide,
bundle, inspection, or lifecycle fields and is not a second recovery state
machine.

The guide may run only read-only/report-only/planning checks and existing
non-mutating dry-runs. It never runs recommended commands, never executes
repair, never calls `repair finalize` in write mode, never calls
`replacement-proposal write` or `supersession write`, never calls `aos do` or
`aos gate ask/defer/submit`, never uses browser/native AX/canvas/live UI/TCC
surfaces, never applies patches, never mutates source Work Records, never
writes replacement or supersession outputs, never starts a Workflow engine, and
never auto-resumes agents. Mutating commands can appear only as explicit
descriptors marked `not_run_by_guide:true`.

`repair bundle` is the Work Record Recovery Bundle V0 surface. It accepts a
source Work Record plus required `--output-root`; optional `--profile` and
repeatable `--root`; at most one of `--authorization`, `--gate-record`,
`--resume-event`, or `--continuation-id`; optional `--attempt-plan`,
`--attempt-artifact`, `--replacement-root`, and `--index-root`; optional
`--dry-run`; and returns `work_record.repair_recovery_bundle` with schema
version `2026-07-work-record-repair-recovery-bundle-v0`. The bundle writes only
under the explicit output root. Dry-run writes nothing and reports the planned
file set.

Recovery Bundle V0 is greenfield and has no legacy compatibility contract.
Current writer output is the contract. Same-schema manifests missing canonical
required `non_execution_flags` such as `mutates_record`, `writes_bundle`, or
`repairs_bundle` are invalid; old generated smoke/test bundle directories
should be regenerated. Any future compatibility support requires an explicit
schema/versioned migration stance, not inspector leniency.

Bundle writes are limited to `bundle-manifest.json`, `guide-report.json`,
`commands/*.json` descriptors, and safe JSON stdout artifacts explicitly
described by guide descriptors such as `artifacts/gate-request.json` and
`artifacts/repair-attempt-plan.json`. Finalization dry-run and supersession
lookup remain explicit follow-up command descriptors only; the bundle does not
run those helpers and does not materialize their reports. Every planned or
written artifact reports path, digest, producer, downstream consumers, write
mode, and whether bytes are known at plan time. Descriptor paths are rebound so
`stdout_artifact.path`, `save_stdout_to`, and `requires_saved_output_from`
point at bundle-local artifacts when those artifacts are materialized;
descriptors also carry `not_run_by_bundle:true` and a
`bundle_artifact_status`.

The bundle rejects path traversal, symlinked output roots, symlinked
not-yet-created output-root ancestors, symlinked bundle child paths, output-root
file conflicts, and conflicting existing artifacts. Matching existing files are
idempotent. It preserves source Work Record bytes and never writes replacement
Work Records, Source Supersession Index entries, source Work Records, gate
records, gate responses, Repair Attempt Artifacts, arbitrary patch output, or
anything outside `--output-root`. It never runs `repair execute`, `repair
finalize`, `replacement-proposal write`, `supersession lookup`,
`supersession write`, `aos gate ask/defer/submit`, `aos do`,
browser/native AX/canvas/TCC operations, replay, auto-resume, or a Workflow
engine.

`repair bundle status` is the read-only Work Record Recovery Bundle Lifecycle
Status V0 surface. It accepts repeatable explicit `--bundle-root` values and
repeatable explicit `--bundle-parent` values. Parent scanning is bounded and
non-recursive:
only immediate children containing `bundle-manifest.json` are candidates. It
does not perform global search, infer roots from Work Record ids, read manifest
paths to discover more bundles, write an index, or run recovery. Each candidate
is inspected through `repair bundle inspect`, then summarized as `ready`,
`blocked`, `invalid`, `missing`, `unsupported`, `finalized`, or `unknown` with
source Work Record identity, saved guide stage, saved-output readiness, and the
exact next command id/`argv` only when the inspected bundle is validated enough
to continue and required saved outputs are present; each row also carries the same information in
`recovery_summary`. Missing or invalid bundle roots stay represented in the
same report instead of aborting other roots. The command returns
`work_record.repair_recovery_bundle_lifecycle_status` with schema version
`2026-07-work-record-repair-recovery-bundle-lifecycle-status-v0`, reports
`ready_count`, `blocked_count`, `invalid_count`, `missing_count`,
`unsupported_count`, `finalized_count`, and `unknown_count`, and reports
canonical non-execution flags: no bundle writes, repairs, action execution,
gate submission, finalization, replay, live UI, browser/native AX/canvas/TCC,
patch application, Workflow engine start, or auto-resume.

`repair bundle inspect` is the Work Record Recovery Bundle Inspection V0
surface. It accepts only an existing `<bundle-root>` and returns
`work_record.repair_recovery_bundle_inspection` with schema version
`2026-07-work-record-repair-recovery-bundle-inspection-v0`. The inspector is
read-only, reads only the explicit bundle root by default, validates
`bundle-manifest.json`, `guide-report.json`, `commands/*.json`, manifest
artifact paths, manifest `non_execution_flags`, descriptor rebinding,
materialized artifact existence and digests, required saved-output presence,
forbidden bundle-owned outputs, and path containment. Manifest artifact paths
must exactly match the writer-owned path resolved from `relative_path`; the
inspector reads and digests the `relative_path` target, not an independent
manifest path claim. Manifest non-execution flags must contain every required
no-execution flag as boolean `false`; missing flags, non-boolean values, `true`
execution/write/live/replay claims, and unknown non-false claims fail closed. It
reports the saved guide stage, the safe next descriptor id, the exact `argv`,
whether saved outputs are present, missing artifact paths, human-approval and
mutation indicators, and a `recovery_summary` with the scan-first continuation
state and a reminder that the command was not run. Invalid, missing,
unsupported, unknown, and incomplete bundle-owned artifact or descriptor states
report no executable `recovery_summary.next.argv`.
Descriptor `command` and `persistence_command` values are display-only
shell-quoted text; `argv`, `stdout_artifact`, `save_stdout_to`, and
`requires_saved_output_from` are the execution and persistence contract.

The inspector never writes or repairs bundle files, never re-runs `repair
guide`, planning, finalization dry-run, supersession lookup, gates, repair
execution, replacement writing, replay, Workflow engine work, or live UI/TCC
work. Forbidden bundle-owned outputs such as
`reports/finalization-dry-run.json`, `reports/supersession-lookup.json`,
`repair-attempt-artifact.json`, `replacement-records/**`,
`source-supersession-index/**`, `gate-record*.json`, and
`gate-response*.json` block continuation.

`repair execute` is the Controlled Repair Executor V0 command. It accepts a
ready Repair Attempt Plan JSON path plus explicit existing `--execution-root`
and `--artifact-root` directories. Dry-run reports the allowlisted operation id,
direct argv command identity, execution root, artifact path, timeout, allowed
mutations, cleanup/rollback plan, and expected side effects without executing.
Execute mode runs only the explicitly named fixture registry for repo-owned
deterministic file-fixture operations. The executor core is separate from that
fixture registry; fixture operations are not the product repair abstraction.
Execution uses `shell:false`, deterministic environment keys, bounded
stdout/stderr capture, timeout enforcement, named phase snapshots
(`before`, `after_primary`, optional `after_cleanup`, optional
`after_rollback`, and `final`), source Work Record immutability proof, Repair
Attempt Artifact writing, and artifact validation. Final artifact evidence uses
`before..final` file-change and digest evidence; cleanup and rollback phase
evidence stays inspectable.

The executor result envelope is `work_record.controlled_repair_executor_result`
with schema version
`2026-07-work-record-controlled-repair-executor-result-v0`. Status values
include `dry_run`, `succeeded`, `failed`, `partial`,
`aborted_precondition`, `blocked_plan_not_ready`, `blocked_authorization`,
`blocked_unsupported_operation`, `blocked_unsafe_command`,
`blocked_workspace_escape`, `blocked_timeout`, `artifact_invalid`,
`finalize_blocked`, `cleanup_failed`, `rollback_failed`, and `unsupported`.
Every result reports `mutates_source_record:false`, `executes_actions:false`,
`uses_live_ui:false`, `uses_browser:false`, `uses_native_ax:false`,
`uses_canvas:false`, `applies_patches:false`, and
`automatic_replay_allowed:false`. Browser, native AX, canvas, coordinate,
screenshot, image matching, TCC-gated, arbitrary shell, unregistered command,
source-record mutation, generic patch execution, Workflow engine, and
auto-resume behavior are unsupported. Replacement writing and supersession
indexing remain separate explicit commands; executor finalization is not part of
this V0 public command.

`attempt-artifact validate` validates an existing
`work_record.repair_attempt_artifact` JSON artifact with schema version
`2026-07-work-record-repair-attempt-artifact-v0`. Artifact statuses are
`succeeded`, `failed`, `partial`, `aborted_precondition`,
`blocked_authorization`, `blocked_plan_mismatch`, `cleanup_failed`,
`rollback_failed`, `invalid_artifact`, and `unsupported`.

`attempt-artifact build` consumes explicit fixture/outcome JSON and emits a
deterministic Repair Attempt Artifact. The input supplies the Repair Attempt
Plan plus operation outcomes, candidate patch outcomes, recommended command
outcomes, evidence refs, verifier-before and verifier-after reports,
postcondition results, cleanup results, rollback results, and the source Work
Record mutation check. The builder does not execute repair, replay UI actions,
apply candidate patches, run recommended commands, patch execution maps, mutate
source Work Records, mint replacement Work Records, or auto-resume agents.

The validator checks consistency rather than inventing a second verifier health
authority. Success requires matching source Work Record identity, matching
Repair Plan and Repair Attempt Plan digests, planned-vs-actual operation
matching, required evidence refs, passed postconditions, passed or not-required
cleanup, unchanged source Work Record, and `final_health` derived from
`verifier_after` when present. Missing evidence, verifier contradiction,
operation mismatch, stale plan, wrong record, wrong authorization, failed
cleanup, failed rollback, source-record mutation, candidate patch application
without evidence, and command execution without command/stdout/stderr/exit
artifacts fail closed.

Both attempt-artifact commands are read-only command surfaces:
`mutates_state:false`, `executes_repair:false`, `executes_actions:false`,
`applies_patches:false`, and `automatic_replay_allowed:false`.

`repair finalize` is the bounded Repair Finalization V0 composition step after
an already-produced successful Repair Attempt Artifact. It accepts a source
Work Record, Repair Attempt Plan JSON, Repair Attempt Artifact JSON, explicit
`--replacement-root`, and explicit `--index-root`; then it builds the
Replacement Proposal internally, validates the existing plan/artifact/proposal
contracts, preflights the Replacement Writer output and Source Supersession
Index entry through their owning planners, calls the Replacement Writer, calls
the Source Supersession Index writer, and returns one
`work_record.repair_finalization_result` envelope.
`--replacement-output-path` is optional and must remain under
`--replacement-root` with the deterministic replacement id filename.

Finalization does not replace the lower-level commands. It is a single
deterministic path for the common successful case:

```text
Repair Attempt Artifact -> Replacement Proposal -> Replacement Writer -> Source Supersession Index -> Finalization Result
```

Dry-run mode writes nothing. It reports the intended replacement output and
supersession index identity/path when they can be computed safely. Execute mode
validates both durable output targets before writing the replacement Work
Record, then writes only the replacement Work Record under `--replacement-root`
and the external supersession entry under `--index-root`; it never mutates the
source Work Record. Repeating the same finalization is idempotent when both
existing outputs match and returns `already_finalized`.

The finalization result records schema/version, finalizer implementation
version, status, source Work Record path and before/after digest, Repair
Attempt Plan digest/status/validation, Repair Attempt Artifact
digest/status/validation, Replacement Proposal identity/digest/status,
Replacement Writer result, Source Supersession Index writer result, readback
validation, side effects, explicit audit facts for wrote/already-existed/would
write replacement and supersession outputs, recovery guidance, and exact
non-execution flags:
`executes_repair:false`, `executes_actions:false`, `uses_live_ui:false`,
`uses_browser:false`, `uses_native_ax:false`, `uses_canvas:false`,
`applies_patches:false`, `mutates_source_record:false`, and
`automatic_replay_allowed:false`.

Finalization statuses include `dry_run`, `finalized`,
`already_finalized`, `not_required`, `blocked_invalid_source`,
`blocked_invalid_attempt_plan`, `blocked_invalid_attempt_artifact`,
`blocked_attempt_not_successful`, `blocked_missing_evidence`,
`blocked_source_mutated`, `blocked_health_mismatch`,
`blocked_replacement_proposal`, `blocked_replacement_write`,
`blocked_supersession_write`, `blocked_path_escape`, `blocked_conflict`,
`partial_finalized`, `stale`, `mismatch`, and `unsupported`. Preflightable
invalid roots, path escapes, relationship mismatches, and writer-result
provenance mismatches fail before durable finalization writes begin. Partial
states are first-class failures reserved for post-preflight durable failures:
if the replacement write succeeds but supersession writing then fails, the
command exits non-zero with `partial_finalized`, exposes the replacement path,
and recommends the explicit supersession recovery command.

Recovery guidance is structured: `finalized` and `already_finalized` expose
argv-backed recommendations for supersession lookup and replacement read, and
`partial_finalized` exposes an argv-backed recommendation for `supersession
write`. `command_hint`, when present, is display-only shell-quoted text derived
from the same argv. Consumers execute `argv` directly and must not parse display
strings.

`repair finalize` does not execute repair, replay actions, run recommended
commands, apply patches, use browser/native AX/canvas/live UI surfaces, start a
Workflow engine, or auto-resume agents.

The Work Record CLI adapter delegates nested command families to separate
script handlers for repair execution, attempt artifacts, replacement proposals,
and supersession indexes. The split is an adapter-maintenance boundary only; it
does not redesign unrelated AOS command routing.

`replacement-proposal build` consumes an explicit source Work Record, Repair
Attempt Plan JSON, and validated Repair Attempt Artifact JSON. It emits a
`work_record.replacement_proposal` envelope with schema version
`2026-07-work-record-replacement-proposal-v0`. The proposal includes source
Work Record identity/path/digest, Repair Attempt Plan schema/digest, Repair
Attempt Artifact schema/digest, replacement proposal identity, proposed
replacement Work Record id seed, proposed `supersedes` metadata,
carried-forward evidence refs, new evidence refs, per-postcondition evidence
mapping, omitted evidence reasons, claim provenance, verifier-before and
verifier-after health, final proposed health, source Work Record mutation check,
diagnostics, and recommended next step.

Replacement Proposals are not writers. The build and validate commands always
report `writes_replacement_record:false`, `mutates_source_record:false`,
`rewrites_historical_evidence:false`, `executes_repair:false`,
`executes_actions:false`, `applies_patches:false`, and
`automatic_replay_allowed:false`. Supersession is proposed metadata only; the
source Work Record is not edited to say it is superseded, and no replacement
Work Record exists until the Replacement Writer persists one.

Proposal statuses are `proposed`, `not_required`, `blocked_attempt_failed`,
`blocked_attempt_partial`, `blocked_missing_evidence`,
`blocked_source_mutated`, `blocked_health_mismatch`, `stale`, `mismatch`, and
`unsupported`. `proposed` requires source identity, Repair Attempt Plan
identity, Repair Attempt Artifact identity, unchanged source digest,
verifier-after health, required new evidence from the artifact, and explicit
carried-forward evidence from the source Work Record to match. Failed, partial,
cleanup-failed, rollback-failed, missing-evidence, verifier-contradicted,
mismatched-plan, wrong-source, source-mutated, and unsupported artifacts fail
closed.

`replacement-proposal write` is the Replacement Writer V0 command. It accepts a
validated `work_record.replacement_proposal` and an explicit `--output-root`;
`--output-path` is optional but must stay under that root and use the
deterministic replacement id filename. Dry-run mode reports the exact output
path, replacement id, content digest, idempotency result, source immutability
check, planned temp file, and side effects without writing. Write mode validates
the proposal, materializes the proposed replacement as a Work Record v0 shape,
checks source Work Record digest when source path/digest are present, rejects
path traversal and symlink escape, writes through a temp file plus atomic
rename, removes the temp file on success, treats identical existing content as
`already_exists`, and refuses different existing content as `blocked_conflict`.

The writer result envelope is `work_record.replacement_writer_result` with
schema version `2026-07-work-record-replacement-writer-result-v0`. Statuses are
`dry_run`, `written`, `already_exists`, `blocked_invalid_proposal`,
`blocked_invalid_replacement_record`, `blocked_source_changed`,
`blocked_output_escape`, `blocked_conflict`, `blocked_write_failed`,
`blocked_cleanup_failed`, and `unsupported`. Successful writes report
`writes_replacement_record:true`; dry-run reports
`would_write_replacement_record:true` instead. Every status reports
`mutates_source_record:false`, `rewrites_historical_evidence:false`,
`executes_repair:false`, `executes_actions:false`, `applies_patches:false`, and
`automatic_replay_allowed:false`.

Successful Replacement Writer results expose `recommended_next.argv` for
reading the written replacement Work Record. `recommended_next.command_hint` is
display-only shell-quoted text derived from that argv; execute the argv
directly instead of reparsing the display string.

The written replacement Work Record records supersession only on the replacement
record, not on the source. Its metadata links the source Work Record,
Replacement Proposal, Repair Attempt Plan, and Repair Attempt Artifact; carries
forward source evidence only through the proposal policy; includes new evidence
from the Repair Attempt Artifact/proposal; and does not claim repair execution
happened during the write. Existing `aos work-record list/read --root
<output-root>` can discover and read the resulting JSON file.

`supersession write` is the Source Supersession Index V0 writer. It accepts a
source Work Record ref, a replacement Work Record ref, and an explicit
`--index-root`; `--replacement-root` can be repeated when replacement lookup
needs an explicit root, and `--writer-result` can supply the Replacement Writer
Result JSON for stronger provenance checks. Toolkit callers can supply the same
Replacement Writer Result in memory; `repair finalize` uses that path so
standalone supersession writing and finalization share one relationship
identity model. Dry-run reports the exact index path, source identity,
replacement identity, idempotency result, planned temp file, and side effects
without writing. Write mode validates both Work Record identities, verifies
that the replacement declares supersession of the source, checks source
id/digest against Replacement Writer provenance when available, rejects
traversal and symlink escape, writes through a temp file plus atomic rename,
removes the temp file on success, treats an equivalent existing entry as
`already_exists`, and refuses conflicting source-to-replacement entries,
including same source/replacement entries with a different relationship
identity.

The index entry is `work_record.source_supersession_entry` with schema version
`2026-07-work-record-source-supersession-index-v0`. Writer statuses include
`dry_run`, `written`, `already_exists`, `conflict`,
`blocked_invalid_source`, `blocked_invalid_replacement`,
`blocked_source_changed`, `blocked_relationship_mismatch`,
`blocked_index_escape`, `blocked_write_failed`, `blocked_cleanup_failed`, and
`unsupported`. Every status reports `mutates_source_record:false`,
`mutates_replacement_record:false`, `executes_repair:false`,
`executes_actions:false`, `applies_patches:false`, and
`automatic_replay_allowed:false`.

`supersession lookup` is read-only and scans only the explicit `--index-root`.
It reports missing index data as `not_found`, malformed entry data as
`malformed_index`, conflicting active replacements as `conflict`, and active
relationships as external discovery metadata with source id/digest,
replacement id/path/digest, relationship status, and replacement readback
status. Without `--replacement-root`, lookup reports replacement readback as
`index_only`, leaves the read command hint empty, and does not claim readability
was proven. With one or more `--replacement-root` values, lookup resolves the
replacement through those roots, validates replacement id/digest against the
index entry, emits structured `recommended_next.argv` for `aos work-record
read` only when the replacement is readable, and reports
`replacement_readback.status` such as
`readable`, `not_found`, `digest_mismatch`, `id_mismatch`, or `path_mismatch`.
Root-backed readback failures return `blocked_invalid_replacement` instead of
masquerading as a fully proven active relationship. Lookup does not change
verifier health and does not claim the source Work Record was mutated. Any
`recommended_next.command_hint` is shell-quoted display text derived from the
argv; execute the argv directly instead of reparsing the display string.
`supersession validate` validates one entry file without mutating state.

`export` emits a read-only bundle manifest. It preserves evidence refs,
artifact paths, and metadata such as digest and size when available, but it does
not inline screenshots, traces, AX dumps, browser payloads, or other heavy UI
artifacts into model context.

`recipe run` supports read-only recipes, mutating canvas recipes with explicit
owned cleanup, and bounded repo-owned shell helpers for runtime/Sigil startup.
Owned resources that require cleanup, such as canvases, must be cleaned by
`finally` steps that only target resources declared by the current run. Runtime,
configuration, process, and surface ownership is reported as local live state
without pretending that every mutation has a cleanup action. Without `--json`,
successful runs emit a concise text summary.

`--json` follows the global process contract: success and dry-run success emit
JSON on stdout with exit code `0`; failure or partial cleanup emits JSON on
stderr with non-zero exit.

## `aos do`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `click` | click coordinates, saved refs, direct browser targets, or AOS canvas semantic refs |
| `hover` | saved/browser hover or coordinate hover |
| `drag` | saved/browser two-endpoint drag, direct canvas semantic drag (`--by` / `--to-value`), or native coordinate drag |
| `scroll` | saved/browser scroll with `dx,dy`, or coordinate scroll with `--dx` / `--dy` |
| `type` | saved/browser text input, direct browser target text, or literal native text input |
| `key` | saved/browser key press, direct browser target key press, or literal native key combo |
| `press` | saved native AX press or direct `--pid` / `--role` AX press |
| `set-value` | saved refs, direct AX, or AOS canvas semantic set-value |
| `focus` | saved native AX focus or direct `--pid` / `--role` AX focus |
| `raise` | raise an app/window |
| `move` | move a window |
| `resize` | resize a window |
| `tell` | AppleScript verb |
| `session` | interactive action session |
| `profiles` | inspect behavior profiles |

`click` supports four target forms:

```bash
aos do click 500,300
aos do click ref:<snapshot-id>:<ref> --workspace <id>
aos do click browser:<session>/<ref>
aos do click canvas:<canvas-id>/<ref> --state-id <id>
```

`--dwell` is a coordinate/native and AOS canvas click option. Direct browser
clicks and browser saved refs reject `--dwell`; use browser click/double/right
forms without native pointer dwell timing.

Use `ref:<snapshot-id>:<ref>` for refs returned by `aos see refs` or compact
saved capture output. `aos do <action> ref:<...> --dry-run` reports the resolved
underlying command and, for browser refs, the fresh xray current-target
validation result. Browser `snapshot_scoped` click, fill, hover, scroll, drag,
type, and key refs can dispatch only after page, frame, navigation, and element
validation pass. Saved-ref grammar rejects missing, invalid, extra, or unknown
action arguments and flags with `MISSING_ARG`, `INVALID_ARG`, `UNKNOWN_ARG`, or
`UNKNOWN_FLAG`.
Saved browser `type` and `key` are text-compatible saved-ref actions when the
producer exposes the action in `supported_actions`; they use the same current
page/frame/navigation and unique enabled element validation as browser `fill`.
Direct browser `type` and `key` remain current-host routes when the first action
argument is `browser:<session>/<ref>` or `browser:<session>`:

```bash
aos do type ref:<snapshot-id>:r2 "hello world" --workspace default --dry-run
aos do key ref:<snapshot-id>:r2 "Enter" --workspace default --dry-run
aos do type browser:<session>/<ref> "hello world" --state-id <id>
aos do key browser:<session>/<ref> "Enter" --state-id <id>
aos do type browser:<session> "hello world"
aos do key browser:<session> "cmd+s"
```

Browser focus and text assertions are not separate public actions in this
slice: `aos do focus` is native AX only, and saved workspaces do not expose
`aos see assert`. Use direct browser `click`, `fill`, `type`, or `key` where
those routes intentionally focus as part of Playwright execution, then verify
through a fresh saved capture, Recipe JSON assertions, or Work Record
postconditions.
Refs with `confidence: low` are readback-only for saved-ref mutation and fail
closed with `REF_UNSUPPORTED` and `reason: low_confidence_target` before dry-run
validation or dispatch. Non-dry-run mutation refuses unsafe resolution classes or
missing validation capability with machine-readable errors such as
`REF_STALE`, `REF_REVALIDATION_REQUIRED`,
`REF_AMBIGUOUS`, `REF_NOT_FOUND`, `ACTION_INCOMPATIBLE`,
`AGENT_WORKSPACE_STATE_CORRUPT`, or `AGENT_WORKSPACE_LOCKED`. Workspace locks
are transient local control state for fail-fast mutation contention; they are
not part of the persisted schema contract.

Use `canvas:<canvas-id>/<ref>` when a target was discovered in
`aos see capture --canvas <canvas-id> --xray`. Agents should pass
`semantic_targets[].provenance.do_target` directly when present;
`provenance.canvas_id` and `ref` remain available for structured filtering.
When the originating descriptor also has `state_id`, pass `--state-id <id>` so
the actuator can detect stale state when that check is available. The CLI
resolves the current AOS-owned canvas semantic target through the fixed probe
path, rejects missing, disabled, stale, ambiguous, suspended, noninteractive,
or unsupported segmented canvases with machine-readable errors, and then
clicks the resolved `provenance.center` in global CG coordinates. V0 preserves
historical `state_id` as correlation metadata; the descriptor contract already
defines stale-ref status so future producers can reject a stale state/ref pair
without changing target vocabulary.

Coordinate, browser-target, and canvas-ref actions accept `--state-id <id>` when
the action was chosen from a prior `aos see capture` response. Direct one-shot
responses and session responses report an additive `execution` object:

```json
{
  "execution": {
    "strategy": "cgevent_click",
    "backend": "cgevent",
    "fallback_used": false,
    "state_id": "see_abc123def456"
  }
}
```

`strategy` names the path that actually ran, `backend` identifies the actuator
family (`cgevent`, `ax`, `applescript`, `playwright`, `canvas`, or `session`), and
`fallback_used` is reserved for paths that intentionally degrade from a
preferred semantic strategy. `duration_ms` remains the top-level timing field on
session responses.

Direct AX `press`, `focus`, and `set-value --pid ... --role ...` responses also
include a top-level `conformance` block from the external wrapper. The wrapper
does not claim no-foreground safety: `conformance.no_foreground.claim` is
`not_claimed`, focus/cursor/Space preservation are `unverified`, permission
state is `unknown`, and `conformance.target_uncertainty.status` is
`direct_ax_current_matching`. If the underlying native result reports
`fallback_used` or `foreground_fallback_required`, those flags are preserved in
`conformance.no_foreground`; a foreground fallback success is still not
no-foreground proof. These direct AX actions use current pid/role/filter
matching, report `direct_ax_current_matching_semantics`, and do not satisfy the
saved-ref durable identity contract; their
`target_uncertainty.missing_identity_facts` still includes saved-ref-only facts
such as `enabled`, `action_names`, `permission_state`, and
`focus_cursor_space_baseline`, and `native_saved_ref_evidence` when the direct
call did not prove them. Their
`conformance.proof.status` is
`live_dispatch_proven_no_foreground_not_claimed` for stable native saved refs
and direct AX wrappers, while volatile or known-limit native refs still report
`approval_gated_live_proof_not_run`.
Native `focus` and `set-value` direct responses also include
`execution.ax_focused_after`, `execution.ax_value_after`, and
`execution.ax_value_matches_request` when the primitive can read the resulting
AX state.

Canvas ref click responses also include the resolved target details, including
the target dialect, canvas id, ref, local semantic-target center, global click
point, coordinate space, capture scale factor, and source
`aos_semantic_targets`. Coordinate fallback remains available for surfaces that
do not expose a semantic ref or for unsupported segmented canvases.

`set-value` and `drag` also accept current AOS canvas semantic refs:

```bash
aos do set-value canvas:<canvas-id>/<slider-ref> <value>
aos do set-value canvas:<canvas-id>/<slider-ref> --value <value>
aos do drag canvas:<canvas-id>/<drag-handle-ref> --by <dx>,<dy>
aos do drag canvas:<canvas-id>/<slider-ref> --to-value <value> --playback human
```

Playback modes are `--playback immediate`, `--playback human`, and
`--playback auto`. `auto` prefers immediate semantic execution for AOS-owned
canvas controls. Coordinate actions and `--playback human` continue to require
the input-tap preflight. Immediate canvas semantic actions resolve the current
target at action time and do not require agents to choose or pass target
coordinates.

For V0, single-thumb toolkit sliders support immediate `set-value` and
`drag --to-value` through the canvas semantic action route. Multi-thumb sliders
advertise `drag` but not single-value `set-value` unless a future thumb-specific
target exists. Toolkit panel drag handles support immediate `drag --by` by
updating the current canvas frame; `--playback human` resolves the current
target center and uses CGEvent as a visible playback implementation detail.

Target-addressed responses include the action, backend, playback mode,
`execution.strategy`, `execution.backend`, `execution.fallback_used`, the
correlation `state_id` when supplied, resolved target details, and post-action
semantic state when the target can be collected after execution. Stale
state/ref pairs report a machine-readable `stale_ref` status. Descriptor-based
reacquisition may report `reacquired` only after one current target is found
through machine facts first; same-label matches without a unique machine
fingerprint report `ambiguous` with candidates instead of selecting one.

Gesture frames and Work Recording references should carry the same descriptor
vocabulary: the state-scoped `ref`/`state_id`, durable
`target.target_id` scoped by `target.owner_namespace`, primitive `actions`,
current `state`, `provenance` for the current address, and `reacquisition`
fingerprints for repair. They should not promote labels or coordinates into
durable target identity.

For the design split between action intents, execution results, optional
gesture evidence, state patches, and Work Recording replay plans, see
[`docs/design/aos-interaction-grammar-v0.md`](../design/aos-interaction-grammar-v0.md).

## `aos graph`

Primary public verbs:

| Subcommand | Purpose |
| --- | --- |
| `displays` | enumerate displays with logical `bounds`, `visible_bounds`, scale, and main-display marker |
| `windows` | enumerate visible windows, optionally scoped to one display |
| `deepen` | expand one focus-channel subtree |
| `collapse` | collapse one focus-channel subtree |

Example:

```bash
aos graph displays
```

`displays[].visible_bounds` uses the same top-left-origin logical coordinate
space as `bounds`, but reflects the usable display area after macOS menu bar /
dock insets.

## `aos say`

Voice output surface:

```bash
aos say "Hello"
aos say --voice-slot 1 --language en --quality-tier premium,enhanced "Hello"
aos say --list-voices
```

`aos say` is a direct TTS convenience path conceptually aligned with speaking to
the human. `aos tell human ...` is daemon-routed communication; consumers that
need routed communication, session metadata, channels, or future sinks should
prefer `aos tell`.
Use `--voice <id>` to select a concrete voice id, or `--voice-slot <n>` to
select the nth currently speakable voice after any `--language`, `--gender`,
and `--quality-tier` filters are applied. `--quality-tier` accepts repeated
flags or comma-separated values. Voice slots are 1-based for human readability.
Slot selection is intentionally ordinal: if the filtered speakable voice list
changes, the same slot can resolve to a different voice. If filters produce no
speakable voices, normal CLI use fails with `VOICE_FILTER_EMPTY`.

## `aos voice`

Inspect the registry-backed session voice catalog, provider availability, live
assignments, and final-response ingress:

```bash
aos voice list [--provider <name>] [--speakable-only]
aos voice assignments
aos voice bind --session-id <id> [--voice <voice-id>]
aos voice next --session-id <id>
aos voice refresh
aos voice providers
printf '%s' "$HOOK_JSON" | aos voice final-response --harness codex --session-id <id>
```

`aos voice` is backed by a provider-pluggable `VoiceRegistry`. The default
catalog includes:

- `system` — local `NSSpeechSynthesizer` voices
- `elevenlabs` — a catalog-only stub provider used for selection, validation,
  and future remote synthesis wiring

Voice selection is intentionally simple. A session keeps its explicitly bound
voice when it has one; otherwise the daemon rotates through a filtered pool of
speakable voices using a persistent integer cursor. The filter is driven by
`voice.filter.language` (default `en`) and `voice.filter.tiers` (default
`["premium", "enhanced"]`) in `config.json`; the cursor lives in `voice/policy.json`
and advances by one on each session-start assignment. Voices are reusable across
sessions. If the filter yields zero matches, the daemon falls back to a random
allocatable voice and records a `filter_empty` voice event. Cursor-picked
restored sessions whose persisted voice is no longer in the filtered pool have
that voice dropped on daemon startup (recorded as a `restore_voice_dropped`
voice event); the next session re-register re-picks through the cursor.
Explicit `voice.bind` assignments are treated as user-pinned and survive
restore-time revalidation regardless of the current filter. There is no
reservation, lease, or promotion model.

Voice identifiers are canonical URIs of the form
`voice://<provider>/<provider_voice_id>`. Commands accept either URI form or
legacy bare ids on input; responses emit canonical URIs for descriptor `id`
while keeping `provider_voice_id` as the provider-native suffix.

`aos voice list` returns the current registry snapshot. Use `--provider` to
filter to one provider and `--speakable-only` to drop catalog-only entries that
cannot currently synthesize. Records include provider metadata, canonical `id`,
provider-native `provider_voice_id`, availability, capabilities, locale, and
quality tier.

`aos voice assignments` returns the active session-centric assignments.

`aos voice bind` stores a concrete voice for a live session. If you omit
`--voice`, it will choose a random enabled + speakable voice, optionally
filtered by simple fields such as `--provider`, `--gender`, `--tag`, `--kind`,
`--locale`, `--language`, `--region`, or `--quality-tier`. Bind failures return
one of three machine codes:

- `VOICE_NOT_FOUND`
- `VOICE_NOT_SPEAKABLE`
- `VOICE_NOT_ALLOCATABLE`

`aos voice next --session-id <id>` cycles the session's voice forward within the
filtered pool without touching the global cursor, and auditions the new voice
by speaking `"Hi, I'm <name>."` through the system speech engine. If the
session's current voice is in the filtered pool, the next pick is the neighbour
one step ahead (wrapping around); if it is not in the pool (for example because
tiers changed), the daemon advances the global cursor to pick the next
rotation voice instead. `aos voice next` returns `SESSION_NOT_FOUND` when the
session is unknown and `VOICE_NOT_FOUND` when the pool is empty.

`aos voice refresh` forces a fresh provider enumeration. `aos voice providers`
lists provider reachability, policy enablement, and voice counts.

Voice policy lives at `~/.config/aos/{mode}/voice/policy.json` and is split
into four sections:

- `providers` — per-provider enable/disable gates
- `voices.disabled` — canonical voice ids to suppress from rotation, random fallback, and filter-based selection
- `session_preferences` — durable `session_id -> voice_uri` bindings
- `voice_cursor` — integer rotation cursor advanced on each new-session assignment

`aos voice final-response` is unchanged as the daemon-owned ingress for harness
final-response events. It resolves the final assistant text, applies the
configured `final_response` speech policy, and routes speech through the
session's assigned voice while keeping daemon cancel controls active.

Voice deliveries and final-response ingress failures append local JSONL records to
`~/.config/aos/{mode}/voice-events.jsonl` so operators can inspect which session,
voice, purpose, and failure code were involved without storing full message bodies.

Docked sessions should use registered role session ids for true final-response
TTS instead of provider-transient hook ids. Dock Stop-hook notices are fixed
role-local status messages, not the assistant's final answer; route those
through `aos say --voice-slot <n> "<notice>"` rather than
`aos voice final-response`.

## `aos config`

Discoverable configuration surface:

```bash
aos config
aos config get voice.enabled
aos config get content.port --json
aos config get see.canvas_inspector_bundle --json
aos config set voice.enabled true
aos config set voice.filter.language en
aos config set voice.filter.tiers premium,enhanced
aos config set see.canvas_inspector_bundle.hotkey cmd+shift+x
aos config set see.canvas_inspector_bundle.output.mode clipboard_payload
aos config set see.canvas_inspector_bundle.include.annotation_snapshot false
```

`aos config` dumps the current runtime config as JSON. `aos config get` defaults
to shell-friendly scalar text and accepts `--json` when you want JSON output.
Discoverable config subtrees include the Surface Inspector see-bundle surface
under the `see.canvas_inspector_bundle.*` namespace, including the export
hotkey, output mode, and bundle artifact include toggles.
`see.canvas_inspector_bundle.output.mode` defaults to `bundle_path`, which writes
the temp bundle directory and copies its path to the clipboard. Set it to
`clipboard_payload` to skip the temp bundle directory and copy a JSON handoff
payload with inline metadata and explicit skipped capture-file evidence instead.
The default-on
`see.canvas_inspector_bundle.include.annotation_snapshot` toggle controls the
public `annotation-snapshot.json` artifact recorded in
`bundle.json.files.annotation_snapshot_json`. The artifact keeps the shared
display-first annotation session boundary as point-in-time evidence, including
root/scope stacks, hover preview evidence, anchors/comments, projection
stale/blocker status, and successful snapshot count; it does not persist live
annotations for later reuse. Bundle-path exports also write canonical
`context-session.json` and `context-keyframe.json` files, recorded in
`bundle.json.files.context_session_json` and
`bundle.json.files.context_keyframe_json`; clipboard-payload exports include
inline `context_session` and `context_keyframe` fields or explicit skipped
evidence. These canonical context fields are the machine-readable convergence
path for future recordings. `annotation-snapshot.json` and
`surface_inspector_annotation_snapshot` remain compatibility data until a later
removal gate confirms downstream consumers have migrated.

Sigil radial camera exports now prefer Sigil's renderer-local active context
provider when present. Reticle commits, live Selection Mode commits, and debug
compatibility adapters can all publish the latest `aos_context_session` plus an
active keyframe candidate to that provider, while `ctrl+opt+c` continues to
derive canonical Surface Inspector context inside the daemon bundle path. The
provider is not yet daemon-visible; that event/state channel is the explicit
next removal gate for making active context available to all AOS apps.

`aos set <key>
<value>` remains supported as the shorthand write form.

Failed CLI invocations now append local JSONL records to
`~/.config/aos/{mode}/cli-errors.jsonl`, which makes it easier to review
discoverability misses like unknown commands or missing arguments over time.

## `aos tell`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<audience>\|--session-id <id> [--json <payload>] [--from <name>] [--from-session-id <id>] [--purpose <name>] [<text>]` | send text or JSON to `human`, a channel, a comma-separated mix, or one canonical session id |
| `--register [<legacy-name>] [--session-id <id>] [--name <name>] [--role <role>] [--harness <harness>]` | register session presence |
| `--unregister [<legacy-name>] [--session-id <id>]` | remove session presence |
| `--who` | list online sessions |

Examples:

```bash
aos tell human "Hello"
aos tell human --from-session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --purpose final_response "Done."
aos tell handoff "task complete"
aos tell human,handoff "done"
aos tell handoff --from wiki-focus "task complete"
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for review"
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name wiki-focus --role worker --harness codex
echo 'queued update' | aos tell handoff
```

If no text args and no `--json` payload are provided, `aos tell` reads plain text from `stdin`.

For `human` delivery, `--from-session-id` lets the daemon resolve that
session's leased voice, and `--purpose final_response` applies the configured
final-response shaping policy before speaking.

`aos tell` is daemon-routed communication, not an app-control synonym for
`aos do tell`. Messages flow through the daemon coordination bus into named
channels or direct canonical-session channels. Session presence is daemon state
mirrored into `~/.config/aos/{mode}/coordination/sessions.json`; channel
messages remain daemon-owned bounded queues instead of model-context history.

Direct routing should prefer canonical session ids. Human-readable names remain
display metadata for `aos tell --who` and operator ergonomics. Presence is
lease-based and restored from the runtime snapshot after daemon restart.
Discover peers with `aos tell --who`, then keep using direct `--session-id`
routing once a peer id is known; direct session messaging does not require
`--who` to be non-empty at send time.

Docked role sessions are ordinary registered sessions. Supervisors should
register each role before launch with stable ids such as `<run-id>:gdi`,
include role and harness metadata, and unregister the session after that role
completes. This keeps `aos tell --who`, `aos voice assignments`, and docked
session status aligned around the same role session identity.

## `aos listen`

Primary public forms:

| Form | Purpose |
| --- | --- |
| `<channel>\|--session-id <id> [--since id] [--limit N]` | read recent channel or direct-session messages |
| `<channel>|--session-id <id> --follow [--since id]` | stream messages as NDJSON |
| `--channels` | list known channels |

Examples:

```bash
aos listen handoff
aos listen handoff --limit 10
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow
aos listen --channels
```

One-shot reads return a JSON envelope with a `messages` array. `--follow` emits
one message per line as NDJSON. `--channels` lists the daemon-known channel
names; it is discovery for existing daemon communication state, not a workspace
or transcript index. STT/dictation is planned as a future `aos listen` source.
Stdin ingestion is also planned as a future `aos listen` source, but the
current public surface only reads channels and direct-session messages.

## `aos wiki`

Primary public verbs for knowledge-base consumers:

| Subcommand | Purpose |
| --- | --- |
| `list` | enumerate indexed wiki entries |
| `show` | fetch one page by path or bare name |
| `graph` | emit the canonical `wiki-kb` graph payload |
| `search` | full-text search across indexed pages |
| `invoke` | invoke a workflow/plugin entry |

`aos wiki graph --json` is the canonical graph projection for KB surfaces. It returns:

- `nodes`
- `links`
- optional `raw` page bodies when `--raw` is requested
- `config` for default graph-view behavior

`nodes[].type` is the wiki graph page kind, not a Workbench Subject
`subject_type` and not arbitrary raw frontmatter. The V0 page-kind vocabulary is
`page`, `concept`, `entity`, `workflow`, and `reference`. Plugin pages under
`references/` map to `reference`.

## Auxiliary Consumer Surfaces

These are still public, but they are more specialized:

| Command | Use when |
| --- | --- |
| `aos inspect` | you want the built-in live AX overlay |
| `aos log` | you want the built-in log console overlay |
| `aos permissions` | you need low-level permission diagnostics |
| `aos doctor` | you need a fuller runtime health snapshot than `aos status` |
| `aos clean` | `aos status` reports stale resources and you want explicit cleanup |
| `aos daemon-snapshot` | you need the low-level spatial snapshot directly |
| `aos focus` / `aos graph` | you are consuming focus channels / display-window topology |
| `aos wiki` | you are consuming the local wiki/plugin system |

## Daemon Model

`aos` subcommands are normally stateless at the call site, but several surfaces rely on the daemon behind the scenes:

- persistent canvases
- perception observation
- focus channels
- content server hosting

Consumers should assume:

- `aos show`, `aos inspect`, and some graph/focus flows may talk to the daemon
- a persistent canvas outlives the creating command unless it is connection-scoped
- `aos serve` is the foreground daemon entry point
- `aos ready` is the front-door managed-daemon readiness gate
- `aos status` / `aos doctor` are observational; they should not be relied on to
  implicitly start a daemon for the current runtime

## Daemon-aware readiness

The daemon's `system.ping` response carries a structured `input_tap` block
and a `permissions` block sourced from inside the daemon process. Because
the launchd-managed daemon is a different process from the CLI, its TCC
grants can diverge from the CLI's. The fields below are the canonical view
when judging whether the daemon can actually observe and inject input.

```json
"input_tap": {
  "status": "active",        // active | retrying | unavailable
  "attempts": 1,
  "listen_access": true,     // CGPreflightListenEventAccess() in daemon
  "post_access": true,       // CGPreflightPostEventAccess() in daemon
  "last_error_at": null,     // ISO-8601 of most recent CGEventTap failure
  "panic_passthrough_active": false, // legacy name for Force Quit safety window
  "panic_passthrough_until": null,
  "panic_trigger": null,
  "panic_trigger_count": 0
},
"permissions": {
  "accessibility": true      // AXIsProcessTrusted() in daemon
}
```

Consumers:
- `aos ready [--json] [--repair] [--post-permission]` first performs a cheap
  daemon health preflight. When the managed daemon is already reachable, owned
  by the expected runtime, and reports an active input tap, `ready` exits without
  kickstarting or restarting the service and records `ready_preflight` in
  `action_trace`. If the preflight is not ready, `ready` may start the managed
  daemon, evaluates the existing readiness contract, exits `0` only when ready,
  and returns structured `phase`, `diagnosis`, `blockers`, `next_actions`, and
  `action_trace` fields for agents. Plain `ready` performs one short automatic
  daemon restart/recheck when it detects a daemon ownership mismatch or inactive
  input tap, because those states commonly appear after a human refreshes macOS
  privacy grants. Human-required Accessibility/Input Monitoring reset handoffs
  should use `./aos permissions reset-runtime --mode repo` before Settings: it
  stops the managed daemon, verifies `running=false`, then either runs a real
  targeted TCC reset for a targetable runtime identity or reports targeted reset
  unavailable for the bare repo binary. Manual Settings removal is fallback only
  if that command reports targeted reset is unavailable or failed.
  `--post-permission` is the explicit
  agent handoff check after the human has re-granted Accessibility or
  Input Monitoring access; it is bounded and reports the remaining blocker
  instead of encouraging repeated ad-hoc repair loops. `--repair` runs the
  longer safe recovery path, but stale daemon owners are cleaned before service
  start/restart and unmanaged socket owners are reported as PID/command facts
  instead of restart loops. For restartable daemon states, repair may restart,
  wait/recheck, then report plain-English human instructions when macOS privacy
  settings still require manual action. It does not open Settings or show
  permission dialogs by itself.
- `aos permissions reset-runtime [--mode repo|installed] [--allow-service-reset --emergency-ack-other-apps] [--dry-run] [--json]`
  is the preferred repo-development TCC reset transaction. It does not grant
  permissions. It stops the managed daemon first, then either resets the runtime
  identity's TCC decisions with `tccutil reset All <identifier>` or explicitly
  classifies targeted reset as unavailable for a bare repo binary that is not a
  LaunchServices app bundle. It returns next actions:
  `aos permissions setup --once` to request fresh prompts and
  `aos ready --post-permission` to verify the recovered daemon. Service-wide TCC
  reset is not part of normal recovery because it can affect other apps. It is a
  break-glass capability only: `--allow-service-reset` requires
  `--emergency-ack-other-apps` and should be used only when Michael explicitly
  asks for emergency recovery.
- When the daemon detects missing Accessibility/Input Monitoring permissions,
  its event tap must fail open and remain unavailable until daemon restart
  rather than running a background retry loop. This keeps reset/regrant recovery
  from re-enabling input capture while the human is changing macOS privacy
  grants. Non-permission tap creation failures may still report `retrying`.
- `aos permissions check --json` exposes `daemon_view`, `cli_view`,
  `ready_source`, and `disagreement` fields. `ready_for_testing` is computed
  from the daemon view when reachable and from the CLI view as fallback.
  The top-level `permissions` object is the CLI-side view and includes
  `accessibility`, `screen_recording`, `listen_access`, and `post_access`.
  The daemon-side Accessibility and Input Monitoring view remains under
  `daemon_view` / `runtime.input_tap`; daemon Screen Recording is not reported.
- `aos permissions setup --once` checks the full CLI permission set
  (Accessibility, Screen Recording, Input Monitoring listen, Input Monitoring
  post). If the CLI grant is present but the daemon reports stale or missing
  daemon-owned grants, setup returns degraded with the same reset-runtime
  guidance instead of silently declaring onboarding complete.
- The permissions onboarding marker is mode-scoped and proves the operator has
  completed the setup flow for that runtime mode. The marker's recorded
  `bundle_path` is diagnostic only: in repo mode, readiness does not fail solely
  because another worktree last wrote the marker when the current CLI grants and
  daemon input tap are verified green.
- `aos ready --json`, `aos status --json`, and `aos doctor --json` expose
  `runtime_verdict` as the shared readiness/action-plan contract:
  `ready`, `phase`, `diagnosis`, `blockers`, `blocked_capabilities`, `notes`,
  `next_actions`, `ownership`, and `cleanup`.
- When `runtime.ownership_state` is `"unmanaged"`, JSON exposes
  `runtime.owner_process` and `runtime_verdict.ownership.owner_process`.
  The process command line is either present as `command_line` or explicitly
  unavailable via `command_line_status` and
  `command_line_unavailable_reason`.
- `aos status --json` exposes `runtime.input_tap` (full block) plus the
  legacy flat `runtime.input_tap_status` / `runtime.input_tap_attempts`.
- `aos status` text mode includes `tap=<status>` in the one-line summary.
- `aos doctor --json` exposes top-level `ready_for_testing` and
  `ready_source`.
- `aos service install`, `start`, and `restart` block-and-poll for up to 5s
  after launchctl kickstart and exit non-zero with `reason: "input_tap_not_active"`
  or `"socket_unreachable"` when the daemon is not fully ready.
- `aos do click/type/...` preflight exits with `INPUT_TAP_NOT_ACTIVE` when
  the daemon is reachable but its tap is inactive.

Test entry point: `aos service _verify-readiness [--json] [--budget-ms N]`
runs the readiness probe against the running daemon and emits the same
response shape `service install/start/restart` produce. Used by
`tests/input-tap-readiness-classifier.sh`. Not advertised in user help.

Example readiness response (`service _verify-readiness --json` against a
mock daemon reporting `tap=retrying`):

```json
{
  "status": "degraded",
  "mode": "repo",
  "installed": true,
  "running": true,
  "pid": 12345,
  "launchd_label": "com.agent-os.aos.repo",
  "expected_binary_path": "/Users/.../aos",
  "actual_binary_path": "/Users/.../aos",
  "plist_path": "/Users/.../Library/LaunchAgents/com.agent-os.aos.repo.plist",
  "state_dir": "/Users/.../.config/aos/repo",
  "reason": "input_tap_not_active",
  "input_tap": {
    "status": "retrying",
    "attempts": 3,
    "listen_access": false,
    "post_access": false
  },
  "recovery": [
    "./aos service restart",
    "./aos permissions setup --once",
    "./aos serve --idle-timeout none"
  ],
  "notes": [
    "Input tap is not active (status=retrying, attempts=3). Try: ..."
  ]
}
```

When the readiness probe outcome is `.ok`, the `reason`, `recovery`, and
`input_tap.last_error_at` fields are absent (omitted from JSON via
`encodeIfPresent`). The top-level `status` may still be `"degraded"` if
the launchd-derived base state has unrelated divergences (e.g., plist
binary path mismatch); discriminate `.ok` outcomes by absence of `reason`
plus `input_tap.status == "active"`.

### Legacy daemon interop

A daemon binary that predates this contract emits only the flat
`input_tap_status` / `input_tap_attempts` fields, with no structured
`input_tap` or `permissions` block. The CLI parser falls back to those
flat fields so `status` / `attempts` still propagate. Fields the legacy
daemon doesn't expose — `input_tap.listen_access`, `input_tap.post_access`,
`input_tap.last_error_at`, and `permissions.accessibility` — are
**omitted** from CLI output rather than fabricated as `false`. Consumers
should treat their absence as "unknown, not denied."

In that mode, the source label depends on which side provides the decisive
answer:

- When the reachable legacy daemon reports `input_tap.status == "active"`,
  `aos permissions check` and `aos doctor` fall back to
  `ready_source: "cli"` because daemon accessibility is still unknown.
- When the reachable legacy daemon reports `input_tap.status != "active"`,
  `ready_for_testing` is forced to `false` and `ready_source: "daemon"`
  because the daemon-owned tap status is sufficient to fail readiness
  closed, even though daemon accessibility remains unknown.

**See also:**
- [`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md) for the canonical `system.ping` payload schema.
- [`shared/schemas/CONTRACT-GOVERNANCE.md`](../../shared/schemas/CONTRACT-GOVERNANCE.md) for the contract rules these consumers follow.

## Content Server Contract

Toolkit and app canvases are typically loaded through `aos://...` URLs backed by the content server.

Minimal setup:

```bash
aos set content.roots.toolkit packages/toolkit
```

In topic worktrees, use `scripts/aos-content-scope.sh` or a branch-aware launch
script to derive a root such as `toolkit_codex_example` instead of overwriting
canonical `toolkit`.

Then:

```bash
aos show create \
  --id surface-inspector \
  --at 200,200,320,480 \
  --interactive \
  --url 'aos://toolkit/components/surface-inspector/index.html'
```

Read-only virtual wiki graph endpoint:

- `GET /wiki/.graph`
- `GET /wiki/.graph?raw=1`

## Guidance For Consumers

- Prefer structured flags and JSON parsing over scraping help output.
- Treat `docs/api/` as the consumer contract. Use `docs/design/` for active
  design work and `docs/archive/superpowers/` only for historical context.
- If you change a public command, update this doc in the same change.

# agent-os: Runtime Substrate for Stateful Multi-Party Agent Work

> Reference note authored 2026-05-22. Captures the architectural framing that
> distinguishes agent-os from a "shell around CLIs." Intended as orientation
> material for new sessions, not a work card or spec.

---

## The Framing That Matters

agent-os is a **runtime substrate for stateful, multi-party agent work**. The
CLI inference engines (Claude Code, Codex, Gemini) are swappable processes
running inside it. The substrate provides what those processes cannot provide
for themselves: memory across sessions, typed routing between participants,
runtime observability, human escalation paths, and durable artifact
accumulation.

A shell around CLIs gives you: spawn a model, pass text, receive output. That
is a script. agent-os is the layer above that — closer to an operating system
for agent sessions, where the CLIs are processes and agent-os supplies the
process model, IPC, filesystem conventions, participant model, and signal
handling.

---

## What the Substrate Actually Provides

### Durable Typed Artifacts

Sessions are ephemeral; artifacts are not. Gate records, evidence records,
decision contracts, transfer packets, and guided user signal sessions all
survive session boundaries. This is the primary mechanism for amortizing
inference cost across sessions — a later session reads a decision contract
rather than re-deriving the same judgment from scratch. The distillation rule
(expensive diagnostic runs produce typed classifier output, not transcript
dumps) is the operational expression of this principle.

### A Typed Participant Model

The routing layer addresses multiple participant kinds symmetrically:

| Participant | Delivery channel | Interaction mode |
|---|---|---|
| `human` | `aos gate ask` / canvas / deferred continuation | Blocking gate or async resume |
| `foreman` | `agent-handoff` + clipboard | Transfer packet handoff |
| `gdi` | `agent-handoff` + clipboard | Transfer packet handoff |
| `operator` | `agent-handoff` + clipboard | Transfer packet handoff |
| External (Slack) | Gateway `InboundIntegrationMessage` | Workflow invocation |

The human is a first-class participant with a delivery channel and interaction
mode, not an implicit assumption. `aos gate ask` is the contract for
human-as-blocking-participant. Deferred continuations (`gate defer` /
`gate submit`) handle the async case: an agent ends its turn, the human
responds later, and the session resumes with a durable gate record. The
workbench TCC-reset case — where a human must physically act before a session
can continue — maps directly onto `gate ask` with a physical action gate.

The **missing wiring** as of May 2026 is that `agent-handoff` /
`dock-handoff-clipboard` and `gate ask` are separate channels with no unified
routing layer. The natural fix is for `agent-handoff --options-json` to gain a
`recipient` key that, when set to `human`, routes through `gate ask` rather
than clipboard. That would make `Participant` a real typed enum rather than an
implicit convention.

### Runtime Observability

The AFK bridge work (May 2026) is the clearest example of this distinction.
The goal is not "launch Codex" — a script can do that. The goal is "launch
Codex *and* verify that the launched session landed in the intended dock, on
the intended branch, with the intended provider." The catalog scope bug
classified on `gdi/afk-provider-session-cwd-mismatch-classification-v0`
(`provider_session_wrong_cwd`) is a runtime observability failure: the bridge
launched the session correctly but could not confirm it because the catalog
query returned the parent Operator session instead of the child GDI session.
The fix branch (`gdi/afk-bridge-catalog-scope-correction-v0`) corrects that
scope.

### Healable, Recoverable Workflows

The browser control surface, workbench checkpoint scripts, and guided user
signal sessions exist because stateful multi-step work fails in the middle.
Recovery requires knowing where in the workflow failure occurred and what
partial state is durable. This is not a feature of any single CLI; it is a
substrate responsibility.

### Token Economics as a First-Class Constraint

Transfer packets are thin by design. Dock profiles carry stable context so
relay sessions do not rediscover it. Decision contracts cache expensive
judgment. The `durable-agent-cognition-v0` doc formalizes this. A shell around
CLIs has no concept of token economics across session boundaries; the substrate
enforces it structurally.

---

## The Handoff Layer: Current Gap

The three-layer handoff stack as of May 2026:

```
.docks/foreman/scripts/handoff        ← foreman-specific wrapper, hardcoded dock allow-list
         ↓ delegates to
scripts/dock-handoff-clipboard        ← strips legacy /goal prefix, bakes options_json
         ↓ delegates to
scripts/agent-handoff                 ← the real primitive: clipboard + chat block, --options-json
```

`scripts/agent-handoff` is already close to the right generic primitive: it
accepts `--options-json` with overrideable gates, timestamp flag, and
post-instructions string. The gaps are:

1. No `recipient` field in `--options-json`, so `Participant` routing is not
   expressed at the handoff layer.
2. No placeholder interpolation — `--text` is treated as a raw payload. An
   interpolation model (e.g. `{{recipient}}`, `{{artifact_path}}`,
   `{{timestamp}}`) in both the payload and a `--header-template` would let
   callers produce bespoke chat-visible shapes without writing wrapper scripts.
3. The dock-specific wrapper bakes `options_json` rather than composing it,
   which means format memory is required of callers rather than defaults
   providing it.

The immediate fix the Foreman identified — adding `Recipient: <dock>` to the
printed block — is correct in intent. The right location is
`agent-handoff --options-json` gaining a `recipient` key, not a new format
baked into `dock-handoff-clipboard`. That preserves the invariant that
`agent-handoff` owns the entire chat-visible shape and the clipboard contains
only the raw transfer payload.

This work is also directly relevant to the AFK session trigger primitive under
construction: the trigger will need to construct and deliver a transfer packet
programmatically. If `agent-handoff` supports `recipient` and placeholder
interpolation, the AFK trigger can call it the same way a human-relay Foreman
does.

---

## Where the AFK Work Fits

The AFK bridge workstream is building the async half of the participant model.
The Slack gateway already handles inbound message receipt. The AFK bridge adds:

1. **Session trigger / scheduler** — fire a docked session from outside (cron,
   Slack message, sibling session completing) without a human in the relay.
   `aos session trigger --dock <dock> --packet <transfer>` is the proposed CLI
   surface. The `workbench-human-checkpoint-*` scripts are the sync, human-relay
   version of the same pattern; the new primitive makes that loop async.

2. **Async result routing** — a background session, when complete, delivers
   its output to a work record, a Slack thread (via the gateway), or a pending
   Foreman inbox without blocking the parent and without a human as message
   courier.

These two primitives, combined with the existing gate/continuation model for
human participants, close the loop on the participant model: any participant —
human, docked agent, or external integration — can be a sender or recipient in
a typed, auditable, recoverable workflow.

---

## What agent-os Is Not

- Not a model wrapper or SDK abstraction layer
- Not a prompt management system
- Not a shell script collection with CI glue
- Not a vendor-specific automation harness

The CLIs are interchangeable inference engines. The substrate is
provider-neutral by design: dock profiles, transfer packets, gate records, and
artifact schemas carry no provider-specific assumptions. The provider is a
runtime argument; the participant model, routing layer, and artifact schema are
substrate invariants.

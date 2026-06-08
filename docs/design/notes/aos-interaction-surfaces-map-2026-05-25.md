# AOS Interaction Surfaces Map

## Why This Exists

AOS currently has several surfaces that all feel like "communication" or
"user interaction":

- `aos say`
- `aos tell`
- `aos listen`
- `aos gate`
- guided user-signal sessions
- Gateway user-signal tools
- Agent Terminal dock PTY input
- AFK launch/session-trigger receipts

They are not one coherent interaction layer yet. They are adjacent primitives
that grew around different jobs. This note records the current boundary so new
work can converge them instead of adding another parallel path.

## Current Boundary

| Surface | Current job | Owner shape | Not this |
| --- | --- | --- | --- |
| `aos say` | Speak text aloud | AOS voice/TTS convenience path | Not a session bus or PTY input path |
| `aos tell` | Send messages to human, channels, or canonical sessions | Daemon-routed communication and presence | Not structured decision capture |
| `aos listen` | Read or follow channel/session messages | Daemon-routed communication readback | Not provider transcript readback |
| `aos gate ask` | Blocking structured human decision | AOS gate request/record contract | Not free-form chat or provider input |
| `aos gate defer/submit` | Deferred human decision and resume event | AOS continuation/resume record contract | Not auto-resume execution in V0 |
| Guided user-signal | Visual "show me what you mean" sessions | Toolkit/runtime records plus gate submit bridge | Not a separate agent-facing contract |
| Gateway user-signal | MCP adapter to human gate | Thin shell to `./aos gate ask` | Not owner of deadlines, sessions, or state |
| Agent Terminal dock PTY | Provider CLI terminal substrate | Dock terminal session / PTY path | Not currently first-class `./aos` input |
| AFK `aos dev afk-*` | Experimental deterministic AFK receipts and guarded launch attempts | Repo dev prototype commands | Not final runtime scheduler/session authority |

## The Confusing Part

There are two overlapping axes:

1. **Who is being addressed?**
   - human/user
   - agent session
   - dock role session
   - provider CLI session
   - Gateway/integration job

2. **What kind of interaction is happening?**
   - voice output
   - message delivery
   - structured decision
   - visual annotation/guidance
   - PTY text/key injection
   - AFK authorization/receipt/result route

The current command names mix these axes. For example, `aos tell human` and
`aos gate ask` both target the human, but one is message delivery and one is a
decision record. Agent Terminal and AFK both touch provider sessions, but one
observes/drives a terminal while the other records an authorized launch attempt.

## Current Gap

There is no clean AOS command for targeted dock/provider terminal input.

Today, hook code reaches the PTY path through:

- `legacy provider input helper`
- `legacy PTY input helper`
- `legacy prompt pause helper`

That helper can use the Agent Terminal bridge or tmux fallback, but it is still
harness-owned plumbing. It is not exposed as a typed AOS surface like `aos tell`,
`aos gate`, or `aos show`.

This is why live orchestration feels like it leaks implementation details: AFK
and hooks need "send this provider-native prompt to Implementer", but the only direct
tool is below the AOS control plane.

## Desired Direction

Keep Gateway thin and keep AOS as the authority for local sessions, human
signals, and dock terminal resources.

The likely convergence target is an addressable interaction/session model:

- stable entities: `human`, canonical agent sessions, dock terminal sessions,
  provider sessions, and integration jobs;
- stable interaction kinds: `message`, `decision`, `voice`, `guided_signal`,
  `terminal_input`, and `result_route`;
- typed AOS commands for each mutating local primitive;
- Gateway as ingress/egress adapter, not the owner of session state.

## Candidate Next Slice

Add an AOS-owned dock terminal input surface before routing more live AFK or
hook behavior through private PTY helpers.

Possible spelling:

```bash
./aos dock input --dock implementer --text "..." --submit
./aos dock key --dock implementer Enter
```

or, if the session identity model is ready:

```bash
./aos session input --session-id <dock-terminal-session-id> --text "..." --submit
./aos session key --session-id <dock-terminal-session-id> Enter
```

The command should consume the dock terminal session registry/receipt contract,
delegate to the existing PTY input implementation internally, and emit a
machine-readable input receipt. Hooks and AFK should call that AOS command
instead of invoking `legacy PTY input helper` directly.

## Source Pointers

- `docs/design/user-signal-surface.md`
- `docs/design/dock-terminal-session-agent-terminal-contract-v0.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/api/aos.md`
- `legacy PTY input helper`
- `legacy prompt pause helper`
- `scripts/lib/dock-terminal-session-registry.mjs`

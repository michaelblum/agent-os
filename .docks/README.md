# Docks

A dock is a named runtime launch envelope for an AOS agent session. A dock owns
its launch root, local `AGENTS.md`, hook/config posture, voice/stop behavior,
and profile binding. It is not an agent definition and not a work assignment.

`.docks/foreman/` is the only current named dock. It is the Codex launch
directory for the main Foreman session. Foreman is the liaison and coordinator
for AOS-owned agent execution. Native Codex custom agents are disabled for
agent-os; role material is consumed through `./aos dev agents`.

`.docks/profiles/` is the shared operating-context model. It selects the active
session doctrine that Foreman announces at startup and passes, in bounded
extracts, to AOS-owned child runs. Docks are runtime shells; profiles are operating
doctrine. Capability routes are path/tool/test routing mechanics, not identity
or ethos.

Future docks are allowed when they define their own runtime envelope and current
authority. Older `.docks/gdi/` and
`.docks/operator/` references predate the current dock metaphor and are
historical only. GDI is superseded by Implementer, and Implementer is not
centered on Codex `/goal`. The old goal-command, transfer-contract,
clipboard-dispatch, separate terminal handoff machinery, and native Codex
custom-agent dispatch are all retired for routine project-agent execution.

Agent definitions are not stored here:

- Provider-neutral source material lives under `ai-agents/`.
- Codex-shaped role material lives under `ai-agents/providers/codex/`.
- `.docks/foreman/.codex/config.toml` is only the Foreman launch config.

The remaining Foreman hooks provide guardrails and TTS for Foreman lifecycle
events and fail closed if a native custom-agent tool appears. They do not
dispatch agents; execution belongs to `./aos dev agents`.

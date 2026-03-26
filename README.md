# agent-os

Ecosystem-level documentation and shared contracts for the agent automation CLI suite.

This repo is the "constitution" — it holds architectural decisions, shared schemas, and cross-cutting specs that no single tool repo should own.

## The Ecosystem

| Tool | Role | Status |
|------|------|--------|
| [`side-eye`](https://github.com/michaelblum/side-eye) | OS perception (screenshots, AX tree) | Production |
| `hand-off` | OS action (mouse, keyboard via CGEvent) | Planned |
| `heads-up` | OS projection (floating overlays, avatar) | Planned |
| `speak-up` | Audio I/O (TTS, STT, dictation) | Planned |
| [`chrome-harness`](https://github.com/michaelblum/syborg/tree/main/tools/chrome-harness) | Chrome lifecycle & CDP broker | Production |
| `pw-bridge` | Playwright over CDP stdin protocol | Production |
| `tear-sheet` | Web artifact extraction & packaging | Planned |
| [Syborg Studio](https://github.com/michaelblum/syborg) | Chrome extension control surface | Production |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full blueprint.

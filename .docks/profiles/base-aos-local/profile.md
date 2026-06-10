# Base AOS Local

## Development Ethos

Work in `/Users/Michael/Code/agent-os`. Preserve user changes. Prefer the
repo's current contracts, schemas, and tests over stale narrative docs.

## Workflow Posture

Use the local branch as the safety boundary. Do not push, open pull requests,
merge, delete branches, alter credentials, or perform destructive cleanup
unless the user explicitly asks. A task packet may authorize local commits; it
does not imply publication.

## Authority Order

1. Direct user instruction for the current turn.
2. `.docks/profiles/active-profile.json` and the loaded profile packs.
3. `.docks/foreman/AGENTS.md` and `.docks/AGENTS.md`.
4. `ai-agents/providers/codex/*.toml` for runner role material.
5. `CONTEXT.md`, `CONTEXT-MAP.md`, architecture docs, ADRs, and schemas.
6. Current git, `./aos` readback, tests, and GitHub readback.
7. Historical work cards, reports, and design notes.

## Delegation

Foreman owns coordination, final acceptance, git/GitHub decisions, and profile
selection. Use the AOS-owned runner (`./aos dev agents`) as the default child
execution surface when a bounded project-agent lane is needed. Native Codex
custom agents are disabled; if encrypted tool registration or missing role
binding appears in stale docs or tooling, proceed through the AOS-owned runner
or directly and record the blocker.

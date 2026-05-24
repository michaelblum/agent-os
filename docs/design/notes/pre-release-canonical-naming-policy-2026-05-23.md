# Pre-Release Canonical Naming Policy

**Date:** 2026-05-23
**Status:** active coordination note

## Rule

Clean canonical names win unless a break would block current development today.

Agent OS is pre-release, showcase-driven, and has no external production
consumer base. Owned repo callers, tests, and current docs should migrate to the
canonical contract immediately when a name is wrong or obsolete. Broad invisible
alias layers create fake obligations, ambiguous ownership, and future cleanup
work that is unlikely to happen.

## Defaults

- Rename active code, tests, and current docs now.
- Delete obsolete env names now.
- Keep path shims only when they reduce immediate friction and are clearly
  marked as historical.
- Do not preserve invisible aliases "just in case."
- Do not spend large cleanup effort rewriting old receipt evidence unless it
  teaches the wrong active contract.
- Add tests that prevent obsolete names from re-entering active code.

## Compatibility Gate

Compatibility aliases require a concrete non-updatable consumer and an explicit
removal gate. Existing repo callers, tests, and docs are owned; they should be
migrated, not protected by aliases.

Historical file or path entrypoints can remain when they are real operator
friction reducers. They should delegate to canonical implementation files and
must not carry broad env, API, or naming aliases by default.

## Agent Terminal Application

For the toolkit Agent Terminal bridge, `AGENT_TERMINAL_*` is the canonical env
contract. `SIGIL_AGENT_*` and `SIGIL_CODEX_*` belonged to old ownership layers
and should not remain as broad bridge env aliases.

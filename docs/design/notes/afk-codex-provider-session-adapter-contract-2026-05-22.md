# AFK Codex Provider Session Adapter Contract

**Date:** 2026-05-22
**Status:** docs-only adapter contract inventory

## Summary

AFK launch correlation needs a repo-owned Codex provider-session adapter that can
connect launch-side provider ids, cwd/time windows, and bridge visibility facts
to local Codex threads without treating ad hoc skill behavior as the contract.

The local `codex-thread-workbench` skill is a useful reference
implementation. It already exposes deterministic utilities for resolving a
Codex thread id, listing threads by project path, returning thread metadata,
and emitting a `codex://threads/<thread_id>` deeplink. Those capabilities should
inform the repo contract, but the repo should not copy, vendor, or import the
skill scripts. The adapter boundary should live in agent-os and read local
Codex state through explicit, fixture-testable inputs.

No real Codex threads, transcripts, provider config, gateway state, dock
profiles, hooks, GitHub state, or provider sessions were mutated for this note.

## Workbench Capabilities Observed

Observed from `codex-thread-workbench` help and source inspection only:

| Capability | Current command | Observed input | Observed output shape | Contract use |
| --- | --- | --- | --- | --- |
| Resolve session/thread id | `resolve-session-id` | `--session-id <id-or-prefix>`, optional `--codex-home`, optional `--json` | One metadata payload: `thread_id`, `title`, `cwd`, `normalized_cwd`, `pinned`, `archived`, `timestamp`, `deeplink`, workspace activity/saved/label flags | Reference for `resolveProviderSessionId`. |
| List project threads | `list-project-threads` | `--project <path>`, optional `--codex-home`, optional `--json` | Project metadata plus sorted `threads[]` with the same thread payload fields | Reference for project/cwd candidate enumeration. |
| Inspect one thread | `get-thread-info` | `--thread <id-or-prefix>`, optional `--codex-home`, optional `--json` | One metadata payload with deeplink and workspace state | Reference for thread metadata inspection. |
| Emit stable local reference | `emit-deeplink` | `--thread <id-or-prefix>`, optional `--codex-home`, optional `--json` | `codex://threads/<thread_id>` or JSON containing `thread_id` and `deeplink` | Reference for local evidence refs and operator handoff links. |
| Open thread | `open-thread` | `--thread <id-or-prefix>`, optional `--codex-home`, optional `--json`, optional `--dry-run` | Dry-run emits `["open", deeplink]`; non-dry-run invokes the OS handler | Non-contract interactive action; repo adapter should emit refs, not open UI. |

The same workbench also exposes search, drill, aggregate, and hygiene commands
as non-contract reference capabilities:

- `search` delegates to the lower-level insights script for candidate thread
  discovery across title, cwd, and optionally message text.
- `drill` extracts focused snippets from one selected thread.
- `aggregate` builds synthesis artifacts.
- `hygiene` produces safe cleanup recommendations.

Those commands are useful for humans and research rounds. They should stay
outside the launch-correlation contract because they can scan message bodies,
create output artifacts, or recommend cleanup actions that are unnecessary for
deterministic AFK launch matching.

## Source Inventory

The workbench utility commands load the
`codex-thread-insights` implementation and call `build_thread_index(codex_home)`.
That lower-level indexer:

- reads `codex_home/.codex-global-state.json` for thread titles, order, pinned
  ids, active workspace roots, saved workspace roots, and workspace labels;
- discovers `*.jsonl` files under `codex_home/sessions` and
  `codex_home/archived_sessions`;
- extracts the first `session_meta` payload with thread id, timestamp, and cwd;
- falls back to the thread id in the rollout filename when possible;
- derives a fallback title from the first non-scaffold user message when needed;
- sorts records by UI order, timestamp, and id.

This is broader than AFK launch correlation needs. The repo adapter should make
metadata-only operation explicit, should not need message text for normal
correlation, and should accept a fixture root so tests never depend on the
user's real `~/.codex`.

## Proposed Repo-Owned Interface

The adapter should be Codex-first and provider-session oriented. Suggested
TypeScript names are below, but the contract is about behavior, not file names.

```ts
type CodexThreadRef = {
  provider: 'codex';
  thread_id: string;
  cwd: string;
  normalized_cwd: string;
  title: string | 'not_observed';
  timestamp: string;
  archived: boolean;
  source_ref: string;
  deeplink: string;
};

type CodexAdapterEvidenceRef = {
  kind:
    | 'codex_global_state'
    | 'codex_session_meta'
    | 'codex_rollout_file'
    | 'codex_deeplink'
    | 'bridge_visibility'
    | 'catalog_record'
    | 'fixture';
  ref: string;
  observed_at?: string;
};
```

### `listCandidateThreads(input)`

Inputs:

- `projectPath` or `cwd`: absolute or repo-relative path to match against
  Codex `session_meta.cwd`;
- optional `codexHome`: defaults to `~/.codex`, but tests must pass a fixture
  root;
- optional `includeArchived`: default true for parity with existing catalog
  behavior;
- optional `timeWindow`: `{ after?: iso, before?: iso }`;
- optional `limit`.

Outputs:

- `status: 'ok' | 'codex_home_not_found' | 'metadata_unreadable'`;
- sorted `threads: CodexThreadRef[]`;
- `evidence_refs` for global state and session metadata files consulted;
- `diagnostics[]` for malformed metadata lines or skipped incomplete records.

Failure states:

- `codex_home_not_found`: adapter root is missing;
- `project_path_invalid`: cwd cannot be resolved;
- `metadata_unreadable`: metadata root exists but cannot be read;
- `partial_index`: some files were skipped, but usable candidates remain.

### `getThreadInfo(input)`

Inputs:

- `threadIdOrPrefix`;
- optional `codexHome`;
- optional `includeWorkspaceState`.

Outputs:

- `status: 'ok' | 'not_found' | 'ambiguous' | 'metadata_unreadable'`;
- `thread?: CodexThreadRef`;
- `matches?: CodexThreadRef[]` for ambiguous prefixes;
- `evidence_refs`.

Failure states:

- `not_found`: no thread id or prefix match;
- `ambiguous`: prefix resolves to multiple ids;
- `metadata_unreadable`: root/index cannot be read.

### `resolveProviderSessionId(input)`

Codex provider session ids and thread ids are currently the same practical key
for local rollout metadata. This method should still use provider-session
language so AFK launch code does not depend on Codex UI naming.

Inputs:

- `providerSessionId`;
- optional `codexHome`.

Outputs:

- `status: 'ok' | 'not_found' | 'ambiguous' | 'metadata_unreadable'`;
- `provider_session_id`;
- `thread?: CodexThreadRef`;
- `evidence_refs`.

Failure states mirror `getThreadInfo`.

### `correlateLaunch(input)`

Inputs:

- `providerSessionId?: string | 'not_observed'`;
- `projectPath` or `intendedCwd`;
- optional `timeWindow` from launch attempt created/observed timestamps;
- optional `bridgeVisibility` fields:
  - `selected_provider`;
  - `command_argv`;
  - `terminal_substrate.driver`;
  - `terminal_substrate.session_handle`;
  - `provider_acceptance.provider_session_id`;
  - `provider_acceptance.provider_reported_cwd`;
  - `provider_acceptance.provider_reported_branch`;
  - `provider_acceptance.provider_reported_head`;
  - `provider_acceptance.provider_version`;
  - `provider_acceptance.model`;
- optional `catalogRecordRefs` from `packages/host/src/session-catalog.ts`;
- optional `codexHome`.

Outputs:

- `status`:
  - `matched_by_provider_session_id`;
  - `matched_by_cwd_time_window`;
  - `multiple_candidates`;
  - `not_observed`;
  - `wrong_cwd`;
  - `metadata_unreadable`;
- `thread?: CodexThreadRef`;
- `candidate_threads: CodexThreadRef[]`;
- `confidence: 'exact' | 'strong' | 'weak' | 'none'`;
- `evidence_refs`;
- `mismatches[]`.

Failure and mismatch states:

- `provider_session_id_not_observed`: launch has terminal substrate but no
  provider id;
- `catalog_record_not_observed`: no catalog-visible record yet;
- `wrong_cwd`: resolved thread cwd differs from intended cwd;
- `outside_time_window`: provider id or cwd candidate exists but is stale;
- `multiple_candidates`: cwd/time matching cannot select exactly one thread;
- `metadata_unreadable`: local Codex metadata cannot be read.

### `emitThreadReference(input)`

Inputs:

- `threadIdOrPrefix`;
- optional `codexHome`;
- `format: 'deeplink' | 'local-ref' | 'json'`.

Outputs:

- `status: 'ok' | 'not_found' | 'ambiguous'`;
- `thread_id`;
- `deeplink: codex://threads/<thread_id>`;
- `local_ref`, for example
  `codex-thread:<thread_id>` or a repo evidence object containing the deeplink;
- `evidence_refs`.

The adapter should not perform the equivalent of `open-thread`. Opening a
Codex Desktop deeplink is an interactive/UI action for a human or Operator, not
a deterministic AFK correlation primitive.

## Bridge Visibility Fixture Connection

The accepted bridge visibility fixture already records launch-side fields that
can feed the adapter without launching a provider:

- `selection.selected_provider` or command-derived provider such as `codex`;
- `launch_intent.intended_launch_cwd`;
- `launch_intent.command_argv`;
- `terminal_substrate.status`, driver, session handle, cwd, command, and
  snapshot reference;
- `provider_acceptance.status`;
- `provider_acceptance.provider_session_id`;
- provider-reported cwd, branch, head, version, and model when parseable.

The adapter should consume those fields in this order:

1. If `provider_acceptance.provider_session_id` is a real id, call
   `resolveProviderSessionId` and classify an exact match only if the resolved
   thread cwd matches the intended launch cwd.
2. If the provider id is `not_observed`, return
   `provider_session_id_not_observed` while preserving terminal-substrate
   evidence refs and any provider-reported cwd/branch/head/model facts.
3. If no id exists but a launch time window and intended cwd exist, call
   `listCandidateThreads` and classify a single current cwd candidate as a weak
   or strong time-window correlation, never as an exact match.
4. If catalog fixture records are present, use matching catalog `session_id`,
   `cwd`, `updated_at`, `source_file`, and `resume_command` as corroborating
   evidence, not as a replacement for provider id or Codex thread metadata.
5. If all-cwd catalog candidates exist outside the requested cwd, preserve them
   as unrelated context and do not bind them to the launch.

The launch-attempt record can then carry:

- `provider_acceptance.provider_session_id`;
- `catalog.matched_session_id`;
- `catalog.catalog_record_refs`;
- `evidence.observed_refs` including `codex://threads/<thread_id>` or
  `codex-thread:<thread_id>`;
- mismatch codes such as `provider_session_id_not_observed`,
  `catalog_match_not_observed`, `multiple_candidates`, or `wrong_cwd`.

## Placement

`packages/host` should own the reusable read-only adapter implementation,
adjacent to `session-catalog.ts`, because it already owns local provider-session
cataloging and telemetry parsing. A candidate module name is
`packages/host/src/codex-thread-adapter.ts` or
`packages/host/src/provider/codex-session-adapter.ts`.

`scripts/` may own deterministic prototypes and fixture-driven CLI probes while
the AFK record shape is still experimental. Scripts should import the repo
adapter, not reach directly into `~/.codex` with private parsing logic once the
adapter exists.

A future `./aos dev` surface can wrap the adapter for developer diagnostics,
for example:

```bash
./aos dev provider-sessions codex resolve --session-id <id> --json
./aos dev provider-sessions codex list --cwd .docks/gdi --json
./aos dev afk correlate-codex-launch --fixture <path> --json
```

That command surface should remain diagnostic and local. It should not open
Codex Desktop, launch providers, delete provider files, or perform hygiene.

Outside the repo:

- `codex-thread-workbench` can remain a personal skill for broad search,
  drilldown, aggregation, and cleanup recommendation workflows.
- `codex-thread-insights` can remain the personal extraction engine.
- Message-body search and synthesis should not become required for AFK launch
  correlation.

## Privacy And Local-State Boundaries

The adapter may read local Codex metadata only under an explicit `codexHome`
root, defaulting to `~/.codex` for local diagnostics. Tests must pass a fixture
root.

Normal launch correlation should be metadata-first:

- permitted: `.codex-global-state.json` workspace/thread metadata;
- permitted: early JSONL `session_meta` records needed for id, cwd, timestamp,
  and optional git branch;
- permitted: file paths and mtimes as evidence refs when surfaced locally;
- avoided by default: user/assistant message bodies;
- forbidden for deterministic tests: real user `~/.codex` state;
- forbidden for the adapter: deleting, moving, rewriting, archiving, or opening
  provider files or Codex UI.

If a future diagnostic mode needs message text, it should be opt-in, named as
diagnostic, excluded from AFK unattended launch correlation, and should report
that transcript content was read.

## Deterministic Fixture And Test Strategy

Add fixtures under a repo test fixture directory, not under the user's home
directory. A minimal Codex fixture root should contain:

- `.codex-global-state.json` with stable titles, order, pinned ids, workspace
  roots, saved roots, and labels;
- `sessions/.../rollout-<thread-id>.jsonl` files with early `session_meta`
  records for current, stale, wrong-cwd, archived, malformed, and duplicate
  cases;
- optional `archived_sessions/...` records to prove archived inclusion policy;
- bridge visibility fixture JSON matching
  `scripts/afk-launch-attempt-prototype.mjs` accepted launch-side fields.

Focused tests should cover:

- resolving an exact provider session id to a thread;
- resolving a unique prefix;
- reporting ambiguous prefixes;
- listing project threads by normalized cwd;
- filtering candidates by launch time window;
- correlating by provider session id plus cwd;
- refusing to bind wrong-cwd provider ids;
- preserving `provider_session_id_not_observed` when bridge visibility lacks an
  id;
- returning multiple candidates instead of guessing;
- emitting a stable deeplink/local ref;
- proving no test reads real `~/.codex`.

These tests should use plain fixture files and should not launch Codex, Claude,
Gemini, Sigil, the gateway, or the AOS daemon.

## Non-Goals

- No provider launch, resume, or UI opening.
- No broad real-thread search.
- No transcript/message-body reads for unattended launch correlation.
- No provider config mutation.
- No cleanup, archive, move, or delete behavior.
- No gateway, broker, scheduler, result-route, or GitHub mutation.
- No schema commitment in this docs-only slice.
- No promotion of personal skill scripts into the repo.
- No claim that catalog or telemetry exists before provider-owned metadata is
  observed.

## Later Claude Code Generalization

Claude Code should become a separate adapter with the same high-level contract:
list candidates for cwd/time, inspect one session, resolve provider session id,
correlate launch evidence, and emit a stable local reference. It should not be
forced through Codex thread names or `codex://` deeplinks.

The provider-neutral AFK layer should depend on common result states such as
`matched_by_provider_session_id`, `multiple_candidates`, `wrong_cwd`, and
`not_observed`. Provider-specific adapters should own source layout, metadata
parsing, resume/deeplink/reference shape, and privacy boundaries.

## Recommended Next GDI Slice

Implement the Codex metadata adapter behind fixture-only tests:

- add a small read-only module under `packages/host` that indexes a supplied
  Codex fixture root and exposes `listCandidateThreads`, `getThreadInfo`,
  `resolveProviderSessionId`, `correlateLaunch`, and `emitThreadReference`;
- add fixtures with synthetic `.codex-global-state.json` and rollout JSONL
  files;
- add focused tests proving exact id, prefix, project cwd, time-window,
  wrong-cwd, ambiguous, not-observed, and deeplink behavior;
- keep `scripts/afk-launch-attempt-prototype.mjs` unchanged unless the adapter
  integration itself is explicitly assigned in a later work card.

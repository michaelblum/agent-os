# Manual AFK Receipt: live bridge current-launch correlation GDI wrong cwd

receipt_bundle_id: manual-afk-2026-05-22-live-bridge-current-launch-correlation-gdi
status: failed_wrong_cwd
created_at: 2026-05-22
updated_at: 2026-05-22
source: Operator completion report in Foreman coordination thread

This receipt records the supervised live bridge current-launch correlation
smoke after fixture-backed current-launch catalog classification was accepted.
It is a manual receipt bundle, not a schema, generated artifact, provider
transcript, or source-backed work/evidence record.

## Transfer Receipt

- packet_id_or_ref: Operator packet,
  `AFK Live Bridge Current-Launch Correlation Smoke`
- source_artifact:
  `docs/design/work-cards/afk-bridge-current-launch-observability-correction-v0.md`
- requested_recipient: `operator`
- branch: `gdi/afk-bridge-current-launch-observability-correction-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- required_start_ref_sha:
  `72fb1cfa6351b48ec37a542f48144ab2133f27ba`
- external_publication_policy: no GitHub mutation, no push, no PR, no
  provider-visible publication route
- result_route: Foreman chat report only
- stop_conditions: TCC/input-tap blocker, provider auth/install/credential
  prompt, wrong cwd/repo/branch/head, dirty repo before launch, provider
  mutation attempt, bridge conflict not quickly resolvable, external
  publication or credential prompt

## Scheduler Receipt

- scheduler_run_id:
  `manual-operator-afk-live-bridge-current-launch-correlation-smoke`
- intake_decision: accepted
- selected_action: deterministic preflight followed by supervised live
  bridge-backed Codex launch and classifier run against live catalog payload
- idempotence_key:
  `manual-afk-live-bridge-current-launch:gdi:codex:72fb1cfa`
- lease: current supervised Operator run
- heartbeat_expectation: manual report only
- lifecycle_state_transitions:
  - queued
  - accepted
  - deterministic_preflight_completed
  - bridge_started
  - provider_session_visibly_started
  - provider_session_wrong_cwd_observed
  - catalog_current_launch_not_observed_for_requested_cwd
  - telemetry_current_launch_not_observed_for_requested_cwd
  - failed_wrong_cwd
- duplicate_or_superseded: false
- route_update_attempts: none; Foreman received chat evidence

## Dispatch Receipt

- deterministic_preflight:
  - `git status --short --branch`: clean on
    `gdi/afk-bridge-current-launch-observability-correction-v0`
  - `git rev-parse HEAD docs/durable-agent-cognition-v0`: both
    `72fb1cfa6351b48ec37a542f48144ab2133f27ba`
  - `./aos ready`: `ready=true mode=repo daemon=reachable tap=active`
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`: 10/10 pass
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`: 1/1 pass
- bridge_command:
  `SIGIL_AGENT_TERMINAL_PORT=17863 SIGIL_AGENT_TMUX_SESSION=afk-provider-correlation SIGIL_AGENT_CWD=/Users/Michael/Code/agent-os/.docks/gdi SIGIL_AGENT_COMMAND='codex --no-alt-screen' SIGIL_AGENT_TERMINAL_DRIVER=process node apps/sigil/codex-terminal/server.mjs`
- bridge_command_note: historical evidence only; current bridge env uses the
  canonical `AGENT_TERMINAL_*` contract.
- bridge_port: `17863`
- bridge_health: succeeded during the run
- bridge_ensure:
  - ok: true
  - session: `afk-provider-correlation`
  - created: true
  - driver: `process`
- launch_observed_at: `2026-05-22T13:26:14Z`
- no_op_input: accepted through `/input`
- selected_provider: `codex`
- selected_dock: `gdi`
- intended_launch_cwd: `/Users/Michael/Code/agent-os/.docks/gdi`
- provider_session_id: `019e4fdc-7236-7db0-9f77-29f8f4108b3f`
- provider_session_meta_cwd: `/Users/Michael/Code/agent-os/.docks/operator`
- provider_version: `codex-cli 0.132.0`
- provider_permission_mode: not_observed
- provider_visible_title:
  - cwd: `.docks/gdi`
  - branch: `gdi/afk-bridge-current-launch...`
  - model: `gpt-5.5`
- no_op_prompt_result: no provider response containing cwd, branch, HEAD, or
  status was visible in `/snapshot`
- session_inspector_result: not collected because the bridge was stopped before
  the inspector probe

## Catalog And Telemetry Evidence

- gdi_sessions_filter:
  `/sessions?cwd=/Users/Michael/Code/agent-os/.docks/gdi&provider=codex`
- matching_records: 306
- newest_gdi_matching_session:
  `019e4fd2-79eb-7811-9545-6ad51b31b5f0`
- newest_gdi_updated_at: `2026-05-22T13:18:47.805Z`
- current_relative_to_launch_observed_at: false
- current_count: 0
- classifier_ran_without_provider_session_id: true
- classifier_catalog_status: `catalog_current_launch_not_observed`
- classifier_catalog_match_count: 0
- classifier_matched_session_id: `not_observed`
- classifier_telemetry_status: `telemetry_current_launch_not_observed`
- classifier_telemetry_event_refs: `not_observed`
- classifier_mismatch_codes:
  - `catalog_current_launch_not_observed`

## Work Receipt

- goal: launch one supervised Codex/GDI provider session through the existing
  Sigil codex-terminal bridge, collect current `/sessions` evidence, and run
  the accepted AFK launch-attempt classifier against that live catalog payload
  without overclaiming stale sessions
- final_status: failed_wrong_cwd
- changed_paths: []
- generated_artifacts: []
- temp_artifacts: temp packet/catalog/classifier files removed by Operator
- local_only_state: worktree clean before and after
- provider_owned_artifacts: Codex transcript files were created by the
  supervised launch; the current launch transcript recorded
  `/Users/Michael/Code/agent-os/.docks/operator`, not the requested
  `/Users/Michael/Code/agent-os/.docks/gdi`
- no_mutation_claims:
  - no source file edits
  - no provider config changes
  - no gateway state changes
  - no dock profile or hook changes
  - no committed generated artifacts
  - no GitHub mutation
  - no push
  - no PR
- next_owner: foreman
- follow_up: route a focused deterministic GDI correction for observed
  provider-session cwd mismatch classification and live collection ordering

## Evidence Receipts

- before_status:
  `## gdi/afk-bridge-current-launch-observability-correction-v0`
- after_status:
  `## gdi/afk-bridge-current-launch-observability-correction-v0`
- after_diff_stat: empty
- bridge_cleanup: bridge killed; port `17863` no longer reachable
- missing_evidence:
  - no readable provider response containing cwd, branch, HEAD, or status was
    captured through `/snapshot`
  - `/session-inspector` was not collected before bridge cleanup
  - classifier did not receive the observed provider session id because the
    session was outside the requested GDI cwd-filtered catalog payload

## Readiness Implication

The live smoke validates the accepted fixture-backed classifier for the
requested GDI cwd filter: it correctly refused to bind stale GDI catalog
sessions to the current launch. It also exposed a stronger mismatch: the
provider-owned Codex transcript for the observed current session recorded
`.docks/operator` as cwd, while the bridge launch intent requested `.docks/gdi`.
The next reversible step is a deterministic correction that classifies observed
provider-session cwd mismatch explicitly and prevents it from being collapsed
into ordinary catalog absence.

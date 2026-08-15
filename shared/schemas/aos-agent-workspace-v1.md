# AOS Agent Workspace V1

V1 stores each saved ref as indirection to exactly one required
`aos-target-handle-v1` `handle`. The only action address grammar is
`ref:<snapshot-id>:<ref-id>`.

V1 has no resolution classes, bare `ref:<ref-id>` shorthand, coordinate
fallback records, browser reacquisition, or alternate action target. A saved
browser handle validates its original session/state/ref and then fails closed
with `TARGET_ACTION_UNSUPPORTED` because the backend cannot atomically bind the
capture generation to ref resolution. Browser records therefore expose an
empty `supported_actions` array and the machine-readable
`browser_ref_actions_unsupported` known limit. Canvas and native AX handles are
Locators and are re-resolved to exactly one current match. `supported_actions`
and `hint_facts` are bounded capture-time presentation facts only; they never
gate dispatch. Current action-time resolution owns missing, ambiguous,
disabled, and action-unsupported results.

Existing V0 files are historical bytes. Active readers reject them with
`AGENT_WORKSPACE_SCHEMA_UNSUPPORTED` and `recapture_required:true`; they do not
upgrade, rewrite, or interpret them.

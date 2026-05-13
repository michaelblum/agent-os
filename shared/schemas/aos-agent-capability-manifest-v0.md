# AOS Agent Capability Manifest v0

Schema:
[`aos-agent-capability-manifest-v0.schema.json`](./aos-agent-capability-manifest-v0.schema.json)

This manifest describes typed capabilities that an agent role or entry path can
activate. It is the contract layer between role/profile policy and concrete
tool adapters. The goal is to make AOS the agent shell while still allowing
repo-development tools such as `gh`, Node, npm, Python, and Bash to exist as
explicit, reviewable capabilities.

## Purpose

The manifest separates four concepts that should not be conflated:

- **Dock/role**: who the agent is and what authority boundary it carries.
- **Entry path**: which capability layer is active for the current task.
- **Capability**: what operation can be performed.
- **Adapter**: how the capability is implemented in the current runtime.

For example, `dev.github.issue_comment` can be a typed capability exposed
through `./aos dev gh issue comment`, backed by the local authenticated `gh`
CLI. The agent depends on the AOS capability contract, not on a provider
connector being installed.

## Host Shell Boundary

Raw host process execution is not a base harness primitive. Capabilities with
`execution.raw_process=true` are only valid for the `aos_developer`, `testing`,
or `break_glass` entry paths. They must declare a non-`none` cwd policy, a
timeout, audit posture, and `requires_explicit_assignment=true`.

This makes raw Bash, Node, npm, Python, and arbitrary process execution visible
as elevated capabilities instead of ambient agent powers.

## V0 Scope

V0 is deliberately small. It records:

- capability identity and status;
- role and entry-path applicability;
- adapter kind and command surface;
- mutability and side-effect class;
- cwd/network/raw-process/audit execution policy;
- input/output metadata;
- failure behavior.

V0 does not execute capabilities, grant permissions, or replace current test
commands. It gives future `./aos dev run` or runtime capability brokers a
schema to target.

The canonical repo-development manifest is
`docs/dev/agent-capabilities.json`. Use `./aos dev capabilities list --json`
and `./aos dev capabilities explain <capability-id> --json` for read-only
discovery.

## Classification Heuristic

Use these defaults when deciding whether repeated agent behavior should become
a capability:

- Prefer `aos_cli` when the repo already has or should have a typed AOS control
  surface.
- Use `local_cli` for a stable external CLI behind a thin AOS wrapper or
  documented command contract.
- Use `node` or `python` for repo-owned scripts that are bounded and
  deterministic.
- Use `shell` only for break-glass or explicitly scoped developer/testing
  operations. Repeated shell clusters are candidates for a typed AOS control
  surface.

## Examples

Valid fixtures live in
`shared/schemas/fixtures/aos-agent-capability-manifest-v0/valid/`.

Invalid fixtures demonstrate unsafe shapes such as base-harness raw shell
capabilities or raw-process capabilities without timeout/audit metadata.

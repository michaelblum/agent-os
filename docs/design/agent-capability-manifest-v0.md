# Agent Capability Manifest v0

## Problem

Agent sessions need a portable way to describe what operations are available
without making raw Bash, Node, npm, Python, or provider-specific tools the
default agent shell. Docks define durable role/profile boundaries. Entry paths
define active capability layers. Neither should hardcode every command an agent
might run.

The missing layer is a small capability manifest: a runtime-neutral description
of operations, adapters, mutability, scope, and audit expectations.

## Direction

AOS should be the shell agents target. Host process execution remains available
for development and testing, but it should be represented as an explicit
capability with scope and audit metadata rather than an ambient power.

The V0 schema lives at
[`shared/schemas/aos-agent-capability-manifest-v0.schema.json`](../../shared/schemas/aos-agent-capability-manifest-v0.schema.json).
It is intentionally declarative. It does not execute commands or grant
permissions.

The canonical repo-development manifest lives at
[`docs/dev/agent-capabilities.json`](../dev/agent-capabilities.json). Agents can
inspect it through the read-only discovery surface:

```bash
./aos dev capabilities list --json
./aos dev capabilities explain dev.github.issue_comment --json
```

## Concept Model

An agent instance is a runtime composition:

```text
dock role/profile
+ active entry path
+ assigned task
+ capability manifest
+ runtime adapter
+ evidence contract
```

The dock answers "who is this agent and what may it decide?" The entry path
answers "what capability layer is active?" The capability manifest answers
"what operations exist and how risky are they?" The adapter answers "how does
this runtime perform that operation?"

## Capability Classes

Use these classes when classifying repeated agent behavior:

| Adapter kind | Use when | Default posture |
| --- | --- | --- |
| `aos_cli` | A typed AOS control surface exists or should exist | Preferred |
| `local_cli` | A stable external CLI is wrapped by policy | Acceptable with scope |
| `node` / `python` | A repo-owned deterministic script or test is needed | Developer/testing only |
| `http` / `mcp` | A protocol-backed external service is the stable interface | Depends on mutability |
| `manual` | Human action is the operation | Requires explicit handoff |
| `shell` | Arbitrary host shell is unavoidable | Break-glass or tightly scoped dev/test |

Repeated raw shell clusters are design pressure. If agents keep running the
same command sequence, either define a typed AOS control surface or register a
capability with narrow execution policy.

## V0 Safety Boundary

The schema enforces the first hard boundary:

- `execution.raw_process=true` cannot be used by the base `agent_harness`
  entry path.
- Raw process capabilities must be scoped to `aos_developer`, `testing`, or
  `break_glass`.
- Raw process capabilities must require explicit assignment.
- Raw process capabilities must declare cwd policy, timeout, and audit posture.

This is not complete security. It is a durable contract that prevents the
platform vocabulary from treating arbitrary host process execution as a base
agent primitive.

## Initial Candidates

`./aos dev gh` is the reference example. It regularizes GitHub work through an
AOS developer control surface while still using the authenticated local `gh`
CLI underneath.

Other candidates to inventory next:

- focused Node schema tests;
- package-local Node tests;
- Swift build through `./aos dev build`;
- readiness and permission-reset checks;
- screenshot or capture helpers;
- browser/Playwright runs.

## Relationship To Future `./aos dev run`

Do not build `./aos dev run` until the manifest has been useful on paper. A
future runner should read capability manifests, enforce cwd/timeout/mutability
metadata, and preserve audit output. It should not become a thin rename for
arbitrary Bash.

The first implementation is read-only:

```bash
./aos dev capabilities list --json
./aos dev capabilities explain dev.github.issue_comment --json
./aos dev docks capabilities foreman --json
```

Execution can come later, once the schema and real capability inventory have
settled.

Dock profiles live in `.docks/<dock>/dock.json` and validate against
[`shared/schemas/aos-dock-profile-v0.schema.json`](../../shared/schemas/aos-dock-profile-v0.schema.json).
They resolve role, default entry path, allowed entry paths, and allowed
capability classes against the capability manifest. This keeps the dock layer
declarative and portable while avoiding duplicated role-specific command lists
in every `AGENTS.md`.

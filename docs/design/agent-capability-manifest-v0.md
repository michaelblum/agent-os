# Agent Capability Manifest v0

## Problem

Agent sessions need a portable way to describe what operations are available
without making raw Bash, Node, npm, Python, or provider-specific tools the
default agent shell. Entry paths, source command manifests, generated help, ADRs,
schemas, tests, and live CLI/runtime readback define the active contract
authority. None of those owners should hardcode every command an agent might
run.

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
node scripts/aos-dev-workflow.mjs capabilities list --json
node scripts/aos-dev-workflow.mjs capabilities explain dev.github.issue_comment --json
```

## Concept Model

An agent instance is a runtime composition:

```text
source/ADR/schema authority
+ active entry path
+ assigned task
+ capability manifest
+ runtime adapter
+ evidence contract
```

Source, ADR, and schema authority answer "what contract is live?" The entry
path answers "what capability layer is active?" The capability manifest answers
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

`node scripts/aos-dev-gh.mjs` is the reference example. It regularizes GitHub work through an
AOS developer control surface while still using the authenticated local `gh`
CLI underneath.

Other candidates to inventory next:

- focused Node schema tests;
- package-local Node tests;
- Swift build through `node scripts/aos-dev-build.mjs build`;
- readiness and permission-reset checks;
- screenshot or capture helpers;
- browser/Playwright runs.

## Relationship To Future Capability Runner

Do not build a new public runner command until the manifest has been useful on
paper. A future runner should read capability manifests, enforce
cwd/timeout/mutability metadata, and preserve audit output. It should not become
a thin rename for arbitrary Bash.

The first implementation is read-only:

```bash
node scripts/aos-dev-workflow.mjs capabilities list --json
node scripts/aos-dev-workflow.mjs capabilities explain dev.github.issue_comment --json
```

Execution can come later, once the schema and real capability inventory have
settled.

Current owners for this design are the schema, canonical manifest, API docs,
tests, and direct maintainer script readback:

- [`shared/schemas/aos-agent-capability-manifest-v0.schema.json`](../../shared/schemas/aos-agent-capability-manifest-v0.schema.json)
- [`docs/dev/agent-capabilities.json`](../dev/agent-capabilities.json)
- [`docs/api/aos.md`](../api/aos.md)
- [`tests/schemas/aos-agent-capability-manifest-v0.test.mjs`](../../tests/schemas/aos-agent-capability-manifest-v0.test.mjs)
- [`tests/aos-dev-gh-contract.test.mjs`](../../tests/aos-dev-gh-contract.test.mjs)
- `node scripts/aos-dev-workflow.mjs capabilities list --json`
- `node scripts/aos-dev-workflow.mjs capabilities explain <capability-id> --json`

The retired dock/persona routing layer is not an active owner for this manifest.
Do not restore dock directories, dock profile schemas, work-card routing, or the
old `./aos dev docks` command family for capability discovery. Any future
routing layer must integrate through the canonical manifest, source command
manifests, generated help, API docs, tests, and live CLI/runtime readback.

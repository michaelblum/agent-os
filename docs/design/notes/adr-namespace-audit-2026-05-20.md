# ADR Namespace Audit

Date: 2026-05-20
Owner: GDI
Work card: `docs/design/work-cards/adr-namespace-audit-v0.md`

Implementation status: resolved on this branch by moving
`docs/decisions/ADR-001-toolkit-platform-strategy.md` to
`docs/adr/0012-toolkit-platform-strategy.md` and updating live consumer
guidance to make `docs/adr/` the canonical ADR and durable
architecture-decision namespace. The moved file title was normalized to
`Toolkit Platform Strategy`; the old path and original title are preserved in
its provenance note.

## Summary

At audit time, agent-os had two durable-decision namespaces:

- `docs/adr/` contains an unprefixed, zero-padded numeric ADR series from
  `0001` through `0011`.
- `docs/decisions/` contains one accepted file named
  `ADR-001-toolkit-platform-strategy.md`.

The split is now visible to consumers because `CONTEXT-MAP.md`,
`docs/agents/domain.md`, and `docs/recipes/context-doc-maintenance.md` all tell
agents to inspect both directories until the ADR namespace is consolidated or
explicitly superseded. That rule is a useful interim guard, but it is not a
durable namespace model.

Recommendation: migrate `docs/decisions/ADR-001-toolkit-platform-strategy.md`
into `docs/adr/` in a later implementation slice, assigning it the next
repo-wide ADR number and preserving its original title, status, date, and
related issue links. The current evidence does not show a distinct
`docs/decisions/` class with its own criteria. Keeping two ADR-like namespaces
would require extra taxonomy and ongoing consumer burden for one file.

## Current Inventory

### `docs/adr/`

The `docs/adr/` directory contains eleven files with the pattern
`NNNN-lowercase-slug.md`. Ten files use only a first-level title and body. The
newest file, `0011-host-neutral-surfaces-use-capability-bounded-hosts.md`, also
includes `Status: Accepted clarification`.

| File | Title and pattern notes |
| --- | --- |
| `0001-facets-belong-to-layers.md` | `# Facets are projections within Layers, not a replacement for them`; zero-padded numeric ADR filename, no explicit status line. |
| `0002-work-records-and-playbooks-are-distinct-artifacts.md` | `# Work Records and Playbooks are distinct artifacts, bridged by an origin reference`; zero-padded numeric ADR filename, no explicit status line. |
| `0003-claims-and-postconditions-split-along-intent-and-execution.md` | `# Claims and Postconditions split along the intent / execution boundary`; zero-padded numeric ADR filename, no explicit status line. |
| `0004-anchor-is-a-role-resolved-into-a-binding.md` | `# Anchor is a role at the input grammar; resolution produces an Anchor Binding`; zero-padded numeric ADR filename, no explicit status line. |
| `0005-subjects-are-host-neutral-facets-declare-hosts.md` | `# Subjects are host-neutral; Facets declare their Hosts`; zero-padded numeric ADR filename, no explicit status line. |
| `0006-state-id-guards-coordinates-strictly-refs-loosely.md` | `# State ID guards coordinate actions strictly; Ref-based actions loosely`; zero-padded numeric ADR filename, no explicit status line. |
| `0007-subject-type-is-kind-not-projection.md` | `# subject_type names the kind of a Subject, not a contextual projection`; zero-padded numeric ADR filename, no explicit status line. |
| `0008-subject-browser-is-a-surface-kind.md` | `# Subject Browser is a class of surfaces, not the wiki renamed`; zero-padded numeric ADR filename, no explicit status line. |
| `0009-recipe-playbook-workflow-as-three-distinct-artifacts.md` | `# Recipe, Playbook, and Workflow are three distinct artifacts on different scopes`; zero-padded numeric ADR filename, no explicit status line. |
| `0010-capabilities-are-named-contracts-not-buttons-or-facets.md` | `# Capabilities are named contracts, distinct from Facets and Controls`; zero-padded numeric ADR filename, no explicit status line. |
| `0011-host-neutral-surfaces-use-capability-bounded-hosts.md` | `# Host-neutral surfaces use capability-bounded hosts`; zero-padded numeric ADR filename, explicit `Status: Accepted clarification`. |

The series is coherent by filename shape and topic: it records platform
architecture choices around Subjects, Facets, Work Records, Playbooks,
capabilities, hosts, input grammar, and surface classification.

### `docs/decisions/`

The `docs/decisions/` directory contains one file:

| File | Title and pattern notes |
| --- | --- |
| `ADR-001-toolkit-platform-strategy.md` | `# ADR-001: Toolkit Platform Strategy`; explicit `Status: Accepted`, `Date: 2026-05-15`, and related GitHub issue links. |

The file is ADR-named and ADR-structured. It decides the toolkit platform
strategy: framework-neutral surface runtime contract, first-party ownership of
AOS-specific toolkit layers, headless-library adapter posture, open-design token
disposition, and impact on issues `#325` through `#328`.

## Current Consumer Guidance

`CONTEXT-MAP.md` now has a `Durable Decisions And SOPs` section that routes
ADRs to `docs/adr/`, additional durable decisions to `docs/decisions/`, and
recipes/SOPs to `docs/recipes/`. It explicitly tells consumers to inspect both
`docs/adr/` and `docs/decisions/` until the ADR namespace is consolidated or
superseded.

`docs/agents/domain.md` says root `CONTEXT.md` is the governed vocabulary and
contract-term index, while `CONTEXT-MAP.md` routes domains. Its `Decision Docs`
section names the current split: most ADRs live under `docs/adr/`, and at least
one ADR-named platform decision lives under `docs/decisions/`. It also says the
current slice does not resolve the split and consumers should inspect both
locations when a task touches architecture, toolkit policy,
subject/work-record contracts, or other durable trade-offs.

`docs/recipes/context-doc-maintenance.md` says to add or update an ADR or
`docs/decisions/` entry when a choice is hard to reverse, surprising without
context, and the result of a real trade-off. It tells maintainers to inspect
both directories until the split is consolidated or superseded, and names
ADR/decision discovery as one of the surfaces that may require coupled updates.

Together these files define a current consumer rule, not a taxonomy. They
protect readers from missing either namespace, but they do not say what belongs
in `docs/decisions/` instead of `docs/adr/`.

## Evidence For Separate `docs/decisions/`

The in-repo evidence for a distinct `docs/decisions/` class is weak.

The only file under `docs/decisions/` is named `ADR-001`, not `DECISION-001` or
a class-specific filename. Its title is `ADR-001: Toolkit Platform Strategy`,
and its content follows normal ADR intent: context, decision, options,
consequences, and issue impact. The directory name therefore creates a second
container for an ADR-like document rather than an obviously different
decision-document class.

The Matt Pocock context integration audit identifies the split as material but
unresolved. It says Matt's skills assume `docs/adr/` and optional
context-scoped `docs/adr/` directories, while agent-os has `docs/adr/0001...0011`
plus `docs/decisions/ADR-001-toolkit-platform-strategy.md`. It states that a
domain setup would need to say whether `docs/decisions/` is an ADR namespace, a
legacy namespace, or a different decision-document class. The post-audit status
says the split remains a known consumer reality documented in the setup, map,
and maintenance recipe, not a resolved model.

No file currently explains why toolkit platform strategy should live outside
the numeric ADR series. No naming pattern, index, local README, or maintenance
rule defines `docs/decisions/` as a broader class such as product decisions,
provider choices, temporary decision records, or issue-resolution records.

## Consumer Risk

Agents that inspect only `docs/adr/` will miss the accepted toolkit platform
strategy. That is high-impact for toolkit and surface work because the missed
decision controls framework neutrality, first-party toolkit ownership,
headless-library adapter posture, token-package direction, and the disposition
of multiple toolkit issues.

Agents that inspect only `docs/decisions/` will miss the larger subject,
workbench, Work Record, Facet, host, state-id, and capability decisions. That
is high-impact for architecture and schema work because the numbered ADR series
defines the current durable model for core AOS concepts.

Skills or docs generators trained on Matt-style `docs/adr/` conventions are
especially likely to miss `docs/decisions/` unless agent-os-specific guidance
is present. The current interim "inspect both" guidance reduces that risk for
well-behaved agents, but it is fragile: search scopes, generated context
bundles, and human skim paths commonly privilege one conventional namespace.

The split also creates numbering ambiguity. `docs/adr/0001` and
`docs/decisions/ADR-001` are both "ADR one" in different schemes. That makes
references like "ADR-001" ambiguous unless the path is always included.

## Options

### Option 1: Migrate The Toolkit Platform Strategy Into `docs/adr/`

Move `docs/decisions/ADR-001-toolkit-platform-strategy.md` into `docs/adr/` as
the next number in the existing zero-padded series, likely
`docs/adr/0012-toolkit-platform-strategy.md`. Preserve the original title,
status, date, related issue links, and decision content, with a short migration
note if Foreman wants to retain the original `ADR-001` provenance.

Benefits:

- gives agents, humans, skills, and context generators one canonical ADR
  namespace;
- removes `ADR-001` numbering ambiguity;
- aligns with Matt-style ADR discovery without local exceptions;
- requires a small docs-only implementation and pointer sweep;
- keeps the toolkit platform strategy visible to the same consumers that read
  the subject/workbench ADRs.

Costs:

- requires updating references to the old path;
- requires a one-time decision on whether to keep a redirect stub or remove
  `docs/decisions/`;
- may be mildly disruptive to open branches or issue comments that cite the old
  path.

This is the recommended path.

### Option 2: Keep `docs/decisions/` As A Distinct Durable-Decision Class

Define `docs/decisions/` explicitly as a separate durable-decision class, then
document what belongs there and how it differs from ADRs. For example, Foreman
could define it as product/platform strategy records that are issue-linked,
dated, and broader than implementation ADRs.

Benefits:

- preserves the current toolkit platform file path;
- leaves room for non-ADR durable decisions if Foreman wants that taxonomy;
- can separate strategic product/platform decisions from lower-level
  architecture records.

Costs:

- no current evidence proves that distinction was intentional;
- requires defining a new document class, naming pattern, read order, and
  conflict rule for one existing file;
- requires long-term consumer guidance to keep inspecting two locations;
- keeps `ADR-001` numbering ambiguity unless the file is renamed.

This option should be chosen only if Michael or Foreman wants a durable
decision class broader than ADRs. If so, the first follow-up should rename or
retitle the existing file so it is not an ADR in a non-ADR namespace.

### Option 3: Leave The Split As-Is With The Current Interim Rule

Keep both directories and rely on the current guidance that consumers inspect
both.

Benefits:

- no immediate file moves or reference updates;
- current docs already warn consumers about the split.

Costs:

- leaves the namespace decision unresolved;
- keeps ambiguous `ADR-001` numbering;
- makes context bundles and skill discovery more error-prone;
- spreads a permanent local exception across docs for one file;
- invites future contributors to add more files to either namespace without
  knowing the intended distinction.

This option should be rejected as a steady state. It is acceptable only as a
temporary bridge until the namespace implementation card lands.

## Recommendation

Foreman should consolidate the ADR namespace by moving the toolkit platform
strategy into `docs/adr/` as the next numbered ADR. The file is already an ADR
by title and structure, and no current source defines a separate
`docs/decisions/` class. Consolidation gives consumers one durable-decision
home, removes a known Matt-style discovery hazard, and reduces maintenance
surface area.

The later implementation should be docs-only. It should not rewrite the
substance of any ADR or decision. It should preserve the accepted toolkit
platform decision and only normalize its namespace and references.

If the correct product direction depends on human judgment, the precise
decision point is: "Does agent-os want `docs/decisions/` to be a durable class
for non-ADR strategic decisions?" Without an affirmative answer, the smallest
reversible follow-up is to migrate the single ADR-named file into `docs/adr/`
and remove or retire the empty namespace.

## Exact Follow-Up Plan For Foreman

Create a later docs-only implementation card with this scope:

1. Move `docs/decisions/ADR-001-toolkit-platform-strategy.md` to
   `docs/adr/0012-toolkit-platform-strategy.md`.
2. Preserve the accepted decision content, including `Status: Accepted`,
   `Date: 2026-05-15`, related issues, context, decision, and consequences.
3. Add a short provenance note only if desired, such as "Originally recorded as
   `docs/decisions/ADR-001-toolkit-platform-strategy.md`; migrated into the
   canonical ADR namespace on YYYY-MM-DD."
4. Search and update live references to the old path in at least
   `CONTEXT-MAP.md`, `docs/agents/domain.md`,
   `docs/recipes/context-doc-maintenance.md`, and
   `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
   if they remain live enough to need a supersession note.
5. Update the consumer guidance to say `docs/adr/` is the canonical ADR and
   durable architecture-decision namespace.
6. Decide whether to delete the empty `docs/decisions/` directory from git or
   leave a README stub that says the namespace is retired. Prefer no tracked
   empty directory and no new namespace unless Foreman wants a distinct class.
7. Do not change Swift, JavaScript, schemas, fixtures, tests, runtime behavior,
   GitHub issues, or PRs.

Verification for that follow-up card should prove:

- `rg --files docs/adr docs/decisions` shows the toolkit platform strategy
  under `docs/adr/` and no remaining ADR-named file under `docs/decisions/`;
- `rg -n "docs/decisions|ADR-001-toolkit-platform-strategy|0012-toolkit-platform-strategy|ADR namespace|durable decision" AGENTS.md CONTEXT-MAP.md docs/agents/domain.md docs/recipes/context-doc-maintenance.md docs/design docs/adr docs/decisions`
  shows only intentional references, migration notes, or no hits for the old
  path;
- `git diff --check` passes;
- source behavior, schemas, fixtures, tests, GitHub issues, and PRs are
  untouched.

If Foreman chooses Option 2 instead, the implementation card should not move
the file. It should define `docs/decisions/` in `CONTEXT-MAP.md`,
`docs/agents/domain.md`, and `docs/recipes/context-doc-maintenance.md`, rename
or retitle the existing file away from `ADR-001`, add a local README or index
for the class, and verify that consumers can distinguish ADRs from other
durable decisions without inspecting both blindly.

# GitHub Coordination and AOS Wiki Knowledge Layer Plan

> Tracking: create GitHub epic issue `Epic: Automation Reliability and Web
> Playbooks` when this plan is adopted.
> Status: proposal for how agent-os should split coordination, source-controlled
> contracts, and agent-operable knowledge.

**Goal:** Make GitHub the coordination layer for unresolved work while keeping
durable system knowledge in repo docs, schemas, recipes, and the local AOS wiki.
GitHub should answer "what is being worked on, by whom, why, and with what
status." The repo and wiki should answer "how does the system work, what
contracts exist, and what should an agent retrieve during operation."

**Architecture:** Use a three-layer operating model:

```text
GitHub Project + issues
  -> portfolio board, epics, issue slices, status, priority, ownership

repo docs + schemas
  -> plans, specs, API docs, JSON schemas, recipes, implementation contracts

local AOS wiki
  -> agent-operable workflows, playbooks, concepts, entities, site notes,
     reusable pattern memory seeded from git and copied to runtime state
```

**Tech Stack:** GitHub Projects/issues/sub-issues/milestones, markdown repo docs,
JSON Schema under `shared/schemas/`, wiki seed markdown under `wiki-seed/`, and
runtime wiki pages under `~/.config/aos/{mode}/wiki/aos/...`.

**Relevant repo context:**

- Root contract: `AGENTS.md`.
- Wiki design: `docs/superpowers/specs/2026-04-09-sigil-wiki-design.md`.
- Wiki seed + namespace plan:
  `docs/superpowers/plans/2026-04-12-aos-wiki-writes-and-namespaces.md`.
- Current seed source: `wiki-seed/README.md`.
- Browser adapter substrate:
  `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`.
- Steerable collection substrate:
  `docs/superpowers/plans/2026-04-28-human-intent-sensing-and-steerable-collection.md`.

---

## Operating Rule

GitHub tracks work. Repo docs and schemas define durable system contracts. The
local AOS wiki stores reusable agent knowledge that should be retrieved during
operation.

Comments are allowed to be noisy. Important comments must be promoted into one
of these durable homes:

| Stable result | Durable home |
|---|---|
| Scope, sequencing, implementation approach | Plan doc under `docs/superpowers/plans/` |
| Architecture or cross-tool contract | Spec/API doc or `shared/schemas/` |
| Repeatable command procedure | Recipe under `docs/recipes/` |
| Reusable agent knowledge | Wiki seed page under `wiki-seed/` |
| One active unit of work | GitHub issue or sub-issue |
| Execution evidence | PR linked to the issue |

---

## Proposed GitHub Model

### Project

Create one repo or organization project for the operating board. The project
should show current execution state, not become a knowledge base.

Recommended fields:

| Field | Type | Values / notes |
|---|---|---|
| `Status` | Project status | `Inbox`, `Ready`, `In progress`, `Blocked`, `Review`, `Done`, `Archived` |
| `Priority` | Single select | `P0`, `P1`, `P2`, `P3` |
| `Area` | Single select | `primitives`, `toolkit`, `apps`, `wiki`, `browser`, `docs`, `infra` |
| `Workflow` | Text or single select | Example: `employer-brand-audit`, `browser-automation`, `design-operator` |
| `Epic` | Parent issue field / linked issue | Prefer GitHub parent issue field when available |
| `Milestone` | GitHub milestone | Date or release target |
| `Blocked reason` | Text | Only populated when blocked |
| `Confidence` | Single select | `high`, `medium`, `low`, `unknown` |
| `Risk` | Single select | `low`, `medium`, `high` |

Use GitHub Project custom fields as the baseline. Organization issue fields are
useful when enabled, but they are still a platform capability with availability
constraints, so the plan should not depend on them for repo portability.

### Epics

Use parent issues as epics. If GitHub issue type `Epic` is enabled in the
organization, set the type too, but do not make issue type the only signal.

Epic body template:

```markdown
## Outcome

What user-visible or agent-visible capability exists when this epic is done.

## Scope

In scope:
- ...

Out of scope:
- ...

## Durable Artifacts

- Plan: `docs/superpowers/plans/...md`
- Spec:
- Schemas:
- Wiki pages:
- Recipes:

## Exit Criteria

- [ ] ...

## Sub-issues

- [ ] #...

## Decision Log

Stable decisions only. Link to comments for raw discussion when useful.
```

### Issues and sub-issues

Issues are durable unresolved work. Sub-issues should be PR-sized slices under an
epic. Keep nesting shallow by default:

- Level 1: epic parent issue.
- Level 2: implementation slices, research spikes, schema work, docs work.
- Level 3: only when a slice is still too large after implementation starts.

Each issue should contain:

- Problem statement.
- Links to durable artifacts.
- Acceptance criteria.
- Verification command or evidence expectation.
- Promotion target for any learned durable knowledge.

### Labels

Labels are low-cardinality taxonomy and search aids. Do not duplicate every
Project field as a label.

Recommended label families:

```text
area:primitives
area:toolkit
area:wiki
area:browser
area:docs

type:bug
type:feature
type:spike
type:plan
type:docs

risk:privacy
risk:permissions
risk:flaky
risk:contract

workflow:employer-brand-audit
workflow:browser-automation
workflow:design-operator
```

Avoid `status:*` labels unless GitHub Project access is unreliable for the
people doing the work. If status labels are required, define a single source of
truth rule: Project `Status` wins, and labels are best-effort mirrors.

### Milestones

Use milestones for release or date targets, not for areas or workflows.

Examples:

- `Design Operator V0`
- `Steerable Collection V0`
- `Automation Reliability V0`
- `Web Playbooks V0`

### PRs

PRs are execution evidence. Every PR should link or close an issue and include:

- What changed.
- Verification performed.
- Screenshots, trace files, source packs, or artifacts when relevant.
- Follow-up issues for known gaps.

---

## Proposed Repo Doc Model

### Plans

Plans live under `docs/superpowers/plans/` and own implementation sequencing.
They should reference their GitHub epic, but should remain useful without
GitHub access.

For this workstream:

```text
docs/superpowers/plans/2026-04-28-github-coordination-and-aos-wiki-knowledge-layer.md
```

Follow-up implementation plans can split out once scope hardens:

```text
docs/superpowers/plans/YYYY-MM-DD-web-playbook-schema-and-registry.md
docs/superpowers/plans/YYYY-MM-DD-automation-trace-contract.md
docs/superpowers/plans/YYYY-MM-DD-employer-brand-audit-v0.md
```

### Specs and schemas

When the plan becomes a real contract, promote it into:

```text
shared/schemas/web-playbook.schema.json
shared/schemas/automation-trace.schema.json
docs/api/wiki.md
docs/api/automation-traces.md
```

Schemas should define what agents and tools can rely on. Plans should not be the
runtime contract.

### Recipes

Recipes under `docs/recipes/` should capture repeatable human or agent
procedures:

```text
docs/recipes/github-coordination-hygiene.md
docs/recipes/steerable-browser-collection.md
docs/recipes/web-playbook-promotion.md
```

---

## Proposed Wiki Model

The wiki is the canonical retrieval surface for reusable operational knowledge.
GitHub issues should link to wiki pages, not embed playbook bodies.

### Source and runtime paths

Source-controlled seed pages:

```text
wiki-seed/concepts/web-automation-playbook-registry.md
wiki-seed/workflows/employer-brand-audit.md
wiki-seed/playbooks/web-ui/common/hitl-gates.md
wiki-seed/playbooks/web-ui/common/retry-and-fallback.md
wiki-seed/playbooks/platforms/linkedin-company-page.md
wiki-seed/playbooks/platforms/greenhouse-careers.md
```

Runtime pages after seeding:

```text
~/.config/aos/repo/wiki/aos/concepts/web-automation-playbook-registry.md
~/.config/aos/repo/wiki/aos/workflows/employer-brand-audit.md
~/.config/aos/repo/wiki/aos/playbooks/web-ui/common/hitl-gates.md
~/.config/aos/repo/wiki/aos/playbooks/web-ui/common/retry-and-fallback.md
~/.config/aos/repo/wiki/aos/playbooks/platforms/linkedin-company-page.md
~/.config/aos/repo/wiki/aos/playbooks/platforms/greenhouse-careers.md
```

Current wiki seed docs list `entities/`, `concepts/`, and `plugins/`. This plan
adds first-class `workflows/` and `playbooks/` directories. Until the indexer is
extended, playbooks can be indexed as `type: concept` pages, but the target
shape is first-class `type: playbook`.

### Wiki page types

| Type | Purpose | Example |
|---|---|---|
| `concept` | Stable explanation or model | `web-automation-playbook-registry` |
| `entity` | Durable thing in the system or world | `gateway`, `linkedin-company-page` if modeled as an entity |
| `workflow` | End-to-end task pattern | `employer-brand-audit` |
| `playbook` | Focused operational procedure for a context/failure | `web-ui.common.retry-and-fallback` |
| `site-note` | Site-specific observed behavior | `linkedin.company-page.navigation` |
| `pattern` | Reusable tactic or detection rule | `stale-locator-recovery` |

### Playbook frontmatter

Target frontmatter shape:

```yaml
---
type: playbook
id: web-ui.common.retry-and-fallback
status: draft
version: 0.1.0
workflows:
  - employer-brand-audit
platforms:
  - generic-web
triggers:
  - playwright-action-failed
  - locator-stale
  - safety-gate-timeout
applies_when:
  - Current page is still reachable
  - Failure is local to one action or locator
avoid_when:
  - User secrets are visible
  - Action may submit, purchase, upload, delete, or message externally
evidence:
  - automation_trace
  - screenshot
confidence: medium
---
```

### Retrieval question

Agents should be able to ask:

```text
I am in workflow X, on platform Y, facing trigger Z. Which playbook applies?
```

The retrieval result should return:

- Matching playbook IDs.
- Why each matched.
- Required safety gates.
- Allowed next actions.
- Confidence and last validation evidence.

---

## Automation Trace Contract

Automation traces should connect runtime behavior back to wiki playbooks and
GitHub work, without making GitHub the trace store.

V0 trace fields:

```json
{
  "run_id": "2026-04-28T180000Z-employer-brand-audit",
  "workflow": "employer-brand-audit",
  "platform": "linkedin-company-page",
  "state": "blocked",
  "trigger": "locator-stale",
  "playbook_refs": ["web-ui.common.retry-and-fallback"],
  "github": {
    "epic": 142,
    "issue": 147,
    "pr": null
  },
  "artifacts": {
    "screenshots": [],
    "source_pack": null,
    "trace_jsonl": "runs/.../automation-trace.jsonl"
  }
}
```

The trace should make it cheap to answer:

- Which playbooks were used?
- Which failures are recurring?
- Which playbooks need promotion from draft to validated?
- Which GitHub issue owns the unresolved gap?

---

## Decisions Locked Before Implementation

| # | Decision | Rationale |
|---|---|---|
| 1 | GitHub is coordination, not knowledge storage. | Issues and comments are too noisy for operational memory. |
| 2 | Parent issues are the durable epic representation. | Works even when issue type `Epic` is unavailable. |
| 3 | Sub-issues are PR-sized implementation slices. | Keeps progress visible and avoids huge ambiguous issues. |
| 4 | Plan docs own implementation sequencing. | They survive GitHub field/view churn and are reviewable with code. |
| 5 | Wiki is canonical for agent-retrieved playbooks. | Agents need structured, local, runtime-accessible context. |
| 6 | Comments are event logs until promoted. | Prevents important decisions from being lost in discussion history. |
| 7 | Playbooks get first-class wiki taxonomy. | A playbook is more operational than a concept and less executable than a workflow plugin. |
| 8 | Schemas become real only after the first useful seed set. | Avoids over-specifying before the agent has used the pages. |
| 9 | Project fields should stay few. | GitHub Projects have field limits and high-cardinality fields become dashboard noise. |
| 10 | Workflow-specific knowledge starts in wiki, not GitHub. | GitHub links to operational knowledge; it does not contain it. |

---

## Implementation Plan

### Task 1: Adopt GitHub coordination conventions

**Files:**

- Create: `docs/recipes/github-coordination-hygiene.md`
- Optional: `.github/ISSUE_TEMPLATE/epic.md`
- Optional: `.github/ISSUE_TEMPLATE/work-slice.md`

- [ ] Define the Project field set and allowed values.
- [ ] Create the epic issue template.
- [ ] Create the work-slice issue template.
- [ ] Document when to use Project fields versus labels.
- [ ] Document the promotion rule from comments to issue body, plan, schema,
  recipe, or wiki page.
- [ ] Create the GitHub epic `Epic: Automation Reliability and Web Playbooks`
  and link this plan.

**Done when:** a new workstream can be represented as one epic, several
sub-issues, one plan doc, and linked durable artifacts without duplicating
knowledge in comments.

### Task 2: Extend wiki taxonomy for workflows and playbooks

**Files:**

- Modify: `wiki-seed/README.md`
- Modify: wiki indexer/frontmatter code, identified from the existing wiki
  implementation
- Create: `shared/schemas/wiki-page.schema.json` if no equivalent exists

- [ ] Add `workflows/` and `playbooks/` to the seed directory convention.
- [ ] Teach the wiki indexer to accept `type: workflow` pages outside
  `plugins/` and `type: playbook` pages under `playbooks/`.
- [ ] Keep `plugins/` as the executable skill/plugin surface.
- [ ] Add lint rules for required `id`, `type`, `status`, and `triggers` on
  playbook pages.
- [ ] Verify `./aos wiki seed --force --from wiki-seed` preserves the new
  directories under the `aos/` runtime namespace.

**Done when:** `aos wiki list --type playbook --json` can return seeded
playbooks from `wiki-seed/playbooks/...`.

### Task 3: Define the web playbook schema

**Files:**

- Create: `shared/schemas/web-playbook.schema.json`
- Create: `docs/api/web-playbooks.md`

- [ ] Define required frontmatter fields.
- [ ] Define optional fields for safety gates, expected evidence, platform
  selectors, failure modes, and validation history.
- [ ] Include examples for generic web, LinkedIn company pages, and Greenhouse
  careers pages.
- [ ] Add schema validation to wiki lint if a wiki lint command exists; otherwise
  create a shell test with fixture pages.

**Done when:** playbook pages have a stable contract that agents can query
without reading every page heuristically.

### Task 4: Seed the first web automation knowledge set

**Files:**

- Create: `wiki-seed/concepts/web-automation-playbook-registry.md`
- Create: `wiki-seed/workflows/employer-brand-audit.md`
- Create: `wiki-seed/playbooks/web-ui/common/hitl-gates.md`
- Create: `wiki-seed/playbooks/web-ui/common/retry-and-fallback.md`
- Create: `wiki-seed/playbooks/platforms/linkedin-company-page.md`
- Create: `wiki-seed/playbooks/platforms/greenhouse-careers.md`

- [ ] Write the registry concept as the entry point and retrieval contract.
- [ ] Write the employer-brand-audit workflow page as the workflow map, not an
  executable plugin.
- [ ] Write common HITL gate and retry/fallback playbooks.
- [ ] Write platform playbooks with observed UI constraints and safe selectors.
- [ ] Cross-link from existing employer brand wiki pages where relevant.

**Done when:** an agent doing an employer-brand audit can retrieve generic and
platform-specific guidance from the local wiki without opening GitHub.

### Task 5: Define automation trace schema

**Files:**

- Create: `shared/schemas/automation-trace.schema.json`
- Create: `docs/api/automation-traces.md`

- [ ] Define trace events for action attempt, failure, retry, fallback, HITL
  gate, user takeover, playbook selected, and playbook outcome.
- [ ] Add `playbook_refs`, `workflow`, `platform`, `trigger`, and artifact
  fields.
- [ ] Include optional GitHub backreferences for epic, issue, and PR numbers.
- [ ] Define JSONL storage expectations for source packs.

**Done when:** automation runs can create evidence that links runtime behavior
to playbook usage and unresolved GitHub work.

### Task 6: Add playbook retrieval commands

**Files:**

- Modify: wiki command implementation under `src/commands/`
- Add tests under `tests/wiki-*` or the nearest existing wiki test convention

- [ ] Add query flags:

```bash
./aos wiki list --type playbook --workflow employer-brand-audit --platform linkedin-company-page --trigger locator-stale --json
```

- [ ] Return matched playbooks with match reasons and confidence.
- [ ] Prefer exact workflow/platform/trigger matches, then generic platform
  matches, then common web-ui matches.
- [ ] Add tests with fixture playbooks.

**Done when:** an agent can resolve a failure context to a small ranked list of
playbooks.

### Task 7: Wire traces and retrieval into browser automation flows

**Files:**

- Modify browser adapter / steerable collection modules identified by the
  implementation owner.
- Modify source-pack output docs.

- [ ] On automation failure, emit a trace event with `trigger`.
- [ ] Query matching playbooks before retrying or asking the human.
- [ ] Record selected playbook IDs and outcome.
- [ ] Respect HITL safety gates before applying fallback actions.
- [ ] Add a fixture run that demonstrates one stale locator fallback and one
  timeout HITL gate.

**Done when:** browser automation failures produce trace evidence and use wiki
playbooks before falling back to ad hoc behavior.

### Task 8: Establish promotion hygiene

**Files:**

- Create: `docs/recipes/web-playbook-promotion.md`
- Modify: `docs/recipes/github-coordination-hygiene.md`

- [ ] Define how a comment becomes a durable decision.
- [ ] Define how a repeated trace failure becomes a GitHub issue.
- [ ] Define how an issue resolution becomes a schema, recipe, or wiki update.
- [ ] Define how a draft playbook becomes validated or retired.

**Done when:** the workstream has a repeatable maintenance loop instead of
knowledge accumulating in comments.

---

## First Epic Draft

Title:

```text
Epic: Automation Reliability and Web Playbooks
```

Body:

```markdown
## Outcome

AOS browser automation can classify common web failures, retrieve local wiki
playbooks, apply safe retries/fallbacks, and leave trace evidence linked to
repo docs and PRs.

## Durable Artifacts

- Plan: `docs/superpowers/plans/2026-04-28-github-coordination-and-aos-wiki-knowledge-layer.md`
- Schemas:
  - `shared/schemas/web-playbook.schema.json`
  - `shared/schemas/automation-trace.schema.json`
- Wiki seed:
  - `wiki-seed/concepts/web-automation-playbook-registry.md`
  - `wiki-seed/workflows/employer-brand-audit.md`
  - `wiki-seed/playbooks/web-ui/common/hitl-gates.md`
  - `wiki-seed/playbooks/web-ui/common/retry-and-fallback.md`
  - `wiki-seed/playbooks/platforms/linkedin-company-page.md`
  - `wiki-seed/playbooks/platforms/greenhouse-careers.md`
- Recipes:
  - `docs/recipes/github-coordination-hygiene.md`
  - `docs/recipes/web-playbook-promotion.md`

## Exit Criteria

- [ ] Project fields and issue templates are documented.
- [ ] Wiki supports first-class playbook pages.
- [ ] Initial web automation playbooks are seeded.
- [ ] Automation trace schema records playbook usage and outcomes.
- [ ] Browser automation failure path queries playbooks before ad hoc retry.
- [ ] One end-to-end fixture demonstrates trace-backed fallback behavior.

## Sub-issues

- [ ] Define GitHub coordination hygiene recipe.
- [ ] Extend wiki taxonomy for playbooks and workflows.
- [ ] Define web playbook schema.
- [ ] Seed web automation playbook registry and first playbooks.
- [ ] Define automation trace schema.
- [ ] Add playbook retrieval query command.
- [ ] Wire playbook retrieval into browser automation failure handling.
```

---

## Open Questions

1. Should `workflow` pages be plain wiki pages, executable `plugins/`, or both?
   Proposed answer: both, with different meanings. `workflows/` explains the
   durable workflow map; `plugins/` remains the executable instruction bundle.

2. Should platform pages be `playbook` or `entity` pages?
   Proposed answer: platform-specific operational procedures are `playbook`;
   long-lived descriptions of the platform itself can become `entity` pages if
   they need separate identity.

3. Should GitHub issue fields be required?
   Proposed answer: no. Use Project fields and labels as the portable baseline.
   Adopt organization issue fields opportunistically when available.

4. Should automation traces live in GitHub artifacts?
   Proposed answer: no. Store traces in source packs or local run artifacts.
   Link summaries and PR evidence back to GitHub.

5. How much wiki nesting is acceptable?
   Proposed answer: enough to express retrieval context, not ownership. Use
   `playbooks/web-ui/common/` and `playbooks/platforms/<platform>/` first. Add
   deeper nesting only when retrieval needs it.

---

## Platform Notes

The plan assumes modern GitHub Issues and Projects behavior:

- Sub-issues support parent-child relationships and project progress views.
- Projects can group, sort, and filter by project fields and issue hierarchy.
- Issue types and organization issue fields are useful when enabled, but should
  not be required for repo-level portability.
- Milestones remain best for date or release targets.
- Issue fields are a newer GitHub capability with availability constraints;
  Project custom fields and labels remain the portable baseline.

Keep this section as an implementation note, not a hard contract. GitHub
platform availability changes faster than repo docs, so automation should detect
what the repository and organization actually support before depending on
advanced issue fields.

Reference docs:

- GitHub sub-issues:
  `https://docs.github.com/en/issues/managing-your-tasks-with-tasklists/creating-a-tasklist`
- GitHub issue fields:
  `https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-and-managing-issue-fields`
- GitHub Project fields:
  `https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-issue-fields`
- GitHub milestones:
  `https://docs.github.com/issues/using-labels-and-milestones-to-track-work/about-milestones`

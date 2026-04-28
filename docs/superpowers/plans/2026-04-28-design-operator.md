# Design Operator Implementation Plan

> Tracking: GitHub issue #140, "Design Operator: adapt design-skill workflows into AOS".

**Goal:** Define and ship an AOS-native Design Operator workflow that turns a
creative/design brief into visual artifacts through asset grounding, style
direction, generation, critique, revision, and handoff. The first slice should
appropriate the useful Huashu/Claude Design workflow pattern without vendoring
restricted Huashu prompts, assets, scripts, or demos.

**Architecture:** Treat Design Operator as a provider-neutral operator layer,
not a new app. AOS owns the workflow, evidence, and handoff contract; provider
adapters such as Gemini Canvas, local HTML generation, or future design tools
are execution targets. The workflow composes existing primitives:

- `see` for visual/browser inspection
- `do` for user-attached browser control
- `show` for overlays and human-facing guidance
- `ops` for deterministic source-backed checks where applicable
- local `skills/` for user-invoked agent guidance
- `docs/recipes/` for reusable SOPs

**Tech Stack:** Markdown docs, local Codex/agent skills, existing `aos` browser
target support, optional Playwright-backed browser inspection, no new runtime
dependencies in v1.

**Source Material:**

- Local note:
  `/Users/Michael/Downloads/https___youtu.be_Nmk1wxoi6ys_si=0lK4yf0eIqP9OWKW.md`
- Upstream pattern reference: `alchaincyf/huashu-design`
- AOS foundations:
  `ARCHITECTURE.md`,
  `shared/schemas/ops-recipe.schema.json`,
  `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`

---

## Decisions Locked Before Implementation

| # | Decision | Rationale |
|---|---|---|
| 1 | Do not vendor Huashu directly in v1. | Huashu's public license allows personal use but restricts company/team/commercial integration without authorization. AOS should copy the pattern, not the protected artifact set. |
| 2 | AOS is the planner; external design tools are execution surfaces. | Prevents Gemini Canvas, Claude Design, or any one UI from becoming the architecture. |
| 3 | Start with user-attached browser co-presence. | AOS is strongest when the human and agent share the same visible surface and can hand control back and forth. |
| 4 | Human checkpoint is mandatory before destructive or account-dependent browser actions. | Browser-hosted design tools include login, sharing, export, and account state. These need explicit human ownership. |
| 5 | V1 output is docs + skill + recipe; richer `ops` branching is follow-up. | Current `aos ops` manifests are good for deterministic command sequences, but design loops need subjective checkpoints and conditional retries. |

---

## Target Workflow

Design Operator v1 uses this provider-neutral state machine:

```text
brief
  -> fact check
  -> asset protocol
  -> direction proposal
  -> execution target selection
  -> generate v1
  -> inspect output
  -> critique
  -> revise
  -> handoff/export
```

Each state records evidence and a next action. Provider adapters may skip or
expand states, but they must not take ownership of the whole loop.

### State Responsibilities

| State | AOS responsibility | Provider responsibility |
|---|---|---|
| brief | Normalize user goal, audience, deliverable, constraints | None |
| fact check | Verify current product/company/tool facts when needed | None |
| asset protocol | Ask for or locate brand/product/UI assets; freeze local notes | None |
| direction proposal | Offer 2-3 distinct design directions | None |
| target selection | Choose local HTML, Gemini Canvas, or another adapter | Open/create target surface |
| generate v1 | Send structured prompt package | Produce artifact |
| inspect output | Capture preview, DOM/code/logs where possible | Expose visible state |
| critique | Score against rubric; propose concrete deltas | Optional self-critique only |
| revise | Send bounded delta prompt or direct edit instruction | Apply revision |
| handoff/export | Produce link/files/summary and note unresolved risks | Export/share when user approves |

---

## File Structure

Create:

- `docs/recipes/design-operator.md`  
  Provider-neutral SOP and state machine.

- `docs/recipes/gemini-canvas-design-operator.md`  
  Browser co-presence recipe for opening and driving Gemini Canvas on behalf of
  the user.

- `skills/design-operator/SKILL.md`  
  User-invoked local skill that tells an agent how to run the workflow, including
  asset protocol, direction proposal, critique, and handoff rules.

Optional follow-up:

- `recipes/design/operator-readiness.json`  
  A deterministic `aos ops` recipe that checks runtime/browser prerequisites
  once those checks are stable enough for source-backed automation.

Do not create:

- A vendored `huashu-design/` directory.
- Copied Huashu `assets/`, `references/`, `scripts/`, demos, or prompt text.
- A Gemini-specific top-level AOS primitive.

---

## Task 1: Write the Provider-Neutral Recipe

**Files:**

- Create: `docs/recipes/design-operator.md`

- [ ] **Step 1: Define trigger and scope.**

Document that this recipe applies when the user asks for prototypes, landing
pages, slide decks, infographics, animation concepts, design directions, visual
critique, or browser-canvas design operation.

Explicitly exclude production app engineering, backend work, SEO sites, and
unapproved commercial reuse of restricted third-party skill packs.

- [ ] **Step 2: Define the state machine.**

Add the `brief -> fact check -> asset protocol -> direction proposal -> target
selection -> generate v1 -> inspect -> critique -> revise -> handoff/export`
flow with entry/exit criteria for each state.

- [ ] **Step 3: Define evidence requirements.**

Require each design loop to keep a short evidence trail:

- source facts checked
- assets used or missing
- selected direction and rejected alternatives
- screenshots or visible inspection notes
- critique deltas
- handoff/export state

- [ ] **Step 4: Define human checkpoints.**

Require a human pause before:

- logging into a service
- sharing or publishing
- exporting to an account-owned destination
- spending paid credits
- accepting a subjective final design call

- [ ] **Step 5: Link issue #140.**

Add a `Tracking` line pointing back to the GitHub issue.

---

## Task 2: Write the Gemini Canvas Adapter Recipe

**Files:**

- Create: `docs/recipes/gemini-canvas-design-operator.md`

- [ ] **Step 1: State the adapter boundary.**

Document Gemini Canvas as one execution target under Design Operator, not the
workflow owner.

- [ ] **Step 2: Use user-attached browser semantics.**

Describe the preferred setup as a visible, user-owned browser session. The user
handles account/login consent. The agent may navigate, select Canvas mode, paste
structured prompts, inspect visible results, and propose revisions.

- [ ] **Step 3: Define browser control loop.**

Use the AOS verb model:

```text
see browser state
do browser action
see generated result
show overlay/commentary when useful
ask/tell human at checkpoint
```

- [ ] **Step 4: Define fallback behavior.**

If selectors drift, Canvas mode is unavailable, login blocks the flow, or visual
confidence drops, the recipe must stop and hand the current state to the human.

- [ ] **Step 5: Define verification.**

Require at least one captured preview or explicit human-confirmed visual state
before claiming the design is ready.

---

## Task 3: Scaffold the Local Design Operator Skill

**Files:**

- Create: `skills/design-operator/SKILL.md`

- [ ] **Step 1: Confirm local skill convention.**

Inspect existing local skills and use the same front-matter conventions. If
there is a user-only key in use, follow it; otherwise use the repo's current
documented convention.

- [ ] **Step 2: Write front matter.**

Use a description that triggers on design-operator, visual artifact generation,
Gemini Canvas operation, design directions, prototype/deck/infographic/motion
requests, and design critique.

- [ ] **Step 3: Encode workflow guidance.**

The skill body should point to the two `docs/recipes/` files and summarize:

- fact verification first for current products, companies, tools, and specs
- asset protocol before high-fidelity brand work
- three-direction fallback for vague briefs
- generate early, inspect visually, revise with bounded deltas
- critique dimensions and output format
- required human checkpoints

- [ ] **Step 4: Keep it AOS-native.**

The skill must reference AOS primitives and recipes, not Huashu internals. It may
credit Huashu as an inspiration/source pattern, but it must not copy restricted
prompt text or asset files.

---

## Task 4: Define a Minimal Readiness Check

**Files:**

- Modify: `docs/recipes/design-operator.md`
- Optional create: `recipes/design/operator-readiness.json`

- [ ] **Step 1: Document manual readiness first.**

Add a small checklist:

- repo `./aos ready` status known
- browser adapter or direct browser control path available
- target provider reachable in a visible browser
- user has approved any login/account steps
- design brief and deliverable are clear enough to start

- [ ] **Step 2: Decide whether `aos ops` is appropriate.**

If the readiness checks are deterministic enough, add an `aos ops` recipe that
runs read-only checks. If they still depend on subjective browser/account state,
leave them as recipe prose and defer the ops recipe.

- [ ] **Step 3: Avoid runtime repair loops.**

The readiness check may report blockers, but it must not repeatedly repair
daemon, browser, or provider state. Follow `AGENTS.md`: use `./aos ready` and
only run repair when the user wants repair.

---

## Task 5: Verification Pass

**Files:**

- Read: `docs/recipes/design-operator.md`
- Read: `docs/recipes/gemini-canvas-design-operator.md`
- Read: `skills/design-operator/SKILL.md`

- [ ] **Step 1: License/IP review.**

Confirm the new docs do not copy Huashu prompt text, scripts, reference docs, or
assets. The plan may cite Huashu as source material and copy general workflow
ideas, but not restricted content.

- [ ] **Step 2: AOS boundary review.**

Confirm the workflow respects AOS layering:

- primitives stay in `src/`
- reusable SOPs stay in `docs/recipes/`
- skill guidance stays in `skills/`
- provider-specific UI control stays in adapter recipes
- toolkit/app changes are deferred until a concrete UI need exists

- [ ] **Step 3: Dry-run with one sample prompt.**

Use a non-commercial, low-risk brief such as:

```text
Use Design Operator to create three directions for an AOS status dashboard
mockup, then choose one and produce a first-pass local HTML concept.
```

Expected result: the agent follows the state machine, asks for/notes assets,
offers distinct directions, and identifies the selected execution target before
generating anything high-fidelity.

- [ ] **Step 4: Document gaps.**

If the dry-run exposes missing browser adapter support, missing visual
inspection commands, or awkward human checkpoint phrasing, add follow-up issues
instead of widening this plan.

---

## Non-Goals

- No direct clone of Claude Design.
- No direct import of Huashu prompts, demos, starter assets, scripts, or BGM.
- No bypass of provider login, quota, billing, or sharing controls.
- No new AOS primitive until a repeated workflow proves the lower-level need.
- No claim that Gemini Canvas, Claude Design, or any provider is required for
Design Operator.

---

## Acceptance Criteria

- [ ] `docs/recipes/design-operator.md` exists and describes the provider-neutral
  workflow.
- [ ] `docs/recipes/gemini-canvas-design-operator.md` exists and describes the
  browser co-presence adapter.
- [ ] `skills/design-operator/SKILL.md` exists and points agents at the recipes.
- [ ] All new docs link to issue #140.
- [ ] The docs state the Huashu license/IP constraint clearly.
- [ ] The workflow includes explicit human checkpoints and verification gates.
- [ ] No restricted third-party content is vendored or copied.


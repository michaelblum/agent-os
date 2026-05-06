# 2026-05-05 Employer Brand Demo Postmortem

## Summary

The Employer Brand Audit demo did not meet the standard expected for a live stakeholder walkthrough. The prepared automation slice worked at the command level: it collected web artifacts, generated report data, and opened a report. The demo failed as an integrated AOS experience because the agent could not reliably control the visible surfaces, the report artifact was visibly under-polished, and the explanation drifted toward platform architecture when the stakeholder wanted a direct answer about the Employer Brand competitive comparison deliverable.

This was a demo readiness failure, not a single bug.

## What Worked

- The browser collection harness completed and reported `3/3` sources collected.
- The harness wrote a generated report data artifact and saved source artifacts.
- The generated report opened and demonstrated the intended pipeline shape: automated browsing, artifact capture, normalization, and report rendering.
- Foreground `./aos tell human --from-session-id codex-demo-speaker ...` produced reliable TTS after the initial fire-and-forget failure was identified.
- The user was able to manually recover the visual demo by moving the report window onto the shared display.

## What Failed

### TTS Reliability Was Misjudged

A fire-and-forget helper was created to reduce command overhead, but the first important spoken introduction did not come through the speakers. For a live demo, important speech should use the foreground `aos tell` route until AOS has an explicit acknowledgement that audio playback actually started or completed.

The helper reduced typing overhead but weakened observability. That trade-off was wrong for the demo.

### Surface Control Was Not First-Class Enough

When asked to move the report to the main display, the agent attempted ad hoc AppleScript, hit macOS automation restrictions, then partially switched to `aos do`. This was visibly slow and brittle.

The expected AOS behavior is:

- resolve the visible report surface or browser window,
- identify the main display,
- move or re-open the artifact there,
- and confirm the result quickly.

That path is not yet available as a single reliable AOS action. The agent had primitives, but not enough routing, registry, and artifact-window control to behave like a competent surface operator.

### The Report Was Demo-Grade, Not Stakeholder-Grade

The report proved that data could flow from collection into a rendered artifact. It did not prove that AOS can yet produce a credible Employer Brand competitive comparison report.

Visible issues included:

- citation formatting/order problems, including odd reference rendering such as `3312`,
- weak presentation polish,
- insufficient narrative quality,
- unclear relationship between collected evidence and final claims,
- and a gap between "generated report shell" and "client-ready competitive comparison."

The demo should have been framed as a pipeline prototype before showing it, or the artifact should have been polished enough to survive stakeholder inspection.

### The Explanation Did Not Stay Anchored To Stakeholder Value

The stakeholder wanted to know when the Employer Brand Audit competitive comparison report would be useful. The answer eventually converged on a practical estimate, but too much demo time was spent explaining AOS, wiki surfaces, and future workbench ideas.

For this audience, the primary story should have been:

1. We can automate collection of employer brand web evidence.
2. We can turn that evidence into a structured comparison.
3. The near-term deliverable is a repeatable competitive comparison report.
4. Platform work matters only insofar as it improves speed, traceability, and polish.

### Wiki Workbench Was Not Ready As A Demo Surface

The wiki workbench is conceptually important, but it was not ready to answer the live question "show me the Employer Brand Audit note" instantly. The agent had to reason about paths and canvas URLs instead of using a first-class object/action registry.

The missing path is:

`open employer brand audit note -> resolve wiki node -> open correct editor/workbench -> focus it on shared display`

Until that exists, the wiki workbench should not be used as proof of agent-native knowledge navigation in a stakeholder demo.

## Root Causes

### Demo Scope Was Too Broad

The demo mixed at least four separate claims:

- AOS can speak as an embodied agent.
- AOS can control local surfaces.
- AOS can automate Employer Brand Audit collection.
- AOS can support future visual workbenches and editable artifacts.

Only the third claim had a narrowly prepared harness. The others were partially true but not demo-stable.

### AOS Primitives Exist But Product Actions Are Under-Specified

The low-level verbs exist: `see`, `do`, `show`, `tell`, and `listen`. The missing layer is product-action routing:

- open a named artifact,
- move a named surface to a named display,
- focus a named workbench,
- open a wiki node by semantic label,
- close/minimize/restore a surface consistently,
- and explain what is currently visible.

The demo exposed the gap between primitive availability and fluent agent operation.

### Artifact Identity Is Not Yet Strong Enough

The generated report was a file opened in a browser, not a first-class AOS artifact with an address, owner, display policy, source bundle, and workbench route.

For demos and real workflows, generated artifacts need stable metadata:

- artifact id,
- type,
- source workflow,
- source evidence bundle,
- render route,
- preferred surface,
- display placement policy,
- and edit/workbench affordances.

### The Agent Chose Mechanisms Instead Of A Demo Runbook

The agent improvised from available tools instead of following a preflighted runbook. That caused slow decision-making under pressure. A live demo should have a tiny deterministic script for each important move.

## Corrective Actions

### Before The Next Stakeholder Demo

- Create a single command that regenerates and opens the Employer Brand competitive comparison report on the main display.
- Create a fallback static polished report snapshot so the demo can continue if live collection fails.
- Fix citation ordering, deduplication, and rendering in the generated report.
- Add visible source evidence links or artifact references that make claims traceable.
- Prepare a short verbal script focused on stakeholder value, not platform internals.
- Use foreground TTS for all important spoken lines.
- Avoid untested live surface movement during the demo unless the action has a preflighted command.

### Near-Term Product Work

- Define an AOS artifact metadata contract for generated reports.
- Add a first-class route for opening an artifact in a workbench or browser surface.
- Add a first-class route for opening a wiki node by semantic label.
- Add a display placement action that can move or open an AOS-owned surface on a target display.
- Add a demo readiness recipe with preflight checks, known-good commands, and fallback states.

### Employer Brand Report Work

- Promote the demo report from shell to deliverable:
  - structured scoring,
  - stakeholder-readable findings,
  - source-backed claims,
  - screenshot evidence,
  - citation cleanup,
  - Symphony Talent styling,
  - and exportable HTML/PDF.
- Keep the speed-run scope separate from the larger AOS workbench roadmap.

## Revised Demo Narrative

The better demo story is:

"This is an early automated Employer Brand competitive audit. The agent collects evidence from selected employer brand sites, stores the source artifacts, maps the evidence into a comparison model, and renders a report. Today the report is rough, but the pipeline works. The next near-term milestone is a polished, repeatable report that can be reviewed by a stakeholder. The broader AOS platform then turns that report into a living artifact that humans and agents can inspect, edit, cite, and improve together."

## Practical Timeline Estimate

For the Employer Brand competitive comparison report alone:

- A rough automated report can be improved in a few days.
- A repeatable usable version should be achievable in about one week.
- A stakeholder-polished version, with better visuals, citations, screenshots, and narrative, is more realistically a two-week target.

That estimate assumes the scope is the report deliverable, not the full AOS workbench platform.

## Follow-Up Issues To Reconcile

This postmortem should be reconciled against existing work on:

- AOS work records and self-healing recipes,
- wiki/workbench artifact editing,
- panel/window placement and display ownership,
- generated report artifact contracts,
- and Employer Brand Audit workflow execution.

Do not let this become a broad new platform epic unless the report deliverable remains explicitly separated from the platform improvements it depends on.

---
name: work-retrospective
description: Use after a bounded goal is achieved, failed, paused, or handed off when the user asks for a retrospective, friction report, after-action review, lessons learned, or feedback about what should be improved in product ergonomics, operational procedures, tests, tooling, docs, architecture, or engineering workflow. Especially useful for GDI goal work where implementation evidence can reveal better primitives, clearer harnesses, or process improvements.
---

# Work Retrospective

Use this skill only after meaningful goal work has produced evidence. The task is not to justify the work or plan the next slice. The task is to mine the experience for improvements that would make future work easier, safer, faster, or more product-aligned.

## Scope

Look for friction in:

- product ergonomics and user-facing behavior;
- developer ergonomics, test harnesses, command surfaces, logs, and debug tools;
- operational procedures, handoffs, readiness gates, and cleanup paths;
- architecture boundaries, missing primitives, unclear ownership, and stale abstractions;
- docs, schemas, fixtures, and contracts that were incomplete or misleading;
- reviewability issues such as dirty worktrees, noisy output, hidden state, or brittle verification.

Do not invent broad roadmap work from weak evidence. Prefer concrete observations grounded in what happened during the goal.

## Inputs To Reconstruct

Before answering, quickly reconstruct the goal evidence from memory, local state, and available command output:

- the assigned goal and whether it passed, failed, paused, or needed a handoff;
- files, commands, tests, live runtime checks, or manual probes used;
- places where the work slowed down, became ambiguous, required workaround steps, or exposed surprising behavior;
- any remaining dirty state, stale runtime state, flaky checks, missing docs, or awkward commands.

If the evidence is too thin, say so and provide only cautious observations.

## Review Method

Classify each observation by impact:

- **Product Ergonomics:** affects how the product behaves, explains itself, or supports users and agents.
- **Operational Procedure:** affects readiness, cleanup, handoffs, runbooks, or verification loops.
- **Developer Tooling:** affects commands, logs, tests, fixtures, debug surfaces, or harnesses.
- **Architecture/Primitive:** suggests a missing lower-level capability, unclear boundary, or misplaced policy.
- **Documentation/Contract:** affects source-of-truth docs, schemas, AGENTS guidance, or examples.
- **Reviewability:** affects how easy the change is to inspect, isolate, or safely land.

For each item, include:

- the friction or inefficiency observed;
- why it matters;
- the smallest useful improvement;
- whether it is evidence-backed or an inference.

## Output Format

Keep the answer concise and directly useful. Start with a small YAML frontmatter block for consumers, then a one-sentence assessment, then the highest-signal findings in priority order.

The frontmatter should be stable and compact:

- `type`: always `work_retrospective`;
- `goal_status`: `achieved`, `failed`, `paused`, `handoff`, or `unknown`;
- `evidence`: short list of evidence classes, such as `tests`, `runtime_probe`, `diff`, `logs`, `manual_observation`;
- `generated_at`: local date in `YYYY-MM-DD` form when known;
- `scope`: short human-readable phrase for the completed work;
- `report_path`: absolute path where this report was written, when a file artifact was produced.

## Report Artifact

On each invocation, write the full markdown report to a temp artifact before replying:

- Use `${TMPDIR:-/tmp}/aos-work-retrospective.md` as the default path.
- Overwrite that file on each invocation; do not append.
- If an existing file is present, it is expected to be replaced by the current report.
- After writing, read the file back once to verify the artifact matches the intended report.
- Reply with the path and a compact summary. Paste the full report only when the user explicitly asks for it in chat.

Use this shape:

```markdown
---
type: work_retrospective
goal_status: achieved
evidence: [tests, runtime_probe, diff]
generated_at: 2026-05-12
scope: "radial menu real-input and inspector mini-map"
report_path: "/tmp/aos-work-retrospective.md"
---

Yes. The work exposed a few concrete improvement opportunities:

1. **Category:** Short finding.
   Why it matters: ...
   Smallest improvement: ...
   Evidence: ...

2. **Category:** Short finding.
   Why it matters: ...
   Smallest improvement: ...
   Evidence: ...
```

If no meaningful friction surfaced, say that clearly and name any residual uncertainty.

## Guardrails

- Keep observations grounded in the completed work, not general preferences.
- Separate facts from inferences.
- Do not assign owners, create issues, commit changes, or start implementation unless the user explicitly asks.
- Do not relitigate implementation details unless they explain the improvement opportunity.
- Prefer a small number of sharp findings over a long inventory.

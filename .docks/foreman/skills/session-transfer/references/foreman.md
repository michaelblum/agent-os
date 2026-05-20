# Foreman Successor Handoffs

Use this reference when Foreman transfers current coordination state to a
successor Foreman session.

## Successor Contract

A successor handoff is state compression for Foreman continuity. It helps the
next Foreman choose and execute the next reversible coordination step. It is
not a GDI work card, Operator run, relay packet, or durable design artifact.

Use successor handoffs for:

- compaction or context exhaustion;
- thread or session switches;
- Foreman-to-Foreman continuity after review, GitHub, or branch hygiene work;
- preserving ephemeral state that cannot be rediscovered cheaply.

Do not use successor handoffs to assign implementation to GDI, supervised checks
to Operator, or external relay work. Reclassify those as separate transfer kinds.

## Storage And Dispatch

Successor handoffs are ephemeral by default:

- write the handoff to `mktemp -t foreman-handoff-XXXXXX.md` unless the user
  explicitly asks for chat-only output;
- read the temp file before writing to it when building the successor handoff;
- copy the handoff with `.docks/foreman/scripts/handoff --target-dock foreman`
  only when another Foreman session should start from it;
- do not put successor handoffs under `docs/design/work-cards/`;
- do not commit successor handoff temp files or chat recovery copies.

If a durable note is needed, create the durable artifact explicitly as a design
note, issue, PR comment, or GDI work card, then reference it from the successor
handoff. Do not make the handoff itself durable by changing its path.

## Required Slots

Include only what the next Foreman needs to continue:

- active focus, hard boundaries, and current owner;
- accepted slices, pending correction/review, human-only blockers, and the
  single best next action;
- git/GitHub hygiene: branch, base, head SHA, dirty/untracked state, issue or PR
  state, and paths not to touch;
- verification/runtime evidence already gathered, including commands and exact
  results;
- durable references by path, URL, issue, PR, commit, branch, log, screenshot,
  or artifact;
- ephemeral state only when it cannot be rediscovered;
- suggested skills for the next session, or `Suggested skills: none`.

## Guardrails

- Do not duplicate content already captured in work cards, PRDs, ADRs, issues,
  PRs, commits, diffs, or test artifacts. Reference those artifacts instead.
- Do not summarize a work card into the successor handoff when a path reference
  is enough.
- Do not decide GDI branch bases or verification contracts from a successor
  handoff. Put those facts in a GDI work card.
- Do not call a successor handoff a work card.
- If the title says "Successor Foreman Handoff" and the path is
  `docs/design/work-cards/`, stop and fix the classification before committing.

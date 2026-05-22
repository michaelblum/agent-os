# Operator Run Transfers

Use this reference when Foreman routes supervised or human-in-the-loop work to
Operator.

## Operator Contract

Operator runs live or supervised checks and reports evidence. Operator does not
own implementation, branch strategy, issue hygiene, or next-slice selection
unless the transfer explicitly says so.

## Required Slots

An Operator transfer should include:

- exact surface, command, URL, issue, or artifact to inspect;
- what the human or live environment should confirm;
- bounded setup commands;
- maximum number of retries or screenshots/traces to collect;
- stop condition for permission/TCC blockers;
- evidence to return to Foreman.

For non-trivial or long Operator runs, write these slots into a Markdown work
card under `docs/design/work-cards/operator-<card>.md` and copy only:

```text
follow the instructions in docs/design/work-cards/operator-<card>.md
```

Use direct clipboard instructions only for short self-contained checks that are
comfortably under the CLI goal limit.

## When To Use Operator

Prefer Operator when:

- the proof depends on a real live AOS canvas or real input;
- a human has explicitly put themselves in the verification loop;
- the task is observation or annotation, not deterministic implementation;
- GDI would otherwise burn context trying to recover a runtime blocker.

Do not route deterministic Node tests, static docs audits, or simple grep-based
validation to Operator.

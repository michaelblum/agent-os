# AOS Control-Surface Exit Interview

Use this reference with the parent `work-retrospective` skill when a Goal Driven
Implementation session has completed its implementation, verification, and
commits, and the user asks for an AOS/GDI exit interview or command-surface
friction report. The interview is read-only. Its purpose is to learn how well
the AOS command surface served an agent that was required to use it.

The output should capture friction, misunderstandings, useful affordances,
missing command shape, stale help, verification gaps, and any place where forced
AOS usage improved or degraded the work. This is product ergonomics evidence,
not a performance review of the agent.

## Timing

Run the interview after the implementation evidence is fresh:

1. Code/docs/tests are complete.
2. Required verification has run.
3. Commits are created if the session was asked to commit.
4. The worktree state has been reported.
5. The goal is not yet marked complete.

If the goal was already marked complete, run the interview immediately afterward
in the same session. The signal is still useful, but slightly less fresh.

Do not run the full interview at the beginning of a GDI session. If a prompt
mentions the interview up front, treat that as an instruction to notice concrete
AOS friction during the run; perform the actual interview only after the goal
work, verification, and commits are complete.

## Ground Rules

- Do not edit files for the interview.
- Do not create commits, issues, PRs, canvases, or durable notes for the
  interview unless explicitly asked.
- Do not flatter AOS or the user. Report concrete evidence.
- Separate observed facts from inference.
- Prefer specific command examples, error messages, recovery steps, and time or
  attention cost over general opinions.
- Treat missing data as missing data. Do not invent telemetry.
- Keep the final interview compact by default. Preserve the headings, but prefer
  one to three high-signal bullets per section unless a serious incident needs
  more detail.
- Do not let unavailable read-only evidence commands block goal completion.
  Record what was skipped and why.

## Evidence Packet

Before answering, gather the smallest available read-only packet. Use commands
that exist in the current checkout; skip unavailable commands and say what was
skipped.

```bash
./aos introspect review --json
./aos dev audit --json
./aos help --json
git status --short --branch
git diff --name-only origin/main...HEAD
```

Use `origin/main...HEAD` as the default comparison when the active workflow
profile or assigned handoff used a branch. If the active profile or assigned
handoff explicitly kept the GDI session on `main`, report
`git status --short --branch`, the local commit range or file diff that best
describes the session, and name the base you used.

If the session changed files, also run:

```bash
./aos dev recommend --json --files <changed-files...>
```

Optional context when relevant:

```bash
./aos show list --json
./aos ready
./aos help <command> --json
```

Do not over-collect. The point is to prime a better interview, not to rerun the
whole session.

## Interview Output

Return a structured answer with these sections.

### Session Context

- goal:
- branch:
- issue:
- commits:
- primary AOS commands used:
- AOS commands avoided or bypassed:
- evidence commands run:
- evidence commands skipped:

### Ratings

Score each item from 1 to 5 and give one sentence of evidence.

- command discoverability:
- help and JSON usefulness:
- dev workflow router usefulness:
- readiness and daemon ergonomics:
- `see` / `do` / `show` fit for the task:
- semantic target and ref clarity:
- `state_id` and stale-state clarity:
- verification ergonomics:
- forced-AOS value:
- overall AOS control-surface fit:

### Critical Incidents

List three to five concrete moments. Use this shape:

- situation:
- command or surface involved:
- expected:
- actual:
- recovery:
- time or attention cost:
- evidence:
- suggested fix:

### Misunderstandings Or Ambiguity

- naming that confused you:
- stale docs, help, or examples:
- command shape that invited wrong use:
- missing affordance:
- what would have prevented it:

### Forced-AOS Assessment

- Where did AOS materially improve correctness, observability, or safety?
- Where did AOS feel ceremonial or slower than the task required?
- Which shell, browser, or manual fallback did you want to use, and why?
- Should AOS add, change, hide, or document anything to make that path natural?

### Improvement Backlog

Give up to seven proposals. For each:

- title:
- category: docs/help | command surface | JSON/schema | state/daemon |
  `see/do/show` | dev workflow | testing | prompt/process
- severity: high | medium | low
- change type: docs | help | CLI | schema | test | workflow | primitive
- evidence:
- proposed acceptance test:

### Prompt Change

Suggest one sentence to add, remove, or change in future GDI prompts.

### Command-Surface Change

Name the single highest-leverage AOS command, help, or schema improvement.

### Durability Gate

Do not create durable follow-up by default. Recommend durable follow-up only
when the interview reveals a repeated, high-severity, or contract-level issue.

For each recommended follow-up:

- finding:
- evidence:
- why durable:
- target boundary: AGENTS.md | docs/recipes | docs/api | shared/schemas |
  GitHub issue | none
- suggested title:

Skip ADRs unless the decision is hard to reverse, surprising without context,
and the result of a real trade-off.

## Output Contract

The parent `work-retrospective` skill owns the temp report artifact. Inside that
report, preserve the headings above. If a downstream collector needs JSON, wrap
the same fields in:

```json
{
  "type": "aos.gdi_exit_interview.v0",
  "session_context": {},
  "ratings": {},
  "critical_incidents": [],
  "ambiguity": {},
  "forced_aos_assessment": {},
  "improvement_backlog": [],
  "prompt_change": "",
  "command_surface_change": "",
  "durability_gate": []
}
```

## Future Automation Hook

A future read-only helper can prepare an evidence packet before the interview:

```bash
node scripts/aos-gdi-exit-packet.mjs --issue <n> --base <ref>
```

The helper should gather command-registry statistics, `introspect review`,
`dev audit`, `dev recommend`, git state, issue metadata, and recent
agent-introspection telemetry. It should not infer conclusions by itself; it
should give the agent a compact packet to interpret in the interview.

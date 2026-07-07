# AOS Skills Agentic Efficacy Eval V0

Date: 2026-07-07

## Purpose

This report records the V0 test pattern for measuring whether installable AOS
skills actually help agents choose the right direct `./aos` workflows across a
model and reasoning-effort matrix.

The harness keeps scoring separate from live provider execution. It scores
captured responses first, can emit prompt packets for external runners, and now
includes a capture-only OpenAI Responses adapter for fixture matrix rows that
explicitly declare `adapter: "openai-responses"`.

## External Patterns Used

- Playwright CLI frames skills as locally installed reference material that
  coding agents can discover and use. Its README explicitly positions CLI plus
  skills as token-efficient for high-throughput coding agents, while MCP remains
  useful for persistent, rich exploratory loops.
  Source: https://github.com/microsoft/playwright-cli and
  https://playwright.dev/agent-cli/skills
- BrowserGym/WorkArena style evaluations emphasize executable environments,
  multimodal observations, action spaces, and task success rather than prose
  agreement.
  Source: https://github.com/servicenow/browsergym and
  https://servicenow.github.io/WorkArena/
- WebArena and Online-Mind2Web highlight that realistic task success and
  functional correctness matter more than easy static snapshots or optimistic
  judge-only scores.
  Sources: https://arxiv.org/abs/2307.13854 and
  https://arxiv.org/html/2504.01382v4
- OSWorld, AndroidWorld, and WindowsWorld reinforce that desktop/computer-use
  evaluations need controlled initial state, state-derived rewards, and
  intermediate progress checkpoints for long-horizon tasks.
  Sources: https://os-world.github.io/,
  https://google-research.github.io/android_world/, and
  https://arxiv.org/html/2604.27776v1
- The live OpenAI runner uses the Responses API with model/reasoning inputs and
  Structured Outputs JSON schema capture; the scorer remains provider-neutral.
  Sources: https://platform.openai.com/docs/api-reference/responses/create and
  https://developers.openai.com/api/docs/guides/structured-outputs

## V0 Repo Shape

- Scorer and prompt-packet module:
  `scripts/lib/aos-skills/eval.mjs`
- Captured-run file writer:
  `scripts/lib/aos-skills/captured-runs.mjs`
- OpenAI Responses adapter:
  `scripts/lib/aos-skills/openai-responses-runner.mjs`
- CLI:
  `node scripts/aos-skills-eval.mjs --fixture <path> --json`
- Live capture runner:
  `node scripts/aos-skills-eval.mjs --fixture <path> --run-openai --output-dir <dir> --json`
- Fixture:
  `tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json`
- Tests:
  `tests/aos-skills-eval.test.mjs`

## What V0 Measures

Each captured model response is scored on:

- response shape: selected skills, selected commands, decision, stop condition;
- current skill selection: required skills present, retired skills absent;
- command validity: every selected direct `./aos` command must match the current
  generated command manifest and cannot use unsupported flags;
- required checkpoints: task-specific command patterns must be present;
- reasoning judgment: decision and stop-condition terms must preserve the
  expected operating boundary;
- boundary avoidance: wrappers, raw daemon access, unsupported desktop verbs,
  stale Playwright boundary violations, or unsafe coordinate shortcuts fail the
  case.

## Running It

Evaluate captured fixture responses:

```bash
node scripts/aos-skills-eval.mjs \
  --fixture tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json \
  --json
```

Emit prompt packets for a model/reasoning matrix:

```bash
node scripts/aos-skills-eval.mjs \
  --fixture tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json \
  --emit-prompts /tmp/aos-skills-eval-prompts \
  --json
```

Capture live OpenAI Responses API output for a subset of the matrix:

```bash
OPENAI_API_KEY=... node scripts/aos-skills-eval.mjs \
  --fixture tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json \
  --run-openai \
  --output-dir /tmp/aos-skills-eval-responses \
  --matrix codex-gpt-5.4-mini-high \
  --session-id first-live-pass \
  --json
```

The OpenAI adapter writes captured response files atomically and does not
overwrite an existing run file by default. Use a distinct `--session-id` for each
trial, or pass `--replace` only when intentionally replacing the same trial.

Feed captured JSON responses back through `--responses-dir` for scoring:

```bash
node scripts/aos-skills-eval.mjs \
  --fixture tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json \
  --responses-dir /tmp/aos-skills-eval-responses \
  --json
```

## Next Iteration

V1 should add repeated-trial aggregation, cost/latency summaries, and additional
provider adapters with explicit matrix `adapter` ownership. Do not move to
live-desktop task execution until captured-response scoring is stable. Live
execution should add state-derived rewards and process checkpoints, not replace
command-manifest and boundary scoring.

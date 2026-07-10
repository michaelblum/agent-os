---
name: aos-maintainer-routing
description: Route AOS maintainer validation through deterministic repo workflow rules. Use inside agent-os when choosing proof or test commands for changed files, proof-worth assets, command surfaces, docs, skills, or implementation paths; call node scripts/aos-dev-workflow.mjs recommend.
---

# AOS Maintainer Routing

Use this skill to choose verification for changes in this repo.

## Workflow

1. Work from the repo root.
2. Prefer the direct backing script:

   ```bash
   node scripts/aos-dev-workflow.mjs recommend --json --paths <changed paths>
   ```

   Use `--files <path...>` when shell quoting a space-separated path list is clearer.
3. Read `summary.rule_ids`, `next_commands`, `verification`, and `proof_worth`.
4. Run the recommended commands unless the user explicitly narrowed the proof lane.
5. Treat `proof_worth.status: failed` as a stop condition. Register, replace, or remove the proof asset rather than ignoring the failure.

## References

- `docs/dev/workflow-rules.json`
- `docs/dev/test-proof-registry.json`
- `docs/dev/test-proof-registry.d/`
- `scripts/aos-dev-workflow.mjs`
- `tests/dev-workflow-router.sh`

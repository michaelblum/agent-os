# Recipe: Value-Of-Information Clarification

Use this recipe when an AOS agent must choose between acting now, gathering
more structured context, looking at pixels, or asking the human to clarify.

The goal is to spend attention on observations that can change the decision.
This is guidance, not an executable policy or schema-backed run-control
contract.

## Default Order

Start with the cheapest reliable source that can answer the question.

1. Use a readiness-gated live path when the task depends on live perception,
   action, canvas projection, or input routing. A prior explicit readiness
   check or a deterministic capability preflight may satisfy the gate. Recheck
   only when the required capability lease is missing or invalidated; do not
   poll readiness on every turn. If readiness is blocked, report the concrete
   blocker instead of guessing from stale state.
2. Use structured perception first: `see`, `inspect`, `target.probe`, known
   refs, semantic names, accessibility roles, handles, and adapter metadata.
3. Use addressable semantic expansion when the target exposes a cheap deeper
   read through `target.probe.available_expansions` or an adapter-specific
   handle.
4. Use projection-backed clarification when the missing fact is spatial,
   referential, or ambiguous to the agent but easy for the human to answer.
5. Use visual capture or pixel inspection when the task depends on appearance,
   layout, graphics, visual defects, screenshots, or other state not available
   through structured surfaces.
6. Act only when the remaining uncertainty is acceptable for the risk of the
   operation.

## Structured First

Prefer structured target metadata over pixels when the question is about:

- which control, window, canvas, or browser element is active
- available action routes or command forms
- semantic labels, roles, values, and enabled/selected state
- element bounds, target refs, and adapter handles
- nearby context already exposed by the producer

Do not deepen perception just because the first packet is small. Deepen only
when the next observation can change the action choice, safety gate, or user
question.

## Projection-Backed Clarification

Use projection-backed clarification when ambiguity is mostly about "which one"
or "where" and the human can answer faster than the agent can infer.

Good candidates:

- multiple plausible targets with similar labels
- a region, path, or object that needs human intent confirmation
- a choice between visible options where structured metadata is incomplete
- a high-risk action where a one-turn confirmation avoids a bad edit or click

Pattern:

1. Use structured perception to identify candidate targets.
2. Use `show` to project labels, outlines, arrows, or small anchored affordances
   onto the candidates.
3. Use `tell human` or the active conversation channel to ask one concise
   question that references the projected labels.
4. Continue from the selected target and record the clarification only if it is
   useful durable evidence.

Projection should clarify the user's task, not add hidden agent-only controls.
For app or toolkit UI, keep visible text, accessibility names, and AOS routing
metadata distinct. See `docs/recipes/aos-app-accessibility-surfaces.md`.

## When Pixels Are Worth It

Use visual capture when the decision depends on visual facts that structured
perception cannot currently expose:

- graphical rendering defects
- canvas or WebGL content without a semantic companion layer
- color, contrast, opacity, overlap, or visual alignment
- screenshots requested by the user
- validating that projected or rendered UI is visible and correctly framed

Pixels are not a failure. They are just a more expensive observation. Prefer
them when they answer the actual uncertainty instead of forcing unreliable
semantic inference.

## When To Ask The Human

Ask the human when:

- the next step could cause destructive, external, or hard-to-revert effects
- available observations leave multiple plausible interpretations
- the human explicitly placed themselves in the verification loop
- the cost of a short question is lower than deep inspection or risky action

Ask a targeted question. Avoid broad "what should I do?" prompts when the agent
can narrow the choice to concrete labeled options.

## When To Execute

Execute when:

- the target and intended action are identified
- readiness and permissions are adequate for the path
- the action is reversible or the risk is acceptable
- additional perception is unlikely to change the choice
- any necessary human clarification has been captured

For repo work, use reversible checkpoints for meaningful slices. For runtime
work, prefer cleanup-aware commands, TTLs, or scoped helper daemons so the
environment can be restored.

## Anti-Patterns

Avoid these patterns:

- reading pixels first when semantic refs or AX data are available
- forcing a fixed confidence percentage without measured calibration
- hiding mandatory reasoning blocks in prompts or docs
- asking broad text-only questions when the ambiguity is spatial
- creating app-specific shortcuts for behavior that belongs in AOS primitives
- treating this recipe as an `aos ops` recipe or schema-backed policy

## Related

- `docs/api/target-probe.md`
- `docs/design/notes/2026-05-01-capability-preflight-readiness-lease.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/aos-app-accessibility-surfaces.md`
- `docs/design/notes/2026-05-01-evoi-placement-decision.md`

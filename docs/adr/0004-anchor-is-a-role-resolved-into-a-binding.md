# Anchor is a role at the input grammar; resolution produces an Anchor Binding

A **Target** is an AOS scope address. Live ref-addressed CLI target strings
currently include `browser:<session>[/<ref>]` and
`canvas:<canvas-id>/<ref>`. `screen` and `ax` remain target-model vocabulary,
but the current CLI exposes screen coordinate actions through raw `x,y` and
rejects `--state-id`, and AX actions through command arguments and flags such
as `--pid` and `--role`, rather than `screen:` or `ax:` target strings. A
**Ref** is the dialect-specific component of a semantic handle within a
Target's scope; a **Target-with-Ref** is the wire-form
`<dialect>:<scope>/<ref>` that `aos see`/`aos do`/`aos show` operate on where a
live target dialect supports refs. **Anchor** is not a separate primitive — it
is a *role* a Target-with-Ref plays when `aos show` uses it as a placement
reference. The display subsystem resolves an input Anchor into an **Anchor
Binding** that stores the lower-level placement state (e.g. `anchor_window +
offset`) and lifecycle behavior, distinct from the original input string.

We rejected treating Anchor as synonymous with Target/Ref (loses the role-vs-address split visible in the wire format) and rejected treating Anchor as a fully separate top-level primitive (the input really is a Target-with-Ref; the extra metadata only appears post-resolution as the Anchor Binding). Today's CLI exposes `--anchor-window` and `--anchor-channel` as concrete flags. Browser-window binding remains deferred by ADR 0041 checkpoint 2B; a generic `--anchor <target>` flag may consolidate admitted resolvers later, but the plan should describe the role-vs-binding model without misrepresenting the current command surface.

# Ethos: Foundation Breaking

AOS is currently foundation-forming, not compatibility-preserving deployment
software. For owned internal contracts, prefer cohesive contract replacement
and broad migration over aliases, shims, and timid incremental slices. Bounded
subagents are an execution strategy, not an architectural constraint.
Reversible means recoverable through git/process checkpoints, not preserving
obsolete contracts.

## Development Ethos

- Build for the platform before the app.
- Replace obsolete internal contracts when the owned callers can be migrated.
- Keep compatibility prose only when a real external consumer exists.
- Treat stale instruction scatter as a product bug.

## What Foreman Delegates

Foreman may delegate execution and evidence gathering, but architecture shape
and acceptance stay with Foreman unless the user explicitly assigns a different
authority.

# Sigil Reference Consumer And Toolkit Repository Boundary

**Status:** Accepted
**Date:** 2026-07-11

## Decision

Sigil is AOS's first-party reference consumer and the sole authority for the
branded Sigil product. Product needs may drive product-neutral AOS primitives,
toolkit policy, hosts, schemas, and public CLI contracts without waiting for a
second consumer.

The AOS toolkit remains a package boundary inside the `agent-os` repository. It
is versioned with the daemon, CLI, schemas, and command manifests as one
compatibility unit. Sigil may consume explicit public toolkit exports from its
pinned AOS revision, but it must not copy or freeze toolkit source in the Sigil
repository.

Cross-repository changes use a paired sequence:

1. Land the product-neutral AOS contract and its focused tests.
2. Pin that committed AOS revision in Sigil.
3. Verify the required public command forms and toolkit package at the pin.
4. Add or update the Sigil acceptance test for the product workflow.

The toolkit does not move to a separate repository merely to appear reusable.
Reconsider extraction only when independent consumers require a different
release cadence, the toolkit has a stable compatibility policy, and it builds
and tests without repository-private AOS dependencies.

## Context

Sigil and AOS need independent repositories because the product changes more
quickly than the privileged macOS permission holder. The toolkit has a
different coupling profile: its bridge, canvas lifecycle, DesktopWorld,
input-region, projection, panel, and windowing contracts sit directly over AOS
daemon primitives.

A third repository would add another revision and release edge to every native
product change without improving Sigil. Package-level exports and tests provide
the useful boundary while the AOS revision provides the compatibility unit.

## Consequences

- Sigil controls product priorities; AOS does not maintain an independent
  platform roadmap ahead of concrete product needs.
- AOS owns generic runtime, toolkit, and native capability contracts; Sigil owns
  branded composition, policy, state, onboarding, and UX.
- Toolkit publication, if later useful, can occur from `agent-os`; publication
  alone does not require repository extraction.
- Stock toolkit components and workbenches are still audited individually.
  Product-specific surfaces move to Sigil or retire instead of being preserved
  by an artificial repository split.

@../AGENTS.md

# Documentation

## Purpose

`docs/` contains durable project knowledge: ADRs, API contracts, guides,
developer workflow docs, design notes, reports, references, and archives.

## Ownership

- `adr/` owns durable architecture decisions.
- `api/` owns consumer-facing command, schema, and toolkit contracts.
- `guides/` owns repeatable procedures and checklists.
- `dev/` owns developer workflow profiles and reports.
- `agents/` owns issue, triage, and domain-doc practices.
- `design/` owns design notes, current work cards, and active architecture
  exploration before they graduate into ADRs, APIs, schemas, or guides.
- `proposals/` owns time-bounded implementation proposals and decision records
  before they graduate into ADRs, APIs, schemas, guides, or source contracts.
- `archive/` owns preserved historical material.

## Local Contracts

- Put stable contracts in the narrowest durable home.
- Do not bury architecture decisions in reports or work cards when an ADR,
  schema, API doc, or guide is the owner.
- Treat reports as historical evidence until current source manifests, schemas,
  `docs/api/`, help output, tests, Git, or live AOS state confirm the claim.
- Treat work cards as live dispatch context only; remove completed or superseded
  cards after promoting durable requirements to their owning source.
- Keep archives clearly historical and avoid linking them as active authority
  unless the current doc names the reason.

## Work Guidance

- Prefer short operational docs with explicit owners, commands, and verification
  routes.
- Remove stale instructions when replacing them with a canonical pointer.

## Verification

- For docs that describe command surfaces, run the named help, schema, or route
  test before closing the change when practical.
- For doc-only edits with no executable contract, run `git diff --check`.

## Child DOX Index

- `adr/` holds architecture decisions.
- `agents/` holds agent issue/triage/domain practices.
- `api/` holds public and consumer-facing contracts.
- `archive/` holds historical material.
- `design/` holds design exploration, transition notes, and current work cards.
- `dev/` holds developer workflow docs and reports.
- `guides/` holds repeatable procedures.
- `proposals/` holds implementation proposals and decision records.
- `reference/` holds external or factual references.
- `superpowers/` holds superpower documentation.
- `wiki/` holds wiki-related documentation.

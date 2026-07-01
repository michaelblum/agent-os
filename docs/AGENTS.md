@../AGENTS.md

# Documentation

## Purpose

`docs/` contains durable project knowledge: ADRs, API contracts, guides,
developer workflow docs, design notes, reports, references, and archives.

## Ownership

- `adr/` owns durable architecture decisions.
- `api/` owns consumer-facing command, schema, and toolkit contracts.
- `guides/` owns repeatable procedures and checklists.
- `dev/` owns developer workflow profiles, reports, and work cards.
- `agents/` owns issue, triage, and domain-doc practices.
- `design/` owns design notes and active architecture exploration before they
  graduate into ADRs, APIs, schemas, or guides.
- `archive/` owns preserved historical material.

## Local Contracts

- Put stable contracts in the narrowest durable home.
- Do not bury architecture decisions in reports or work cards when an ADR,
  schema, API doc, or guide is the owner.
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
- `design/` holds design exploration and transition notes.
- `dev/` holds developer workflow docs, reports, and work cards.
- `guides/` holds repeatable procedures.
- `reference/` holds external or factual references.
- `superpowers/` holds superpower documentation.
- `wiki/` holds wiki-related documentation.

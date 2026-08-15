@../AGENTS.md

# Companion Descriptors

## Purpose

`manifests/companions/` owns reviewed, source-pinned descriptors for external
tool runtimes managed by AOS.

## Ownership

- `playwright-cli-v1.json` owns the exact managed Playwright CLI package
  closure, package provenance, entrypoint, Node requirement, and resource
  limits.

## Local Contracts

- Descriptors use exact versions, exact tarball URLs, and exact SRI values.
- Keep package runtimes separate from browser binaries, AOS or upstream skill
  installation, extensions, global package managers, and lifecycle scripts.
- Descriptor changes require offline lifecycle and schema proof before any
  live browser lane.

## Work Guidance

## Verification

- Run `node --test tests/browser/companion-lifecycle.test.mjs tests/browser/companion-staging.test.mjs`,
  `node --test tests/browser/managed-session-lifecycle.test.mjs tests/browser/managed-session-consumers.test.mjs`, and
  `node --test tests/schemas/aos-browser-companion-v1.test.mjs`.

## Child DOX Index

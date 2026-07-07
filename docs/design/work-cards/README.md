# Work Cards

This directory stores current actionable transfer contracts.

A file existing here is active only when current Git, issue, PR, or runtime state
names it as an open queue item. Completed, accepted, superseded, or retired
cards should be removed from the live tree. Git history is the archive.
The directory may be empty except for this README; historical developer cards
under `docs/dev/work-cards/` are evidence, not live dispatch.

Before deleting a card, promote any still-current requirement into the owning
source, test, schema, API doc, ADR, or current owner doc. Do not keep stale cards
for evidence, searchability, or context.

For current contracts, prefer the owning source surface: ADRs, schemas,
`docs/api/`, command source manifests, generated help output, applicable
`AGENTS.md` files, tests, and live source code.

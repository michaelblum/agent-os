# Dev Reports

This directory stores durable audits, reviews, runtime notes, and investigation
reports.

Reports are evidence and historical orientation material, not standing
instructions. Query live Git, GitHub, and AOS state before routing follow-up
work. Then read only the report relevant to the current lane and treat any
status claims inside it as historical unless live systems confirm them.

For current contracts, start from the owning source surface instead of report
prose: command source manifests in `manifests/commands/source/`, generated
`./aos help ... --json`, schemas in `shared/schemas/`, consumer contracts in
`docs/api/`, applicable `AGENTS.md` files, and the tests named by those owners.
Use reports as evidence pointers after checking that source truth.

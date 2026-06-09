# Runtime: Passive Unless Approved

Use passive readback first: `git`, `./aos service status --mode repo --json`,
schema tests, static scans, and bounded process inspection.

Do not restart live AOS services, run HITL live smoke, rebuild repo-mode native
artifacts, or trigger manual TCC flows unless the user explicitly approves the
runtime action or the task specifically assigns that lower-level repair.

When a proof would disrupt the main Foreman thread or runtime, document it as a
required manual Foreman smoke before enabling that topology.

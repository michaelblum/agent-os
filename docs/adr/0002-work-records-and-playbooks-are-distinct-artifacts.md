# Work Records and Playbooks are distinct artifacts, bridged by an origin reference

**Status:** Accepted; amended by ADR 0013 and ADR 0040

ADR 0013 defines the broader AOS Execution Model V0 and clarifies that
Playbooks are guidance rather than the primary executable substrate. ADR 0040
clarifies that Work Records are optional evidence/history and never permission
grants. The Work Record/Playbook distinction remains active.

A **Work Record** is an optional durable AOS evidence/history artifact for a single run, carrying a durable intent spine, a repairable execution map, immutable evidence, and a verifier-written health verdict. A **Playbook** is method guidance that can shape how a human, agent, Recipe, Workflow, or gated harness approaches work, but it is not the executable substrate or the evidence log. Recipes, Workflows, ad-hoc work, and gated harness runs may emit Work Records when durable evidence is useful; a Work Record never grants permission to execute.

We rejected collapsing Playbook into "multi-step Work Record" (loses the distinction between guidance and historical evidence) and rejected pure orthogonality (loses the bridge from a run back to the method guidance or compatibility descriptor that shaped it). The bridge is an `origin` reference on the Work Record for executable origins and current v0 compatibility origins, plus `references[]` for guidance-only material; whether its shape is `{ kind, ref }` or per-kind explicit fields (`playbook_ref`, `recipe_ref`, `workflow_ref`) is deferred until "recipe" and "workflow" are themselves resolved as Subjects.

# Recipe, Playbook, and Workflow are three distinct artifacts on different scopes

Supersession note: ADR-0013 defines the formal AOS Execution Model V0 and
narrows **Recipe** to source-backed executable procedures. Markdown guidance
now lives under `docs/guides/` as Guides/SOPs, not Recipes.

**Recipe** is a reusable bounded executable procedure: how a piece of work might happen again through `aos recipe`, with explicit inputs, outputs, blocks, resources, and runtime behavior. **Playbook** is method/guidance for agents and humans, not the primary execution substrate. **Workflow** is an orchestration graph or chain that invokes Recipes, agent tasks, approvals, gates, external operations, and evidence handling, often crossing systems or human gates. All three are Subjects.

Composition: Workflows may invoke Recipes, gated harnesses, agent tasks, or human decisions; Recipes should not invoke Workflows (anything orchestrating multi-system gates and child runs *is* a Workflow). Executable origins can be the origin of a Work Record: `origin: { kind: "ad_hoc" | "recipe" | "playbook" | "workflow", ref: <handle> | null }` in the current v0 schema. Markdown Guides/SOPs that guided a run without executing are cited via a separate `references[]` array with `relationship: "guided_by"`, not as origin.

We rejected collapsing Workflow and Playbook into one artifact at different abstraction levels (loses the audience/scope distinction: a Workflow with Slack approvals and external jobs is doing fundamentally different work than method guidance) and rejected dropping Recipe in favor of Playbook-only (loses the executable source-backed procedure layer).

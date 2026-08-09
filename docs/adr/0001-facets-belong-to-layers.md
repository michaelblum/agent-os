# Facets are projections within Layers, not a replacement for them

The `aos.workbench.subject` model uses a fixed taxonomy of **Layers**
(narrative → descriptor / execution map → controls / editor → artifacts /
evidence → health / verification) defined in
`docs/guides/layered-subject-expressions.md`. **Facets** are concrete
addressable projections of a Subject: each Facet declares which Layer it
occupies, and one Layer can be served by multiple Facets (for example, Markdown
and audio Facets can both serve the narrative Layer). The active workbench
schema and API own the concrete descriptor contract.

We chose this over making Facet a synonym for Layer (which would lose the ordered taxonomy and break the recipe) and over treating Facet as an orthogonal axis (which would create a Layer × Facet grid that nothing in the wiki/workbench/verifier surfaces actually needs).

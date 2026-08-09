# AOS Step Descriptor v1

Status: active neutral one-step descriptor contract. The JSON Schema in
`aos-step-descriptor-v1.schema.json` is the only Step Descriptor schema
accepted by the active harness and Work Record capture bridge.

A Step Descriptor declares intent, target resolution, preconditions, one
action, postconditions, repair hints, claim promotions, and evidence
requirements. It is descriptive input to a caller-selected harness. It does not
grant permission, require approval, classify risk, or constrain execution to an
AOS-owned operation registry.

The one-step harness either consumes saved evidence or invokes a
caller-supplied adapter. In both modes it emits a Work Record v1 and runs the
report-only verifier. Simulation and execution use the same exact descriptor
and evidence contract; neither mode accepts an authority token.

`aos-step-descriptor-v0.schema.json`, its Markdown, and its fixtures are
frozen historical bytes. Active harnesses reject V0 rather than translating or
silently upgrading it.

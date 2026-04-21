# Integration Broker Snapshot

**File:** `integration-broker-snapshot.schema.json`  
**Producer:** `packages/gateway` integration broker  
**Consumers:** toolkit `integration-hub`, Sigil workbench, future provider adapters, local operator tools

## What This Is

A provider-neutral snapshot contract for chat-driven integrations.

The same snapshot should work for:

- Slack as the current transport
- Discord or other chat providers later
- local operator surfaces inside toolkit/Sigil
- future dashboards or status pages outside the browser surface

The contract keeps provider state, workflow catalog, and recent job history in
one place instead of baking Slack-specific assumptions into toolkit or Sigil.

## Top-Level Shape

```json
{
  "schema": "aos-integration-broker-snapshot",
  "version": "1.0.0",
  "generated_at": "2026-04-20T12:00:00Z",
  "broker": {
    "label": "AOS Integration Broker",
    "url": "http://127.0.0.1:47231"
  },
  "surfaces": [ ... ],
  "providers": [ ... ],
  "workflows": [ ... ],
  "jobs": [ ... ]
}
```

## Design Rules

- `providers` describe transport adapters, not app surfaces.
- `workflows` describe reusable commands exposed through providers.
- `workflows[].inputFields` describe provider-neutral launch inputs for
  structured workflow starts such as Slack modals.
- `workflows[].availability` separates launch-ready flows from live-registry
  entries that are only discoverable today.
- `workflows[].group` lets providers cluster controls into the same hierarchy
  without inventing Slack-only groupings.
- `jobs` describe executions of workflows, regardless of transport.
- `surfaces` are UI hints for consumers such as toolkit or Sigil.
- Provider-specific metadata may live in `jobs[].metadata`, but the top-level
  contract stays transport-neutral.
- Provider-native UI such as Slack App Home, Block Kit buttons, or Discord
  components should be derived from this snapshot and the shared workflow
  catalog rather than stored as transport-specific top-level schema.

## Workflow Inputs

Structured workflow launches can advertise `inputFields` so transports can
collect data without inventing transport-specific forms.

Current shared field model:

- `id`
- `label`
- `type`: `text`, `textarea`, or `select`
- `placeholder`
- `helpText`
- `required`
- `options` for `select` fields, each with:
  - `value`
  - `label`
  - `description` (optional)

This is enough for Slack modals today and should also map cleanly to future
Discord forms or toolkit-hosted launch UIs. `select` options are important for
live indexed pickers such as Wiki Search.

## Workflow Availability

Current shared workflow availability values:

- `ready`
- `coming-soon`

Current shared workflow groups:

- `quick-actions`
- `research`
- `launch`
- `feedback`
- `discovery`

These are presentation hints for provider surfaces and browser/operator UIs.
They are intentionally provider-neutral.

## Surface IDs

Current shared surface IDs:

- `jobs`
- `workflows`
- `integrations`
- `activity`

Consumers may render these as tabs, routes, or sections. They should not invent
a parallel naming scheme for the same concepts.

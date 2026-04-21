# Integration Broker API

Consumer-facing reference for the provider-neutral chat integration broker in
`packages/gateway`.

Use this doc when you are:

- wiring Slack or a future Discord-style provider into agent-os
- building a browser/operator surface that needs workflow + job state
- reviewing changes to the broker snapshot or local HTTP API

## What The Broker Is

The integration broker is a local Node service that sits between chat providers
and agent-os workflows.

Current pilot shape:

- Slack Socket Mode adapter as the first transport
- provider-neutral workflow registry
- persistent local job history
- local HTTP snapshot API for toolkit/Sigil

The broker is intentionally transport-neutral at the contract layer. Slack is a
runtime adapter, not the schema.

## Start

From `packages/gateway/`:

```bash
npm install
npm run build
npm run start:broker
```

Default local bind:

- `http://127.0.0.1:47231`

Override with:

```bash
AOS_INTEGRATION_HTTP_PORT=48200 npm run start:broker
```

## Slack Configuration

Set these environment variables before starting the broker:

```bash
export AOS_SLACK_BOT_TOKEN=xoxb-...
export AOS_SLACK_APP_TOKEN=xapp-...
```

Optional:

```bash
export AOS_SLACK_SIGNING_SECRET=...
export AOS_SLACK_COMMAND=/aos
```

If Slack tokens are missing, the broker still starts and exposes the local HTTP
surface. Slack simply appears as `disabled` in the provider snapshot.

The broker also auto-loads local env files from `packages/gateway/`:

- `.env`
- `.env.local`

Environment variables already present in the shell win over file-based values.
A checked-in template lives at:

- `packages/gateway/env.example`

### Slack App Features

The current Slack adapter now supports three interactive surfaces:

- conversation commands in DMs and `@mentions`
- interactive Block Kit controls in replies
- App Home as a persistent dashboard for jobs, workflows, and provider state

To light those up in Slack app settings:

- enable `Socket Mode`
- enable `App Home` with the `Home Tab`
- enable `Interactivity & Shortcuts`
- subscribe to bot events:
  - `app_mention`
  - `message.im`

Recommended bot scopes for the current broker:

- `chat:write`
- `app_mentions:read`
- `im:history`

Optional if you want `/aos`:

- add the `commands` scope
- create a slash command matching `AOS_SLACK_COMMAND` or the default `/aos`

Current interactive behavior:

- `menu`, `help`, or `?` returns a Block Kit control surface
- the control surface is grouped into quick actions, research, launch, and
  feedback sections instead of one flat button row
- quick actions run `status`, `features`, and `jobs`
- research actions include `Wiki Search`, `Workflow Catalog`, and `Coming Soon`
- feedback actions include `Feature Request` and `Report a Bug`
- `Wiki Search` opens a modal with both a free-text query and a live indexed
  wiki picker
- App Home now includes a broker-owned wiki browser that simulates an
  expandable tree with root buckets (`Types`, `Tags`, `Plugins`), breadcrumbs,
  branch drilldown, and paged entry lists
- structured workflows can declare provider-neutral `inputFields`, which the
  Slack adapter turns into modals
- `app_home_opened` publishes the App Home dashboard

## Local HTTP API

### `GET /health`

Basic readiness check.

### `GET /api/integrations/snapshot?limit=12`

Returns the canonical snapshot for toolkit/Sigil.

Schema:

- [`shared/schemas/integration-broker-snapshot.md`](../../shared/schemas/integration-broker-snapshot.md)

### `GET /api/integrations/providers`

Returns only provider descriptors.

### `GET /api/integrations/workflows`

Returns the workflow catalog without job history.

### `GET /api/integrations/jobs?limit=20`

Returns recent jobs ordered by most recently updated first.

### `POST /api/integrations/workflows/:id/launch`

Structured workflow launch ingress for providers, local operators, or future
workers that need to start a workflow with named fields instead of a text
command.

Request body:

```json
{
  "provider": "slack",
  "requester": "U123456",
  "channel": "C123456",
  "thread": "1710000000.000100",
  "fields": {
    "clientCompanyName": "Acme Corp",
    "competitorCompanyNames": "Globex\nInitech",
    "areaOfFocus": "Engineering talent"
  }
}
```

### `POST /api/integrations/jobs/:id/complete`

Marks a queued or running job as completed, persists the result, and notifies
the original requester through the provider notifier when available.

Request body:

```json
{
  "summary": "Comparative audit is ready for review.",
  "lines": ["Stored in Google Drive."],
  "artifactLink": {
    "label": "Open audit",
    "url": "https://drive.google.com/..."
  }
}
```

### `POST /api/integrations/jobs/:id/fail`

Marks a queued or running job as failed and optionally notifies the requester.

### `POST /api/integrations/simulate`

Local operator/testing ingress that runs the same command router used by chat
providers.

Request body:

```json
{
  "provider": "slack",
  "requester": "sigil-workbench",
  "text": "status",
  "channel": "sigil-workbench"
}
```

This endpoint exists so toolkit/Sigil can exercise the broker without a live
Slack session.

## Pilot Workflows

Current broker workflows:

- `wiki <query>` — fuzzy search the local `aos wiki` index, with the modal also
  able to start from a live indexed wiki entry
- `status` — summarize `./aos status --json`
- `features` — summarize recent local git history
- `workflows` — show the live merged workflow registry
- `coming soon` — show live-registry workflow plugins not yet wired to a
  structured Slack launch surface
- `jobs` — list recent broker executions
- `Feature Request` — queue product or workflow feedback from Slack for later
  follow-up
- `Report a Bug` — queue a bug report from Slack for later follow-up
- `Employer Brand Profile (KILOS)` — queue a structured employer-brand profile
  request with client + optional focus/notes
- `Employer Brand Competitor Comparative Audit (KILOS)` — queue a structured
  comparison request with client, competitors, and optional focus/notes

The workflow catalog is reusable across providers. A future Discord adapter
should call into the same command router and snapshot surface rather than
creating a parallel command set.

The workflow list is now live-registry backed. The broker merges:

- built-in launch-ready workflows with structured Slack forms
- workflow plugins discovered from `./aos wiki list --json`

New wiki workflow plugins can therefore appear in the broker snapshot and Slack
surfaces without rebuilding the gateway. Until they get a structured launch
handler, they appear as `coming soon`.

The two KILOS workflows are launch scaffolds today, not the finished workers.
They exist so Slack can start the request now, persist structured inputs in the
job record, and later receive a completion reply with a result link when a
worker or operator finishes the underlying analysis.

## Slack Control Surface

The Slack provider renders provider-native UI from the provider-neutral broker
state:

- message replies use grouped Block Kit sections for quick actions, research,
  launch, and feedback
- App Home renders provider status, workflow inventory, and recent jobs from
  the snapshot API
- the App Home wiki browser keeps its open branch / current page in broker-owned
  state keyed by provider + requester rather than storing a client-side wiki
  tree
- workflow-input commands use a modal instead of free-text parsing when the
  workflow descriptor marks `requiresInput`
- live registry metadata such as workflow availability/grouping drives both
  Slack layout and browser/operator surfaces

The broker contract remains transport-neutral. Slack maps existing workflow and
job surfaces into Slack-native controls instead of introducing a Slack-only
workflow layer.

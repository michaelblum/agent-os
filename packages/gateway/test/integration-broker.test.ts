import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationDB } from '../src/db.js';
import { IntegrationBroker } from '../src/integrations/broker.js';
import { startIntegrationHttpServer } from '../src/integrations/http-api.js';
import type { IntegrationWorkflowDefinition } from '../src/integrations/types.js';

describe('IntegrationBroker', () => {
  let dbDir: string;
  let db: CoordinationDB;

  before(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'aos-integration-broker-'));
    db = new CoordinationDB(join(dbDir, 'broker.db'));
  });

  after(() => {
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  function makeBroker() {
    const notifications: string[] = [];
    const workflows: IntegrationWorkflowDefinition[] = [
      {
        id: 'echo',
        title: 'Echo',
        description: 'Test workflow that echoes the provided input.',
        surface: 'workflows',
        availability: 'ready',
        group: 'research',
        command: {
          label: 'run echo',
          usage: 'run echo <text>',
          examples: ['run echo hello'],
        },
        async run(input) {
          const text = input.text?.trim() ?? '';
          return {
            summary: `Echoed ${text || 'nothing'}.`,
            lines: text ? [text] : [],
            json: { input: text },
          };
        },
      },
      {
        id: 'queue',
        title: 'Queue Workflow',
        description: 'Queues a workflow request for later completion.',
        surface: 'workflows',
        availability: 'ready',
        group: 'launch',
        requiresInput: true,
        inputFields: [
          {
            id: 'client',
            label: 'Client',
            required: true,
          },
        ],
        command: {
          label: 'run queue',
          usage: 'run queue',
          examples: ['run queue'],
        },
        formatCommandText(input) {
          return `run queue client="${input.fields?.client ?? ''}"`;
        },
        async run(input) {
          const client = input.fields?.client?.trim() ?? '';
          return {
            status: 'queued',
            summary: `Queued ${client}.`,
            lines: [`Client: ${client}`],
            json: { client },
            metadata: {
              queuedClient: client,
            },
          };
        },
      },
    ];

    const broker = new IntegrationBroker({
      db,
      repoRoot: process.cwd(),
      brokerUrl: 'http://127.0.0.1:0',
      surfaces: [
        { id: 'jobs', label: 'Jobs', description: 'Recent jobs.' },
        { id: 'workflows', label: 'Workflows', description: 'Workflow catalog.' },
        { id: 'integrations', label: 'Integrations', description: 'Provider adapters.' },
        { id: 'activity', label: 'Activity', description: 'Simulation surface.' },
      ],
      providers: [
        {
          id: 'slack',
          kind: 'slack',
          label: 'Slack',
          status: 'disabled',
          enabled: false,
          configured: false,
          capabilities: ['dm'],
        },
      ],
      workflows,
    });
    broker.registerNotifier('slack', {
      async notifyJobNotification(notification) {
        notifications.push(notification.text);
      },
    });
    return {
      broker,
      notifications,
    };
  }

  it('returns a help menu', async () => {
    const { broker } = makeBroker();
    const reply = await broker.handleMessage({
      provider: 'slack',
      requester: 'tester',
      text: 'help',
    });
    assert.equal(reply.kind, 'reply');
    assert.match(reply.text, /AOS command surface/);
    assert.match(reply.text, /run echo <text>/);
    assert.match(reply.text, /Launch-ready workflows/);
  });

  it('runs a workflow and records a succeeded job', async () => {
    const { broker } = makeBroker();
    const reply = await broker.handleMessage({
      provider: 'slack',
      requester: 'tester',
      text: 'run echo hello from broker',
      channel: 'ops',
    });
    assert.equal(reply.kind, 'job');
    assert.match(reply.text, /Echoed hello from broker/);

    const jobs = await broker.listJobs(5);
    assert.ok(jobs.some((job) => job.workflowId === 'echo' && job.status === 'succeeded'));
  });

  it('launches a structured workflow and keeps it queued for later completion', async () => {
    const { broker } = makeBroker();
    const reply = await broker.launchWorkflow({
      provider: 'slack',
      requester: 'tester',
      workflowId: 'queue',
      channel: 'ops',
      thread: '123.456',
      input: {
        source: 'modal',
        fields: {
          client: 'Acme',
        },
      },
    });

    assert.equal(reply.kind, 'job');
    assert.equal(reply.job?.status, 'queued');
    assert.match(reply.text, /Queued Acme/);

    const jobs = await broker.listJobs(5);
    assert.ok(jobs.some((job) => job.workflowId === 'queue' && job.status === 'queued'));
  });

  it('completes a queued job and sends a provider notification', async () => {
    const { broker, notifications } = makeBroker();
    const launch = await broker.launchWorkflow({
      provider: 'slack',
      requester: 'tester',
      workflowId: 'queue',
      channel: 'ops',
      thread: '123.456',
      input: {
        source: 'modal',
        fields: {
          client: 'Acme',
        },
      },
    });

    const job = launch.job;
    assert.ok(job);

    const completed = await broker.completeJob(job!.id, {
      summary: 'Employer brand profile draft is ready.',
      lines: ['Saved to local workspace output.'],
      artifactLink: {
        label: 'Open draft',
        url: 'https://example.com/report',
      },
    });

    assert.equal(completed.status, 'succeeded');
    assert.ok(notifications.some((message) => message.includes('Employer brand profile draft is ready.')));
    assert.ok(notifications.some((message) => message.includes('https://example.com/report')));
  });

  it('serves snapshot and simulation over HTTP', async () => {
    const { broker } = makeBroker();
    const http = await startIntegrationHttpServer({
      broker,
      host: '127.0.0.1',
      port: 0,
    });
    broker.setBrokerUrl(http.url);

    try {
      const simulate = await fetch(`${http.url}/api/integrations/simulate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'slack',
          requester: 'http-test',
          text: 'run echo via http',
        }),
      });
      assert.equal(simulate.status, 200);
      const reply = await simulate.json() as { text: string };
      assert.match(reply.text, /via http/);

      const snapshotRes = await fetch(`${http.url}/api/integrations/snapshot?limit=5`);
      assert.equal(snapshotRes.status, 200);
      const snapshot = await snapshotRes.json() as { jobs: Array<{ workflowId: string }> };
      assert.ok(snapshot.jobs.some((job) => job.workflowId === 'echo'));

      const launch = await fetch(`${http.url}/api/integrations/workflows/queue/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'slack',
          requester: 'http-test',
          fields: {
            client: 'Acme',
          },
        }),
      });
      assert.equal(launch.status, 200);
      const launched = await launch.json() as { job?: { id: string, status: string } };
      assert.equal(launched.job?.status, 'queued');

      const complete = await fetch(`${http.url}/api/integrations/jobs/${launched.job?.id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: 'Ready for review.',
          artifactLink: {
            label: 'Open result',
            url: 'https://example.com/result',
          },
        }),
      });
      assert.equal(complete.status, 200);
      const completed = await complete.json() as { status: string, metadata?: { artifactLink?: { url?: string } } };
      assert.equal(completed.status, 'succeeded');
      assert.equal(completed.metadata?.artifactLink?.url, 'https://example.com/result');
    } finally {
      await new Promise<void>((resolveClose) => {
        http.server.close(() => resolveClose());
      });
    }
  });
});

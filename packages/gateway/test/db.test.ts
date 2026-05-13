import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayStore } from '../src/db.js';

let tmpDir: string;
let db: GatewayStore;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gateway-store-test-'));
  db = new GatewayStore(join(tmpDir, 'test.db'));
});

after(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GatewayStore broker-local state', () => {
  test('setState writes and overwrites broker-local state', async () => {
    const first = await db.setState('integration/wiki-browser/slack/U123', { root: 'types' });
    assert.equal(first?.version, 1);

    const second = await db.setState('integration/wiki-browser/slack/U123', { root: 'plugins' });
    assert.equal(second?.version, 2);

    const entries = await db.getState('integration/wiki-browser/slack/U123');
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].value, { root: 'plugins' });
  });

  test('setState null deletes broker-local state', async () => {
    await db.setState('integration/wiki-browser/slack/delete-me', { page: 1 });
    await db.setState('integration/wiki-browser/slack/delete-me', null);
    const entries = await db.getState('integration/wiki-browser/slack/delete-me');
    assert.equal(entries.length, 0);
  });

  test('getState supports scoped glob lookups without treating LIKE metacharacters as wildcards', async () => {
    await db.setState('integration/snapshot/100%done', 'target');
    await db.setState('integration/snapshot/100Xdone', 'decoy');

    const exact = await db.getState('integration/snapshot/100%done');
    assert.equal(exact.length, 1);
    assert.equal(exact[0].value, 'target');

    const glob = await db.getState('integration/snapshot/*');
    const keys = glob.map((entry) => entry.key);
    assert.ok(keys.includes('integration/snapshot/100%done'));
    assert.ok(keys.includes('integration/snapshot/100Xdone'));
  });
});

describe('GatewayStore integration jobs', () => {
  test('createIntegrationJob persists a queued provider workflow job', async () => {
    const job = await db.createIntegrationJob({
      provider: 'slack',
      workflowId: 'profile',
      workflowTitle: 'Employer Brand Profile',
      surface: 'workflows',
      requester: 'U123',
      channel: 'C123',
      thread: '1710000000.000100',
      commandText: 'run profile client="Acme"',
      status: 'queued',
      summary: 'Queued Acme.',
      metadata: {
        workflowInput: { client: 'Acme' },
      },
    });

    assert.equal(job.provider, 'slack');
    assert.equal(job.status, 'queued');
    assert.equal(job.requester, 'U123');
    assert.deepEqual(job.metadata?.workflowInput, { client: 'Acme' });
  });

  test('updateIntegrationJob transitions a queued job to succeeded', async () => {
    const job = await db.createIntegrationJob({
      provider: 'slack',
      workflowId: 'audit',
      workflowTitle: 'Comparative Audit',
      commandText: 'run audit',
      status: 'queued',
    });

    const updated = await db.updateIntegrationJob(job.id, {
      status: 'succeeded',
      summary: 'Audit complete.',
      resultText: 'Stored in the artifact bundle.',
      resultJson: { ok: true },
    });

    assert.equal(updated.status, 'succeeded');
    assert.equal(updated.summary, 'Audit complete.');
    assert.deepEqual(updated.resultJson, { ok: true });
    assert.ok(updated.completedAt);
  });

  test('listIntegrationJobs filters by provider and status', async () => {
    await db.createIntegrationJob({
      provider: 'fixture',
      commandText: 'fixture job',
      status: 'failed',
    });

    const slackJobs = await db.listIntegrationJobs({ provider: 'slack', limit: 20 });
    assert.ok(slackJobs.every((job) => job.provider === 'slack'));

    const failedJobs = await db.listIntegrationJobs({ status: 'failed', limit: 20 });
    assert.ok(failedJobs.some((job) => job.provider === 'fixture'));
  });
});

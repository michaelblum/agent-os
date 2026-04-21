import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGatewayEnv } from '../src/env.js';

const touchedKeys = [
  'AOS_SLACK_BOT_TOKEN',
  'AOS_SLACK_APP_TOKEN',
  'AOS_SLACK_SIGNING_SECRET',
  'AOS_GATEWAY_ENV_FILE',
];

function resetTouchedEnv() {
  for (const key of touchedKeys) delete process.env[key];
}

afterEach(() => {
  resetTouchedEnv();
});

describe('loadGatewayEnv', () => {
  it('loads .env values when shell env is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-gateway-env-'));
    try {
      writeFileSync(join(dir, '.env'), [
        'AOS_SLACK_BOT_TOKEN=xoxb-test',
        'AOS_SLACK_APP_TOKEN=xapp-test',
      ].join('\n'));

      loadGatewayEnv(dir);

      assert.equal(process.env.AOS_SLACK_BOT_TOKEN, 'xoxb-test');
      assert.equal(process.env.AOS_SLACK_APP_TOKEN, 'xapp-test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not override values already present in the shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-gateway-env-'));
    try {
      process.env.AOS_SLACK_BOT_TOKEN = 'shell-value';
      writeFileSync(join(dir, '.env'), 'AOS_SLACK_BOT_TOKEN=file-value\n');

      loadGatewayEnv(dir);

      assert.equal(process.env.AOS_SLACK_BOT_TOKEN, 'shell-value');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

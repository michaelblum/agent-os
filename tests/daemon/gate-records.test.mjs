import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateRecordStore, gateRecordPath } from '../../packages/daemon/gate/records.js';
import { runGateRecords } from '../../packages/cli/verbs/gate-records.js';

function writable() {
  let text = '';
  return {
    write(chunk) {
      text += chunk;
    },
    text() {
      return text;
    },
  };
}

test('gate record path respects AOS_STATE_ROOT and runtime mode', () => {
  assert.equal(
    gateRecordPath({ env: { AOS_STATE_ROOT: '/tmp/aos-state', AOS_RUNTIME_MODE: 'installed' } }),
    '/tmp/aos-state/installed/gate/records.jsonl',
  );
  assert.equal(
    gateRecordPath({ env: { AOS_STATE_ROOT: '/tmp/aos-state' } }),
    '/tmp/aos-state/repo/gate/records.jsonl',
  );
});

test('gate records readback lists and filters isolated JSONL without a live receptor', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'aos-gate-readback-'));
  const path = join(stateRoot, 'repo', 'gate', 'records.jsonl');
  const store = new GateRecordStore({ path });
  await store.append({ schema_version: 'aos.gate.record.v1', gate_id: 'gate-1', resolution: 'answered', status: null });
  await store.append({ schema_version: 'aos.gate.record.v1', gate_id: 'gate-2', resolution: 'timeout', status: 'timeout' });
  await store.append({ schema_version: 'aos.gate.record.v1', gate_id: 'gate-3', resolution: 'error', status: null });

  const stdout = writable();
  const stderr = writable();
  const code = await runGateRecords(['--status', 'timeout', '--json'], { stdout, stderr, store });

  assert.equal(code, 0);
  assert.equal(stderr.text(), '');
  const payload = JSON.parse(stdout.text());
  assert.equal(payload.schema_version, 'aos.gate.records.readback.v1');
  assert.equal(payload.count, 1);
  assert.equal(payload.records[0].gate_id, 'gate-2');
  assert.equal(payload.records[0].status, 'timeout');
  assert.match(await readFile(path, 'utf8'), /gate-1/);
});

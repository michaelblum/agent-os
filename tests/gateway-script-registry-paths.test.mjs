import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ScriptRegistry } from '../packages/gateway/src/scripts.ts';

test('gateway ScriptRegistry rejects traversal names without writing outside scripts dir', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aos-gateway-scripts-'));
  const registry = new ScriptRegistry(dir);
  const outside = path.join(dir, '..', 'escape.ts');

  try {
    assert.throws(() => {
      registry.save('../escape', 'return 1;', { description: 'bad', intent: 'mixed' });
    }, /Invalid script name/);
    assert.throws(() => {
      registry.save('/tmp/escape', 'return 1;', { description: 'bad', intent: 'mixed' });
    }, /Invalid script name/);
    assert.throws(() => registry.load('../escape'), /Invalid script name/);

    assert.equal(existsSync(outside), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

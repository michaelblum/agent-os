import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptRegistry } from '../src/scripts.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ScriptRegistry', () => {
  let dir: string;
  let registry: ScriptRegistry;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'aos-scripts-'));
    registry = new ScriptRegistry(dir);
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('saves and loads a script', () => {
    registry.save('greet', 'return "hi";', { description: 'Says hi', intent: 'mixed' });
    const source = registry.load('greet');
    assert.equal(source, 'return "hi";');
  });

  it('lists scripts with metadata', () => {
    registry.save('task-a', 'return 1;', { description: 'A', intent: 'action' });
    const all = registry.list();
    assert.ok(all.some(s => s.name === 'task-a' && s.intent === 'action'));
  });

  it('errors on duplicate name without overwrite', () => {
    registry.save('dup', 'return 1;', { description: 'v1', intent: 'mixed' });
    assert.throws(() => {
      registry.save('dup', 'return 2;', { description: 'v2', intent: 'mixed' });
    }, /already exists/);
  });

  it('overwrites with overwrite flag', () => {
    registry.save('up', 'return 1;', { description: 'v1', intent: 'mixed' });
    registry.save('up', 'return 2;', { description: 'v2', intent: 'mixed' }, true);
    assert.equal(registry.load('up'), 'return 2;');
    const meta = registry.list().find(s => s.name === 'up')!;
    assert.equal(meta.version, 2);
  });

  it('filters by intent', () => {
    registry.save('percep', 'return 1;', { description: 'P', intent: 'perception' });
    const filtered = registry.list({ intent: 'perception' });
    assert.ok(filtered.some(s => s.name === 'percep'));
    assert.ok(!filtered.some(s => s.intent !== 'perception'));
  });
});

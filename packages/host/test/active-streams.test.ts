import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveStreamRegistry } from '../src/active-streams.ts';

describe('ActiveStreamRegistry', () => {
  it('rejects concurrent chat sends for the same session', () => {
    const registry = new ActiveStreamRegistry();
    const controller = registry.begin('session-a');

    assert.throws(
      () => registry.begin('session-a'),
      (error: any) => error.code === 'AOS_HOST_CHAT_SEND_ACTIVE',
    );
    assert.equal(registry.size, 1);

    registry.finish('session-a', controller);
    assert.equal(registry.size, 0);
  });

  it('does not let stale cleanup delete a newer controller', () => {
    const registry = new ActiveStreamRegistry();
    const stale = new AbortController();
    const current = registry.begin('session-a');

    registry.finish('session-a', stale);
    assert.equal(registry.size, 1);
    assert.equal(registry.stop('session-a'), true);
    assert.equal(current.signal.aborted, true);

    registry.finish('session-a', current);
    assert.equal(registry.size, 0);
  });

  it('aborts all active streams during shutdown', () => {
    const registry = new ActiveStreamRegistry();
    const first = registry.begin('session-a');
    const second = registry.begin('session-b');

    registry.abortAll();

    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, true);
    registry.finish('session-a', first);
    registry.finish('session-b', second);
    assert.equal(registry.size, 0);
  });
});

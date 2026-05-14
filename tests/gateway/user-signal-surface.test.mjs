import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { userSignalSurface } from '../../packages/gateway/tools/user-signal-surface.js';

function execMock(callback) {
  const calls = [];
  const fn = (command, args, options, done) => {
    calls.push({ command, args, options });
    callback({ command, args, options, done });
  };
  fn.calls = calls;
  return fn;
}

test('user_signal_surface resolves parsed stdout from aos gate ask', async () => {
  const execFile = execMock(({ command, args, options, done }) => {
    assert.equal(command, './aos');
    assert.deepEqual(args.slice(0, 3), ['gate', 'ask', '--request']);
    assert.equal(options.cwd.endsWith('/agent-os'), true);
    const request = JSON.parse(readFileSync(args[3], 'utf8'));
    assert.equal(request.schema_version, 'aos.gate.request.v1');
    assert.deepEqual(request.prompt, { title: 'Proceed?' });
    assert.deepEqual(request.fields, [{ id: 'decision', kind: 'exclusive_choice' }]);
    assert.equal(request.source.surface, 'aos-gateway-mcp');
    done(null, '{"decision":"approve"}\n', '');
  });

  const result = await userSignalSurface({
    prompt: { title: 'Proceed?' },
    fields: [{ id: 'decision', kind: 'exclusive_choice' }],
    timeout_ms: 1234,
  }, { execFile });

  assert.deepEqual(result, { decision: 'approve' });
  assert.equal(execFile.calls[0].options.timeout, 2234);
});

test('user_signal_surface rejects on non-zero aos gate ask exit', async () => {
  const execFile = execMock(({ done }) => {
    const error = new Error('Command failed');
    error.code = 1;
    done(error, '', 'human rejected');
  });

  await assert.rejects(
    () => userSignalSurface({ prompt: { title: 'Proceed?' } }, { execFile }),
    /human rejected/,
  );
});

test('user_signal_surface rejects on subprocess timeout', async () => {
  const execFile = execMock(({ done }) => {
    const error = new Error('Command timed out');
    error.killed = true;
    error.signal = 'SIGTERM';
    done(error, '', '');
  });

  await assert.rejects(
    () => userSignalSurface({ prompt: { title: 'Proceed?' }, timeout_ms: 5 }, { execFile }),
    /Command timed out/,
  );
});

test('user_signal_surface rejects malformed stdout', async () => {
  const execFile = execMock(({ done }) => {
    done(null, 'not-json\n', '');
  });

  await assert.rejects(
    () => userSignalSurface({ prompt: { title: 'Proceed?' } }, { execFile }),
    /malformed JSON/,
  );
});

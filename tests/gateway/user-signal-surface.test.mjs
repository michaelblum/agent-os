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

test('user_signal_surface normalizes shorthand and resolves parsed stdout from aos gate ask', async () => {
  const execFile = execMock(({ command, args, options, done }) => {
    assert.equal(command, './aos');
    assert.deepEqual(args.slice(0, 3), ['gate', 'ask', '--request']);
    assert.equal(options.cwd.endsWith('/agent-os'), true);
    const request = JSON.parse(readFileSync(args[3], 'utf8'));
    assert.equal(request.schema_version, 'aos.gate.request.v1');
    assert.deepEqual(request.prompt, { title: 'Proceed?', body: 'Check this.' });
    assert.equal(request.fields.length, 2);
    assert.equal(request.fields[0].id, 'decision');
    assert.equal('fields' in request.ui, false);
    assert.equal(request.source.surface, 'aos-gateway-mcp');
    done(null, '{"decision":"approve"}\n', '');
  });

  const result = await userSignalSurface({
    title: 'Proceed?',
    message: 'Check this.',
    preset: 'approve_deny',
    timeout_seconds: 3,
  }, { execFile });

  assert.deepEqual(result, { decision: 'approve' });
  assert.equal(execFile.calls[0].options.timeout, 4000);
});

test('user_signal_surface normalizes full request ui.fields to top-level fields', async () => {
  const execFile = execMock(({ args, done }) => {
    const request = JSON.parse(readFileSync(args[3], 'utf8'));
    assert.deepEqual(request.fields, [{ id: 'confirmed', kind: 'boolean' }]);
    assert.equal('fields' in request.ui, false);
    done(null, '{"confirmed":true}\n', '');
  });

  const result = await userSignalSurface({
    request: {
      prompt: { title: 'Proceed?' },
      ui: { variant: null, fields: [{ id: 'confirmed', kind: 'boolean' }] },
      timeout_ms: 1234,
    },
  }, { execFile });

  assert.deepEqual(result, { confirmed: true });
  assert.equal(execFile.calls[0].options.timeout, 2234);
});

test('user_signal_surface rejects with machine code on non-zero aos gate ask exit', async () => {
  const execFile = execMock(({ done }) => {
    const error = new Error('Command failed');
    error.code = 1;
    done(error, '', 'aos gate ask: AOS_GATE_PRESENT_FAILED: no display');
  });

  await assert.rejects(() => userSignalSurface({ prompt: { title: 'Proceed?' } }, { execFile }), (error) => {
    assert.equal(error.code, 'AOS_GATE_PRESENT_FAILED');
    assert.equal(error.message, 'no display');
    return true;
  });
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
    (error) => error.code === 'AOS_GATE_PROCESS_TIMEOUT' && /Command timed out/.test(error.message),
  );
});

test('user_signal_surface rejects malformed stdout', async () => {
  const execFile = execMock(({ done }) => {
    done(null, 'not-json\n', '');
  });

  await assert.rejects(
    () => userSignalSurface({ prompt: { title: 'Proceed?' } }, { execFile }),
    (error) => error.code === 'AOS_GATE_MALFORMED_STDOUT' && /malformed JSON/.test(error.message),
  );
});

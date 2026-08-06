import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { AOSCommandError } from '../packages/gateway/dist/aos-proxy.js';
import { projectSDKError } from '../packages/gateway/dist/sdk-socket.js';

test('gateway socket preserves typed target failures and bounded details', () => {
  const error = new AOSCommandError('TARGET_AMBIGUOUS', 'multiple current matches', {
    candidates: [{ role: 'AXButton', label: 'Save' }],
  });
  assert.deepEqual(projectSDKError(error), {
    error: {
      code: 'TARGET_AMBIGUOUS',
      message: 'multiple current matches',
      details: { candidates: [{ role: 'AXButton', label: 'Save' }] },
    },
  });
});

test('SDK rejects with the original target code and details', async () => {
  const connection = new EventEmitter();
  connection.write = (data, callback) => {
    const request = JSON.parse(data);
    queueMicrotask(() => connection.emit('data', Buffer.from(`${JSON.stringify({
      id: request.id,
      result: {
        error: {
          code: 'TARGET_STATE_STALE',
          message: 'capture generation was superseded',
          details: { state_id: 'see_old', current_state_id: 'see_new' },
        },
      },
    })}\n`)));
    callback?.();
  };
  connection.destroy = () => {};

  const context = {
    Buffer,
    clearTimeout,
    console,
    queueMicrotask,
    require(name) {
      assert.equal(name, 'node:net');
      return { createConnection: () => connection };
    },
    setTimeout,
    __aos_config: { gatewaySocket: '/tmp/aos-gateway-test.sock' },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('packages/gateway/sdk/aos-sdk.js', 'utf8'), context);

  await assert.rejects(context.aos.capture(), (error) => {
    assert.equal(error.code, 'TARGET_STATE_STALE');
    assert.deepEqual(
      JSON.parse(JSON.stringify(error.details)),
      { state_id: 'see_old', current_state_id: 'see_new' },
    );
    return true;
  });
});

test('gateway surfaces expose target state and handles without clickElement', () => {
  const proxy = readFileSync('packages/gateway/src/aos-proxy.ts', 'utf8');
  const sdkTypes = readFileSync('packages/gateway/sdk/aos-sdk.d.ts', 'utf8');
  assert.match(proxy, /state_id\?: string/);
  assert.match(proxy, /handle\??: AOSTargetHandle/);
  assert.match(sdkTypes, /type AOSTargetHandle/);
  assert.match(proxy, /pid: number; role: string; window_id\?: number/);
  assert.match(sdkTypes, /pid: number; role: string; window_id\?: number/);
  assert.doesNotMatch(`${proxy}\n${sdkTypes}`, /backend: 'native_ax'[\s\S]{0,160}role\?: string/);
  assert.doesNotMatch(`${proxy}\n${sdkTypes}`, /clickElement/);
});

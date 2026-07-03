import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function methodBody(swiftSource, signature) {
  const start = swiftSource.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const brace = swiftSource.indexOf('{', start);
  assert.notEqual(brace, -1, `${signature} body not found`);
  let depth = 0;
  for (let i = brace; i < swiftSource.length; i += 1) {
    if (swiftSource[i] === '{') depth += 1;
    else if (swiftSource[i] === '}') {
      depth -= 1;
      if (depth === 0) return swiftSource.slice(brace + 1, i);
    }
  }
  throw new Error(`${signature} body did not close`);
}

test('DaemonEventStream subscriber loop only closes fd it still owns', () => {
  const swift = source('shared/swift/ipc/event-stream.swift');
  const helper = methodBody(swift, 'private func clearConnectedFD(');
  const loop = methodBody(swift, 'private func subscriberLoop()');
  const stop = methodBody(swift, 'func stop()');

  assert.match(helper, /guard fd == expectedFD else \{ return false \}/);
  assert.match(helper, /fd = -1/);

  assert.match(stop, /let currentFD = fd/);
  assert.match(stop, /fd = -1/);
  assert.match(stop, /close\(currentFD\)/);

  assert.match(loop, /if clearConnectedFD\(sockFD\) \{\s*close\(sockFD\)\s*\}/);
  assert.doesNotMatch(loop, /\/\/ Connection lost\s*close\(sockFD\)/);
  assert.doesNotMatch(loop, /lock\.lock\(\);\s*fd = -1;\s*lock\.unlock\(\)/);
});

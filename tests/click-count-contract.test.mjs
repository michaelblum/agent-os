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

function functionBody(swiftSource, signature) {
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

test('handleClick rejects non-positive counts before posting click events', () => {
  const body = functionBody(source('src/act/actions.swift'), 'func handleClick(');
  const clickCount = body.indexOf('let clickCount = req.count ?? 1');
  const invalidCount = body.indexOf('guard clickCount > 0 else');
  const invalidCode = body.indexOf('code: "INVALID_COUNT"');
  const eventSource = body.indexOf('CGEventSource(stateID: .hidSystemState)');
  const clickRange = body.indexOf('for i in 1...clickCount');

  assert.ok(clickCount >= 0, 'handleClick should normalize missing count to one');
  assert.ok(invalidCount > clickCount, 'handleClick should validate the normalized count');
  assert.ok(invalidCode > invalidCount, 'invalid click counts should return a structured error');
  assert.ok(eventSource > invalidCode, 'invalid count should be rejected before any CGEvent source is created');
  assert.ok(clickRange > invalidCode, 'invalid count should be rejected before the trapping range loop');
});

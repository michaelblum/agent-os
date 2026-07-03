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

test('runProcess drains stdout and stderr before waiting for child exit', () => {
  const body = functionBody(source('src/shared/helpers.swift'), 'func runProcess(');
  const group = body.indexOf('let pipeReaders = DispatchGroup()');
  const run = body.indexOf('try process.run()');
  const stdoutAsync = body.indexOf('stdoutBuffer.readToEnd');
  const stderrAsync = body.indexOf('stderrBuffer.readToEnd');
  const waitExit = body.indexOf('process.waitUntilExit()');
  const waitReaders = body.indexOf('pipeReaders.wait()');
  const oldPattern = body.indexOf('let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()');

  assert.ok(group >= 0, 'runProcess should coordinate pipe readers with a DispatchGroup');
  assert.ok(run >= 0, 'runProcess should still start the child process');
  assert.ok(stdoutAsync > run, 'stdout drain should start after process launch');
  assert.ok(stderrAsync > run, 'stderr drain should start after process launch');
  assert.ok(waitExit > stdoutAsync, 'process exit wait should happen after stdout drain starts');
  assert.ok(waitExit > stderrAsync, 'process exit wait should happen after stderr drain starts');
  assert.ok(waitReaders > waitExit, 'runProcess should wait for pipe readers before decoding output');
  assert.equal(oldPattern, -1, 'runProcess must not wait for exit before draining stdout');
});

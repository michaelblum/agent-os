import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dispatchableDevGhCommandPaths,
  devGhPathKey,
  exposedDevGhCommandPaths,
} from '../scripts/aos-dev-gh-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function sortedKeys(paths) {
  return paths.map(devGhPathKey).sort();
}

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function combinedOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

test('dev gh command spec keeps dispatch and help exposure in parity', () => {
  const dispatchable = sortedKeys(dispatchableDevGhCommandPaths());
  const exposed = sortedKeys(exposedDevGhCommandPaths());
  const exposedSet = new Set(exposed);
  const dispatchableSet = new Set(dispatchable);

  const dispatchableOnly = dispatchable.filter((key) => !exposedSet.has(key));
  const exposedOnly = exposed.filter((key) => !dispatchableSet.has(key));

  assert.deepEqual(dispatchableOnly, [], `dispatchable but not exposed: ${dispatchableOnly.join(', ')}`);
  assert.deepEqual(exposedOnly, [], `exposed but not dispatchable: ${exposedOnly.join(', ')}`);
  assert.ok(dispatchableSet.has('label list'), 'label list is the canary for non-pr child discovery');
});

test('dev gh root help enumerates the script-owned command subtree', () => {
  const result = runAos(['dev', 'gh', '--help']);
  const output = combinedOutput(result);

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /UNKNOWN_COMMAND/);
  assert.match(output, /^\.\/aos dev gh — /m);
  assert.match(output, /^  \.\/aos dev gh <subcommand> \[options\]/m);
  assert.match(output, /^  Subcommands:/m);

  for (const commandPath of sortedKeys(dispatchableDevGhCommandPaths())) {
    assert.match(output, new RegExp(`^    ${escapeRegExp(commandPath)}\\s{2,}`, 'm'));
  }
});

test('every dispatchable dev gh command path has real ./aos text help', () => {
  for (const pathParts of dispatchableDevGhCommandPaths()) {
    const result = runAos(['dev', 'gh', ...pathParts, '--help']);
    const output = combinedOutput(result);
    const label = `./aos dev gh ${pathParts.join(' ')} --help`;

    assert.equal(result.status, 0, `${label}\n${output}`);
    assert.doesNotMatch(output, /UNKNOWN_COMMAND/, label);
    assert.match(output, new RegExp(`^  ${escapeRegExp(`./aos dev gh ${pathParts.join(' ')}`)}\\b`, 'm'), label);
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

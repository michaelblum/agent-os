import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dispatchableDevGhCommandPaths,
  devGhPathKey,
} from '../scripts/aos-dev-gh-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const devGhScriptPath = path.join(repoRoot, 'scripts/aos-dev-gh.mjs');

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

test('dev gh allowlist matches the script dispatch branches', async () => {
  const source = await fs.readFile(devGhScriptPath, 'utf8');
  const allowlist = sortedKeys(dispatchableDevGhCommandPaths());
  const dispatched = sortedKeys(actualDispatchPathsFromSource(source));

  assert.deepEqual(allowlist, dispatched);
  assert.ok(allowlist.includes('label list'), 'label list is the canary for non-pr child discovery');
});

test('dev gh root help enumerates the allowlist and documents deltas', () => {
  const result = runAos(['dev', 'gh', '--help']);
  const output = combinedOutput(result);

  assertDeltaDoc(result, output);
  assert.match(output, /^  Allowed subcommands:/m);

  for (const commandPath of sortedKeys(dispatchableDevGhCommandPaths())) {
    assert.match(output, new RegExp(`^    ${escapeRegExp(commandPath)}\\s{2,}`, 'm'));
  }
});

test('dev gh catch-all help returns the delta doc for real and unknown paths', () => {
  for (const pathParts of dispatchableDevGhCommandPaths()) {
    const label = `./aos dev gh ${pathParts.join(' ')} --help`;
    const result = runAos(['dev', 'gh', ...pathParts, '--help']);
    assertDeltaDoc(result, combinedOutput(result), label);

    const helpLabel = `./aos help dev gh ${pathParts.join(' ')}`;
    const helpResult = runAos(['help', 'dev', 'gh', ...pathParts]);
    assertDeltaDoc(helpResult, combinedOutput(helpResult), helpLabel);
  }

  const unknownResult = runAos(['dev', 'gh', 'pr', 'definitely-not-real', '--help']);
  assertDeltaDoc(unknownResult, combinedOutput(unknownResult), 'unknown subcommand help');
});

function assertDeltaDoc(result, output, label = 'dev gh help') {
  assert.equal(result.status, 0, `${label}\n${output}`);
  assert.doesNotMatch(output, /UNKNOWN_COMMAND/, label);
  assert.match(output, /^\.\/aos dev gh — sanctioned GitHub workflow subset/m, label);
  assert.match(output, /Non-interactive only: commands fail instead of prompting\./, label);
  assert.match(output, /Body-writing commands use --body-file <path\|->; stdin is accepted via - or \/dev\/stdin\./, label);
  assert.match(output, /pr merge requires exactly one explicit strategy: --squash, --merge, or --rebase\./, label);
  assert.match(output, /List commands take bounded --limit values for inventory scans\./, label);
  assert.match(output, /context\s+Reports local gh auth, repository, branch, current PR, and dirty checkout state\./, label);
  assert.match(output, /ci inspect\s+Reads PR checks and failed GitHub Actions logs for review triage\./, label);
  assert.match(output, /review-comments\s+Reads PR review thread state through gh GraphQL\./, label);
}

function actualDispatchPathsFromSource(source) {
  const paths = [];
  const groupFunctions = new Map([
    ['issue', 'issueCommand'],
    ['label', 'labelCommand'],
    ['pr', 'prCommand'],
    ['ci', 'ciCommand'],
  ]);

  for (const match of source.matchAll(/\bgroup\s*===\s*'([^']+)'/g)) {
    const group = match[1];
    if (!groupFunctions.has(group)) paths.push([group]);
  }

  for (const [group, functionName] of groupFunctions) {
    const body = functionBody(source, functionName);
    const actions = new Set(
      [...body.matchAll(/\baction\s*(?:===|!==)\s*'([^']+)'/g)].map((match) => match[1]),
    );
    for (const action of actions) paths.push([group, action]);
  }

  return paths;
}

function functionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing function body for ${functionName}`);

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated function body for ${functionName}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

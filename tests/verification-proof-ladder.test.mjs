import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const guidePath = 'docs/guides/agent-entry-paths-and-verification.md';

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function assertPathExists(relativePath) {
  await assert.doesNotReject(
    stat(path.join(repoRoot, relativePath)),
    `verification proof ladder points to missing path: ${relativePath}`,
  );
}

test('agent entry verification guide keeps the static-first proof ladder explicit', async () => {
  const guide = await text(guidePath);

  for (const phrase of [
    'Static-First Contract Proof',
    './aos help --json',
    './aos help see --json',
    './aos help do --json',
    './aos help show --json',
    'git diff --check',
    'tests/help-contract.sh',
    'tests/command-manifest-generation.sh',
    'tests/external-parser-flags.sh',
    'tests/agent-workspace-contract-drift.sh',
    'Level 4',
    'TCC-sensitive proof',
    'explicit user approval',
  ]) {
    assert.match(guide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const referencedPath of [
    'tests/help-contract.sh',
    'tests/command-manifest-generation.sh',
    'tests/external-parser-flags.sh',
    'tests/agent-workspace-contract-drift.sh',
    'tests/schemas',
  ]) {
    await assertPathExists(referencedPath);
  }
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const relativeSchemaPath = 'shared/schemas/aos-external-command-manifest-v0.schema.json';
const schemaPath = path.join(repoRoot, relativeSchemaPath);
const baselineRevision = '7aada1cb4d7a046a2b99b1b24470115eefc82224';
const baselineSHA256 = '246025ae1019fcf188a257da3da5f138773861475ddb904b8337fc4cce22320e';

test('frozen v0 schema remains byte-exact baseline decision history', async () => {
  const current = await fs.readFile(schemaPath);
  assert.equal(crypto.createHash('sha256').update(current).digest('hex'), baselineSHA256);
  const baseline = spawnSync('git', ['show', `${baselineRevision}:${relativeSchemaPath}`], {
    cwd: repoRoot,
    encoding: null,
  });
  assert.equal(baseline.status, 0, baseline.stderr?.toString('utf8'));
  assert.deepEqual(current, baseline.stdout);
  const schema = JSON.parse(current.toString('utf8'));
  assert.equal(schema.properties.schema_version.const, 1);
  assert.equal(schema.$defs.command.properties.spawn_registration, undefined);
});

test('active Swift and help readers reject wire v0', async () => {
  const swift = await fs.readFile(path.join(repoRoot, 'src/shared/external-command-dispatch.swift'), 'utf8');
  const help = await fs.readFile(path.join(repoRoot, 'scripts/aos-help-proxy.mjs'), 'utf8');
  const validator = await fs.readFile(path.join(repoRoot, 'scripts/lib/external-command-manifest-v1.mjs'), 'utf8');
  assert.match(swift, /guard manifest\.schemaVersion == 2 else/u);
  assert.doesNotMatch(swift, /manifest\.schemaVersion == 1/u);
  assert.match(help, /validateExternalCommandManifestV1\(manifest\)/u);
  assert.match(validator, /manifest\.schema_version !== 2/u);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-external-manifest-v0-rejection-'));
  try {
    const manifest = path.join(temporaryRoot, 'v0.json');
    await fs.writeFile(manifest, `${JSON.stringify({ schema_version: 1, commands: [] })}\n`);
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/aos-help-proxy.mjs'), 'help'], {
      cwd: repoRoot,
      env: { ...process.env, AOS_EXTERNAL_COMMAND_MANIFEST: manifest },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"code"\s*:\s*"INVALID_MANIFEST"/u);
    assert.match(result.stderr, /external command manifest wire v2 is invalid/u);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

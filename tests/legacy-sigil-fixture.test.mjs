import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureRoot = path.join(repoRoot, 'apps/sigil');
const metadataPath = path.join(fixtureRoot, 'legacy-fixture.json');

async function exportedFixtureFiles(directory = fixtureRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await exportedFixtureFiles(absolute));
    else if (entry.isFile()) files.push(path.relative(fixtureRoot, absolute));
  }
  return files.sort();
}

function committedFixtureFiles(excludedPaths) {
  const result = spawnSync('git', ['ls-files', '--', 'apps/sigil'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((relativePath) => relativePath.replace(/^apps\/sigil\//, ''))
    .filter((relativePath) => !excludedPaths.includes(relativePath))
    .sort();
}

test('embedded Sigil is a sealed legacy fixture', async () => {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.status, 'frozen');
  assert.equal(metadata.product_authority, 'https://github.com/Ch-osctrl/sigil');
  assert.equal(metadata.active_discovery, false);
  assert.equal(metadata.packaged, false);
  assert.deepEqual(metadata.allowed_use, ['deterministic_legacy_compatibility_proof']);

  const files = metadata.content.files;
  assert.equal(files.length, new Set(files).size, 'fixture inventory contains duplicate paths');
  assert.deepEqual(files, [...files].sort(), 'fixture inventory must be sorted');
  assert.ok(files.every((relativePath) => (
    relativePath
    && !path.isAbsolute(relativePath)
    && !relativePath.split('/').includes('..')
    && !metadata.content.excluded_paths.includes(relativePath)
  )), 'fixture inventory contains an invalid or excluded path');

  const actualFiles = existsSync(path.join(repoRoot, '.git'))
    ? committedFixtureFiles(metadata.content.excluded_paths)
    : (await exportedFixtureFiles())
      .filter((relativePath) => !metadata.content.excluded_paths.includes(relativePath));
  assert.deepEqual(actualFiles, files, 'fixture inventory must match committed or exported payload bytes');

  const digest = createHash('sha256');
  for (const relativePath of files) {
    digest.update(Buffer.from(`${relativePath}\0`));
    digest.update(await readFile(path.join(fixtureRoot, relativePath)));
    digest.update(Buffer.from('\0'));
  }

  assert.equal(files.length, metadata.content.file_count);
  assert.equal(digest.digest('hex'), metadata.content.sha256);
});

test('embedded Sigil is absent from active discovery, recipes, and packaging', async () => {
  assert.equal(existsSync(path.join(fixtureRoot, 'aos-app.json')), false);
  assert.equal(existsSync(path.join(fixtureRoot, 'aos-app.fixture.json')), true);
  assert.equal(existsSync(path.join(repoRoot, 'experiences/sigil/aos-experience.json')), false);
  assert.equal(existsSync(path.join(repoRoot, 'tests/fixtures/legacy-sigil/aos-experience.fixture.json')), true);
  assert.equal(existsSync(path.join(repoRoot, 'recipes/sigil')), false);
  assert.equal(existsSync(path.join(repoRoot, 'packages/host/src/sigil-bridge.ts')), false);
  assert.equal(existsSync(path.join(repoRoot, 'packages/toolkit/workbench/sigil-subject.js')), false);

  for (const packageScriptPath of ['package.sh', 'scripts/package-aos-runtime']) {
    const packageScript = await readFile(path.join(repoRoot, packageScriptPath), 'utf8');
    assert.doesNotMatch(packageScript, /apps\/sigil|recipes\/sigil/, packageScriptPath);
  }

  const recipes = spawnSync('node', ['scripts/aos-recipe.mjs', 'list', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(recipes.status, 0, recipes.stderr);
  assert.deepEqual(JSON.parse(recipes.stdout).recipes.map((recipe) => recipe.id), [
    'canvas/window-level-smoke',
    'runtime/clean-restart',
    'runtime/status-snapshot',
  ]);
});

test('embedded Sigil app and experience names fail closed', () => {
  const app = spawnSync('node', ['scripts/aos-launch.mjs', 'sigil', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(app.status, 1, app.stdout);
  assert.equal(JSON.parse(app.stderr).code, 'APP_NOT_FOUND');

  const experience = spawnSync('node', ['scripts/aos-experience.mjs', 'status', 'sigil', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(experience.status, 1, experience.stdout);
  assert.equal(JSON.parse(experience.stderr).code, 'EXPERIENCE_NOT_FOUND');
});

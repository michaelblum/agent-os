import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function createFakeBrowserBin() {
  const root = await mkdtemp(path.join(tmpdir(), 'aos-browser-keyboard-'));
  const bin = path.join(root, 'bin');
  await mkdir(bin);

  const aosPath = path.join(bin, 'aos');
  await writeFile(aosPath, `#!/usr/bin/env bash
if [ "$1" = "browser" ] && [ "$2" = "_check-version" ] && [ "$3" = "--json" ]; then
  printf '{"status":"ok"}\\n'
  exit 0
fi
printf '{"code":"UNEXPECTED_AOS","error":"unexpected aos invocation"}\\n' >&2
exit 1
`);
  await chmod(aosPath, 0o755);

  const playwrightLog = path.join(root, 'playwright-argv.jsonl');
  const playwrightCliPath = path.join(bin, 'playwright-cli');
  await writeFile(playwrightCliPath, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.PLAYWRIGHT_ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('ok\\n');
`);
  await chmod(playwrightCliPath, 0o755);

  return { root, bin, aosPath, playwrightLog };
}

function runBrowserDo(args, env) {
  return spawnSync('node', ['scripts/aos-do-browser.mjs', ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
}

async function readPlaywrightCalls(logPath) {
  const text = await readFile(logPath, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('direct browser type and key preserve state id and dispatch Playwright keyboard verbs', async () => {
  const fake = await createFakeBrowserBin();
  try {
    const env = {
      ...process.env,
      AOS_PATH: fake.aosPath,
      PATH: `${fake.bin}:${process.env.PATH}`,
      PLAYWRIGHT_ARGV_LOG: fake.playwrightLog,
    };

    const typeResult = runBrowserDo(['type', 'browser:work/r7', 'hello world', '--state-id', 'see_type123'], env);
    assert.equal(typeResult.status, 0, typeResult.stderr);
    const typePayload = JSON.parse(typeResult.stdout);
    assert.equal(typePayload.status, 'success');
    assert.equal(typePayload.execution.backend, 'playwright');
    assert.equal(typePayload.execution.strategy, 'playwright_type');
    assert.equal(typePayload.execution.fallback_used, false);
    assert.equal(typePayload.execution.state_id, 'see_type123');
    assert.equal(typePayload.result.stdout, 'ok');

    const keyResult = runBrowserDo(['key', 'browser:work/r7', 'cmd+s', '--state-id', 'see_key123'], env);
    assert.equal(keyResult.status, 0, keyResult.stderr);
    const keyPayload = JSON.parse(keyResult.stdout);
    assert.equal(keyPayload.status, 'success');
    assert.equal(keyPayload.execution.backend, 'playwright');
    assert.equal(keyPayload.execution.strategy, 'playwright_press');
    assert.equal(keyPayload.execution.fallback_used, false);
    assert.equal(keyPayload.execution.state_id, 'see_key123');
    assert.equal(keyPayload.result.stdout, 'ok');

    assert.deepEqual(await readPlaywrightCalls(fake.playwrightLog), [
      ['-s=work', 'type', 'r7', 'hello world'],
      ['-s=work', 'press', 'r7', 'cmd+s'],
    ]);
  } finally {
    await rm(fake.root, { recursive: true, force: true });
  }
});

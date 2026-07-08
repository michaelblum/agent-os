import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function commandIds() {
  const manifest = JSON.parse(await read('manifests/commands/aos-commands.json'));
  return new Set(manifest.commands.flatMap((command) => (
    command.forms ?? []
  ).map((form) => form.id)));
}

test('AOS capability map is backed by current command manifest forms', async () => {
  const doc = await read('docs/api/aos-capabilities.md');
  const ids = await commandIds();

  for (const id of [
    'ready',
    'status',
    'doctor',
    'permissions-check',
    'service-status',
    'graph-displays',
    'graph-windows',
    'see-capture',
    'see-capture-save',
    'see-refs',
    'focus-create',
    'focus-list',
    'do-click',
    'do-hover',
    'do-drag',
    'do-scroll',
    'do-type',
    'do-key',
    'do-fill',
    'do-navigate',
    'do-press',
    'do-focus',
    'do-set-value',
    'do-activate',
    'do-quit',
    'do-hide',
    'do-unhide',
    'do-raise',
    'do-move',
    'do-resize',
    'do-close',
    'do-minimize',
    'do-maximize',
    'do-restore',
    'do-menu',
    'do-tell',
    'show-create',
    'show-list',
    'gate-ask',
    'work-record-verify',
    'skills-companion-check',
    'recipe-dry-run',
  ]) {
    assert.ok(ids.has(id), `manifest command id missing: ${id}`);
  }

  for (const command of [
    'aos graph windows',
    'aos see capture',
    'aos see refs --diff',
    'aos do raise',
    'aos do move',
    'aos do resize',
    'aos do press',
    'aos do focus',
    'aos do set-value',
    'aos do activate',
    'aos do quit',
    'aos do hide',
    'aos do unhide',
    'aos do close',
    'aos do minimize',
    'aos do maximize',
    'aos do restore',
    'aos do menu',
    'aos skills companion check --name playwright-cli',
  ]) {
    assert.match(doc, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('AOS capability map preserves unsupported desktop verbs and browser boundary', async () => {
  const doc = await read('docs/api/aos-capabilities.md');
  const design = await read('docs/design/aos-desktop-playwright-cli-map.md');
  const decision = await read('docs/design/aos-desktop-command-vocabulary-decision.md');

  for (const phrase of [
    'Window fullscreen',
    'Space detection',
    'Space switching',
    'Mission Control / app expose',
    'deferred follow-up',
    'unsupported',
  ]) {
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const phrase of [
    'network mocking',
    'storage/auth state',
    'console/eval',
    'tracing, video, and PDF',
    'locator generation and test generation',
    'test debugging',
    'tab management',
  ]) {
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(design, /Follow-Up Card Seeds/);
  assert.match(design, /Do not add a new `aos desktop` noun yet/);
  assert.match(decision, /Do not add a new `aos desktop` command noun/);
  assert.match(decision, /Do not add a new .*desktop:<target>.* target/s);
  assert.match(decision, /prefer\s+source-manifest-backed semantic verbs under `aos do`/);
});

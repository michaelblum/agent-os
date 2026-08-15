import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureBrowserEvidenceManifest } from '../../packages/toolkit/workbench/browser-evidence-capture.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/browser-evidence-capture-v0');
const manifestPath = path.join(fixtureRoot, 'valid/manifest.json');
const schemaPath = path.join(repoRoot, 'shared/schemas/browser-evidence-capture-v0.schema.json');
const GENERATION = '0123456789abcdef0123456789abcdef';
const SHA = 'a'.repeat(64);

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'aos-browser-evidence-managed-'));
}

function fakeManagedEvidence(calls) {
  return async (sessionId, input) => {
    calls.push({ sessionId, input });
    const candidates = input.candidates.map((candidate) => ({
      ...candidate,
      match_count: candidate.value.includes('missing') ? 0 : 1,
      error: null,
    }));
    const used = candidates.find((candidate) => candidate.match_count > 0) ?? null;
    return {
      receipt: {
        session_generation: GENERATION,
        backend_identity: { descriptor_sha256: SHA, closure_sha256: SHA },
      },
      result: {
        status: used ? 'captured' : 'missing_selector',
        extracted_text: used ? 'Managed evidence text' : null,
        bounding_box: used ? { x: 1, y: 2, width: 100, height: 40 } : null,
        visible: Boolean(used),
        selector_resolution: {
          strategy: candidates.map((candidate) => candidate.kind).join('_then_'),
          candidates,
          used: used ? {
            kind: used.kind, value: used.value, index: 0, match_count: used.match_count,
          } : null,
        },
      },
      screenshot: used ? Buffer.from('managed-png') : null,
    };
  };
}

function validateRegistry(file) {
  return spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema=json.loads(Path(sys.argv[1]).read_text())
value=json.loads(Path(sys.argv[2]).read_text())
errors=list(Draft202012Validator(schema).iter_errors(value))
assert not errors, [error.message for error in errors]
`, schemaPath, file], { encoding: 'utf8', timeout: 10_000 });
}

test('browser evidence uses one path-free managed session operation and emits schema-valid evidence', async () => {
  const root = await tempDir();
  try {
    const calls = [];
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const registry = await captureBrowserEvidenceManifest(manifest, {
      cwd: path.join(fixtureRoot, 'valid'), outputDir: root, assetDir: 'evidence',
      sessionId: 'research', managedEvidenceOperation: fakeManagedEvidence(calls),
    });
    const output = path.join(root, 'registry.json');
    fs.writeFileSync(output, `${JSON.stringify(registry, null, 2)}\n`);
    const validation = validateRegistry(output);
    assert.equal(validation.status, 0, validation.stderr);
    assert.equal(registry.status, 'completed');
    assert.equal(registry.summary.captured_count, 2);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.sessionId === 'research'));
    assert.ok(calls.every((call) => call.input.url.startsWith('data:text/html;base64,')));
    assert.equal(registry.capture_metadata.backend, 'managed_playwright_companion');
    assert.equal(registry.capture_metadata.local_fixture_max_bytes, 3000);
    assert.equal(registry.capture_metadata.session_generation, GENERATION);
    assert.equal(JSON.stringify(registry).includes('backend_command'), false);
    assert.equal(JSON.stringify(registry).includes('playwright_session'), false);
    for (const item of registry.evidence) {
      assert.equal(item.status, 'captured');
      assert.equal(item.extracted_text, 'Managed evidence text');
      assert.ok(fs.existsSync(path.join(root, item.screenshot_path)));
      assert.equal(item.capture_metadata.descriptor_sha256, SHA);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing CSS falls through to XPath without accepting an absent screenshot', async () => {
  const root = await tempDir();
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.requests = [{ ...manifest.requests[1], selector: '.missing-values', xpath: "//*[@data-evidence-id='values']" }];
    const registry = await captureBrowserEvidenceManifest(manifest, {
      cwd: path.join(fixtureRoot, 'valid'), outputDir: root,
      sessionId: 'research', managedEvidenceOperation: fakeManagedEvidence([]),
    });
    const item = registry.evidence[0];
    assert.equal(item.status, 'captured');
    assert.deepEqual(item.selector_resolution.candidates.map(({ kind, match_count }) => [kind, match_count]), [['css', 0], ['xpath', 1]]);
    assert.equal(item.selector_resolution.used.kind, 'xpath');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local policy and managed-operation failures are content-free and never execute a fallback', async () => {
  const root = await tempDir();
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.requests = [{ ...manifest.requests[0], url: 'https://example.com/private' }];
    let calls = 0;
    const blocked = await captureBrowserEvidenceManifest(manifest, {
      outputDir: root, sessionId: 'research', managedEvidenceOperation: async () => { calls += 1; },
    });
    assert.equal(blocked.evidence[0].status, 'blocked_non_local_url');
    assert.equal(calls, 0);

    manifest.requests[0].url = 'data:text/html,<main></main>';
    const failed = await captureBrowserEvidenceManifest(manifest, {
      outputDir: root, sessionId: 'research', managedEvidenceOperation: async () => {
        throw new Error('/private/runtime/path https://secret.invalid raw worker output');
      },
    });
    assert.equal(failed.evidence[0].status, 'capture_failed');
    assert.equal(JSON.stringify(failed).includes('/private/runtime/path'), false);
    assert.equal(JSON.stringify(failed).includes('secret.invalid'), false);

    const oversized = path.join(root, 'oversized.html');
    fs.writeFileSync(oversized, Buffer.alloc(3001));
    manifest.requests[0].url = oversized;
    const bounded = await captureBrowserEvidenceManifest(manifest, {
      outputDir: root, sessionId: 'research', managedEvidenceOperation: async () => { calls += 1; },
    });
    assert.equal(bounded.evidence[0].error.code, 'source_url_unreadable');
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('exact 3000-byte local fixture fits the managed URL bound and 3001 bytes is rejected', async () => {
  const root = await tempDir();
  try {
    const exact = path.join(root, 'exact.html');
    fs.writeFileSync(exact, Buffer.alloc(3000, 0x61));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.requests = [{ ...manifest.requests[0], url: exact }];
    const calls = [];
    const registry = await captureBrowserEvidenceManifest(manifest, {
      outputDir: root, sessionId: 'research', managedEvidenceOperation: fakeManagedEvidence(calls),
    });
    assert.equal(registry.evidence[0].status, 'captured');
    assert.equal(calls.length, 1);
    assert.ok(Buffer.byteLength(calls[0].input.url) <= 4096);
    assert.equal(Buffer.from(calls[0].input.url.split(',', 2)[1], 'base64').length, 3000);

    fs.writeFileSync(exact, Buffer.alloc(3001, 0x61));
    calls.length = 0;
    const rejected = await captureBrowserEvidenceManifest(manifest, {
      outputDir: root, sessionId: 'research', managedEvidenceOperation: fakeManagedEvidence(calls),
    });
    assert.equal(rejected.evidence[0].error.code, 'source_url_unreadable');
    assert.equal(calls.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

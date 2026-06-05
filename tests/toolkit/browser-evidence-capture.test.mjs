import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureBrowserEvidenceManifest,
  playwrightCliAvailable,
} from '../../packages/toolkit/workbench/browser-evidence-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/browser-evidence-capture-v0');
const manifestPath = path.join(fixtureRoot, 'valid/manifest.json');
const schemaPath = path.join(repoRoot, 'shared/schemas/browser-evidence-capture-v0.schema.json');
const hasPlaywrightCli = playwrightCliAvailable();

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'aos-browser-evidence-'));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function validateRegistry(file) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      file,
    ],
    { encoding: 'utf8' },
  );
}

test('browser evidence capture script writes CSS and XPath element evidence from local fixtures', {
  skip: hasPlaywrightCli ? false : 'playwright-cli is not available',
}, async () => {
  const outputDir = await tempDir();
  try {
    const outputPath = path.join(outputDir, 'registry.json');
    const result = spawnSync(
      'node',
      [
        'scripts/browser-evidence-capture.mjs',
        '--manifest',
        manifestPath,
        '--out',
        outputPath,
        '--asset-dir',
        'evidence',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 90_000,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

    const registry = await readJson(outputPath);
    const validation = validateRegistry(outputPath);
    assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);

    assert.equal(registry.type, 'aos.browser_evidence_registry');
    assert.equal(registry.status, 'completed');
    assert.equal(registry.summary.request_count, 2);
    assert.equal(registry.summary.captured_count, 2);
    assert.equal(registry.summary.failed_count, 0);

    const hero = registry.evidence.find((item) => item.request_id === 'example_health_careers_hero');
    assert.equal(hero.status, 'captured');
    assert.equal(hero.company, 'Example Health');
    assert.equal(hero.source_category, 'careers_site');
    assert.equal(hero.selector, 'main .hero');
    assert.equal(hero.xpath, null);
    assert.equal(hero.selector_resolution.used.kind, 'css');
    assert.equal(hero.selector_resolution.used.match_count, 1);
    assert.match(hero.extracted_text, /Build meaningful healthcare tools/);
    assert.deepEqual(hero.evidence_dimensions, ['messaging', 'proof', 'usability']);
    assert.ok(fs.existsSync(path.join(outputDir, hero.screenshot_path)), 'expected hero screenshot crop');
    assert.ok(hero.capture_metadata.screenshot_bytes > 0);
    assert.equal(hero.capture_metadata.autonomous_browsing, false);

    const values = registry.evidence.find((item) => item.request_id === 'example_health_work_values');
    assert.equal(values.status, 'captured');
    assert.equal(values.selector, null);
    assert.equal(values.xpath, "//*[@data-evidence-id='values']");
    assert.equal(values.selector_resolution.used.kind, 'xpath');
    assert.match(values.extracted_text, /safe forums for employee voice/);
    assert.ok(fs.existsSync(path.join(outputDir, values.screenshot_path)), 'expected values screenshot crop');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('browser evidence capture records missing selector failure without dropping request intent', {
  skip: hasPlaywrightCli ? false : 'playwright-cli is not available',
}, async () => {
  const outputDir = await tempDir();
  try {
    const manifest = await readJson(manifestPath);
    manifest.requests = [
      {
        ...manifest.requests[0],
        request_id: 'example_health_missing_hero',
        selector: '.does-not-exist',
        xpath: null,
        evidence_goal: 'capture missing selector failure for repairable execution metadata',
      },
    ];

    const registry = captureBrowserEvidenceManifest(manifest, {
      cwd: path.join(fixtureRoot, 'valid'),
      outputDir,
      assetDir: 'evidence',
    });

    assert.equal(registry.status, 'completed_with_failures');
    assert.equal(registry.summary.request_count, 1);
    assert.equal(registry.summary.captured_count, 0);
    assert.equal(registry.summary.failed_count, 1);

    const evidence = registry.evidence[0];
    assert.equal(evidence.request_id, 'example_health_missing_hero');
    assert.equal(evidence.company, 'Example Health');
    assert.equal(evidence.status, 'missing_selector');
    assert.equal(evidence.screenshot_path, null);
    assert.equal(evidence.extracted_text, null);
    assert.equal(evidence.error.code, 'selector_not_found');
    assert.equal(evidence.selector_resolution.used, null);
    assert.deepEqual(evidence.selector_resolution.candidates, [
      {
        kind: 'css',
        value: '.does-not-exist',
        match_count: 0,
        error: null,
      },
    ]);
    assert.equal(evidence.evidence_factors.includes('next-step clarity'), true);
    assert.equal(evidence.capture_metadata.autonomous_browsing, false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('browser evidence capture falls back from missing CSS selector to XPath candidate', {
  skip: hasPlaywrightCli ? false : 'playwright-cli is not available',
}, async () => {
  const outputDir = await tempDir();
  try {
    const manifest = await readJson(manifestPath);
    manifest.requests = [
      {
        ...manifest.requests[1],
        request_id: 'example_health_values_xpath_fallback',
        selector: '.missing-values-card',
        xpath: "//*[@data-evidence-id='values']",
      },
    ];

    const registry = captureBrowserEvidenceManifest(manifest, {
      cwd: path.join(fixtureRoot, 'valid'),
      outputDir,
      assetDir: 'evidence',
    });

    assert.equal(registry.status, 'completed');
    const evidence = registry.evidence[0];
    assert.equal(evidence.status, 'captured');
    assert.equal(evidence.selector_resolution.strategy, 'css_then_xpath');
    assert.deepEqual(evidence.selector_resolution.candidates.map((candidate) => [
      candidate.kind,
      candidate.match_count,
    ]), [
      ['css', 0],
      ['xpath', 1],
    ]);
    assert.equal(evidence.selector_resolution.used.kind, 'xpath');
    assert.match(evidence.extracted_text, /People managers support mentorship/);
    assert.ok(fs.existsSync(path.join(outputDir, evidence.screenshot_path)), 'expected fallback screenshot crop');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

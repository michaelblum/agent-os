import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/company-brand-audit-v0.schema.json');
const invalidFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/company-brand-audit-v0/invalid');
const artifactFixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const companyAuditRoot = path.join(artifactFixtureRoot, 'company-audits');
const registryPath = path.join(artifactFixtureRoot, 'browser-evidence/registry.json');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function validate(instancePath) {
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
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

function collectRequestIds(value, ids = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRequestIds(item, ids);
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'request_ids' || key === 'browser_evidence_request_ids') {
      for (const requestId of child || []) ids.push(requestId);
    } else {
      collectRequestIds(child, ids);
    }
  }
  return ids;
}

test('Company Brand Audit v0 validates Employer Brand company audit fixtures', async () => {
  const fixtures = await jsonFiles(companyAuditRoot);
  assert.deepEqual(fixtures.map((fixture) => path.basename(fixture)).sort(), [
    'phenom.json',
    'radancy.json',
    'symphony-talent.json',
  ]);

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('invalid Company Brand Audit v0 fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(invalidFixtureRoot);
  assert.ok(fixtures.length >= 1, 'expected invalid Company Brand Audit fixture');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('Company Brand Audit fixtures cite only registry evidence and screenshots', async () => {
  const registry = await loadJson(registryPath);
  const registryByRequest = new Map(registry.evidence.map((item) => [item.request_id, item]));
  const registryRequestIds = new Set(registry.evidence.map((item) => item.request_id));
  const citedRequestIds = new Set();
  const fixtures = await jsonFiles(companyAuditRoot);

  for (const fixture of fixtures) {
    const audit = await loadJson(fixture);
    const citedEvidenceByRequest = new Map(
      audit.cited_evidence.map((item) => [item.request_id, item]),
    );

    assert.equal(audit.scope.registry_path, 'browser-evidence/registry.json');
    assert.equal(audit.scope.local_fixture_evidence_only, true);
    assert.equal(audit.scope.live_websites, false);
    assert.equal(audit.scope.report_generation, false);
    assert.equal(audit.provenance.local_fixture_pages_only, true);
    assert.equal(audit.provenance.live_websites, false);
    assert.equal(audit.provenance.provenance_only, true);

    for (const citation of audit.cited_evidence) {
      const registryItem = registryByRequest.get(citation.request_id);
      assert.ok(registryItem, `${audit.id} cites unknown request ${citation.request_id}`);
      assert.equal(citation.company, audit.company.name);
      assert.equal(citation.company, registryItem.company);
      assert.equal(citation.source_category, registryItem.source_category);
      assert.equal(citation.source_url, registryItem.source_url);
      assert.equal(citation.screenshot_path, registryItem.screenshot_path);
      assert.equal(citation.status, registryItem.status);
      assert.equal(citation.captured_at, registryItem.captured_at);
      assert.match(citation.source_url, /^html\//);
      assert.match(citation.screenshot_path, /^screenshots\//);
      await fs.readFile(path.join(artifactFixtureRoot, 'browser-evidence', citation.screenshot_path));
      citedRequestIds.add(citation.request_id);
    }

    for (const requestId of collectRequestIds(audit)) {
      assert.ok(
        citedEvidenceByRequest.has(requestId),
        `${audit.id} section request_id ${requestId} must resolve to cited_evidence[]`,
      );
      assert.ok(
        registryRequestIds.has(requestId),
        `${audit.id} section request_id ${requestId} must resolve to the registry`,
      );
    }
  }

  assert.deepEqual([...citedRequestIds].sort(), [...registryRequestIds].sort());
});

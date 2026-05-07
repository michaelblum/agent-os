import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/comparative-brand-audit-v0.schema.json');
const invalidFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/comparative-brand-audit-v0/invalid');
const artifactFixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const comparativeAuditRoot = path.join(artifactFixtureRoot, 'comparative-audits');
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

function collectNamedIds(value, keys, ids = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedIds(item, keys, ids);
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;

  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key)) {
      if (Array.isArray(child)) ids.push(...child);
      else ids.push(child);
    } else {
      collectNamedIds(child, keys, ids);
    }
  }
  return ids.filter(Boolean);
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

test('Comparative Brand Audit v0 validates Employer Brand comparative audit fixtures', async () => {
  const fixtures = await jsonFiles(comparativeAuditRoot);
  assert.deepEqual(fixtures.map((fixture) => path.basename(fixture)).sort(), [
    'symphony-talent-phenom-radancy.json',
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

test('invalid Comparative Brand Audit v0 fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(invalidFixtureRoot);
  assert.ok(fixtures.length >= 1, 'expected invalid Comparative Brand Audit fixture');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('Comparative Brand Audit fixtures cite only company audit IDs and registry request IDs', async () => {
  const registry = await loadJson(registryPath);
  const registryRequestIds = new Set(registry.evidence.map((item) => item.request_id));
  const companyAuditFiles = await jsonFiles(companyAuditRoot);
  const companyAudits = await Promise.all(companyAuditFiles.map(loadJson));
  const companyAuditById = new Map(companyAudits.map((audit) => [audit.id, audit]));
  const expectedCompanyAuditIds = new Set(companyAudits.map((audit) => audit.id));
  const fixtures = await jsonFiles(comparativeAuditRoot);

  for (const fixture of fixtures) {
    const audit = await loadJson(fixture);
    const citationIds = new Set(audit.citations.map((citation) => citation.company_audit_id));
    const citationRequestIds = new Set(audit.citations.flatMap((citation) => citation.request_ids));

    assert.equal(audit.scope.registry_path, 'browser-evidence/registry.json');
    assert.equal(audit.scope.local_fixture_evidence_only, true);
    assert.equal(audit.scope.live_websites, false);
    assert.equal(audit.scope.report_generation, false);
    assert.equal(audit.provenance.local_fixture_evidence_only, true);
    assert.equal(audit.provenance.live_websites, false);
    assert.equal(audit.provenance.report_generation, false);
    assert.equal(audit.provenance.provenance_only, true);
    assert.equal(audit.provenance.read_only, true);
    assert.ok(audit.provenance.non_goals.includes('viewer'));
    assert.ok(audit.provenance.non_goals.includes('workflow_engine'));

    assert.deepEqual([...citationIds].sort(), [...expectedCompanyAuditIds].sort());
    assert.deepEqual([...citationRequestIds].sort(), [...registryRequestIds].sort());
    assert.deepEqual([...audit.provenance.derived_from_company_audit_ids].sort(), [...expectedCompanyAuditIds].sort());
    assert.deepEqual([...audit.provenance.browser_evidence_request_ids].sort(), [...registryRequestIds].sort());

    for (const source of audit.source_company_audits) {
      const companyAudit = companyAuditById.get(source.id);
      assert.ok(companyAudit, `${audit.id} source audit ${source.id} must resolve`);
      assert.equal(source.company, companyAudit.company.name);
      assert.equal(source.role, companyAudit.company.role);
      assert.deepEqual(source.request_ids, companyAudit.provenance.browser_evidence_request_ids);
      await fs.readFile(path.join(artifactFixtureRoot, source.path));
    }

    for (const citation of audit.citations) {
      const companyAudit = companyAuditById.get(citation.company_audit_id);
      assert.ok(companyAudit, `${audit.id} cites unknown company audit ${citation.company_audit_id}`);
      assert.equal(citation.company, companyAudit.company.name);
      assert.equal(citation.role, companyAudit.company.role);
      assert.deepEqual(citation.request_ids, companyAudit.provenance.browser_evidence_request_ids);
      for (const requestId of citation.request_ids) {
        assert.ok(registryRequestIds.has(requestId), `${audit.id} cites unknown request ${requestId}`);
      }
    }

    for (const companyAuditId of collectNamedIds(audit, new Set(['company_audit_id', 'company_audit_ids', 'derived_from_company_audit_ids']))) {
      assert.ok(citationIds.has(companyAuditId), `${audit.id} company audit citation ${companyAuditId} must resolve to citations[]`);
      assert.ok(expectedCompanyAuditIds.has(companyAuditId), `${audit.id} company audit citation ${companyAuditId} must resolve to a fixture`);
    }

    for (const requestId of collectNamedIds(audit, new Set(['request_ids', 'browser_evidence_request_ids']))) {
      assert.ok(citationRequestIds.has(requestId), `${audit.id} request citation ${requestId} must resolve to citations[]`);
      assert.ok(registryRequestIds.has(requestId), `${audit.id} request citation ${requestId} must resolve to the registry`);
    }

    const keys = collectKeys(audit);
    for (const forbiddenKey of ['source_url', 'screenshot_path', 'captured_at', 'extracted_text_excerpt']) {
      assert.equal(keys.has(forbiddenKey), false, `${audit.id} should not duplicate Company Brand Audit citation field ${forbiddenKey}`);
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-audit-project-v0.schema.json');
const invalidFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/employer-brand-audit-project-v0/invalid');
const artifactFixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const projectFixturePath = path.join(artifactFixtureRoot, 'intake/project.json');

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

function collectStrings(value, strings = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
    return strings;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') strings.push(value);
    return strings;
  }
  for (const child of Object.values(value)) collectStrings(child, strings);
  return strings;
}

test('Employer Brand Audit Project v0 validates the Symphony/Phenom/Radancy project instance', async () => {
  const result = validate(projectFixturePath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

  const project = await loadJson(projectFixturePath);
  assert.equal(project.type, 'aos.employer_brand_audit_project');
  assert.equal(project.intake.client_company.name, 'Symphony Talent');
  assert.deepEqual(project.intake.competitor_companies.map((company) => company.name), [
    'Phenom',
    'Radancy',
  ]);
  assert.equal(project.intake.talent_segment, null);
  assert.equal(project.controls.remote_web_collection_authorized, false);
  assert.equal(project.controls.autonomous_browsing_authorized, false);
  assert.equal(project.controls.report_generation_authorized, false);
  assert.equal(project.controls.export_execution_authorized, false);
  assert.equal(project.controls.workflow_engine_authorized, false);
  assert.equal(project.provenance.project_instance_only, true);
  assert.equal(project.provenance.read_only, true);
  assert.equal(project.provenance.provenance_only, true);

  assert.deepEqual(project.source_categories.map((category) => category.id), [
    'careers_site',
    'employer_brand_pages',
    'linkedin_presence',
    'review_platforms',
    'social_campaigns',
    'awards_recognition',
    'employee_stories',
  ]);

  const links = project.artifact_links;
  assert.equal(links.artifact_bundle_id, 'artifact-bundle:employer-brand-comparative-audit');
  assert.equal(links.work_record_id, 'work-record:employer-brand-comparative-audit-fixture');
  assert.equal(links.read_only, true);
  assert.equal(links.provenance_only, true);
  await fs.readFile(path.join(repoRoot, links.artifact_bundle_subject_path));
  await fs.readFile(path.join(artifactFixtureRoot, links.work_record_path));
  await fs.readFile(path.join(artifactFixtureRoot, links.browser_evidence_manifest_path));
  await fs.readFile(path.join(artifactFixtureRoot, links.browser_evidence_registry_path));
  for (const fixturePath of [...links.company_brand_audit_paths, ...links.comparative_brand_audit_paths]) {
    await fs.readFile(path.join(artifactFixtureRoot, fixturePath));
  }
});

test('Employer Brand Audit Project v0 accepts arbitrary clients and no completed artifact links', async () => {
  const fixture = await loadJson(projectFixturePath);
  const generic = structuredClone(fixture);
  generic.id = 'employer-brand-audit-project:example-health-northstar';
  generic.label = 'Example Health Employer Brand Audit Project';
  generic.project.project_id = 'example-health-northstar';
  generic.project.status = 'draft';
  generic.project.description = 'Generic intake-only project fixture for a different employer brand audit.';
  generic.intake.client_company = {
    name: 'Example Health',
    role: 'client',
    website_url: 'https://example.test/careers',
    notes: 'Synthetic client used to prove the schema is not tied to the bundled fixture.',
  };
  generic.intake.competitor_companies = [
    {
      name: 'Northstar Talent',
      role: 'competitor',
      website_url: null,
      notes: 'Synthetic competitor used to prove the competitor set is project data.',
    },
  ];
  generic.intake.talent_segment = {
    label: 'Nursing talent',
    provided_by_user: true,
    notes: 'Optional talent segment can be supplied per project.',
  };
  generic.intake.geography = null;
  generic.intake.audience_use_case = {
    primary_audience: 'Talent acquisition leadership',
    use_case: 'Scope a future competitor audit before evidence collection.',
    secondary_audiences: [],
    notes: null,
  };
  generic.source_categories = [
    {
      id: 'careers_site',
      label: 'Careers or jobs site',
      coverage_policy: 'attempt_if_available',
      expected_source_kinds: ['careers_home'],
      evidence_goal: 'Capture the primary employer value proposition.',
      notes: null,
    },
    {
      id: 'review_platforms',
      label: 'Review platforms',
      coverage_policy: 'required',
      expected_source_kinds: ['glassdoor', 'indeed'],
      evidence_goal: 'Capture employee sentiment when available.',
      notes: null,
    },
  ];
  generic.provenance.local_fixture_evidence_only = false;
  generic.provenance.derived_from = [];
  delete generic.artifact_links;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-project-'));
  const tmpFixture = path.join(tmpDir, 'generic-project.json');
  await fs.writeFile(tmpFixture, `${JSON.stringify(generic, null, 2)}\n`);
  try {
    const result = validate(tmpFixture);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  assert.equal('artifact_links' in generic, false);
  assert.deepEqual(generic.intake.competitor_companies.map((company) => company.name), [
    'Northstar Talent',
  ]);
  for (const fixtureCompany of ['Symphony Talent', 'Phenom', 'Radancy']) {
    assert.equal(
      collectStrings(generic).some((value) => value.includes(fixtureCompany)),
      false,
      `generic project should not depend on ${fixtureCompany}`,
    );
  }
});

test('invalid Employer Brand Audit Project v0 fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(invalidFixtureRoot);
  assert.ok(fixtures.length >= 1, 'expected invalid Employer Brand Audit Project fixture');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

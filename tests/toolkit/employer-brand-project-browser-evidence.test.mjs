import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileBrowserEvidenceManifestFromEmployerBrandAuditProject,
} from '../../packages/toolkit/workbench/employer-brand-project-browser-evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const browserEvidenceSchemaPath = path.join(repoRoot, 'shared/schemas/browser-evidence-capture-v0.schema.json');
const projectFixturePath = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/intake/project.json',
);
const planningManifestFixturePath = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/planning-manifest-skeleton.json',
);

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'aos-eba-project-manifest-'));
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

function validateJson(instancePath) {
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
      browserEvidenceSchemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

async function validateManifestObject(manifest) {
  const dir = await tempDir();
  const file = path.join(dir, 'manifest.json');
  try {
    await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = validateJson(file);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function companyNamesFromProject(project) {
  return [
    project.intake.client_company.name,
    ...project.intake.competitor_companies.map((company) => company.name),
  ];
}

function assertLocalOnlyManifest(manifest) {
  assert.equal(manifest.type, 'aos.browser_evidence_capture_manifest');
  assert.equal(manifest.metadata.deterministic_planning_bridge, true);
  assert.equal(manifest.metadata.skeleton_only, true);
  assert.equal(manifest.metadata.local_fixture_pages_only, true);
  assert.equal(manifest.metadata.live_websites, false);
  assert.equal(manifest.metadata.remote_web_collection, false);
  assert.equal(manifest.metadata.autonomous_browsing, false);
  assert.equal(manifest.metadata.collection_execution, false);
  assert.equal(manifest.metadata.workflow_execution, false);
  assert.equal(manifest.metadata.report_generation, false);
  assert.equal(manifest.metadata.export_execution, false);
  assert.equal('evidence' in manifest, false);
  assert.equal('capture_metadata' in manifest, false);

  for (const request of manifest.requests) {
    assert.doesNotMatch(request.url, /^[a-zA-Z][a-zA-Z0-9+.-]*:/);
    assert.doesNotMatch(request.url, /^\//);
    assert.equal(request.xpath, null);
    assert.match(request.selector, /^\[data-browser-evidence-request="/);
    assert.deepEqual(request.kilos_relevance, []);
    assert.deepEqual(request.kilos_factors, []);
  }
}

function assertDoesNotCopyLiveUrls(manifest, project) {
  for (const liveUrl of [
    project.intake.client_company.website_url,
    ...project.intake.competitor_companies.map((company) => company.website_url),
  ]) {
    assert.equal(collectStrings(manifest).includes(liveUrl), false, `manifest should not copy ${liveUrl}`);
  }
}

function genericProjectFixture() {
  return {
    type: 'aos.employer_brand_audit_project',
    schema_version: '2026-05-employer-brand-audit-project-v0',
    id: 'employer-brand-audit-project:example-health-northstar',
    label: 'Example Health Employer Brand Audit Project',
    project: {
      project_id: 'example-health-northstar',
      kind: 'comparative_employer_brand_audit',
      framework: 'KILOS',
      status: 'draft',
      description: 'Generic intake-only project fixture for a different employer brand audit.',
    },
    intake: {
      client_company: {
        name: 'Example Health',
        role: 'client',
        website_url: 'https://example.test/careers',
        notes: 'Synthetic client.',
      },
      competitor_companies: [
        {
          name: 'Northstar Talent',
          role: 'competitor',
          website_url: 'https://northstar.example/jobs',
          notes: 'Synthetic competitor supplied by the project fixture.',
        },
      ],
      talent_segment: null,
      geography: null,
      audience_use_case: {
        primary_audience: 'Talent acquisition leadership',
        use_case: 'Scope a future competitor audit before evidence collection.',
        secondary_audiences: [],
        notes: null,
      },
      output_preferences: {
        artifact_types: ['structured_browser_evidence_manifest'],
        include_evidence_appendix: false,
        include_work_record_link: false,
        export_preferences: [],
        notes: 'Planning fixture only.',
      },
    },
    source_categories: [
      {
        id: 'careers_site',
        label: 'Careers site',
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
        evidence_goal: 'Capture employee sentiment themes when available.',
        notes: 'Review sites remain local fixture placeholders at planning time.',
      },
      {
        id: 'social_campaigns',
        label: 'Social campaign examples',
        coverage_policy: 'not_applicable',
        expected_source_kinds: ['social_post'],
        evidence_goal: 'Do not plan social evidence for this project.',
        notes: null,
      },
    ],
    controls: {
      remote_web_collection_authorized: false,
      autonomous_browsing_authorized: false,
      report_generation_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      replay_authorized: false,
      repair_authorized: false,
      macro_playback_authorized: false,
    },
    provenance: {
      created_at: '2026-05-07T18:00:00Z',
      project_instance_only: true,
      read_only: true,
      provenance_only: true,
      local_fixture_evidence_only: true,
      derived_from: [],
      non_goals: [
        'remote_web_collection',
        'autonomous_browsing',
        'report_generation',
        'export_execution',
        'workflow_engine',
      ],
    },
  };
}

test('compiles the Symphony/Phenom/Radancy project fixture into a local-only planning manifest skeleton', async () => {
  const project = await readJson(projectFixturePath);
  const manifest = compileBrowserEvidenceManifestFromEmployerBrandAuditProject(project);
  await validateManifestObject(manifest);

  assert.equal(manifest.type, 'aos.browser_evidence_capture_manifest');
  assert.equal(manifest.schema_version, '2026-05-browser-evidence-capture-v0');
  assert.equal(manifest.created_at, null);
  assert.equal(manifest.metadata.source_project_id, 'symphony-talent-phenom-radancy');
  assert.equal(manifest.requests.length, 21);
  assertLocalOnlyManifest(manifest);

  const projectCompanyNames = companyNamesFromProject(project);
  assert.deepEqual([...new Set(manifest.requests.map((request) => request.company))], projectCompanyNames);
  assert.deepEqual([...new Set(manifest.requests.map((request) => request.source_category))], [
    'careers_site',
    'employer_brand_pages',
    'linkedin_presence',
    'review_platforms',
    'social_campaigns',
    'awards_recognition',
    'employee_stories',
  ]);

  for (const company of projectCompanyNames) {
    for (const category of project.source_categories) {
      const request = manifest.requests.find((item) => (
        item.company === company && item.source_category === category.id
      ));
      assert.ok(request, `expected request for ${company} / ${category.id}`);
      assert.equal(request.evidence_goal, category.evidence_goal);
    }
  }

  assertDoesNotCopyLiveUrls(manifest, project);
});

test('checked-in planning manifest skeleton matches the project compiler output', async () => {
  const project = await readJson(projectFixturePath);
  const manifest = await readJson(planningManifestFixturePath);
  const compiled = compileBrowserEvidenceManifestFromEmployerBrandAuditProject(project);
  const validation = validateJson(planningManifestFixturePath);

  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);
  assert.deepEqual(manifest, compiled);
  assert.equal(manifest.requests.length, 21);
  assert.equal(manifest.metadata.request_count, manifest.requests.length);
  assertLocalOnlyManifest(manifest);
  assertDoesNotCopyLiveUrls(manifest, project);
});

test('compiles arbitrary project fixtures without inherited companies or non-applicable source categories', async () => {
  const project = genericProjectFixture();
  const manifest = compileBrowserEvidenceManifestFromEmployerBrandAuditProject(project, {
    htmlRoot: 'browser-evidence/html',
  });
  await validateManifestObject(manifest);
  assertLocalOnlyManifest(manifest);

  assert.deepEqual(manifest.requests.map((request) => [request.company, request.source_category]), [
    ['Example Health', 'careers_site'],
    ['Example Health', 'review_platforms'],
    ['Northstar Talent', 'careers_site'],
    ['Northstar Talent', 'review_platforms'],
  ]);
  assert.deepEqual(manifest.metadata.source_categories.map((category) => category.id), [
    'careers_site',
    'review_platforms',
  ]);
  assert.deepEqual(manifest.metadata.skipped_source_categories, ['social_campaigns']);

  const careersRequest = manifest.requests.find((request) => (
    request.company === 'Example Health' && request.source_category === 'careers_site'
  ));
  assert.equal(careersRequest.request_id, 'example_health_careers_site_planning');
  assert.equal(careersRequest.url, 'browser-evidence/html/example-health-careers-site.html');
  assert.equal(careersRequest.evidence_goal, 'Capture the primary employer value proposition.');
  assert.match(careersRequest.notes, /Planning skeleton only/);

  for (const forbidden of [
    'Symphony Talent',
    'Phenom',
    'Radancy',
    'https://example.test/careers',
    'https://northstar.example/jobs',
  ]) {
    assert.equal(
      collectStrings(manifest).some((value) => value.includes(forbidden)),
      false,
      `generic manifest should not include ${forbidden}`,
    );
  }
});

test('script writes a Browser Evidence Capture manifest skeleton without running collection', async () => {
  const outputDir = await tempDir();
  const outputPath = path.join(outputDir, 'manifest.json');
  try {
    const result = spawnSync(
      'node',
      [
        'scripts/employer-brand-project-browser-evidence-manifest.mjs',
        '--project',
        projectFixturePath,
        '--out',
        outputPath,
        '--html-root',
        'planning-html',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /21 planning requests/);

    const manifest = await readJson(outputPath);
    const validation = validateJson(outputPath);
    assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);
    assert.equal(manifest.requests.length, 21);
    assert.equal(manifest.requests[0].url.startsWith('planning-html/'), true);
    assert.equal(manifest.metadata.collection_execution, false);
    assert.equal(manifest.metadata.workflow_execution, false);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

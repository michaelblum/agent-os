import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbenchSubject } from '../../packages/toolkit/workbench/subject.js';
import { createArtifactBundleSubject } from '../../packages/toolkit/workbench/artifact-bundle-subject.js';
import { createWikiPageSubject } from '../../packages/toolkit/workbench/wiki-subject.js';
import { createWorkRecordSubject } from '../../packages/toolkit/workbench/work-record-subject.js';
import { createWikiWorkflowSubject } from '../../packages/toolkit/workbench/workflow-subject.js';
import { buildMarkdownWorkbenchSubject, createMarkdownWorkbenchState } from '../../packages/toolkit/components/markdown-workbench/model.js';
import { buildWorkRecordWorkbenchSubject, createWorkRecordWorkbenchState } from '../../packages/toolkit/components/work-record-workbench/model.js';
import { createRadialMenuWorkbenchSubject } from '../../packages/toolkit/workbench/radial-menu-subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-workbench-subject.schema.json');
const workRecordFixturePath = path.join(
  repoRoot,
  'docs/design/fixtures/aos-work-records/browser-artifact-collection-step.json',
);
const v0WorkRecordFixturePath = path.join(
  repoRoot,
  'shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json',
);
const artifactBundleFixturePath = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/example-design-pass/subject.json',
);
const workflowMapMarkdown = `# Runtime Readiness Workflow

| Stage | Canonical Page | Output |
| --- | --- | --- |
| Orient | [Runtime Modes](runtime-modes.md) | Runtime mode selected |
| Inspect | [Self Check](../plugins/self-check/SKILL.md) | Runtime diagnostics reviewed |
`;

async function validate(instance) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.argv[2])
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      JSON.stringify(instance),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

async function reject(instance) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.argv[2])
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
sys.exit(0 if errors else 1)
`,
      schemaPath,
      JSON.stringify(instance),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

test('toolkit workbench subject helper emits schema-valid descriptors', async () => {
  await fs.access(schemaPath);
  await validate(createWorkbenchSubject({
    id: 'file:docs/example.md',
    type: 'markdown.document',
    label: 'example.md',
    owner: 'markdown-workbench',
  }));
});

test('subject schema accepts canonical v-next fields', async () => {
  await validate(createWorkbenchSubject({
    id: 'service.runtime:gateway',
    type: 'service.runtime',
    label: 'Gateway',
    owner: 'gateway',
    capabilities: ['inspectable', 'editable'],
    contracts: ['service.runtime.read', 'service.runtime.configure'],
    subject_references: [
      {
        id: 'gateway-narrative-source',
        relationship: 'narrative_source',
        handle: 'wiki:aos/concepts/gateway.md',
        subject_id: 'wiki:aos/concepts/gateway.md',
        subject_type: 'wiki.entity',
        facet_key: 'wiki',
        layer: 'narrative',
        role: 'source',
      },
    ],
    facets: [
      {
        key: 'narrative',
        layer: 'narrative',
        label: 'Agent Narrative',
        source_ref: 'gateway-narrative-source',
        capabilities: ['inspectable', 'editable'],
        contracts: ['markdown_document.text.patch'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: 'aos://toolkit/components/markdown-workbench/index.html',
            },
            preferred: true,
          },
        ],
      },
    ],
  }));
});

test('subject schema keeps legacy summaries only as explicit boundary fields', async () => {
  await validate({
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'wiki:aos/concepts/legacy.md',
    subject_type: 'wiki.concept',
    label: 'Legacy',
    owner: 'aos',
    capabilities: ['inspectable'],
    views: ['markdown.source'],
    controls: ['text.editor'],
  });

  await reject({
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'wiki:aos/concepts/dotted-capability.md',
    subject_type: 'wiki.concept',
    label: 'Dotted Capability',
    owner: 'aos',
    capabilities: ['wiki.read'],
  });
});

test('current workbench adopters emit schema-valid subject descriptors', async () => {
  await validate(buildMarkdownWorkbenchSubject(createMarkdownWorkbenchState({
    path: 'docs/example.md',
    content: '# Example',
  })));
  await validate(createRadialMenuWorkbenchSubject({
    menu: {
      id: 'example.radial',
      items: [{ id: 'inspect', label: 'Inspect', action: 'inspect' }],
    },
    owner: 'fixture',
    canvasId: 'preview',
    selectedItemId: 'inspect',
  }));
  await validate(createWikiPageSubject({
    path: 'aos/plugins/self-check/SKILL.md',
    type: 'workflow',
    name: 'self-check',
    plugin: 'self-check',
    tags: ['diagnostics', 'runtime'],
  }));
  await validate(createWorkRecordSubject(JSON.parse(await fs.readFile(workRecordFixturePath, 'utf8'))));
  await validate(createWorkRecordSubject(JSON.parse(await fs.readFile(v0WorkRecordFixturePath, 'utf8'))));
  await validate(createWikiWorkflowSubject({
    root: {
      path: 'aos/concepts/runtime-readiness-workflow.md',
      type: 'concept',
      name: 'Runtime Readiness Workflow',
      tags: ['runtime', 'workflow', 'process'],
    },
    pages: [
      {
        path: 'aos/concepts/runtime-modes.md',
        type: 'concept',
        name: 'Runtime Modes',
      },
      {
        path: 'aos/plugins/self-check/SKILL.md',
        type: 'workflow',
        name: 'self-check',
      },
    ],
    markdown: workflowMapMarkdown,
  }));
  await validate(buildWorkRecordWorkbenchSubject(createWorkRecordWorkbenchState({
    record: JSON.parse(await fs.readFile(workRecordFixturePath, 'utf8')),
  })));
  await validate(buildWorkRecordWorkbenchSubject(createWorkRecordWorkbenchState({
    record: JSON.parse(await fs.readFile(v0WorkRecordFixturePath, 'utf8')),
  })));
  await validate(createArtifactBundleSubject(JSON.parse(await fs.readFile(artifactBundleFixturePath, 'utf8'))));
});

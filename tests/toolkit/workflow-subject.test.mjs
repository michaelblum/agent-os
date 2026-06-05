import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWikiWorkflowDescriptor,
  createWikiWorkflowSubject,
} from '../../packages/toolkit/workbench/workflow-subject.js';
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
} from '../../packages/toolkit/workbench/subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workflowMapMarkdown = `# Runtime Readiness Workflow

| Stage | Canonical Page | Output |
| --- | --- | --- |
| Orient | [Runtime Modes](runtime-modes.md) | Runtime mode selected |
| Inspect | [Self Check](../plugins/self-check/SKILL.md) | Runtime diagnostics reviewed |
| Record | [Daemon](../entities/daemon.md) | Runtime evidence recorded |
`;

const pages = [
  {
    path: 'aos/concepts/runtime-readiness-workflow.md',
    type: 'concept',
    name: 'Runtime Readiness Workflow',
    description: 'End-to-end map for runtime readiness checks.',
    tags: ['runtime', 'workflow', 'process'],
    modified_at: 1776393337,
  },
  {
    path: 'aos/concepts/runtime-modes.md',
    type: 'concept',
    name: 'Runtime Modes',
  },
  {
    path: 'aos/plugins/self-check/SKILL.md',
    type: 'workflow',
    name: 'self-check',
    plugin: 'self-check',
  },
  {
    path: 'aos/entities/daemon.md',
    type: 'entity',
    name: 'Daemon',
  },
];

test('createWikiWorkflowDescriptor projects a neutral workflow map chain', () => {
  const descriptor = createWikiWorkflowDescriptor({
    root: pages[0],
    pages,
    markdown: workflowMapMarkdown,
  });

  assert.equal(descriptor.root.path, 'aos/concepts/runtime-readiness-workflow.md');
  assert.equal(descriptor.validation.state, 'valid');
  assert.equal(descriptor.validation.source, 'stage_contract_table');
  assert.equal(descriptor.steps.length, 3);
  assert.equal(descriptor.steps[0].label, 'Orient');
  assert.equal(descriptor.steps[0].target.path, 'aos/concepts/runtime-modes.md');
  assert.equal(descriptor.steps[1].target.path, 'aos/plugins/self-check/SKILL.md');
  assert.equal(descriptor.steps[2].target.kind, 'artifact');
  assert.ok(descriptor.child_workflows.some((child) => child.path === 'aos/plugins/self-check/SKILL.md'));
  assert.ok(descriptor.artifacts.some((artifact) => artifact.path === 'aos/entities/daemon.md'));
  assert.ok(descriptor.outputs.includes('Runtime evidence recorded'));
});

test('createWikiWorkflowSubject emits a workflow-chain workbench subject', () => {
  const subject = createWikiWorkflowSubject({
    root: pages[0],
    pages,
    markdown: workflowMapMarkdown,
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'workflow:aos/concepts/runtime-readiness-workflow.md');
  assert.equal(subject.subject_type, 'wiki.workflow_chain');
  assert.equal(subject.owner, 'aos');
  assert.equal(subject.source.kind, 'wiki_workflow');
  assert.equal(subject.metadata.step_count, 3);
  assert.equal(subject.metadata.child_workflow_count, 1);
  assert.equal(subject.metadata.validation_state, 'valid');
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'replayable']);
  assert.ok(subjectContracts(subject).includes('workflow.chain.inspect'));
  assert.ok(subjectFacets(subject).some((facet) => facet.key === 'workflow-chain'));
  assert.equal('views' in subject, false);
  assert.equal('controls' in subject, false);
  assert.equal(subject.state.workflow.steps[0].target.subject_id, 'wiki:aos/concepts/runtime-modes.md');
});

test('workflow descriptor marks unresolved linked workflow targets repairable', () => {
  const descriptor = createWikiWorkflowDescriptor({
    root: pages[0],
    pages: pages.slice(0, 1),
    markdown: workflowMapMarkdown,
  });

  assert.equal(descriptor.validation.state, 'repairable');
  assert.ok(descriptor.validation.missing_targets.length > 0);
  assert.equal(descriptor.steps[0].target.resolved, false);
  assert.equal(descriptor.steps[0].target.kind, 'missing');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWikiWorkflowDescriptor,
  createWikiWorkflowSubject,
} from '../../packages/toolkit/workbench/workflow-subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workflowMapPath = path.join(repoRoot, 'wiki-seed/concepts/employer-brand-workflow-map.md');
const workflowMapMarkdown = fs.readFileSync(workflowMapPath, 'utf8');

const pages = [
  {
    path: 'aos/concepts/employer-brand-workflow-map.md',
    type: 'concept',
    name: 'Employer Brand Workflow Map',
    description: 'End-to-end map for the canonical employer-brand workflow set.',
    tags: ['employer-brand', 'workflow', 'process'],
    modified_at: 1776393337,
  },
  {
    path: 'aos/plugins/employer-brand-profile-intake/SKILL.md',
    type: 'workflow',
    name: 'employer-brand-profile-intake',
    plugin: 'employer-brand-profile-intake',
  },
  {
    path: 'aos/plugins/employer-brand-artifact-collection-planner/SKILL.md',
    type: 'workflow',
    name: 'employer-brand-artifact-collection-planner',
    plugin: 'employer-brand-artifact-collection-planner',
  },
  {
    path: 'aos/concepts/normalize-employer-brand-evidence.md',
    type: 'concept',
    name: 'Normalize Employer Brand Evidence',
  },
  {
    path: 'aos/plugins/employer-brand-profile-synthesis/SKILL.md',
    type: 'workflow',
    name: 'employer-brand-profile-synthesis',
    plugin: 'employer-brand-profile-synthesis',
  },
  {
    path: 'aos/plugins/employer-brand-competitor-comparison/SKILL.md',
    type: 'workflow',
    name: 'employer-brand-competitor-comparison',
    plugin: 'employer-brand-competitor-comparison',
  },
  {
    path: 'aos/plugins/employer-brand-report-generation/SKILL.md',
    type: 'workflow',
    name: 'employer-brand-report-generation',
    plugin: 'employer-brand-report-generation',
  },
  {
    path: 'aos/entities/employer-brand-profile.md',
    type: 'entity',
    name: 'Employer Brand Profile',
  },
  {
    path: 'aos/entities/employer-brand-comparison.md',
    type: 'entity',
    name: 'Employer Brand Comparison',
  },
  {
    path: 'aos/plugins/kilos-brand-audit-report/references/report-data-schema.md',
    type: 'concept',
    name: 'Brand Audit Report Data Schema',
    plugin: 'kilos-brand-audit-report',
  },
  {
    path: 'aos/plugins/kilos-brand-audit-report/references/folder-structure.md',
    type: 'concept',
    name: 'Brand Audit Report Folder Structure',
    plugin: 'kilos-brand-audit-report',
  },
];

test('createWikiWorkflowDescriptor projects the employer-brand workflow map chain', () => {
  const descriptor = createWikiWorkflowDescriptor({
    root: pages[0],
    pages,
    markdown: workflowMapMarkdown,
  });

  assert.equal(descriptor.root.path, 'aos/concepts/employer-brand-workflow-map.md');
  assert.equal(descriptor.validation.state, 'valid');
  assert.equal(descriptor.validation.source, 'stage_contract_table');
  assert.equal(descriptor.steps.length, 6);
  assert.equal(descriptor.steps[0].label, 'Intake');
  assert.equal(descriptor.steps[0].target.path, 'aos/plugins/employer-brand-profile-intake/SKILL.md');
  assert.equal(descriptor.steps[1].target.path, 'aos/plugins/employer-brand-artifact-collection-planner/SKILL.md');
  assert.equal(descriptor.steps[2].target.kind, 'reference');
  assert.equal(descriptor.steps[3].target.kind, 'workflow');
  assert.ok(descriptor.child_workflows.some((child) => child.path === 'aos/plugins/employer-brand-report-generation/SKILL.md'));
  assert.ok(descriptor.artifacts.some((artifact) => artifact.path === 'aos/entities/employer-brand-profile.md'));
  assert.ok(descriptor.outputs.includes('One [Employer Brand Comparison](../entities/employer-brand-comparison.md)'));
});

test('createWikiWorkflowSubject emits a workflow-chain workbench subject', () => {
  const subject = createWikiWorkflowSubject({
    root: pages[0],
    pages,
    markdown: workflowMapMarkdown,
  });

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'workflow:aos/concepts/employer-brand-workflow-map.md');
  assert.equal(subject.subject_type, 'wiki.workflow_chain');
  assert.equal(subject.owner, 'aos');
  assert.equal(subject.source.kind, 'wiki_workflow');
  assert.equal(subject.metadata.step_count, 6);
  assert.equal(subject.metadata.child_workflow_count, 5);
  assert.equal(subject.metadata.validation_state, 'valid');
  assert.ok(subject.capabilities.includes('workflow.chain.inspect'));
  assert.ok(subject.views.includes('workflow.chain'));
  assert.ok(subject.controls.includes('invoke.child_workflow'));
  assert.equal(subject.state.workflow.steps[0].target.subject_id, 'wiki:aos/plugins/employer-brand-profile-intake/SKILL.md');
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

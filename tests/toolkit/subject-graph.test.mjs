import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBJECT_GRAPH_INDEX_SCHEMA_VERSION,
  SUBJECT_GRAPH_INDEX_TYPE,
  deriveSubjectGraphIndex,
  summarizeSubjectGraphIndex,
} from '../../packages/toolkit/workbench/subject-graph.js';
import { createWikiPageSubject } from '../../packages/toolkit/workbench/wiki-subject.js';
import {
  WORK_RECORD_WORKBENCH_URL,
  createWorkRecordSubjectCatalogEntry,
} from '../../packages/toolkit/workbench/subject-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

function graphFixtureInputs() {
  const wikiSubject = createWikiPageSubject({
    path: 'aos/concepts/runtime-modes.md',
    frontmatter: {
      type: 'concept',
      name: 'Runtime Modes',
      tags: ['aos', 'runtime'],
    },
  });
  const workRecordEntry = createWorkRecordSubjectCatalogEntry(fixture('workflow-browser-click-status.json'));
  return { wikiSubject, workRecordEntry };
}

test('subject graph index derives deterministic subject nodes facets hosts and typed edges', () => {
  const { wikiSubject, workRecordEntry } = graphFixtureInputs();
  const index = deriveSubjectGraphIndex([workRecordEntry, wikiSubject]);
  const reversed = deriveSubjectGraphIndex([wikiSubject, workRecordEntry]);

  assert.deepEqual(index, reversed);
  assert.equal(index.type, SUBJECT_GRAPH_INDEX_TYPE);
  assert.equal(index.schema_version, SUBJECT_GRAPH_INDEX_SCHEMA_VERSION);
  assert.deepEqual(index.nodes.map((node) => node.subject_id), [
    'wiki:aos/concepts/runtime-modes.md',
    'work-record:aos-browser-click-status-2026-05-06',
  ]);

  assert.equal(index.metadata.subject_count, 2);
  assert.equal(index.metadata.facet_count, 11);
  assert.equal(index.metadata.host_count, 12);
  assert.equal(index.metadata.edge_count, 29);
  assert.equal(index.metadata.catalog_entry_count, 1);
  assert.equal(index.metadata.descriptor_count, 1);
  assert.deepEqual(index.metadata.health, { valid: 1 });

  const wikiNode = index.nodes.find((node) => node.subject_id === 'wiki:aos/concepts/runtime-modes.md');
  assert.equal(wikiNode.subject_type, 'wiki.concept');
  assert.equal(wikiNode.entry_handle, 'wiki:aos/concepts/runtime-modes.md');
  assert.deepEqual(wikiNode.capabilities, ['inspectable', 'editable']);
  assert.ok(wikiNode.contracts.includes('wiki.read'));
  assert.equal(wikiNode.source.kind, 'wiki');
  assert.equal(wikiNode.source.path, 'aos/concepts/runtime-modes.md');

  const workRecordNode = index.nodes.find((node) => (
    node.subject_id === 'work-record:aos-browser-click-status-2026-05-06'
  ));
  assert.equal(workRecordNode.subject_type, 'aos.work_record');
  assert.equal(workRecordNode.source_record.kind, 'catalog_entry');
  assert.equal(workRecordNode.health.verdict, 'valid');
  assert.equal(workRecordNode.evidence.evidence_count, 3);
  assert.equal(workRecordNode.evidence.claim_count, 2);

  assert.ok(index.facet_summaries.some((facet) => (
    facet.subject_id === wikiNode.subject_id
      && facet.key === 'wiki-graph'
      && facet.layer === 'descriptor'
      && facet.host_count === 2
  )));
  assert.ok(index.host_references.some((host) => (
    host.subject_id === workRecordNode.subject_id
      && host.entry.value === WORK_RECORD_WORKBENCH_URL
  )));
  assert.ok(index.edges.some((edge) => (
    edge.kind === 'has_facet'
      && edge.source === wikiNode.id
      && edge.target.endsWith('#wiki-markdown')
  )));
  assert.ok(index.edges.some((edge) => (
    edge.kind === 'hosted_by'
      && edge.source.endsWith('#work_record.intent')
      && edge.host_kind === 'canvas'
      && edge.target_dialect === 'canvas'
  )));

  const originEdge = index.edges.find((edge) => (
    edge.kind === 'subject_reference'
      && edge.relationship === 'origin_subject'
  ));
  assert.equal(originEdge.source, workRecordNode.id);
  assert.equal(originEdge.target_handle, 'workflow:browser-live-action-status');
  assert.equal(originEdge.target_subject_id, 'workflow:browser-live-action-status');
  assert.equal(originEdge.target_subject_type, 'aos.workflow');
  assert.equal(originEdge.target_layer, 'execution_map');

  assert.deepEqual(summarizeSubjectGraphIndex(index), {
    subject_count: 2,
    facet_count: 11,
    host_count: 12,
    edge_count: 29,
    relationship_types: ['bridges_to', 'guided_by', 'has_facet', 'hosted_by', 'origin_step', 'origin_subject'],
    subject_types: ['aos.work_record', 'wiki.concept'],
    health: { valid: 1 },
  });
});

test('subject graph index ignores legacy views controls metadata refs and dotted raw capabilities', () => {
  const legacySummarySubject = {
    type: 'aos.workbench.subject',
    schema_version: '2026-05-03',
    id: 'work-record:legacy-summary-only',
    subject_type: 'aos.work_record',
    label: 'Legacy Summary Only',
    owner: 'aos-work-record',
    capabilities: ['inspectable', 'work_record.execution_map.view'],
    views: ['work_record.execution_map.json'],
    controls: ['open'],
    metadata: {
      subject_references: [
        {
          id: 'metadata-only-ref',
          relationship: 'guided_by',
          handle: 'wiki:aos/concepts/legacy.md',
        },
      ],
    },
    subject_references: [
      {
        id: 'canonical-ref',
        relationship: 'guided_by',
        handle: 'wiki:aos/concepts/canonical.md',
        subject_type: 'wiki.concept',
        layer: 'narrative',
      },
    ],
    facets: [
      {
        key: 'canonical-facet',
        layer: 'descriptor',
        label: 'Canonical Facet',
        contracts: ['work_record.execution_map.view'],
        hosts: [
          {
            kind: 'canvas',
            target_dialect: 'canvas',
            entry: {
              kind: 'aos-url',
              value: WORK_RECORD_WORKBENCH_URL,
            },
          },
        ],
      },
    ],
  };

  const index = deriveSubjectGraphIndex([legacySummarySubject]);
  const encoded = JSON.stringify(index);

  assert.deepEqual(index.nodes[0].capabilities, ['inspectable']);
  assert.deepEqual(index.nodes[0].contracts, []);
  assert.equal(index.facet_summaries[0].key, 'canonical-facet');
  assert.deepEqual(index.facet_summaries[0].contracts, ['work_record.execution_map.view']);
  assert.equal(index.host_references[0].entry.value, WORK_RECORD_WORKBENCH_URL);
  assert.equal(index.edges.filter((edge) => edge.kind === 'subject_reference').length, 1);
  assert.equal(index.edges.find((edge) => edge.kind === 'subject_reference').reference_id, 'canonical-ref');
  assert.doesNotMatch(encoded, /work_record\.execution_map\.json/);
  assert.doesNotMatch(encoded, /metadata-only-ref/);
  assert.doesNotMatch(encoded, /"open"/);
});

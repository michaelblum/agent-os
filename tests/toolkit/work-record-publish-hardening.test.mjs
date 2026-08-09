// Regression acceptance tests for Work Record publish-path hardening.
//
// These tests encode the corrected publication contract confirmed during the
// 2026-08-07 review cycle (see docs/design/work-record-publish-hardening-handoff-20260808.md):
//
//   1. The subject catalog must not construct active, openable entries from
//      historical V0 work-record bytes.
//   2. Publication rollback must scrub invocation-owned content through the
//      held descriptor and receipt what it leaves behind, instead of removing
//      path-named entries whose current identity it cannot prove.
//   3. A result claiming publication must leave the published bytes at the
//      destination path; a destination replaced mid-publication must survive
//      and must be reported, never silently accepted or removed.
//   4. Successful publication must complete as one atomic no-replace transfer
//      of the staged entry, with no remove-temp phase on the success path.
//
// Expectation at authoring time (checkpoint 1ea8a06f): the V0-rejection,
// rollback-receipt, and atomic-transfer tests FAIL against the current
// implementation; the mid-publication replacement test passes as a
// characterization guard and must stay green. The failing tests pass once the
// hardened publish path lands. Do not weaken these assertions to match
// current behavior; fix the implementation.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  descriptorRelativeAtomicPublishAvailability,
  installWorkRecordAtomicPublishTestHook,
  publishTextFileIfAbsent,
} from '../../packages/toolkit/workbench/work-record-atomic-publish.js';
import {
  createWorkRecordSubjectCatalogEntry,
} from '../../packages/toolkit/workbench/subject-catalog.js';

const V0_FIXTURE = new URL(
  '../../shared/schemas/fixtures/aos-work-record-v0/valid/workflow-browser-click-status.json',
  import.meta.url,
);

function fixture(prefix = 'aos-work-record-hardening-') {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(outer, 'boundary');
  const parent = path.join(root, 'nested', 'records');
  fs.mkdirSync(parent, { recursive: true });
  const destination = path.join(parent, 'record.json');
  return { outer, root, parent, destination };
}

function withHook(callback, run) {
  const restore = installWorkRecordAtomicPublishTestHook(callback);
  try {
    return run();
  } finally {
    restore();
  }
}

function nativeAvailable() {
  return descriptorRelativeAtomicPublishAvailability().available === true;
}

test('subject catalog rejects historical V0 records at construction', () => {
  const historical = JSON.parse(fs.readFileSync(V0_FIXTURE, 'utf8'));
  // Migration doctrine: V0 bytes are opaque historical data and must be
  // rejected by active readers. The catalog is an active reader, so entry
  // construction must fail for V0 input rather than wrap the bytes in an
  // entry object (even a non-openable one carrying schema_version
  // '2026-05-work-record-v0').
  assert.throws(
    () => createWorkRecordSubjectCatalogEntry(historical),
    undefined,
    'createWorkRecordSubjectCatalogEntry must reject historical V0 records at construction',
  );
});

test('publication rollback scrubs staged content through the held descriptor and receipts leftovers', { skip: !nativeAvailable() }, () => {
  const paths = fixture('aos-work-record-hardening-rollback-');
  const bytes = '{"record":"rollback-contract"}\n';

  // Force the publication transfer to fail after staging is complete.
  const result = withHook(
    (event) => (event.phase === 'before_publish_link' ? { fail_operation: 'link_destination' } : undefined),
    () => publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }),
  );

  assert.equal(result.published, false);
  assert.equal(fs.existsSync(paths.destination), false, 'failed publication must not create a destination entry');

  // Corrected contract: staged content is scrubbed through the held descriptor
  // before any removal decision, and the result receipts the outcome.
  assert.equal(
    result.content_scrubbed,
    true,
    'rollback must report content_scrubbed=true: staged bytes are destroyed via the held descriptor '
      + 'before the result is returned',
  );
  if (result.temp_file_leftover === true) {
    const leftover = fs.readFileSync(result.temp_file);
    assert.equal(
      leftover.length,
      0,
      'a receipted leftover staged entry must be empty: scrub-and-preserve, never remove-by-name '
        + 'an entry whose current identity cannot be proven',
    );
  }
});

test('a destination entry replaced mid-publication survives and is never claimed as published', { skip: !nativeAvailable() }, (t) => {
  const paths = fixture('aos-work-record-hardening-replacement-');
  const bytes = '{"record":"original-publication"}\n';
  const replacementBytes = '{"record":"concurrent-replacement"}\n';
  const parked = path.join(paths.parent, 'record.json.published-by-operation');

  const injectionPhases = new Set([
    'after_publish_link',
    'before_temp_unlink',
    'after_temp_unlink',
    'before_readback',
    'after_readback',
  ]);
  let swapped = false;

  const result = withHook(
    (event) => {
      if (!swapped && injectionPhases.has(event.phase) && fs.existsSync(paths.destination)) {
        fs.renameSync(paths.destination, parked);
        fs.writeFileSync(paths.destination, replacementBytes);
        swapped = true;
      }
      return undefined;
    },
    () => publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }),
  );

  if (!swapped) {
    // The hardened flow may publish through phases this test does not observe;
    // in that case this injection cannot run and the invariant is not exercisable here.
    t.diagnostic('no observable post-publication hook phase fired; replacement invariant not exercised');
    return;
  }
  t.diagnostic('replacement injection executed at a post-publication phase');

  // The concurrent replacement is not invocation-owned. It must survive intact.
  assert.equal(
    fs.readFileSync(paths.destination, 'utf8'),
    replacementBytes,
    'publication cleanup must never remove or overwrite a destination entry it did not create',
  );
  // And the operation must not claim success for bytes that are no longer at the path.
  assert.equal(
    result.published,
    false,
    'a result claiming publication while the destination path holds different bytes is a contract violation',
  );
});

test('successful publication is one atomic no-replace transfer with no remove-temp phase', { skip: !nativeAvailable() }, () => {
  const paths = fixture('aos-work-record-hardening-atomic-');
  const bytes = '{"record":"atomic-transfer"}\n';
  const phases = [];

  const result = withHook(
    (event) => {
      phases.push(event.phase);
      return undefined;
    },
    () => publishTextFileIfAbsent(paths.destination, bytes, { boundaryRoot: paths.root }),
  );

  assert.equal(result.status, 'published');
  assert.equal(result.published, true);
  assert.equal(fs.readFileSync(paths.destination, 'utf8'), bytes);

  // The corrected success path moves the staged entry into place with a single
  // atomic no-replace transfer; there is no subsequent phase that removes a
  // staged entry by name.
  const removePhases = phases.filter((phase) => phase === 'before_temp_unlink' || phase === 'after_temp_unlink');
  assert.deepEqual(
    removePhases,
    [],
    'success path must not contain a remove-temp phase: the staged entry is consumed by the atomic '
      + 'no-replace transfer itself',
  );
});

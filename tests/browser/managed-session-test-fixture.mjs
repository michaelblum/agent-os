import fs from 'node:fs';
import path from 'node:path';

import { writePrivateRecordAtomic } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { createSessionWorkspace } from '../../scripts/lib/browser-companion/session-store.mjs';

export function writeManagedLease(store, id, active, generation) {
  const timestamp = '2026-08-14T00:00:00.000Z';
  const record = {
    schema_version: 'aos.browser.companion-session.v1', session_id: id, generation,
    upstream_session_id: `aos-${generation}`, state: 'active', ownership: 'launched',
    attach_kind: null, headless: true, persistent: false, version_key: active.version_key,
    version: active.version, descriptor_sha256: active.descriptor_sha256,
    closure_sha256: active.closure_sha256,
    entrypoint: 'node_modules/@playwright/cli/playwright-cli.js',
    workspace: `${id}-${generation}`, cleanup_operation: 'close',
    pending_operation: null, operation_nonce: null,
    created_at: timestamp, updated_at: timestamp,
  };
  createSessionWorkspace(store, record);
  writePrivateRecordAtomic(path.join(store.paths.leases, `${id}.json`), record);
  return record;
}

export function removeManagedLease(store, record) {
  fs.rmSync(path.join(store.paths.workspaces, record.workspace), { recursive: true });
  fs.unlinkSync(path.join(store.paths.leases, `${record.session_id}.json`));
}

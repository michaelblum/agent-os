import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defaultWorkspaceMetadata } from '../../scripts/lib/agent-workspace/core.mjs';
import { generateRefRecords } from '../../scripts/lib/agent-workspace/refs.mjs';

export { defaultWorkspaceMetadata };
export const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

export function isolatedWorkspaceRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-workspace-v1-'));
}

export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeWorkspace(state, env, { target, capture }) {
  const workspace = 'default';
  const snapshotID = 'snap1';
  const dir = path.join(state, 'repo', 'agent-workspaces', workspace);
  const snapshotDir = path.join(dir, 'snapshots', snapshotID);
  const paths = {
    workspace: dir,
    snapshot: snapshotDir,
    snapshot_record: path.join(snapshotDir, 'snapshot.json'),
    capture: path.join(snapshotDir, 'capture.json'),
    summary: path.join(snapshotDir, 'summary.json'),
    refs: path.join(snapshotDir, 'refs.json'),
    artifacts: path.join(snapshotDir, 'artifacts'),
  };
  const createdAt = '2026-08-05T12:00:00Z';
  const context = {
    workspace_id: workspace,
    snapshot_id: snapshotID,
    target,
    capture_target: target,
    capture_mode: 'ax',
    artifact_refs: [],
  };
  const refs = generateRefRecords(capture, context);
  writeJSON(path.join(dir, 'workspace.json'), {
    ...defaultWorkspaceMetadata(workspace, env),
    created_at: createdAt,
    updated_at: createdAt,
  });
  writeJSON(paths.snapshot_record, {
    schema_version: 'aos.agent-workspace.v1',
    workspace_id: workspace,
    snapshot_id: snapshotID,
    created_at: createdAt,
    runtime_mode: 'repo',
    capture_mode: 'ax',
    capture_target: target,
    target,
    query: null,
    ref_scope_grammar: 'saved handles use only ref:<snapshot-id>:<ref>',
    artifact_refs: [],
    ref_count: refs.length,
    paths,
    omitted_from_compact_stdout: [],
    known_limits: [],
  });
  writeJSON(paths.refs, {
    schema_version: 'aos.agent-workspace.v1',
    workspace_id: workspace,
    snapshot_id: snapshotID,
    created_at: createdAt,
    refs,
  });
  writeJSON(path.join(snapshotDir, 'committed.json'), {
    schema_version: 'aos.agent-workspace.v1',
    workspace_id: workspace,
    snapshot_id: snapshotID,
    committed_at: createdAt,
    snapshot_record: 'snapshot.json',
  });
  return refs[0];
}

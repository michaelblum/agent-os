import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CAPTURE_MODES,
  SCHEMA_VERSION,
  aosPath,
  exitAgentWorkspaceError,
  nowISO,
  printError,
  printJSON,
  randomToken,
  runtimeMode,
  sessionMetadata,
  stateRoot,
  validateLocalID,
  workspaceID,
  writeJSONAtomic,
  writeTextAtomic,
} from './core.mjs';
import { ensureWorkspace, saveSnapshotToIndex } from './store.mjs';
import { generateRefRecords, omittedPayloads, queryMatches, refSummary } from './refs.mjs';

function snapshotID(explicit) {
  if (explicit) return validateLocalID(explicit, 'snapshot id');
  return `snap-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-')}-${randomToken()}`;
}

function captureValueFlag(flag) {
  return new Set([
    '--out',
    '--crop',
    '--region',
    '--canvas',
    '--channel',
    '--exclude-window',
    '--format',
    '--quality',
    '--radius',
    '--browser-dom-point',
    '--browser-content-rect',
    '--timeout',
    '--delay',
    '--grid',
    '--thickness',
    '--shadow',
    '--workspace',
    '--name',
    '--mode',
    '--query',
    '--draw-rect',
    '--draw-rect-fill',
  ]).has(flag);
}

function targetFromCaptureArgs(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (captureValueFlag(arg)) i += arg === '--draw-rect' || arg === '--draw-rect-fill' ? 2 : 1;
      continue;
    }
    if (arg === 'external' && args[i + 1] && !args[i + 1].startsWith('--') && /^\d+$/.test(args[i + 1])) {
      return `${arg} ${args[i + 1]}`;
    }
    return arg;
  }
  return 'main';
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function setOrAppendFlag(args, flag, value) {
  const out = [];
  let replaced = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) {
      out.push(flag, value);
      i += 1;
      replaced = true;
      continue;
    }
    out.push(args[i]);
  }
  if (!replaced) out.push(flag, value);
  return out;
}

export function parseSavedCaptureArgs(args) {
  const passthrough = [];
  const options = {
    save: false,
    workspace: null,
    name: null,
    mode: 'som',
    query: null,
    requested_out: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--save') {
      options.save = true;
      continue;
    }
    if (arg === '--workspace' || arg === '--name' || arg === '--mode' || arg === '--query') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitAgentWorkspaceError(`${arg} requires a value`, 'MISSING_ARG');
      }
      const value = args[i + 1];
      if (arg === '--workspace') options.workspace = value;
      if (arg === '--name') options.name = value;
      if (arg === '--mode') options.mode = value;
      if (arg === '--query') options.query = value;
      i += 1;
      continue;
    }
    if (arg === '--out') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitAgentWorkspaceError('--out requires a value', 'MISSING_ARG');
      }
      options.requested_out = args[i + 1];
      passthrough.push(arg, args[i + 1]);
      i += 1;
      continue;
    }
    passthrough.push(arg);
  }

  if (!CAPTURE_MODES.has(options.mode)) {
    exitAgentWorkspaceError('--mode must be one of: ax, vision, som', 'INVALID_ARG');
  }
  if (options.workspace) validateLocalID(options.workspace, 'workspace id');
  if (options.name) validateLocalID(options.name, 'snapshot id');
  return { passthrough, options };
}

function captureArgsForMode(args, mode, artifactPath) {
  let out = [...args];
  if ((mode === 'ax' || mode === 'som') && !hasFlag(out, '--xray') && !hasFlag(out, '--browser-dom-point')) {
    out.push('--xray');
  }
  if (!hasFlag(out, '--base64')) {
    out = setOrAppendFlag(out, '--out', artifactPath);
  }
  return out;
}

function parsePrimitiveJSON(result, label) {
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    else printError({ code: 'PRIMITIVE_FAILED', error: `${label} failed with exit ${result.status ?? 1}` });
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    printError({ code: 'PRIMITIVE_JSON_INVALID', error: `${label} did not return JSON` });
    process.exit(1);
  }
}

function rewriteBase64Payload(capture, artifactsDir) {
  const artifactRefs = [];
  if (!Array.isArray(capture.base64)) return artifactRefs;
  capture.base64.forEach((payload, index) => {
    const file = path.join(artifactsDir, `base64-${index + 1}.txt`);
    writeTextAtomic(file, `${payload}\n`);
    artifactRefs.push({
      role: 'base64',
      path: file,
      bytes: Buffer.byteLength(String(payload), 'utf8'),
    });
  });
  delete capture.base64;
  capture.base64_artifacts = artifactRefs.map((item) => item.path);
  return artifactRefs;
}

function fileArtifactRefs(capture, artifactsDir) {
  const refs = [];
  for (const file of capture.files ?? []) {
    let stat = null;
    try { stat = fs.statSync(file); } catch {}
    refs.push({
      role: 'capture_image',
      path: file,
      bytes: stat?.size ?? null,
      stored_under_workspace: path.resolve(file).startsWith(path.resolve(artifactsDir)),
    });
  }
  return refs;
}

function knownLimitsForSnapshot(mode, target) {
  const limits = [
    'workspace snapshots are local control state, not Work Recording evidence storage',
    'state_id remains capture provenance and is not treated as durable identity',
  ];
  if (mode === 'ax') limits.push('non-browser ax mode may still require the current native capture primitive until a tree-only native path lands');
  if (target?.startsWith?.('browser:')) limits.push('browser refs are snapshot-scoped until current-page locator validation is implemented');
  return limits;
}

export async function savedCaptureCommand(rawArgs, parsed = parseSavedCaptureArgs(rawArgs), env = process.env) {
  const workspace = workspaceID(parsed.options.workspace, env);
  const snapID = snapshotID(parsed.options.name);
  const target = targetFromCaptureArgs(parsed.passthrough);
  const current = ensureWorkspace(workspace, env);
  const snapshotDir = path.join(current.dir, 'snapshots', snapID);
  if (fs.existsSync(snapshotDir)) {
    exitAgentWorkspaceError(`Snapshot '${snapID}' already exists in workspace '${workspace}'`, 'SNAPSHOT_EXISTS');
  }
  fs.mkdirSync(path.join(snapshotDir, 'artifacts'), { recursive: true });

  const artifactsDir = path.join(snapshotDir, 'artifacts');
  const captureArtifact = path.join(artifactsDir, 'capture.png');
  const captureArgs = captureArgsForMode(parsed.passthrough, parsed.options.mode, captureArtifact);
  const createdAt = nowISO();

  try {
    const result = spawnSync(aosPath(env), ['__see', 'capture', ...captureArgs], {
      encoding: 'utf8',
      env: {
        ...env,
        AOS_RUNTIME_MODE: runtimeMode(env),
        AOS_STATE_ROOT: stateRoot(env),
      },
      maxBuffer: 100 * 1024 * 1024,
    });
    const capture = parsePrimitiveJSON(result, 'aos __see capture');
    const artifactRefs = [
      ...fileArtifactRefs(capture, artifactsDir),
      ...rewriteBase64Payload(capture, artifactsDir),
    ];
    const refs = generateRefRecords(capture, {
      workspace_id: workspace,
      snapshot_id: snapID,
      target,
      artifact_refs: artifactRefs,
    });
    const compactRefs = refs.filter((record) => queryMatches(record, parsed.options.query)).map(refSummary);
    const paths = {
      workspace: current.dir,
      snapshot: snapshotDir,
      snapshot_record: path.join(snapshotDir, 'snapshot.json'),
      capture: path.join(snapshotDir, 'capture.json'),
      summary: path.join(snapshotDir, 'summary.json'),
      refs: path.join(snapshotDir, 'refs.json'),
      artifacts: artifactsDir,
    };
    const snapshot = {
      schema_version: SCHEMA_VERSION,
      workspace_id: workspace,
      snapshot_id: snapID,
      created_at: createdAt,
      runtime_mode: runtimeMode(env),
      capture_mode: parsed.options.mode,
      ref_scope_grammar: 'scoped refs are ref:<snapshot-id>:<ref>; bare ref:<ref> resolves only when unambiguous in the workspace',
      target,
      query: parsed.options.query,
      requested_out: parsed.options.requested_out,
      state_id: capture.state_id ?? null,
      artifact_refs: artifactRefs,
      ref_count: refs.length,
      paths,
      omitted_from_compact_stdout: omittedPayloads(capture),
      known_limits: knownLimitsForSnapshot(parsed.options.mode, target),
      session: sessionMetadata(env),
    };
    const summary = {
      status: 'success',
      schema_version: SCHEMA_VERSION,
      workspace_id: workspace,
      snapshot_id: snapID,
      runtime_mode: runtimeMode(env),
      capture_mode: parsed.options.mode,
      target,
      query: parsed.options.query,
      state_id: capture.state_id ?? null,
      paths,
      counts: {
        files: capture.files?.length ?? 0,
        elements: capture.elements?.length ?? 0,
        semantic_targets: capture.semantic_targets?.length ?? 0,
        refs: refs.length,
      },
      artifact_refs: artifactRefs,
      refs: compactRefs,
      omitted: {
        heavy_payloads: omittedPayloads(capture),
        capture_json: paths.capture,
      },
      recommended_next_commands: [
        `${process.env.AOS_INVOCATION_DISPLAY_NAME || 'aos'} see refs --workspace ${workspace} --snapshot ${snapID} --json`,
        refs.length ? `${process.env.AOS_INVOCATION_DISPLAY_NAME || 'aos'} do click ref:${snapID}:${refs[0].ref} --workspace ${workspace} --dry-run` : null,
      ].filter(Boolean),
      known_limits: snapshot.known_limits,
    };

    writeJSONAtomic(paths.capture, capture);
    writeJSONAtomic(paths.refs, {
      schema_version: SCHEMA_VERSION,
      workspace_id: workspace,
      snapshot_id: snapID,
      created_at: createdAt,
      refs,
    });
    writeJSONAtomic(paths.snapshot_record, snapshot);
    writeJSONAtomic(paths.summary, summary);
    saveSnapshotToIndex(workspace, snapshot, env);
    printJSON(summary);
  } catch (error) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    if (error?.code || error?.message) {
      exitAgentWorkspaceError(error.message || String(error), error.code || 'AGENT_WORKSPACE_SAVE_FAILED');
    }
    throw error;
  }
}

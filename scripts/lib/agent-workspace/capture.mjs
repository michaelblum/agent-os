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
import { ensureWorkspace, saveSnapshotToIndex, withWorkspaceLock } from './store.mjs';
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

const CAPTURE_FORMATS = new Set(['png', 'jpg', 'heic']);
const CAPTURE_QUALITIES = new Set(['high', 'med', 'low']);
const CAPTURE_BOOL_FLAGS = new Set([
  '--window',
  '--base64',
  '--perception',
  '--show-cursor',
  '--interactive',
  '--wait-for-click',
  '--xray',
  '--label',
  '--clipboard',
  '--save',
]);

function isNumeric(value) {
  return /^-?(?:\d+|\d*\.\d+)$/.test(value);
}

function isPositiveInt(value) {
  return /^[1-9]\d*$/.test(value);
}

function validationError(errors, message, code = 'INVALID_ARG') {
  errors.push({ code, error: message });
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

export function parseCaptureArgs(args) {
  const passthrough = [];
  const seen = new Set();
  const errors = [];
  let target = null;
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
    if (arg === '--highlight-cursor') {
      seen.add(arg);
      passthrough.push(arg);
      if (i + 1 < args.length && args[i + 1].startsWith('#')) {
        passthrough.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (arg === '--draw-rect' || arg === '--draw-rect-fill') {
      seen.add(arg);
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) validationError(errors, `${arg} requires x,y,w,h and #color`, 'MISSING_ARG');
      if (i + 2 >= args.length || args[i + 2].startsWith('--')) validationError(errors, `${arg} requires a color after coordinates`, 'MISSING_ARG');
      passthrough.push(arg);
      if (i + 1 < args.length) passthrough.push(args[i + 1]);
      if (i + 2 < args.length) passthrough.push(args[i + 2]);
      i += 2;
      continue;
    }
    if (arg === '--save') {
      seen.add(arg);
      options.save = true;
      continue;
    }
    if (arg === '--workspace' || arg === '--name' || arg === '--mode' || arg === '--query') {
      seen.add(arg);
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        validationError(errors, `${arg} requires a value`, 'MISSING_ARG');
        continue;
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
      seen.add(arg);
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        validationError(errors, '--out requires a value', 'MISSING_ARG');
        continue;
      }
      options.requested_out = args[i + 1];
      passthrough.push(arg, args[i + 1]);
      i += 1;
      continue;
    }
    if (CAPTURE_BOOL_FLAGS.has(arg)) {
      seen.add(arg);
      passthrough.push(arg);
      continue;
    }
    if (captureValueFlag(arg)) {
      seen.add(arg);
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        validationError(errors, `${arg} requires a value`, 'MISSING_ARG');
        continue;
      }
      const value = args[i + 1];
      if (arg === '--exclude-window' && !isPositiveInt(value)) validationError(errors, '--exclude-window must be a positive integer CGWindowID');
      if (arg === '--radius' && !isPositiveInt(value)) validationError(errors, '--radius must be a positive integer');
      if (arg === '--timeout' && (!isNumeric(value) || Number(value) <= 0)) validationError(errors, '--timeout must be a positive number');
      if (arg === '--delay' && (!isNumeric(value) || Number(value) < 0)) validationError(errors, '--delay must be a non-negative number');
      if (arg === '--grid' && !/^[1-9]\d*x[1-9]\d*$/i.test(value)) validationError(errors, '--grid format: COLSxROWS (e.g., 4x3)');
      if (arg === '--thickness' && (!isNumeric(value) || Number(value) <= 0)) validationError(errors, '--thickness must be a positive number');
      if (arg === '--format' && !CAPTURE_FORMATS.has(value)) validationError(errors, `--format must be one of: ${[...CAPTURE_FORMATS].join(', ')}`);
      if (arg === '--quality' && !CAPTURE_QUALITIES.has(value)) validationError(errors, `--quality must be one of: ${[...CAPTURE_QUALITIES].join(', ')}`);
      passthrough.push(arg, value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      validationError(errors, `Unknown see capture flag: ${arg}`, 'UNKNOWN_FLAG');
      continue;
    }
    if (target) {
      validationError(errors, `Unknown see capture argument: ${arg}`, 'UNKNOWN_ARG');
      continue;
    }
    target = arg;
    passthrough.push(arg);
    if (arg === 'external' && i + 1 < args.length && !args[i + 1].startsWith('--') && /^\d+$/.test(args[i + 1])) {
      passthrough.push(args[i + 1]);
      i += 1;
    }
  }

  if (!CAPTURE_MODES.has(options.mode)) validationError(errors, '--mode must be one of: ax, vision, som');
  if (seen.has('--crop') && seen.has('--region')) validationError(errors, '--region and --crop cannot be used together');
  if (seen.has('--window') && seen.has('--region')) validationError(errors, '--region and --window cannot be used together');
  const surfaceSelectors = ['--region', '--canvas', '--channel'].filter((flag) => seen.has(flag));
  if (surfaceSelectors.length > 1) validationError(errors, 'Use only one of --region, --canvas, or --channel');
  if (!options.save) {
    for (const flag of ['--workspace', '--name', '--mode', '--query']) {
      if (seen.has(flag)) validationError(errors, `${flag} requires --save`);
    }
  }
  if (options.workspace) validateLocalID(options.workspace, 'workspace id');
  if (options.name) validateLocalID(options.name, 'snapshot id');
  return {
    target: target ?? targetFromCaptureArgs(passthrough),
    passthrough,
    options,
    requested_out: options.requested_out,
    seen,
    errors,
  };
}

export function parseSavedCaptureArgs(args) {
  const parsed = parseCaptureArgs(args);
  if (parsed.errors.length) {
    const first = parsed.errors[0];
    exitAgentWorkspaceError(first.error, first.code);
  }
  return parsed;
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
  const target = parsed.target;
  const current = ensureWorkspace(workspace, env);
  const snapshotDir = path.join(current.dir, 'snapshots', snapID);
  return withWorkspaceLock(workspace, () => {
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
      saveSnapshotToIndex(workspace, snapshot, env, { lockHeld: true });
      printJSON(summary);
    } catch (error) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
      if (error?.code || error?.message) {
        exitAgentWorkspaceError(error.message || String(error), error.code || 'AGENT_WORKSPACE_SAVE_FAILED');
      }
      throw error;
    }
  }, env);
}

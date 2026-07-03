import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AgentWorkspaceError,
  CAPTURE_MODES,
  SCHEMA_VERSION,
  aosPath,
  exitAgentWorkspaceError,
  isAgentWorkspaceError,
  nowISO,
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
import {
  cleanupStagedSnapshot,
  commitStagedSnapshot,
  prepareSnapshotWrite,
  withWorkspaceLock,
} from './store.mjs';
import { generateRefRecords, omittedPayloads, queryMatches, refSummary } from './refs.mjs';
import {
  savedCaptureModeFlags,
  savedCaptureModeKnownLimits,
  savedCaptureModePolicy,
} from './contracts.mjs';
import {
  browserIdentityComparable,
  queryBrowserPageIdentity,
} from './browser-identity.mjs';

function snapshotID(explicit) {
  if (explicit) return validateLocalID(explicit, 'snapshot id');
  return `snap-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-')}-${randomToken()}`;
}

const WORKSPACE_CAPTURE_VALUE_FLAGS = new Set(['--workspace', '--name', '--mode', '--query']);
const CAPTURE_SOURCE_VALUE_FLAGS = new Set(['--region', '--canvas', '--channel']);
const PRIMITIVE_CAPTURE_VALUE_ARITY = new Map([
  ['--out', 1],
  ['--crop', 1],
  ['--region', 1],
  ['--canvas', 1],
  ['--channel', 1],
  ['--exclude-window', 1],
  ['--format', 1],
  ['--quality', 1],
  ['--radius', 1],
  ['--browser-dom-point', 1],
  ['--browser-content-rect', 1],
  ['--timeout', 1],
  ['--delay', 1],
  ['--grid', 1],
  ['--thickness', 1],
  ['--shadow', 1],
  ['--draw-rect', 2],
  ['--draw-rect-fill', 2],
]);
const PRIMITIVE_CAPTURE_BOOL_FLAGS = new Set([
  '--window',
  '--base64',
  '--perception',
  '--show-cursor',
  '--interactive',
  '--wait-for-click',
  '--xray',
  '--label',
  '--clipboard',
]);

function validationError(errors, message, code = 'INVALID_ARG') {
  errors.push({ code, error: message });
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

function renderCaptureSource(source) {
  if (!source) return null;
  const normalizedArgv = source.argv.length > 0 ? source.argv : ['main'];
  return {
    kind: source.kind,
    argv: normalizedArgv,
    display: normalizedArgv.map(commandToken).join(' '),
  };
}

function parseCaptureSource(targetArgv, sourceFlagEntries, errors) {
  let invalid = false;
  if (targetArgv && sourceFlagEntries.length > 0) {
    validationError(errors, 'capture accepts exactly one source: positional target or --region/--canvas/--channel', 'INVALID_ARG');
    invalid = true;
  }
  if (sourceFlagEntries.length > 1) {
    validationError(errors, 'capture accepts exactly one source: --region, --canvas, and --channel cannot be combined', 'INVALID_ARG');
    invalid = true;
  }
  if (invalid) return null;
  if (sourceFlagEntries.length === 1) {
    return { kind: 'source_flags', argv: sourceFlagEntries[0].argv };
  }
  if (targetArgv) return { kind: 'target', argv: targetArgv };
  return { kind: 'default_target', argv: ['main'] };
}

export function parseCaptureArgs(args) {
  const passthrough = [];
  const sourceFlagEntries = [];
  let invalidSourceFlag = false;
  const seen = new Set();
  const errors = [];
  let target = null;
  let targetArgv = null;
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
      seen.add(arg);
      options.save = true;
      continue;
    }
    if (WORKSPACE_CAPTURE_VALUE_FLAGS.has(arg)) {
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
    if (arg === '--highlight-cursor') {
      seen.add(arg);
      passthrough.push(arg);
      if (i + 1 < args.length && args[i + 1].startsWith('#')) {
        passthrough.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (PRIMITIVE_CAPTURE_BOOL_FLAGS.has(arg)) {
      seen.add(arg);
      passthrough.push(arg);
      continue;
    }
    if (PRIMITIVE_CAPTURE_VALUE_ARITY.has(arg)) {
      seen.add(arg);
      passthrough.push(arg);
      const arity = PRIMITIVE_CAPTURE_VALUE_ARITY.get(arg);
      const values = [];
      for (let consumed = 0; consumed < arity && i + 1 < args.length && !args[i + 1].startsWith('--'); consumed += 1) {
        const value = args[i + 1];
        if (arg === '--out' && consumed === 0) options.requested_out = value;
        passthrough.push(value);
        values.push(value);
        i += 1;
      }
      if (values.length < arity) {
        validationError(errors, `${arg} requires a value`, 'MISSING_ARG');
        if (CAPTURE_SOURCE_VALUE_FLAGS.has(arg)) invalidSourceFlag = true;
      }
      if (CAPTURE_SOURCE_VALUE_FLAGS.has(arg) && values.length === arity) {
        sourceFlagEntries.push({ flag: arg, argv: [arg, ...values] });
      }
      continue;
    }
    if (arg.startsWith('--')) {
      passthrough.push(arg);
      continue;
    }
    passthrough.push(arg);
    if (target) continue;
    target = arg;
    targetArgv = [arg];
    if (arg === 'external' && i + 1 < args.length && !args[i + 1].startsWith('--') && /^\d+$/.test(args[i + 1])) {
      target = `${arg} ${args[i + 1]}`;
      passthrough.push(args[i + 1]);
      targetArgv.push(args[i + 1]);
      i += 1;
    }
  }

  if (!CAPTURE_MODES.has(options.mode)) validationError(errors, '--mode must be one of: ax, vision, som');
  if (options.save && seen.has('--out')) {
    validationError(errors, '--out cannot be used with --save; saved captures write artifacts under the workspace snapshot');
  }
  const captureSource = invalidSourceFlag ? null : parseCaptureSource(targetArgv, sourceFlagEntries, errors);
  if (!options.save) {
    for (const flag of ['--workspace', '--name', '--mode', '--query']) {
      if (seen.has(flag)) validationError(errors, `${flag} requires --save`);
    }
  }
  if (options.workspace) validateLocalID(options.workspace, 'workspace id');
  if (options.name) validateLocalID(options.name, 'snapshot id');
  return {
    target: target ?? 'main',
    capture_source: renderCaptureSource(captureSource),
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

function browserSessionFromTarget(target) {
  if (!target?.startsWith?.('browser:')) return null;
  const remainder = target.slice('browser:'.length);
  if (!remainder) return process.env.PLAYWRIGHT_CLI_SESSION || null;
  return remainder.split('/')[0] || null;
}

function captureArgsForMode(args, mode, artifactPath, target) {
  let out = [...args];
  for (const flag of savedCaptureModeFlags(mode, target)) {
    if (!hasFlag(out, flag) && !hasFlag(out, '--browser-dom-point')) out.push(flag);
  }
  const isBrowserTarget = target?.startsWith?.('browser:');
  const needsWorkspaceArtifact = savedCaptureModePolicy(mode)?.requires_image || !isBrowserTarget;
  if (needsWorkspaceArtifact && !hasFlag(out, '--base64')) {
    out = setOrAppendFlag(out, '--out', artifactPath);
  }
  return out;
}

function parsePrimitiveJSON(result, label) {
  if (result.status !== 0) {
    const status = result.status ?? 1;
    throw new AgentWorkspaceError(
      `${label} failed with exit ${status}`,
      'PRIMITIVE_FAILED',
      {},
      { exitStatus: status, stderr: result.stderr || null },
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AgentWorkspaceError(`${label} did not return JSON`, 'PRIMITIVE_JSON_INVALID');
  }
}

function rewriteArtifactPath(value, stagedArtifactsDir, finalArtifactsDir) {
  const stagedRoot = path.resolve(stagedArtifactsDir);
  const resolved = path.resolve(value);
  if (resolved === stagedRoot || resolved.startsWith(`${stagedRoot}${path.sep}`)) {
    return path.join(finalArtifactsDir, path.relative(stagedRoot, resolved));
  }
  return value;
}

function rewriteCaptureFilePaths(capture, stagedArtifactsDir, finalArtifactsDir) {
  if (Array.isArray(capture.files)) {
    capture.files = capture.files.map((file) => rewriteArtifactPath(file, stagedArtifactsDir, finalArtifactsDir));
  }
}

function rewriteBase64Payload(capture, artifactsDir, finalArtifactsDir = artifactsDir) {
  const artifactRefs = [];
  if (!Array.isArray(capture.base64)) return artifactRefs;
  capture.base64.forEach((payload, index) => {
    const file = path.join(artifactsDir, `base64-${index + 1}.txt`);
    const finalFile = path.join(finalArtifactsDir, `base64-${index + 1}.txt`);
    writeTextAtomic(file, `${payload}\n`);
    artifactRefs.push({
      role: 'base64',
      path: finalFile,
      bytes: Buffer.byteLength(String(payload), 'utf8'),
    });
  });
  delete capture.base64;
  capture.base64_artifacts = artifactRefs.map((item) => item.path);
  return artifactRefs;
}

function fileArtifactRefs(capture, artifactsDir, finalArtifactsDir = artifactsDir) {
  const refs = [];
  for (const file of capture.files ?? []) {
    let stat = null;
    try { stat = fs.statSync(file); } catch {}
    const finalPath = rewriteArtifactPath(file, artifactsDir, finalArtifactsDir);
    refs.push({
      role: 'capture_image',
      path: finalPath,
      bytes: stat?.size ?? null,
      stored_under_workspace: path.resolve(finalPath).startsWith(path.resolve(finalArtifactsDir)),
    });
  }
  return refs;
}

function knownLimitsForSnapshot(mode, target) {
  const isBrowserTarget = target?.startsWith?.('browser:');
  const limits = [
    'workspace snapshots are local control state, not Work Recording evidence storage',
    'state_id remains capture provenance and is not treated as durable identity',
    ...savedCaptureModeKnownLimits(mode, target),
  ];
  if ((mode === 'ax' || mode === 'som') && !isBrowserTarget) {
    limits.push('non-browser tree modes may include native AX refs; stable saved-ref actions require durable native identity facts and still make no saved-action no-foreground guarantee');
  }
  if (isBrowserTarget && mode !== 'vision') {
    limits.push('browser refs are snapshot-scoped and require fresh page/frame/navigation plus element validation before real saved-ref dispatch');
  }
  return limits;
}

function commandToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function sampleActionCommand(workspace, snapshotIDValue, refs) {
  const display = process.env.AOS_INVOCATION_DISPLAY_NAME || 'aos';
  const refTarget = (record) => `ref:${snapshotIDValue}:${record.ref}`;
  const byPreferredAction = (action) => refs.find((record) => record.action_target && (record.supported_actions ?? []).includes(action));
  for (const action of ['click', 'set-value', 'fill', 'hover', 'scroll', 'press', 'focus']) {
    const record = byPreferredAction(action);
    if (!record) continue;
    if (action === 'click' || action === 'hover' || action === 'press' || action === 'focus') {
      return `${display} do ${action} ${refTarget(record)} --workspace ${workspace} --dry-run`;
    }
    if (action === 'set-value') {
      return `${display} do set-value ${refTarget(record)} --workspace ${workspace} --value 42 --dry-run`;
    }
    if (action === 'fill') {
      return `${display} do fill ${refTarget(record)} ${commandToken('sample text')} --workspace ${workspace} --dry-run`;
    }
    if (action === 'scroll') {
      return `${display} do scroll ${refTarget(record)} 0,-200 --workspace ${workspace} --dry-run`;
    }
  }
  return null;
}

export async function savedCaptureCommand(rawArgs, parsed = parseSavedCaptureArgs(rawArgs), env = process.env) {
  const workspace = workspaceID(parsed.options.workspace, env);
  const snapID = snapshotID(parsed.options.name);
  const target = parsed.target;
  const captureSource = parsed.capture_source;
  return withWorkspaceLock(workspace, () => {
    let prepared = null;

    try {
      prepared = prepareSnapshotWrite(workspace, snapID, env);
      const stagedArtifactsDir = prepared.stagedPaths.artifacts;
      const finalArtifactsDir = prepared.finalPaths.artifacts;
      const captureArtifact = path.join(stagedArtifactsDir, 'capture.png');
      const captureArgs = captureArgsForMode(parsed.passthrough, parsed.options.mode, captureArtifact, target);
      const createdAt = nowISO();
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
        ...fileArtifactRefs(capture, stagedArtifactsDir, finalArtifactsDir),
        ...rewriteBase64Payload(capture, stagedArtifactsDir, finalArtifactsDir),
      ];
      rewriteCaptureFilePaths(capture, stagedArtifactsDir, finalArtifactsDir);
      const browserSession = browserSessionFromTarget(target);
      const browserIdentity = browserSession && (capture.elements?.length ?? 0) > 0
        ? browserIdentityComparable(queryBrowserPageIdentity(browserSession, env))
        : null;
      const refs = generateRefRecords(capture, {
        workspace_id: workspace,
        snapshot_id: snapID,
        target,
        capture_target: target,
        capture_source: captureSource,
        capture_mode: parsed.options.mode,
        query: parsed.options.query,
        artifact_refs: artifactRefs,
        browser_identity: browserIdentity,
      });
      const matchingRefs = refs.filter((record) => queryMatches(record, parsed.options.query));
      const compactRefs = matchingRefs.map(refSummary);
      const paths = prepared.finalPaths;
      const snapshot = {
        schema_version: SCHEMA_VERSION,
        workspace_id: workspace,
        snapshot_id: snapID,
        created_at: createdAt,
        runtime_mode: runtimeMode(env),
        capture_mode: parsed.options.mode,
        capture_target: target,
        capture_source: captureSource,
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
        capture_target: target,
        capture_source: captureSource,
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
          sampleActionCommand(workspace, snapID, matchingRefs),
        ].filter(Boolean),
        known_limits: snapshot.known_limits,
      };

      writeJSONAtomic(prepared.stagedPaths.capture, capture);
      writeJSONAtomic(prepared.stagedPaths.refs, {
        schema_version: SCHEMA_VERSION,
        workspace_id: workspace,
        snapshot_id: snapID,
        created_at: createdAt,
        refs,
      });
      writeJSONAtomic(prepared.stagedPaths.snapshot_record, snapshot);
      writeJSONAtomic(prepared.stagedPaths.summary, summary);
      commitStagedSnapshot(workspace, snapshot, prepared, env);
      printJSON(summary);
    } catch (error) {
      cleanupStagedSnapshot(prepared);
      if (isAgentWorkspaceError(error)) throw error;
      if (error?.code || error?.message) {
        exitAgentWorkspaceError(error.message || String(error), error.code || 'AGENT_WORKSPACE_SAVE_FAILED');
      }
      throw error;
    }
  }, env, { create: true });
}

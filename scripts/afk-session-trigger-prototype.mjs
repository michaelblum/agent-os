#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'gemini']);
const NOT_OBSERVED = 'not_observed';
const NOT_ATTEMPTED = 'not_attempted';

function usage() {
  return `Experimental AFK session-trigger dry-run prototype.

Usage:
  node scripts/afk-session-trigger-prototype.mjs --packet <packet.json> --dry-run --json [--provider <name>] [--dock <dock>] [--repo <path>] [--timestamp <iso>] [--out <path>] [--result-route <ref>] [--idempotence-salt <value>]

This local prototype validates one transfer packet and emits a scheduler/dispatch dry-run receipt. It does not launch providers, terminals, gateways, or result routes.`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    options[key] = value;
  }

  return options;
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: `git ${args.join(' ')}`,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function resolveRepoRoot(startPath) {
  const cwd = resolve(startPath ?? process.cwd());
  if (!existsSync(cwd)) {
    throw Object.assign(new Error(`Repo path does not exist: ${cwd}`), { mismatchClass: 'repo_missing' });
  }
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw Object.assign(
      new Error(`Unable to resolve repo root from ${cwd}: ${result.stderr || 'git rev-parse failed'}`),
      { mismatchClass: 'repo_missing' },
    );
  }
  return resolve(result.stdout);
}

function stableHash(value, length = 16) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

async function readJsonFile(path, label) {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON in ${label} ${path}: ${error.message}`), {
      mismatchClass: 'invalid_packet_json',
    });
  }
}

function repoPath(repoRoot, candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  return isAbsolute(candidate) ? resolve(candidate) : resolve(repoRoot, candidate);
}

function isWithinRepo(repoRoot, candidate) {
  const rel = relative(repoRoot, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function relIfRepo(repoRoot, candidate) {
  return candidate && isWithinRepo(repoRoot, candidate) ? relative(repoRoot, candidate) || '.' : candidate;
}

function normalizePacketId(packet) {
  return packet.packet_id ?? packet.packetId ?? packet.packet_ref ?? packet.packetRef ?? packet.id ?? packet.ref;
}

function normalizeSourceArtifact(packet) {
  return packet.source_artifact ?? packet.sourceArtifact ?? packet.source_event?.artifact ?? packet.sourceEvent?.artifact;
}

function normalizeRequestedDock(packet) {
  return packet.requested_recipient ?? packet.requestedRecipient ?? packet.dock;
}

function normalizeProviderHint(packet) {
  return packet.provider_hint ?? packet.providerHint ?? packet.provider;
}

function normalizeRef(packet) {
  return packet.required_start_ref ?? packet.requiredStartRef ?? packet.start_ref ?? packet.startRef;
}

function normalizeWorktree(packet, repoRoot) {
  return repoPath(repoRoot, packet.worktree ?? packet.cwd ?? repoRoot);
}

function normalizeResultRoutes(packet, override) {
  const route = packet.result_route ?? packet.resultRoute ?? packet.result_routes ?? packet.resultRoutes;
  if (Array.isArray(route)) return route;
  if (route) return [route];
  return override ? [override] : [];
}

function normalizeBranchPolicy(packet) {
  return packet.branch_policy
    ?? packet.branchPolicy
    ?? packet.external_publication_policy
    ?? packet.externalPublicationPolicy
    ?? NOT_OBSERVED;
}

function resolveRef(repoRoot, ref) {
  if (!ref) {
    return { status: 'missing_with_reason', ref: null, sha: null, reason: 'packet did not include required_start_ref' };
  }
  const result = runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return {
    status: result.exitCode === 0 ? 'resolved' : 'missing_with_reason',
    ref,
    sha: result.exitCode === 0 ? result.stdout : null,
    reason: result.exitCode === 0 ? null : result.stderr || 'git rev-parse failed',
    command: result.command,
  };
}

function currentWorktreeFacts(repoRoot) {
  const branch = runGit(repoRoot, ['branch', '--show-current']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const status = runGit(repoRoot, ['status', '--short']);
  return {
    branch: branch.exitCode === 0 && branch.stdout ? branch.stdout : NOT_OBSERVED,
    head: head.exitCode === 0 && head.stdout ? head.stdout : NOT_OBSERVED,
    dirty_untracked_baseline: status.exitCode === 0 && status.stdout ? status.stdout.split('\n') : [],
  };
}

async function resolveDockProfile(repoRoot, dockName) {
  const dockRoot = resolve(repoRoot, '.docks', dockName);
  const dockJson = resolve(dockRoot, 'dock.json');
  if (!existsSync(dockRoot)) {
    return {
      status: 'unknown_dock',
      mismatch_class: 'unknown_dock',
      dock: dockName,
      profile_path: relative(repoRoot, dockJson),
      launch_root: relative(repoRoot, dockRoot),
    };
  }
  if (!existsSync(dockJson)) {
    return {
      status: 'dock_profile_missing',
      mismatch_class: 'dock_profile_missing',
      dock: dockName,
      profile_path: relative(repoRoot, dockJson),
      launch_root: relative(repoRoot, dockRoot),
    };
  }
  const profile = await readJsonFile(dockJson, 'dock profile');
  return {
    status: 'resolved',
    dock: profile.name ?? dockName,
    role: profile.role ?? dockName,
    profile_path: relative(repoRoot, dockJson),
    launch_root: relative(repoRoot, dockRoot),
  };
}

function mismatch(mismatchClass, message, details = {}) {
  return { class: mismatchClass, message, ...details };
}

function resolveProvider(explicitProvider, packetProviderHint) {
  const selected = explicitProvider ?? packetProviderHint ?? null;
  if (!selected) {
    return {
      selected_provider: NOT_OBSERVED,
      selection_source: 'missing',
      mismatch: mismatch('provider_missing', 'No --provider or packet provider hint was supplied.'),
    };
  }
  const normalized = String(selected).toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    return {
      selected_provider: normalized,
      selection_source: explicitProvider ? 'explicit_option' : 'packet_provider_hint',
      mismatch: mismatch('provider_unsupported', `Unsupported provider: ${normalized}`, { selected_provider: normalized }),
    };
  }
  return {
    selected_provider: normalized,
    selection_source: explicitProvider ? 'explicit_option' : 'packet_provider_hint',
    mismatch: null,
  };
}

async function buildReceipt(options) {
  if (!options.packet) {
    throw Object.assign(new Error('Missing required --packet'), { mismatchClass: 'missing_packet' });
  }
  if (!options.dryRun) {
    throw Object.assign(new Error('Missing required --dry-run'), { mismatchClass: 'launch_policy_violation' });
  }

  const repoRoot = resolveRepoRoot(options.repo ?? process.cwd());
  const packetPath = repoPath(repoRoot, options.packet);
  if (!existsSync(packetPath)) {
    throw Object.assign(new Error(`Packet path does not exist: ${packetPath}`), { mismatchClass: 'missing_packet' });
  }

  const packet = await readJsonFile(packetPath, 'packet');
  const createdAt = options.timestamp ?? new Date().toISOString();
  const packetId = normalizePacketId(packet) ?? NOT_OBSERVED;
  const sourceArtifact = normalizeSourceArtifact(packet) ?? NOT_OBSERVED;
  const sourcePath = sourceArtifact === NOT_OBSERVED ? null : repoPath(repoRoot, sourceArtifact);
  const requiredStartRef = normalizeRef(packet);
  const refResolution = resolveRef(repoRoot, requiredStartRef);
  const selectedDock = options.dock ?? normalizeRequestedDock(packet) ?? NOT_OBSERVED;
  const dockProfile = selectedDock === NOT_OBSERVED
    ? { status: 'unknown_dock', mismatch_class: 'unknown_dock', profile_path: NOT_OBSERVED, launch_root: NOT_OBSERVED }
    : await resolveDockProfile(repoRoot, selectedDock);
  const provider = resolveProvider(options.provider, normalizeProviderHint(packet));
  const worktree = normalizeWorktree(packet, repoRoot);
  const resultRoutes = normalizeResultRoutes(packet, options.resultRoute);
  const worktreeFacts = currentWorktreeFacts(repoRoot);
  const mismatches = [];

  if (sourceArtifact === NOT_OBSERVED || !sourcePath || !existsSync(sourcePath)) {
    mismatches.push(mismatch('missing_source_artifact', 'Packet source artifact was missing or not present in the current worktree.', {
      source_artifact: sourceArtifact,
    }));
  }
  if (refResolution.status !== 'resolved') {
    mismatches.push(mismatch('required_start_ref_unresolved', 'Required start ref did not resolve.', {
      required_start_ref: requiredStartRef ?? NOT_OBSERVED,
      reason: refResolution.reason,
    }));
  }
  if (!worktree || !existsSync(worktree) || resolve(worktree) !== repoRoot) {
    mismatches.push(mismatch('worktree_mismatch', 'Packet worktree/cwd does not match the selected repo root.', {
      worktree: worktree ?? NOT_OBSERVED,
      repo_root: repoRoot,
    }));
  }
  if (dockProfile.status !== 'resolved') {
    mismatches.push(mismatch(dockProfile.mismatch_class ?? 'dock_profile_missing', 'Dock launch root/profile could not be resolved.', {
      selected_dock: selectedDock,
      dock_profile_ref: dockProfile.profile_path,
    }));
  }
  if (provider.mismatch) {
    mismatches.push(provider.mismatch);
  }
  if (resultRoutes.length === 0) {
    mismatches.push(mismatch('result_route_missing', 'Packet did not include a result route and --result-route was not supplied.'));
  }

  const idempotenceMaterial = {
    packetId,
    packetRef: relIfRepo(repoRoot, packetPath),
    sourceArtifact,
    requiredStartRef,
    requiredStartSha: refResolution.sha,
    selectedDock,
    selectedProvider: provider.selected_provider,
    launchRoot: dockProfile.launch_root,
    resultRoutes,
    action: 'dry-run',
    salt: options.idempotenceSalt ?? null,
  };
  const idempotenceKey = stableHash(idempotenceMaterial, 32);
  const schedulerRunId = `scheduler-${stableHash({ idempotenceKey, kind: 'scheduler' })}`;
  const dispatchAttemptId = `dispatch-${stableHash({ schedulerRunId, idempotenceKey, kind: 'dispatch' })}`;
  const validationStatus = mismatches.length === 0 ? 'valid' : 'invalid';
  const status = mismatches.length === 0 ? 'dry_run_ready' : 'rejected';

  return {
    record_type: 'aos.afk_session_trigger_dry_run',
    schema_status: 'not_a_schema',
    status,
    created_at: createdAt,
    packet: {
      packet_ref: relIfRepo(repoRoot, packetPath),
      packet_id: packetId,
      source_artifact: sourceArtifact,
      validation_status: validationStatus,
    },
    current_state: {
      repo_root: repoRoot,
      worktree: worktree ?? NOT_OBSERVED,
      branch: worktreeFacts.branch,
      head: worktreeFacts.head,
      required_start_ref: requiredStartRef ?? NOT_OBSERVED,
      required_start_sha: refResolution.sha ?? NOT_OBSERVED,
      source_artifact_status: sourcePath && existsSync(sourcePath) ? 'present' : 'missing',
      branch_or_publication_policy: normalizeBranchPolicy(packet),
    },
    scheduler: {
      scheduler_run_id: schedulerRunId,
      idempotence_key: idempotenceKey,
      lifecycle_state: mismatches.length === 0 ? 'accepted' : 'rejected',
      selected_action: 'dry-run',
      lease: 'not_enforced',
    },
    dispatch: {
      dispatch_attempt_id: dispatchAttemptId,
      selected_provider: provider.selected_provider,
      selected_dock: selectedDock,
      dock_profile_ref: dockProfile.profile_path ?? NOT_OBSERVED,
      launch_root: dockProfile.launch_root ?? NOT_OBSERVED,
      action: 'dry-run',
      provider_launch_allowed: false,
    },
    terminal_substrate: {
      status: NOT_ATTEMPTED,
      reason: 'dry-run-only',
    },
    result_route: {
      status: NOT_ATTEMPTED,
      refs: resultRoutes,
    },
    mismatches,
  };
}

function toMarkdown(receipt) {
  return `# Experimental AFK Session Trigger Dry-Run Receipt

status: ${receipt.status}
created_at: ${receipt.created_at}

This receipt is experimental local dry-run output and is not a schema.

\`\`\`json
${JSON.stringify(receipt, null, 2)}
\`\`\`
`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const receipt = await buildReceipt(options);
    const output = options.json ? `${JSON.stringify(receipt, null, 2)}\n` : toMarkdown(receipt);
    if (options.out) {
      try {
        await writeFile(resolve(options.out), output, 'utf8');
      } catch (error) {
        receipt.status = 'failed';
        receipt.mismatches.push(mismatch('receipt_write_failed', `Unable to write receipt: ${error.message}`, {
          out: options.out,
        }));
        process.stdout.write(options.json ? `${JSON.stringify(receipt, null, 2)}\n` : toMarkdown(receipt));
        process.exitCode = 1;
        return;
      }
    }
    process.stdout.write(output);
    process.exitCode = receipt.status === 'dry_run_ready' ? 0 : 1;
  } catch (error) {
    const payload = {
      record_type: 'aos.afk_session_trigger_dry_run',
      schema_status: 'not_a_schema',
      status: 'blocked',
      error: error.message,
      mismatches: [mismatch(error.mismatchClass ?? 'failed', error.message)],
      script: basename(SCRIPT_PATH),
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${SCRIPT_PATH}`) {
  await main();
}

export {
  buildReceipt,
  parseArgs,
};

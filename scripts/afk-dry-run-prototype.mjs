#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_TIMESTAMP = null;
const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'gemini']);

function usage() {
  return `Experimental AFK dry-run prototype.

Usage:
  node scripts/afk-dry-run-prototype.mjs --packet <packet.json> --provider <name> --dock <dock> --json [--repo <path>] [--timestamp <iso>] [--out <path>]

This local prototype validates one packet and emits a receipt bundle. It does not launch providers.`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    noProviderLaunch: true,
    timestamp: DEFAULT_TIMESTAMP,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--allow-provider-launch') {
      options.noProviderLaunch = false;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
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
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function resolveRepoRoot(startPath) {
  const cwd = resolve(startPath ?? process.cwd());
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Unable to resolve repo root from ${cwd}: ${result.stderr || 'git rev-parse failed'}`);
  }
  return resolve(result.stdout);
}

function stableHash(value, length = 16) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function readJsonFile(path, label) {
  return readFile(path, 'utf8').then((raw) => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in ${label} ${path}: ${error.message}`);
    }
  });
}

function repoPath(repoRoot, candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return null;
  }
  return isAbsolute(candidate) ? resolve(candidate) : resolve(repoRoot, candidate);
}

function isWithinRepo(repoRoot, candidate) {
  const rel = relative(repoRoot, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizeRef(packet) {
  return packet.required_start_ref ?? packet.requiredStartRef ?? packet.start_ref ?? packet.startRef;
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

function normalizeResultRoutes(packet) {
  const route = packet.result_route ?? packet.resultRoute ?? packet.result_routes ?? packet.resultRoutes;
  if (Array.isArray(route)) {
    return route;
  }
  if (route) {
    return [route];
  }
  return [];
}

function normalizeEvidenceRequirements(packet) {
  const requirements = packet.evidence_requirements ?? packet.evidenceRequirements ?? packet.proof_requirements ?? packet.proofRequirements;
  return Array.isArray(requirements) ? requirements : [];
}

function normalizeStopConditions(packet) {
  const conditions = packet.stop_conditions ?? packet.stopConditions;
  return Array.isArray(conditions) ? conditions : [];
}

function normalizeProviderHint(packet) {
  return packet.provider_hint ?? packet.providerHint ?? packet.provider;
}

function normalizeWorktree(packet, repoRoot) {
  const worktree = packet.worktree ?? packet.cwd ?? repoRoot;
  return repoPath(repoRoot, worktree);
}

function checkSourceArtifact(repoRoot, sourceArtifact) {
  if (!sourceArtifact) {
    return {
      status: 'missing_with_reason',
      reason: 'packet did not include source_artifact',
      path: null,
    };
  }

  const sourcePath = repoPath(repoRoot, sourceArtifact);
  const repoRelative = isWithinRepo(repoRoot, sourcePath);
  return {
    status: existsSync(sourcePath) ? 'present' : 'missing_with_reason',
    reason: existsSync(sourcePath) ? null : 'source artifact path does not exist in current worktree',
    path: repoRelative ? relative(repoRoot, sourcePath) : sourcePath,
    repo_path: repoRelative,
  };
}

function resolveRef(repoRoot, ref) {
  if (!ref) {
    return {
      status: 'missing_with_reason',
      reason: 'packet did not include required_start_ref',
      ref: null,
      sha: null,
    };
  }

  const result = runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return {
    status: result.exitCode === 0 ? 'resolved' : 'missing_with_reason',
    reason: result.exitCode === 0 ? null : result.stderr || 'git rev-parse failed',
    ref,
    sha: result.exitCode === 0 ? result.stdout : null,
    command: result.command,
  };
}

function resolveGitFacts(repoRoot) {
  const branch = runGit(repoRoot, ['branch', '--show-current']);
  const status = runGit(repoRoot, ['status', '--short']);
  return {
    branch: branch.exitCode === 0 && branch.stdout ? branch.stdout : 'not_observed',
    dirty_untracked_baseline: status.exitCode === 0
      ? (status.stdout ? status.stdout.split('\n') : [])
      : ['missing_with_reason: git status failed'],
    status_command: {
      command: status.command,
      exit_code: status.exitCode,
    },
  };
}

async function resolveDockProfile(repoRoot, dockName) {
  const dockJson = resolve(repoRoot, '.docks', dockName, 'dock.json');
  if (!existsSync(dockJson)) {
    return {
      status: 'missing_with_reason',
      reason: `dock profile not found at .docks/${dockName}/dock.json`,
      dock: dockName,
      launch_root: relative(repoRoot, resolve(repoRoot, '.docks', dockName)),
    };
  }

  const profile = await readJsonFile(dockJson, 'dock profile');
  return {
    status: 'resolved',
    dock: profile.name ?? dockName,
    role: profile.role ?? 'not_observed',
    default_entry_path: profile.default_entry_path ?? 'not_observed',
    allowed_entry_paths: profile.allowed_entry_paths ?? [],
    launch_root: relative(repoRoot, resolve(repoRoot, '.docks', dockName)),
    harness: profile.harness ?? 'not_observed',
    profile_path: relative(repoRoot, dockJson),
  };
}

function resolveProviderFact({ explicitProvider, packetProviderHint, noProviderLaunch }) {
  const selected = explicitProvider ?? packetProviderHint ?? null;
  if (!selected) {
    return {
      selected_provider: 'missing_with_reason',
      selection_source: 'missing_with_reason',
      availability_status: 'not_observed',
      launch_requested: !noProviderLaunch,
      launch_performed: false,
      reason: 'no --provider or packet provider_hint supplied',
    };
  }

  const normalized = String(selected).toLowerCase();
  return {
    selected_provider: normalized,
    selection_source: explicitProvider ? 'explicit_option' : 'packet_provider_hint',
    availability_status: SUPPORTED_PROVIDERS.has(normalized) ? 'selected_dry_run_not_launched' : 'unsupported',
    launch_requested: !noProviderLaunch,
    launch_performed: false,
    auth_status: 'not_applicable: dry-run/no-provider-launch',
    catalog_record_refs: 'not_observed',
    telemetry_event_refs: 'not_observed',
    mismatch_facts: SUPPORTED_PROVIDERS.has(normalized) ? [] : [`unsupported_provider:${normalized}`],
  };
}

function buildDryRunCommand({ packetPath, provider, dock, repoRoot, timestamp }) {
  const parts = [
    'node',
    'scripts/afk-dry-run-prototype.mjs',
    '--packet',
    relative(repoRoot, packetPath),
    '--provider',
    provider ?? 'missing_with_reason',
    '--dock',
    dock,
    '--json',
  ];
  if (timestamp) {
    parts.push('--timestamp', timestamp);
  }
  return parts;
}

function validationRecord(name, ok, details = {}) {
  return {
    name,
    ...details,
    status: ok ? 'passed' : 'failed',
  };
}

async function buildReceipt(options) {
  if (!options.packet) {
    throw new Error('Missing required --packet');
  }
  if (!options.noProviderLaunch) {
    throw new Error('Provider launch is outside this dry-run prototype; remove --allow-provider-launch');
  }

  const repoRoot = resolveRepoRoot(options.repo ?? process.cwd());
  const packetPath = repoPath(repoRoot, options.packet);
  const packet = await readJsonFile(packetPath, 'packet');
  const createdAt = options.timestamp ?? new Date().toISOString();
  const packetId = normalizePacketId(packet);
  const sourceArtifact = normalizeSourceArtifact(packet);
  const requiredStartRef = normalizeRef(packet);
  const requestedDock = options.dock ?? normalizeRequestedDock(packet);
  const selectedDock = requestedDock ?? 'missing_with_reason';
  const worktree = normalizeWorktree(packet, repoRoot);
  const source = checkSourceArtifact(repoRoot, sourceArtifact);
  const refResolution = resolveRef(repoRoot, requiredStartRef);
  const dockProfile = await resolveDockProfile(repoRoot, selectedDock);
  const gitFacts = resolveGitFacts(repoRoot);
  const providerFact = resolveProviderFact({
    explicitProvider: options.provider,
    packetProviderHint: normalizeProviderHint(packet),
    noProviderLaunch: options.noProviderLaunch,
  });
  const resultRoutes = normalizeResultRoutes(packet);
  const evidenceRequirements = normalizeEvidenceRequirements(packet);
  const stopConditions = normalizeStopConditions(packet);
  const cwdPath = repoPath(repoRoot, packet.cwd ?? repoRoot);
  const worktreeExists = worktree ? existsSync(worktree) : false;
  const cwdExists = cwdPath ? existsSync(cwdPath) : false;
  const cwdIsRepo = cwdPath ? resolveRepoRoot(cwdPath) === repoRoot : false;

  const validations = [
    validationRecord('packet_id_or_ref_present', Boolean(packetId), { packet_id_or_ref: packetId ?? null }),
    validationRecord('source_artifact_exists_when_repo_path', source.status === 'present', source),
    validationRecord('cwd_resolves_to_repo_root', cwdExists && cwdIsRepo, {
      cwd: cwdPath,
      expected_repo_root: repoRoot,
    }),
    validationRecord('worktree_exists', worktreeExists, { worktree }),
    validationRecord('required_start_ref_resolves', refResolution.status === 'resolved', refResolution),
    validationRecord('dock_profile_exists', dockProfile.status === 'resolved', {
      dock: selectedDock,
      profile_path: dockProfile.profile_path ?? null,
      reason: dockProfile.reason ?? null,
    }),
    validationRecord('no_provider_launch_requested', options.noProviderLaunch, {
      launch_requested: providerFact.launch_requested,
      launch_performed: providerFact.launch_performed,
    }),
  ];

  const validationFailed = validations.some((validation) => validation.status !== 'passed');
  const providerUnsupported = providerFact.availability_status === 'unsupported';
  const finalStatus = validationFailed || providerUnsupported ? 'failed' : 'completed';
  const schedulerRunId = `dry-run-scheduler-${stableHash({
    packetId,
    sourceArtifact,
    requiredStartRef,
    dock: selectedDock,
    provider: providerFact.selected_provider,
  })}`;
  const dispatchAttemptId = `dry-run-dispatch-${stableHash({
    schedulerRunId,
    dock: selectedDock,
    provider: providerFact.selected_provider,
  })}`;
  const receiptBundleId = `afk-dry-run-${stableHash({
    packetId,
    schedulerRunId,
    dispatchAttemptId,
  })}`;
  const idempotenceKey = stableHash({
    packetId,
    sourceArtifact,
    requiredStartRef,
    dock: selectedDock,
    provider: providerFact.selected_provider,
    worktree: isWithinRepo(repoRoot, worktree) ? relative(repoRoot, worktree) : worktree,
  }, 32);
  const dryRunCommand = buildDryRunCommand({
    packetPath,
    provider: providerFact.selected_provider,
    dock: selectedDock,
    repoRoot,
    timestamp: options.timestamp,
  });

  return {
    type: 'aos.afk_dry_run_receipt_bundle.prototype',
    experimental: true,
    schema_status: 'not_a_schema',
    receipt_bundle_id: receiptBundleId,
    created_at: createdAt,
    updated_at: createdAt,
    final_status: finalStatus,
    validations,
    transfer: {
      packet_id_or_ref: packetId ?? 'missing_with_reason: packet id/ref is required',
      source_event_or_artifact: sourceArtifact ?? 'missing_with_reason: source_artifact not supplied',
      source_artifact_status: source,
      selected_recipient: selectedDock,
      requested_role_kind: packet.requested_role_kind ?? packet.requestedRoleKind ?? 'not_observed',
      cwd: cwdPath,
      worktree,
      branch: gitFacts.branch,
      branch_policy: packet.branch_policy ?? packet.branchPolicy ?? 'not_observed',
      required_start_ref: requiredStartRef ?? 'missing_with_reason: required_start_ref not supplied',
      start_ref_sha: refResolution.sha ?? 'missing_with_reason: required_start_ref did not resolve',
      selected_outputs: packet.selected_outputs ?? packet.selectedOutputs ?? 'not_observed',
      proof_requirements: evidenceRequirements.length > 0 ? evidenceRequirements : 'not_observed',
      stop_conditions: stopConditions.length > 0 ? stopConditions : 'not_observed',
      result_route_refs: resultRoutes.length > 0 ? resultRoutes : 'not_observed',
      external_publication_policy: packet.external_publication_policy ?? packet.externalPublicationPolicy ?? 'not_observed',
    },
    scheduler: {
      scheduler_run_id: schedulerRunId,
      idempotence_key: idempotenceKey,
      intake_decision: validationFailed ? 'rejected' : 'accepted',
      selected_action: validationFailed ? 'reject' : 'dry-run',
      lifecycle_state_transitions: validationFailed
        ? ['queued', 'failed']
        : ['queued', 'accepted', 'launching', 'completed'],
      lease_or_deadline: packet.timeout_or_lease ?? packet.timeoutOrLease ?? 'not_observed',
      heartbeat_expectation: packet.timeout_or_lease?.heartbeat ?? packet.timeoutOrLease?.heartbeat ?? 'not_observed',
      heartbeat_observations: 'not_applicable: dry-run/no-provider-session',
      duplicate_superseded_expired: {
        duplicate: 'not_observed',
        superseded: 'not_observed',
        expired: 'not_observed',
      },
      route_attempts: 'not_applicable: local dry-run emitted receipt only',
      final_status: finalStatus,
    },
    dispatch: {
      dispatch_attempt_ids: [dispatchAttemptId],
      selected_provider: providerFact.selected_provider,
      provider_selection: providerFact,
      selected_dock_profile: dockProfile,
      terminal_substrate: 'not_applicable: dry-run/no-provider-terminal',
      launch_root: dockProfile.launch_root ?? `missing_with_reason: .docks/${selectedDock}`,
      command_or_dry_run_command: dryRunCommand,
      availability_auth_status: providerFact.auth_status ?? providerFact.availability_status,
      provider_session_id: 'not_applicable: dry-run/no-provider-launch',
      catalog_record_refs: providerFact.catalog_record_refs ?? 'not_observed',
      telemetry_event_refs: providerFact.telemetry_event_refs ?? 'not_observed',
      mismatch_facts: providerFact.mismatch_facts ?? [],
    },
    work: {
      bounded_goal: packet.goal ?? packet.objective ?? 'validate manual packet and emit local dry-run receipt bundle',
      constraints: [
        'experimental command shape',
        'no provider launch',
        'no schema mutation',
        'no external publication',
      ],
      execution_summary: validationFailed
        ? 'Validated packet and current state; dry-run receipt reports validation failures.'
        : 'Validated packet and current state; emitted local dry-run receipt without launching a provider.',
      commands_checks: [
        {
          command: 'git rev-parse --show-toplevel',
          cwd: repoRoot,
          result: 'passed',
        },
        {
          command: refResolution.command ?? 'git rev-parse --verify <required_start_ref>^{commit}',
          cwd: repoRoot,
          result: refResolution.status === 'resolved' ? 'passed' : 'failed',
        },
        {
          command: gitFacts.status_command.command,
          cwd: repoRoot,
          result: gitFacts.status_command.exit_code === 0 ? 'passed' : 'failed',
        },
      ],
      changed_paths: [],
      artifacts_created: options.out ? [options.out] : [],
      artifacts_deliberately_not_created: [
        'provider session',
        'provider transcript',
        'gateway job mutation',
        'schema fixture',
        'committed receipt artifact',
      ],
      explicit_deferrals_preserved: [
        'public ./aos command spelling',
        'provider-neutral dispatch implementation',
        'scheduler implementation',
        'durable work/evidence schemas',
        'provider launch/resume/authentication',
      ],
      local_only_state: {
        dirty_untracked_baseline: gitFacts.dirty_untracked_baseline,
        surface: 'local dry-run output only',
      },
      blocker_class: finalStatus === 'completed' ? 'not_applicable' : 'validation_failed',
      next_owner: finalStatus === 'completed' ? 'foreman' : 'gdi',
      follow_up_recommendation: finalStatus === 'completed'
        ? 'bounded manual dry-run with Operator/HITL evidence'
        : 'correct packet/current-state validation failures before dry-run dispatch',
      final_status: finalStatus,
    },
    evidence: {
      evidence_receipt_ids: [`dry-run-evidence-${stableHash({ receiptBundleId, createdAt })}`],
      proof_summaries: validations.map((validation) => ({
        claim: validation.name,
        status: validation.status,
        evidence: validation,
      })),
      command_output_refs: 'inline: work.commands_checks',
      workflow_router_output_ref: 'not_observed: caller should run ./aos dev recommend --json as verification',
      provider_catalog_refs: 'not_applicable: dry-run/no-provider-launch',
      provider_telemetry_refs: 'not_applicable: dry-run/no-provider-launch',
      route_notification_response_refs: 'not_applicable: local dry-run/no-route-mutation',
      human_needed_refs: 'not_observed',
      missing_evidence_explanations: [
        'provider catalog and telemetry are absent by design because this prototype never launches or resumes a provider',
        'route responses are absent by design because this prototype does not mutate gateway, notification, GitHub, or broker routes',
      ],
    },
  };
}

function toMarkdown(receipt) {
  return `# Experimental AFK Dry-Run Receipt

receipt_bundle_id: ${receipt.receipt_bundle_id}
created_at: ${receipt.created_at}
final_status: ${receipt.final_status}

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
      await writeFile(resolve(options.out), output, 'utf8');
    }
    process.stdout.write(output);
    process.exitCode = receipt.final_status === 'completed' ? 0 : 1;
  } catch (error) {
    const payload = {
      type: 'aos.afk_dry_run_receipt_bundle.prototype_error',
      experimental: true,
      final_status: 'failed',
      error: error.message,
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

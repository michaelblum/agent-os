#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import http from 'node:http';

const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'gemini']);
const PROVIDER_BINARY_PATTERN = /(^|[/\s'"`])(codex|claude|gemini)(\s|$)/i;
const DEFAULT_TIMESTAMP = null;
const NOT_OBSERVED = 'not_observed';
const NOT_ATTEMPTED = 'not_attempted';
const NOT_APPLICABLE_NO_PROVIDER = 'not_applicable: no-provider-launch';
const attemptRegistry = new Map();

function usage() {
  return `Experimental AFK launch-attempt prototype.

Usage:
  node scripts/afk-launch-attempt-prototype.mjs --packet <packet.json> --provider <name> --dock <dock> --json [--repo <path>] [--timestamp <iso>] [--out <path>] [--duplicate-in-process] [--catalog-fixture <path>] [--provider-session-id <id>] [--launch-observed-at <iso>]

This local prototype creates an aos.afk_launch_attempt record, observes terminal substrate through the Sigil codex-terminal bridge, and launches no provider.`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    timestamp: DEFAULT_TIMESTAMP,
    duplicateInProcess: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--duplicate-in-process') {
      options.duplicateInProcess = true;
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
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Unable to resolve repo root from ${cwd}: ${result.stderr || 'git rev-parse failed'}`);
  }
  return resolve(result.stdout);
}

function stableHash(value, length = 32) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

async function readJsonFile(path, label) {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${path}: ${error.message}`);
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
  if (Array.isArray(route)) return route;
  return route ? [route] : [];
}

function normalizeProviderHint(packet) {
  return packet.provider_hint ?? packet.providerHint ?? packet.provider;
}

function normalizeSessionId(session) {
  return session.session_id ?? session.sessionId ?? session.id;
}

function normalizeSessionUpdatedAt(session) {
  return session.updated_at ?? session.updatedAt ?? session.last_updated_at ?? session.lastUpdatedAt;
}

function normalizeSessionCwd(session) {
  return session.cwd ?? session.worktree ?? session.launch_cwd ?? session.launchCwd;
}

function resolveObservedSessionCwd(session) {
  const sessionCwd = normalizeSessionCwd(session);
  return sessionCwd ? resolve(sessionCwd) : NOT_OBSERVED;
}

function normalizeSessionProvider(session) {
  return session.provider ? String(session.provider).toLowerCase() : null;
}

function normalizeCatalogFixture(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.sessions)) return value.sessions;
  if (Array.isArray(value.catalog_sessions)) return value.catalog_sessions;
  throw new Error('Catalog fixture must be an array or object with sessions');
}

function normalizeAllCwdCatalogFixture(value) {
  if (!value || Array.isArray(value)) return [];
  if (Array.isArray(value.all_cwd_sessions)) return value.all_cwd_sessions;
  if (Array.isArray(value.allCwdSessions)) return value.allCwdSessions;
  if (Array.isArray(value.all_cwd_catalog_sessions)) return value.all_cwd_catalog_sessions;
  return [];
}

function timestampMs(value) {
  if (!value || value === NOT_OBSERVED) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function sessionRef(session) {
  const provider = normalizeSessionProvider(session) ?? NOT_OBSERVED;
  const id = normalizeSessionId(session) ?? NOT_OBSERVED;
  return `${provider}:${id}`;
}

function sessionTelemetryObserved(session) {
  return Boolean(
    session.telemetry_observed
      ?? session.telemetryObserved
      ?? session.telemetry?.observed
      ?? (Array.isArray(session.telemetry_event_refs) && session.telemetry_event_refs.length > 0),
  );
}

function classifyCatalogAndTelemetry({
  sessions,
  allCwdSessions = [],
  provider,
  cwd,
  launchObservedAt,
  providerSessionId,
}) {
  if (!sessions) {
    return {
      catalog: {
        status: NOT_OBSERVED,
        catalog_record_refs: NOT_OBSERVED,
        match_count: NOT_OBSERVED,
        matched_session_id: NOT_OBSERVED,
        source_file: NOT_OBSERVED,
        resume_command: NOT_OBSERVED,
      },
      telemetry: {
        status: NOT_OBSERVED,
        telemetry_event_refs: NOT_OBSERVED,
        lifecycle_event_refs: NOT_OBSERVED,
        capability_event_refs: NOT_OBSERVED,
        mismatch_refs: [],
      },
      mismatches: [],
    };
  }

  const normalizedProvider = String(provider).toLowerCase();
  const matchingProviderSessionId = providerSessionId && providerSessionId !== NOT_OBSERVED
    ? sessions.filter((session) => (
      normalizeSessionProvider(session) === normalizedProvider
        && normalizeSessionId(session) === providerSessionId
    ))
    : [];
  const observedProviderSession = matchingProviderSessionId.length === 1
    ? matchingProviderSessionId[0]
    : null;
  const observedProviderSessionCwd = observedProviderSession
    ? resolveObservedSessionCwd(observedProviderSession)
    : NOT_OBSERVED;
  const observedProviderSessionWrongCwd = Boolean(
    observedProviderSession
      && observedProviderSessionCwd !== NOT_OBSERVED
      && observedProviderSessionCwd !== cwd,
  );
  const providerAcceptance = providerSessionId && providerSessionId !== NOT_OBSERVED
    ? {
      status: observedProviderSessionWrongCwd
        ? 'provider_session_wrong_cwd'
        : 'provider_session_observed',
      provider_session_id: providerSessionId,
      provider_reported_cwd: observedProviderSessionCwd,
    }
    : null;
  const matchingProviderCwd = sessions.filter((session) => (
    normalizeSessionProvider(session) === normalizedProvider
      && resolveObservedSessionCwd(session) === cwd
  ));
  const currentThreshold = timestampMs(launchObservedAt);
  const allCwdCurrentCandidates = currentThreshold == null
    ? []
    : allCwdSessions.filter((session) => {
      const updatedAt = timestampMs(normalizeSessionUpdatedAt(session));
      return normalizeSessionProvider(session) === normalizedProvider
        && updatedAt != null
        && updatedAt >= currentThreshold;
    });
  const unrelatedCurrentSessions = allCwdCurrentCandidates.filter((session) => (
    resolveObservedSessionCwd(session) !== cwd
  ));
  const unrelatedCurrentSessionEvidence = unrelatedCurrentSessions.map((session) => ({
    provider_session_id: normalizeSessionId(session) ?? NOT_OBSERVED,
    catalog_record_ref: sessionRef(session),
    cwd: resolveObservedSessionCwd(session),
    updated_at: normalizeSessionUpdatedAt(session) ?? NOT_OBSERVED,
  }));
  const currentCandidates = currentThreshold == null
    ? matchingProviderCwd
    : matchingProviderCwd.filter((session) => {
      const updatedAt = timestampMs(normalizeSessionUpdatedAt(session));
      return updatedAt != null && updatedAt >= currentThreshold;
    });
  const catalogRecordRefs = matchingProviderCwd.map(sessionRef);
  const reviewableCatalogRecordRefs = observedProviderSessionWrongCwd
    ? [sessionRef(observedProviderSession)]
    : catalogRecordRefs;

  let status;
  let matched = null;
  let mismatch = null;

  if (observedProviderSessionWrongCwd) {
    status = 'catalog_provider_session_wrong_cwd';
    mismatch = {
      code: 'provider_session_wrong_cwd',
      severity: 'error',
      source: 'catalog',
      expected: {
        provider_session_id: providerSessionId,
        cwd,
      },
      observed: {
        provider_session_id: providerSessionId,
        cwd: observedProviderSessionCwd,
        catalog_record_ref: sessionRef(observedProviderSession),
      },
      effect: 'failed',
      evidence_ref: 'inline:catalog.provider_session_mismatch',
    };
  } else if (matchingProviderCwd.length === 0 && unrelatedCurrentSessionEvidence.length > 0) {
    status = 'catalog_current_launch_not_observed';
    mismatch = {
      code: 'catalog_current_launch_not_observed',
      severity: 'info',
      source: 'catalog',
      expected: { cwd, updated_at_or_after: launchObservedAt },
      observed: { unrelated_current_session_refs: unrelatedCurrentSessionEvidence },
      effect: 'not_observed',
      evidence_ref: 'inline:catalog.unrelated_current_session_refs',
    };
  } else if (matchingProviderCwd.length === 0) {
    status = 'catalog_not_observed';
  } else if (providerSessionId && providerSessionId !== NOT_OBSERVED) {
    const exactMatches = matchingProviderCwd.filter((session) => normalizeSessionId(session) === providerSessionId);
    if (exactMatches.length === 1) {
      status = 'catalog_matched';
      [matched] = exactMatches;
    } else if (exactMatches.length > 1) {
      status = 'multiple_catalog_candidates';
      mismatch = {
        code: 'multiple_catalog_matches',
        severity: 'warn',
        source: 'catalog',
        expected: { provider_session_id: providerSessionId },
        observed: { match_count: exactMatches.length },
        effect: 'ambiguous',
        evidence_ref: 'inline:catalog.catalog_record_refs',
      };
    } else {
      status = 'catalog_current_launch_not_observed';
      mismatch = {
        code: 'catalog_match_not_observed',
        severity: 'info',
        source: 'catalog',
        expected: { provider_session_id: providerSessionId },
        observed: { catalog_record_refs: catalogRecordRefs },
        effect: 'not_observed',
        evidence_ref: 'inline:catalog.catalog_record_refs',
      };
    }
  } else if (currentCandidates.length === 0) {
    status = 'catalog_current_launch_not_observed';
    mismatch = {
      code: 'catalog_current_launch_not_observed',
      severity: 'info',
      source: 'catalog',
      expected: { updated_at_or_after: launchObservedAt },
      observed: { catalog_record_refs: catalogRecordRefs },
      effect: 'not_observed',
      evidence_ref: 'inline:catalog.catalog_record_refs',
    };
  } else if (currentCandidates.length === 1) {
    status = 'catalog_candidate_current_launch_observed';
    [matched] = currentCandidates;
  } else {
    status = 'multiple_catalog_candidates';
    mismatch = {
      code: 'multiple_catalog_candidates',
      severity: 'warn',
      source: 'catalog',
      expected: { current_candidate_count: 1 },
      observed: { current_candidate_count: currentCandidates.length },
      effect: 'ambiguous',
      evidence_ref: 'inline:catalog.catalog_record_refs',
    };
  }

  const telemetryStatus = matched
    ? (sessionTelemetryObserved(matched) ? 'telemetry_observed' : 'telemetry_not_observed')
    : (
      status === 'catalog_provider_session_wrong_cwd'
        ? 'telemetry_not_attempted_wrong_cwd'
        : (status === 'catalog_not_observed' ? 'telemetry_not_attempted_no_catalog_match' : 'telemetry_current_launch_not_observed')
    );
  const telemetryEventRefs = matched && sessionTelemetryObserved(matched)
    ? (matched.telemetry_event_refs ?? matched.telemetryEventRefs ?? [`inline:catalog:${sessionRef(matched)}:telemetry`])
    : NOT_OBSERVED;

  return {
    provider_acceptance: providerAcceptance,
    catalog: {
      status,
      catalog_record_refs: reviewableCatalogRecordRefs.length > 0 ? reviewableCatalogRecordRefs : NOT_OBSERVED,
      match_count: matched ? 1 : currentCandidates.length,
      matched_session_id: matched ? normalizeSessionId(matched) : NOT_OBSERVED,
      source_file: matched?.source_file ?? matched?.sourceFile ?? NOT_OBSERVED,
      resume_command: matched?.resume_command ?? matched?.resumeCommand ?? NOT_OBSERVED,
      launch_observed_at: launchObservedAt ?? NOT_OBSERVED,
      unrelated_current_session_refs: unrelatedCurrentSessionEvidence.length > 0
        ? unrelatedCurrentSessionEvidence
        : NOT_OBSERVED,
      provider_session_mismatch: observedProviderSessionWrongCwd
        ? {
          code: 'provider_session_wrong_cwd',
          expected_cwd: cwd,
          observed_cwd: observedProviderSessionCwd,
          provider_session_id: providerSessionId,
          catalog_record_ref: sessionRef(observedProviderSession),
          lifecycle_state: 'failed',
        }
        : NOT_OBSERVED,
    },
    telemetry: {
      status: telemetryStatus,
      telemetry_event_refs: telemetryEventRefs,
      lifecycle_event_refs: matched?.lifecycle_event_refs ?? matched?.lifecycleEventRefs ?? NOT_OBSERVED,
      capability_event_refs: matched?.capability_event_refs ?? matched?.capabilityEventRefs ?? NOT_OBSERVED,
      mismatch_refs: [],
    },
    mismatches: mismatch ? [mismatch] : [],
  };
}

function normalizeWorktree(packet, repoRoot) {
  return repoPath(repoRoot, packet.worktree ?? packet.cwd ?? repoRoot);
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
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  return {
    branch: branch.exitCode === 0 && branch.stdout ? branch.stdout : NOT_OBSERVED,
    head: head.exitCode === 0 && head.stdout ? head.stdout : NOT_OBSERVED,
  };
}

async function resolveDockProfile(repoRoot, dockName) {
  const dockJson = resolve(repoRoot, '.docks', dockName, 'dock.json');
  if (!existsSync(dockJson)) {
    return {
      status: 'missing_with_reason',
      reason: `dock profile not found at .docks/${dockName}/dock.json`,
      dock: dockName,
      role: NOT_OBSERVED,
      launch_root: relative(repoRoot, resolve(repoRoot, '.docks', dockName)),
      profile_path: relative(repoRoot, dockJson),
    };
  }
  const profile = await readJsonFile(dockJson, 'dock profile');
  return {
    status: 'resolved',
    dock: profile.name ?? dockName,
    role: profile.role ?? dockName,
    launch_root: relative(repoRoot, resolve(repoRoot, '.docks', dockName)),
    profile_path: relative(repoRoot, dockJson),
  };
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
  return {
    status: existsSync(sourcePath) ? 'present' : 'missing_with_reason',
    reason: existsSync(sourcePath) ? null : 'source artifact path does not exist in current worktree',
    path: isWithinRepo(repoRoot, sourcePath) ? relative(repoRoot, sourcePath) : sourcePath,
  };
}

function validationRecord(name, ok, details = {}) {
  return { name, ...details, status: ok ? 'passed' : 'failed' };
}

function validatePathExists(name, path) {
  return validationRecord(name, Boolean(path && existsSync(path)), {
    path,
    reason: path && existsSync(path) ? null : `${name} path does not exist: ${path}`,
  });
}

function selectedProvider({ explicitProvider, packetProviderHint }) {
  const selected = explicitProvider ?? packetProviderHint ?? null;
  if (!selected) {
    return {
      selected_provider: 'missing_with_reason',
      provider_selection_source: 'missing_with_reason',
      status: 'missing_with_reason',
      mismatch_facts: ['missing_provider_selection'],
    };
  }
  const normalized = String(selected).toLowerCase();
  return {
    selected_provider: normalized,
    provider_selection_source: explicitProvider ? 'explicit_option' : 'packet_provider_hint',
    status: SUPPORTED_PROVIDERS.has(normalized) ? 'selected_no_provider_launch' : 'unsupported',
    mismatch_facts: SUPPORTED_PROVIDERS.has(normalized) ? [] : [`unsupported_provider:${normalized}`],
  };
}

function harmlessCommand(session, cwd) {
  const payload = JSON.stringify({ marker: 'afk-launch-attempt-marker', session, cwd });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  return `node -e ${JSON.stringify(`console.log(Buffer.from(${JSON.stringify(encoded)}, 'base64').toString('utf8'));`)}`;
}

function assertNoProviderCommand(command) {
  if (PROVIDER_BINARY_PATTERN.test(command)) {
    throw new Error('Refusing command path that would execute a provider binary');
  }
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForHealth(port, readOutput) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(`bridge did not become healthy:\n${readOutput()}`);
}

async function waitForSnapshot(port, session, marker) {
  const url = `http://127.0.0.1:${port}/snapshot?session=${encodeURIComponent(session)}&lines=80`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const snapshot = await response.json();
      if (snapshot.text.includes(marker)) return snapshot;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`snapshot did not include ${marker}`);
}

async function observeTerminalSubstrate({ repoRoot, idempotenceKey, launchCwd, command }) {
  assertNoProviderCommand(command);
  const tempRoot = mkdtempSync(join(tmpdir(), 'afk-launch-attempt-'));
  const homeDir = join(tempRoot, 'home');
  const codexRoot = join(tempRoot, 'codex-empty');
  const claudeRoot = join(tempRoot, 'claude-empty');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(codexRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const port = await freePort();
  const defaultSession = `afk-launch-${idempotenceKey.slice(0, 12)}`;
  let output = '';
  const bridge = spawn(process.execPath, ['apps/sigil/codex-terminal/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SIGIL_AGENT_TERMINAL_PORT: String(port),
      SIGIL_AGENT_TERMINAL_DRIVER: 'process',
      SIGIL_AGENT_TMUX_SESSION: defaultSession,
      SIGIL_AGENT_CWD: launchCwd,
      SIGIL_AGENT_COMMAND: command,
      SIGIL_AGENT_CATALOG_HOME: homeDir,
      SIGIL_AGENT_CODEX_ROOT: codexRoot,
      SIGIL_AGENT_CLAUDE_ROOT: claudeRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  bridge.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

  try {
    const health = await waitForHealth(port, () => output);
    const ensureResponse = await fetch(`http://127.0.0.1:${port}/ensure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: defaultSession,
        cwd: launchCwd,
        command,
        force: true,
      }),
    });
    if (!ensureResponse.ok) {
      throw new Error(`bridge /ensure failed: ${await ensureResponse.text()}`);
    }
    const ensured = await ensureResponse.json();
    const snapshot = await waitForSnapshot(port, defaultSession, 'afk-launch-attempt-marker');
    const sessionsResponse = await fetch(
      `http://127.0.0.1:${port}/sessions?cwd=${encodeURIComponent(launchCwd)}`,
    );
    const catalog = sessionsResponse.ok ? await sessionsResponse.json() : { sessions: [] };
    const inspectorResponse = await fetch(
      `http://127.0.0.1:${port}/session-inspector?cwd=${encodeURIComponent(launchCwd)}&provider=codex&session_id=${defaultSession}`,
    );
    return {
      bridge_session_started: true,
      terminal_substrate: {
        status: 'observed',
        driver: ensured.driver,
        session_handle: ensured.session,
        cwd: launchCwd,
        command,
        snapshot_ref: 'inline:terminal_substrate.snapshot_summary',
        snapshot_summary: {
          session: snapshot.session,
          driver: snapshot.driver,
          command: snapshot.command,
          includes_marker: snapshot.text.includes('afk-launch-attempt-marker'),
          text_excerpt: snapshot.text.split('\n').slice(0, 4).join('\n'),
        },
        bridge_health: {
          ok: health.ok,
          default_session: health.defaultSession,
          default_cwd: health.defaultCwd,
          driver: health.driver,
        },
      },
      catalog_status: catalog.sessions.length === 0 ? NOT_OBSERVED : 'fixture_only_unexpected',
      telemetry_status: inspectorResponse.status === 404 ? NOT_OBSERVED : 'fixture_only_unexpected',
    };
  } finally {
    if (bridge.exitCode == null) {
      bridge.kill('SIGTERM');
      await new Promise((resolvePromise) => bridge.once('exit', resolvePromise));
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function buildAttemptContext(options) {
  if (!options.packet) throw new Error('Missing required --packet');
  const repoRoot = resolveRepoRoot(options.repo ?? process.cwd());
  const packetPath = repoPath(repoRoot, options.packet);
  const packet = await readJsonFile(packetPath, 'packet');
  const rawCatalogFixture = options.catalogFixture
    ? await readJsonFile(repoPath(repoRoot, options.catalogFixture), 'catalog fixture')
    : null;
  const catalogFixture = rawCatalogFixture ? normalizeCatalogFixture(rawCatalogFixture) : null;
  const allCwdCatalogFixture = rawCatalogFixture ? normalizeAllCwdCatalogFixture(rawCatalogFixture) : [];
  const packetId = normalizePacketId(packet);
  const sourceArtifact = normalizeSourceArtifact(packet);
  const requiredStartRef = normalizeRef(packet);
  const selectedDock = options.dock ?? normalizeRequestedDock(packet) ?? 'missing_with_reason';
  const worktree = normalizeWorktree(packet, repoRoot);
  const cwdPath = repoPath(repoRoot, packet.cwd ?? repoRoot);
  const provider = selectedProvider({
    explicitProvider: options.provider,
    packetProviderHint: normalizeProviderHint(packet),
  });
  const source = checkSourceArtifact(repoRoot, sourceArtifact);
  const refResolution = resolveRef(repoRoot, requiredStartRef);
  const dockProfile = await resolveDockProfile(repoRoot, selectedDock);
  const gitFacts = resolveGitFacts(repoRoot);
  const resultRoutes = normalizeResultRoutes(packet);
  const launchRoot = dockProfile.launch_root ?? `.docks/${selectedDock}`;
  const intendedLaunchCwd = resolve(repoRoot, launchRoot);
  const schedulerRunId = options.schedulerRunId ?? `prototype-scheduler-${stableHash({
    packetId,
    sourceArtifact,
    requiredStartRef,
    selectedDock,
    selectedProvider: provider.selected_provider,
  }, 16)}`;
  const dispatchAttemptId = `prototype-dispatch-${stableHash({
    schedulerRunId,
    selectedDock,
    selectedProvider: provider.selected_provider,
  }, 16)}`;
  const action = 'start';
  const idempotenceKey = stableHash({
    packet_id_or_ref: packetId,
    scheduler_run_id: schedulerRunId,
    selected_dock: selectedDock,
    selected_provider: provider.selected_provider,
    launch_root: launchRoot,
    intended_worktree: worktree,
    required_start_ref: requiredStartRef,
    result_route_refs: resultRoutes,
    action,
  });
  const session = `afk-launch-${idempotenceKey.slice(0, 12)}`;
  const command = harmlessCommand(session, intendedLaunchCwd);
  assertNoProviderCommand(command);

  const validations = [
    validationRecord('packet_id_or_ref_present', Boolean(packetId), { packet_id_or_ref: packetId ?? null }),
    validationRecord('source_artifact_exists_when_repo_path', source.status === 'present', source),
    validationRecord('cwd_resolves_to_repo_root', cwdPath === repoRoot, {
      cwd: cwdPath,
      expected_repo_root: repoRoot,
      reason: cwdPath === repoRoot ? null : `cwd resolves to ${cwdPath}, not expected repo root ${repoRoot}`,
    }),
    validatePathExists('worktree_exists', worktree),
    validationRecord('required_start_ref_resolves', refResolution.status === 'resolved', refResolution),
    validationRecord('dock_profile_exists', dockProfile.status === 'resolved', {
      dock: selectedDock,
      profile_path: dockProfile.profile_path ?? null,
      reason: dockProfile.reason ?? null,
    }),
    validationRecord('selected_provider_supported_without_launch', provider.status === 'selected_no_provider_launch', {
      selected_provider: provider.selected_provider,
      reason: provider.status === 'selected_no_provider_launch' ? null : provider.status,
    }),
    validationRecord('provider_binary_not_in_command', !PROVIDER_BINARY_PATTERN.test(command), {
      command,
    }),
  ];

  return {
    repoRoot,
    packetPath,
    packet,
    packetId,
    sourceArtifact,
    requiredStartRef,
    source,
    refResolution,
    selectedDock,
    dockProfile,
    worktree,
    cwdPath,
    provider,
    gitFacts,
    resultRoutes,
    launchRoot,
    intendedLaunchCwd,
    schedulerRunId,
    dispatchAttemptId,
    action,
    idempotenceKey,
    command,
    catalogFixture,
    allCwdCatalogFixture,
    providerSessionId: options.providerSessionId ?? NOT_OBSERVED,
    launchObservedAt: options.launchObservedAt ?? options.timestamp ?? NOT_OBSERVED,
    validations,
  };
}

function initialRecord(context, timestamp) {
  const validationFailed = context.validations.some((validation) => validation.status !== 'passed');
  return {
    record_type: 'aos.afk_launch_attempt',
    schema_status: 'not_a_schema',
    launch_attempt_id: `launch-attempt-${context.idempotenceKey.slice(0, 16)}`,
    scheduler_run_id: context.schedulerRunId,
    dispatch_attempt_id: context.dispatchAttemptId,
    idempotence_key: context.idempotenceKey,
    created_at: timestamp,
    updated_at: timestamp,
    lifecycle_state: validationFailed ? 'rejected' : 'requested',
    duplicate_handling: {
      duplicate: false,
      bridge_session_started: false,
      reused_launch_attempt_id: NOT_APPLICABLE_NO_PROVIDER,
    },
    validations: context.validations,
    transfer: {
      packet_id_or_ref: context.packetId ?? 'missing_with_reason: packet id/ref is required',
      source_event_or_artifact: context.sourceArtifact ?? 'missing_with_reason: source_artifact not supplied',
      result_route_refs: context.resultRoutes.length > 0 ? context.resultRoutes : NOT_OBSERVED,
      required_start_ref: context.requiredStartRef ?? 'missing_with_reason: required_start_ref not supplied',
      start_ref_sha: context.refResolution.sha ?? 'missing_with_reason: required_start_ref did not resolve',
      external_publication_policy: context.packet.external_publication_policy
        ?? context.packet.externalPublicationPolicy
        ?? 'local-only',
    },
    selection: {
      selected_provider: context.provider.selected_provider,
      provider_selection_source: context.provider.provider_selection_source,
      selected_dock: context.selectedDock,
      dock_role_kind: context.dockProfile.role ?? context.selectedDock,
      dock_profile_ref: context.dockProfile.profile_path ?? `.docks/${context.selectedDock}/dock.json`,
      launch_root: context.launchRoot,
    },
    launch_intent: {
      action: context.action,
      intended_worktree: context.worktree,
      intended_launch_cwd: context.intendedLaunchCwd,
      intended_branch: context.gitFacts.branch,
      intended_head: context.gitFacts.head,
      command_argv: ['node', '-e', '<harmless marker command>'],
      command: context.command,
      command_env_refs: [
        'SIGIL_AGENT_TERMINAL_DRIVER=process',
        'SIGIL_AGENT_COMMAND=<harmless-node-command>',
      ],
      deadline_or_lease: context.packet.timeout_or_lease ?? context.packet.timeoutOrLease ?? NOT_OBSERVED,
      launch_requested: true,
      launch_performed: false,
      provider_launch_performed: false,
    },
    terminal_substrate: {
      status: NOT_OBSERVED,
      driver: NOT_OBSERVED,
      session_handle: NOT_OBSERVED,
      cwd: NOT_OBSERVED,
      command: NOT_OBSERVED,
      snapshot_ref: NOT_OBSERVED,
    },
    provider_acceptance: {
      status: NOT_APPLICABLE_NO_PROVIDER,
      provider_session_id: NOT_APPLICABLE_NO_PROVIDER,
      provider_reported_cwd: NOT_APPLICABLE_NO_PROVIDER,
      provider_reported_branch: NOT_APPLICABLE_NO_PROVIDER,
      provider_reported_head: NOT_APPLICABLE_NO_PROVIDER,
      provider_version: NOT_APPLICABLE_NO_PROVIDER,
      model: NOT_APPLICABLE_NO_PROVIDER,
    },
    catalog: {
      status: NOT_OBSERVED,
      catalog_record_refs: NOT_OBSERVED,
      match_count: NOT_OBSERVED,
      matched_session_id: NOT_OBSERVED,
      source_file: NOT_OBSERVED,
      resume_command: NOT_OBSERVED,
    },
    telemetry: {
      status: NOT_OBSERVED,
      telemetry_event_refs: NOT_OBSERVED,
      lifecycle_event_refs: NOT_OBSERVED,
      capability_event_refs: NOT_OBSERVED,
      mismatch_refs: [],
    },
    result_route: {
      status: NOT_ATTEMPTED,
      attempt_refs: [],
      delivered_refs: [],
      failure: NOT_OBSERVED,
    },
    mismatches: context.provider.mismatch_facts.map((fact) => ({
      code: fact.split(':')[0],
      severity: 'error',
      observed_at: timestamp,
      source: 'dispatch',
      expected: { supported_providers: [...SUPPORTED_PROVIDERS] },
      observed: { selected_provider: context.provider.selected_provider },
      effect: 'rejected',
      evidence_ref: 'inline:validations',
    })),
    evidence: {
      required_before_completed: [],
      observed_refs: [],
    },
  };
}

async function createLaunchAttempt(options) {
  const context = await buildAttemptContext(options);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const existing = attemptRegistry.get(context.idempotenceKey);
  if (existing) {
    const duplicate = structuredClone(existing);
    duplicate.updated_at = timestamp;
    duplicate.duplicate_handling = {
      duplicate: true,
      bridge_session_started: false,
      reused_launch_attempt_id: existing.launch_attempt_id,
    };
    duplicate.lifecycle_state = existing.lifecycle_state;
    return duplicate;
  }

  const record = initialRecord(context, timestamp);
  attemptRegistry.set(context.idempotenceKey, structuredClone(record));

  const validationFailed = context.validations.some((validation) => validation.status !== 'passed');
  if (validationFailed) {
    record.result_route.status = NOT_ATTEMPTED;
    attemptRegistry.set(context.idempotenceKey, structuredClone(record));
    return record;
  }

  const observed = await observeTerminalSubstrate({
    repoRoot: context.repoRoot,
    idempotenceKey: context.idempotenceKey,
    launchCwd: context.intendedLaunchCwd,
    command: context.command,
  });
  const catalogTelemetry = classifyCatalogAndTelemetry({
    sessions: context.catalogFixture,
    allCwdSessions: context.allCwdCatalogFixture,
    provider: context.provider.selected_provider,
    cwd: context.intendedLaunchCwd,
    launchObservedAt: context.launchObservedAt,
    providerSessionId: context.providerSessionId,
  });
  record.terminal_substrate = observed.terminal_substrate;
  if (catalogTelemetry.provider_acceptance) {
    record.provider_acceptance = {
      ...record.provider_acceptance,
      ...catalogTelemetry.provider_acceptance,
    };
  }
  record.catalog = context.catalogFixture ? catalogTelemetry.catalog : {
    ...record.catalog,
    status: observed.catalog_status,
  };
  record.telemetry = context.catalogFixture ? catalogTelemetry.telemetry : {
    ...record.telemetry,
    status: observed.telemetry_status,
  };
  record.mismatches.push(...catalogTelemetry.mismatches.map((mismatch) => ({
    observed_at: timestamp,
    ...mismatch,
  })));
  record.lifecycle_state = 'provider_acceptance_unobserved';
  record.launch_intent.launch_performed = true;
  record.duplicate_handling.bridge_session_started = observed.bridge_session_started;
  record.evidence.observed_refs = ['inline:terminal_substrate.snapshot_summary'];
  record.updated_at = timestamp;
  attemptRegistry.set(context.idempotenceKey, structuredClone(record));
  return record;
}

function exitCodeFor(record) {
  return record.lifecycle_state === 'rejected' ? 1 : 0;
}

function toMarkdown(record) {
  return `# Experimental AFK Launch Attempt

launch_attempt_id: ${record.launch_attempt_id}
created_at: ${record.created_at}
lifecycle_state: ${record.lifecycle_state}

This record is experimental local prototype output and is not a schema.

\`\`\`json
${JSON.stringify(record, null, 2)}
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

    const record = await createLaunchAttempt(options);
    const output = options.json ? JSON.stringify(record, null, 2) : toMarkdown(record);
    if (options.out) {
      await writeFile(options.out, `${output}\n`, 'utf8');
    }

    let finalOutput = output;
    let finalExitCode = exitCodeFor(record);
    if (options.duplicateInProcess) {
      const duplicate = await createLaunchAttempt(options);
      const bundle = {
        type: 'aos.afk_launch_attempt.prototype_duplicate_check',
        first: record,
        duplicate,
        bridge_sessions_started: [
          record.duplicate_handling.bridge_session_started,
          duplicate.duplicate_handling.bridge_session_started,
        ].filter(Boolean).length,
      };
      finalOutput = JSON.stringify(bundle, null, 2);
      finalExitCode = Math.max(finalExitCode, exitCodeFor(duplicate));
      if (options.out) {
        await writeFile(options.out, `${finalOutput}\n`, 'utf8');
      }
    }

    process.stdout.write(`${finalOutput}\n`);
    process.exitCode = finalExitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      record_type: 'aos.afk_launch_attempt',
      schema_status: 'not_a_schema',
      lifecycle_state: 'failed',
      error: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

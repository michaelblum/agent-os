#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultProofRegistryPath,
  evaluateProofWorth,
  loadProofRegistry,
  proofWorthFailureCode,
} from './lib/dev-test-proof-registry.mjs';

const workflowDefaultManifest = 'docs/dev/workflow-rules.json';
const capabilitiesDefaultManifest = 'docs/dev/agent-capabilities.json';
const workflowRuleID = 'dev-workflow-manifest';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function error(message, code) {
  process.stderr.write(`{\n  "code" : "${code}",\n  "error" : "${message}"\n}\n`);
  process.exit(1);
}

function runGit(args, cwd) {
  const result = spawnSync('/usr/bin/git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return {
    status: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? result.error.message : ''),
    stdoutLines: (result.stdout ?? '').split(/\r?\n/).filter(Boolean),
  };
}

function resolveRepoRoot(requested) {
  const start = path.resolve(requested || process.cwd());
  const result = runGit(['rev-parse', '--show-toplevel'], start);
  if (result.status === 0 && result.stdoutLines[0]) return path.resolve(result.stdoutLines[0]);
  return start;
}

function resolveUnderRepo(requested, repoRoot, fallback) {
  if (!requested) return path.join(repoRoot, fallback);
  const expanded = requested.startsWith('~') ? path.join(process.env.HOME || '', requested.slice(1)) : requested;
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(repoRoot, expanded));
}

function normalizeRepoRelative(value, repoRoot) {
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(value);
  if (resolved === root) return '.';
  if (resolved.startsWith(`${root}${path.sep}`)) return resolved.slice(root.length + 1);
  if (value.startsWith('./')) return value.slice(2);
  return value;
}

function readJSON(file, missingCode, invalidCode, label = 'JSON file') {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    error(`Missing ${label}: ${file}`, missingCode);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      error(`Invalid ${label} ${file}: expected JSON object`, invalidCode);
    }
    return parsed;
  } catch (err) {
    error(`Invalid ${label} ${file}: ${err.message}`, invalidCode);
  }
}

function parseCommon(args, allowed, positionalMode = 'collect') {
  const options = { json: false, positionals: [] };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (allowed[arg]) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) error(`${arg} requires ${allowed[arg]}`, 'MISSING_ARG');
      options[allowed[arg].replace(/ .*/, '').replaceAll('-', '_')] = args[i + 1];
      i += 2;
    } else if (arg.startsWith('--')) {
      error(`Unknown maintainer workflow flag: ${arg}`, 'UNKNOWN_FLAG');
    } else if (positionalMode === 'collect') {
      options.positionals.push(arg);
      i += 1;
    } else {
      error(`Unknown maintainer workflow argument: ${arg}`, 'UNKNOWN_ARG');
    }
  }
  return options;
}

function parseWorkflowOptions(args) {
  const options = { json: false, files: [] };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    switch (arg) {
      case '--json':
        options.json = true; i += 1; break;
      case '--repo':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--repo requires a path', 'MISSING_ARG');
        options.repo = args[i + 1]; i += 2; break;
      case '--base':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--base requires a ref', 'MISSING_ARG');
        options.base = args[i + 1]; i += 2; break;
      case '--manifest':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--manifest requires a path', 'MISSING_ARG');
        options.manifest = args[i + 1]; i += 2; break;
      case '--paths':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--paths requires a comma-separated path list', 'MISSING_ARG');
        options.files.push(...args[i + 1].split(',').filter(Boolean)); i += 2; break;
      case '--files': {
        i += 1;
        let consumed = false;
        while (i < args.length && !args[i].startsWith('--')) {
          options.files.push(args[i]);
          consumed = true;
          i += 1;
        }
        if (!consumed) error('--files requires at least one path', 'MISSING_ARG');
        break;
      }
      default:
        if (arg.startsWith('--')) error(`Unknown maintainer workflow flag: ${arg}`, 'UNKNOWN_FLAG');
        options.files.push(arg); i += 1;
    }
  }
  return options;
}

function parseAuditOptions(args) {
  const options = { json: false };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    switch (arg) {
      case '--json':
        options.json = true; i += 1; break;
      case '--repo':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--repo requires a path', 'MISSING_ARG');
        options.repo = args[i + 1]; i += 2; break;
      case '--manifest':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--manifest requires a path', 'MISSING_ARG');
        options.manifest = args[i + 1]; i += 2; break;
      default:
        error(`Unknown maintainer workflow audit flag: ${arg}`, 'UNKNOWN_FLAG');
    }
  }
  return options;
}

function unique(input) {
  const seen = new Set();
  return input.filter((item) => item && !seen.has(item) && seen.add(item));
}

function splitNul(value) {
  return value.split('\0').filter(Boolean);
}

function gitDiffFiles(base, repoRoot, strict = false) {
  const result = runGit(['diff', '--name-only', '-z', '--diff-filter=ACDMRTUXB', base, '--'], repoRoot);
  if (result.status !== 0) {
    if (strict) {
      const detail = result.stderr.trim();
      error(`Invalid dev workflow diff base '${base}'${detail ? `: ${detail}` : '.'}`, 'INVALID_BASE_REF');
    }
    return [];
  }
  return splitNul(result.stdout);
}

function gitStatusFiles(repoRoot, untrackedOnly) {
  const result = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot);
  if (result.status !== 0) return [];
  const parts = splitNul(result.stdout);
  const out = [];
  for (let i = 0; i < parts.length;) {
    const record = parts[i];
    if (record.length < 4) { i += 1; continue; }
    const status = record.slice(0, 2);
    const itemPath = record.slice(3);
    const isUntracked = status === '??';
    if ((status.includes('R') || status.includes('C')) && i + 1 < parts.length) {
      if (!untrackedOnly || isUntracked) out.push(itemPath);
      i += 2;
      continue;
    }
    if (!untrackedOnly || isUntracked) out.push(itemPath);
    i += 1;
  }
  return unique(out);
}

function resolveChangedFiles(options, repoRoot) {
  if (options.files.length) return { files: options.files, base: 'explicit' };
  if (options.base) {
    return {
      files: unique([...gitDiffFiles(options.base, repoRoot, true), ...gitStatusFiles(repoRoot, true)]),
      base: options.base,
    };
  }
  const dirty = gitStatusFiles(repoRoot, false);
  if (dirty.length) return { files: dirty, base: 'working-tree' };
  if (runGit(['rev-parse', '--verify', '--quiet', 'origin/main'], repoRoot).status === 0) {
    const mergeBase = runGit(['merge-base', 'HEAD', 'origin/main'], repoRoot).stdoutLines[0];
    if (mergeBase) return { files: gitDiffFiles(mergeBase, repoRoot), base: mergeBase };
  }
  const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot).stdoutLines[0];
  if (upstream) {
    const mergeBase = runGit(['merge-base', 'HEAD', upstream], repoRoot).stdoutLines[0];
    if (mergeBase) return { files: gitDiffFiles(mergeBase, repoRoot), base: mergeBase };
  }
  return { files: gitDiffFiles('HEAD', repoRoot), base: 'HEAD' };
}

function globToRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length;) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 3; }
        else { out += '.*'; i += 2; }
      } else { out += '[^/]*'; i += 1; }
    } else if (ch === '?') {
      out += '[^/]'; i += 1;
    } else {
      out += ch.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'); i += 1;
    }
  }
  return out;
}

function globMatches(pattern, itemPath) {
  if (pattern === '**') return true;
  return new RegExp(`^${globToRegex(pattern)}$`).test(itemPath);
}

function classifyFiles(files, manifest, repoRoot) {
  return unique(files.map((file) => normalizeRepoRelative(file, repoRoot))).filter(Boolean).map((itemPath) => {
    const matches = (manifest.rules || []).filter((rule) => (rule.patterns || []).some((pattern) => globMatches(pattern, itemPath)));
    return { path: itemPath, rules: matches.length ? matches : [manifest.fallback].filter(Boolean) };
  });
}

function aggregateSteps(items) {
  const order = [];
  const map = new Map();
  for (const { step, ruleID } of items) {
    if (!step.command) continue;
    if (map.has(step.command)) {
      const existing = map.get(step.command);
      if (!existing.source_rules.includes(ruleID)) existing.source_rules.push(ruleID);
    } else {
      order.push(step.command);
      const out = { command: step.command, reason: step.reason, source_rules: [ruleID] };
      if (step.id) out.id = step.id;
      map.set(step.command, out);
    }
  }
  return order.map((key) => map.get(key));
}

function aggregateWorkflow(classified) {
  const rules = classified.flatMap((file) => file.rules);
  const commands = aggregateSteps(rules.flatMap((rule) => (rule.commands || []).map((step) => ({ step, ruleID: rule.id }))));
  const verification = aggregateSteps(rules.flatMap((rule) => (rule.verification || []).map((step) => ({ step, ruleID: rule.id }))));
  const actions = unique(rules.flatMap((rule) => rule.actions || []));
  return {
    changed_file_count: classified.length,
    rule_ids: unique(rules.map((rule) => rule.id)),
    classes: unique(rules.flatMap((rule) => rule.classes || [])),
    actions,
    hot_swappable: !rules.some((rule) => rule.hot_swappable === false),
    requires_swift_build: actions.includes('swift_build'),
    tcc_identity_sensitive: rules.some((rule) => rule.tcc_identity_sensitive === true),
    commands,
    verification,
    notes: unique(rules.flatMap((rule) => rule.notes || [])),
  };
}

function buildProofWorth(files, repoRoot) {
  try {
    const loaded = loadProofRegistry({ repoRoot, registryPath: defaultProofRegistryPath });
    return evaluateProofWorth({
      changedFiles: files,
      repoRoot,
      registry: loaded.registry,
      registryPath: loaded.relativePath,
    });
  } catch (err) {
    return {
      status: 'failed',
      passed: false,
      failed: true,
      code: proofWorthFailureCode,
      registry: defaultProofRegistryPath,
      changed_asset_count: 0,
      assets: [],
      commands: [],
      guarded: [],
      failures: [
        {
          path: defaultProofRegistryPath,
          kind: 'proof_registry',
          reason: err.code || 'invalid_proof_registry',
          entries: [],
          message: err.message,
        },
      ],
    };
  }
}

function buildClassification(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const manifestPath = resolveUnderRepo(options.manifest, repoRoot, workflowDefaultManifest);
  const manifest = readJSON(manifestPath, 'MISSING_MANIFEST', 'INVALID_MANIFEST', 'maintainer workflow manifest');
  const changed = resolveChangedFiles(options, repoRoot);
  const files = unique(changed.files.map((file) => normalizeRepoRelative(file, repoRoot))).filter(Boolean);
  const classified = classifyFiles(files, manifest, repoRoot);
  const proofWorth = buildProofWorth(files, repoRoot);
  return {
    status: 'success',
    manifest: normalizeRepoRelative(manifestPath, repoRoot),
    manifest_schema_version: manifest.schema_version,
    repo: repoRoot,
    diff_base: changed.base,
    changed_files: files,
    files: classified.map((file) => ({
      path: file.path,
      rules: file.rules.map((rule) => rule.id),
      classes: unique(file.rules.flatMap((rule) => rule.classes || [])),
      actions: unique(file.rules.flatMap((rule) => rule.actions || [])),
      hot_swappable: !file.rules.some((rule) => rule.hot_swappable === false),
      tcc_identity_sensitive: file.rules.some((rule) => rule.tcc_identity_sensitive === true),
    })),
    summary: aggregateWorkflow(classified),
    proof_worth: proofWorth,
  };
}

function mergeRecommendationSteps(baseSteps, proofCommands) {
  const order = [];
  const map = new Map();
  const add = (step, sourceRule) => {
    if (!step?.command) return;
    if (map.has(step.command)) {
      const existing = map.get(step.command);
      for (const rule of step.source_rules || [sourceRule].filter(Boolean)) {
        if (rule && !existing.source_rules.includes(rule)) existing.source_rules.push(rule);
      }
      return;
    }
    order.push(step.command);
    map.set(step.command, {
      command: step.command,
      reason: step.reason,
      source_rules: step.source_rules ? step.source_rules.slice() : [sourceRule].filter(Boolean),
      ...(step.id ? { id: step.id } : {}),
    });
  };

  for (const step of baseSteps || []) add(step, null);
  for (const command of proofCommands || []) {
    add({
      command: command.command,
      reason: command.reason,
      source_rules: (command.source_entries || []).map((entry) => `proof:${entry}`),
    }, 'proof-registry');
  }

  return order.map((key) => map.get(key));
}

function proofWorthSuppressesGenericTestFallback(proofWorth) {
  return proofWorth?.status === 'passed' && (proofWorth.assets || []).length > 0;
}

function buildRecommendation(classification) {
  const proofWorth = classification.proof_worth || null;
  const verification = proofWorthSuppressesGenericTestFallback(proofWorth)
    ? (classification.summary?.verification || []).filter((step) => step.command !== 'bash <changed-test>')
    : (classification.summary?.verification || []);
  const nextCommands = mergeRecommendationSteps(classification.summary?.commands || [], proofWorth?.commands || []);
  const failed = proofWorth?.status === 'failed';
  return {
    status: failed ? 'failed' : 'success',
    ...(failed ? { code: proofWorthFailureCode } : {}),
    manifest: classification.manifest || workflowDefaultManifest,
    repo: classification.repo || process.cwd(),
    diff_base: classification.diff_base ?? null,
    changed_files: classification.changed_files || [],
    next_commands: nextCommands,
    verification,
    notes: classification.summary?.notes || [],
    summary: classification.summary || {},
    proof_worth: proofWorth,
  };
}

function compactCapability(capability) {
  const adapter = capability.adapter || {};
  const mutability = capability.mutability || {};
  const execution = capability.execution || {};
  return {
    id: capability.id ?? null,
    label: capability.label ?? null,
    summary: capability.summary ?? null,
    status: capability.status ?? null,
    roles: capability.roles || [],
    entry_paths: capability.entry_paths || [],
    adapter_kind: adapter.kind ?? null,
    command: adapter.command || [],
    mutability_class: mutability.class ?? null,
    requires_explicit_assignment: mutability.requires_explicit_assignment ?? null,
    requires_human_approval: mutability.requires_human_approval ?? null,
    requires_body_file: mutability.requires_body_file ?? null,
    raw_process: execution.raw_process ?? null,
    cwd_policy: execution.cwd_policy ?? null,
    timeout_seconds: execution.timeout_seconds ?? null,
    audit: execution.audit ?? null,
  };
}

function parseCapabilitiesOptions(args) {
  return parseCommon(args, {
    '--repo': 'repo path',
    '--manifest': 'manifest path',
    '--role': 'role legacy compatibility filter',
    '--entry-path': 'entry-path entry path',
  });
}

function loadCapabilityManifest(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const manifestPath = resolveUnderRepo(options.manifest, repoRoot, capabilitiesDefaultManifest);
  const manifest = readJSON(manifestPath, 'MISSING_MANIFEST', 'INVALID_MANIFEST', 'maintainer capability manifest');
  return { repoRoot, path: manifestPath, manifest, capabilities: manifest.capabilities || [] };
}

function filterCapabilities(capabilities, options) {
  return capabilities.filter((capability) => {
    if (options.role && (capability.roles || []).length && !(capability.roles || []).includes(options.role)) return false;
    if (options.entry_path && !(capability.entry_paths || []).includes(options.entry_path)) return false;
    return true;
  });
}

function capabilitiesCommand(action, args) {
  const options = parseCapabilitiesOptions(args);
  if (action === 'list') {
    if (options.positionals.length) error('maintainer capabilities list does not accept positional arguments', 'UNKNOWN_ARG');
    const loaded = loadCapabilityManifest(options);
    const capabilities = filterCapabilities(loaded.capabilities, options);
    const payload = {
      status: 'success',
      manifest: normalizeRepoRelative(loaded.path, loaded.repoRoot),
      manifest_id: loaded.manifest.id ?? null,
      manifest_schema_version: loaded.manifest.schema_version ?? null,
      role: options.role ?? null,
      entry_path: options.entry_path ?? null,
      count: capabilities.length,
      capabilities: capabilities.map(compactCapability),
    };
    options.json ? printJSON(payload) : printCapabilitiesList(payload);
    return;
  }
  if (action === 'explain') {
    if (options.positionals.length === 0) error('maintainer capabilities explain requires exactly one capability id', 'MISSING_ARG');
    if (options.positionals.length > 1) error(`Unknown maintainer capabilities argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const loaded = loadCapabilityManifest(options);
    const capability = loaded.capabilities.find((item) => item.id === options.positionals[0]);
    if (!capability) error(`Unknown capability id: ${options.positionals[0]}`, 'UNKNOWN_CAPABILITY');
    const payload = {
      status: 'success',
      manifest: normalizeRepoRelative(loaded.path, loaded.repoRoot),
      manifest_id: loaded.manifest.id ?? null,
      manifest_schema_version: loaded.manifest.schema_version ?? null,
      capability,
    };
    options.json ? printJSON(payload) : printCapabilityExplain(payload);
    return;
  }
  error(`Unknown maintainer capabilities subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
}

function subagentCommand(action, args) {
  void action;
  void args;
  error("maintainer subagent is retired for agent-os; use repo-root sessions, DOX, and installable AOS skills instead", "RETIRED_SUBAGENT_COMMAND");
}

function claim(id, claimText, passed, expected, observed, evidence, next) {
  const out = { id, claim: claimText, status: passed ? 'passed' : 'failed', expected, observed, evidence };
  if (!passed && next) out.next = next;
  return out;
}

function auditRegistryClaims(repoRoot) {
  const registryPath = path.join(repoRoot, 'manifests/commands/aos-commands.json');
  const registry = readJSON(registryPath, 'MISSING_COMMAND_REGISTRY', 'INVALID_COMMAND_REGISTRY', 'command registry');
  const dev = (registry.commands || []).find((command) => command.path?.join(' ') === 'dev');
  const externalRegistryPath = path.join(repoRoot, 'manifests/commands/aos-external-commands.json');
  const externalRegistry = readJSON(externalRegistryPath, 'MISSING_EXTERNAL_COMMAND_REGISTRY', 'INVALID_EXTERNAL_COMMAND_REGISTRY', 'external command registry');
  const externalDev = (externalRegistry.commands || []).filter((command) => command.path?.[0] === 'dev');
  return [
    claim('dev-help-registry-absent', 'The generated AOS help registry does not expose a dev command.', !dev, 'no command path dev', dev ? `present with ${(dev.forms || []).length} forms` : 'absent', ['manifests/commands/aos-commands.json'], 'Remove dev command source fragments and regenerate command manifests.'),
    claim('dev-external-routes-absent', 'The generated external command registry does not dispatch dev routes.', externalDev.length === 0, 'no external paths beginning with dev', externalDev.map((command) => command.path.join(' ')).join(',') || 'absent', ['manifests/commands/aos-external-commands.json'], 'Remove external dev routes and use repo-local maintainer scripts directly.'),
  ];
}

function auditWorkflowManifestClaims(manifest) {
  const rule = (manifest.rules || []).find((item) => item.id === workflowRuleID);
  if (!rule) return [claim('dev-workflow-self-routes', 'The maintainer workflow manifest routes its own scripts, registry, and tests.', false, workflowRuleID, 'missing', [workflowDefaultManifest], `Add a ${workflowRuleID} rule to the workflow manifest.`)];
  const expectedPatterns = ['docs/dev/workflow-rules.json', 'docs/dev/agent-capabilities.json', 'docs/dev/test-proof-registry.json', 'scripts/aos-dev-workflow.mjs', 'scripts/aos-dev-situation.mjs', 'scripts/aos-dev-drift-lint.mjs', 'scripts/lib/dev-test-proof-registry.mjs', 'shared/schemas/dev-test-proof-registry.schema.json', 'shared/schemas/fixtures/dev-test-proof-registry/**', 'tests/dev-workflow-router.sh', 'tests/dev-audit.sh', 'tests/dev-situation.sh', 'tests/dev-drift-lint.sh', 'tests/schemas/dev-test-proof-registry.test.mjs', 'tests/schemas/dev-workflow-rules.test.mjs'];
  const expectedCommands = ['node --test tests/schemas/dev-test-proof-registry.test.mjs', 'node --test tests/schemas/dev-workflow-rules.test.mjs', 'bash tests/dev-workflow-router.sh', 'bash tests/dev-audit.sh', 'bash tests/dev-situation.sh', 'bash tests/dev-drift-lint.sh'];
  const patterns = rule.patterns || [];
  const commands = (rule.commands || []).map((item) => item.command);
  return [
    claim('dev-workflow-self-routes', 'The maintainer workflow manifest routes its own scripts, registry, and tests.', expectedPatterns.every((item) => patterns.includes(item)), expectedPatterns.slice().sort().join(','), patterns.slice().sort().join(','), [workflowDefaultManifest], `Add missing maintainer workflow source/test patterns to ${workflowDefaultManifest}.`),
    claim('dev-workflow-self-verifies', 'The maintainer workflow rule recommends schema, router, and audit verification.', expectedCommands.every((item) => commands.includes(item)), expectedCommands.slice().sort().join(','), commands.slice().sort().join(','), [workflowDefaultManifest], `Add missing verification commands to the ${workflowRuleID} rule.`),
  ];
}

function auditExplicitRecommendationClaims(manifest, repoRoot) {
  const summary = aggregateWorkflow(classifyFiles(['docs/guides/example.md'], manifest, repoRoot));
  const passed = JSON.stringify(summary.rule_ids) === JSON.stringify(['docs-only']) && summary.commands.length === 0 && summary.verification.length === 0;
  return [claim('dev-recommend-explicit-files', 'The router can classify explicit docs-only file input without runtime work.', passed, 'rule_ids=docs-only; commands=0; verification=0', `rule_ids=${summary.rule_ids.join(',')}; commands=${summary.commands.length}; verification=${summary.verification.length}`, ['node scripts/aos-dev-workflow.mjs recommend --json --files docs/guides/example.md'], 'Fix maintainer workflow matching so explicit file input does not trigger unrelated runtime loops.')];
}

function auditCommand(args) {
  const options = parseAuditOptions(args);
  const repoRoot = resolveRepoRoot(options.repo);
  const defaultManifestPath = resolveUnderRepo(null, repoRoot, workflowDefaultManifest);
  const selectedManifestPath = resolveUnderRepo(options.manifest, repoRoot, workflowDefaultManifest);
  const selectedManifestRelative = normalizeRepoRelative(selectedManifestPath, repoRoot);
  const claims = [];
  const defaultManifestRelative = normalizeRepoRelative(defaultManifestPath, repoRoot);
  claims.push(claim('dev-default-manifest-path', 'The maintainer workflow router default manifest path is canonical.', defaultManifestRelative === workflowDefaultManifest, workflowDefaultManifest, defaultManifestRelative, ['scripts/aos-dev-workflow.mjs:workflowDefaultManifest'], `Update workflowDefaultManifest to use ${workflowDefaultManifest}.`));
  const manifestExists = fs.existsSync(selectedManifestPath);
  claims.push(claim('dev-manifest-readable', 'The selected maintainer workflow manifest exists on disk.', manifestExists, `exists=true at ${selectedManifestRelative}`, `exists=${manifestExists}`, [selectedManifestRelative], 'Restore the manifest or pass --manifest <path> to a valid rules file.'));
  let manifest = null;
  if (manifestExists) {
    try {
      manifest = JSON.parse(fs.readFileSync(selectedManifestPath, 'utf8'));
      claims.push(claim('dev-manifest-decodes', 'The selected maintainer workflow manifest decodes as schema version 1.', manifest.schema_version === 1, 'schema_version=1', `schema_version=${manifest.schema_version}`, [selectedManifestRelative, 'shared/schemas/dev-workflow-rules.schema.json'], 'Run node --test tests/schemas/dev-workflow-rules.test.mjs.'));
    } catch (err) {
      claims.push(claim('dev-manifest-decodes', 'The selected maintainer workflow manifest decodes as schema version 1.', false, 'valid schema_version=1 manifest', err.message, [selectedManifestRelative, 'shared/schemas/dev-workflow-rules.schema.json'], 'Run node --test tests/schemas/dev-workflow-rules.test.mjs.'));
    }
  } else {
    claims.push(claim('dev-manifest-decodes', 'The selected maintainer workflow manifest decodes as schema version 1.', false, 'valid schema_version=1 manifest', `missing: ${selectedManifestPath}`, [selectedManifestRelative, 'shared/schemas/dev-workflow-rules.schema.json'], 'Run node --test tests/schemas/dev-workflow-rules.test.mjs.'));
  }
  claims.push(...auditRegistryClaims(repoRoot));
  if (manifest) {
    claims.push(...auditWorkflowManifestClaims(manifest));
    claims.push(...auditExplicitRecommendationClaims(manifest, repoRoot));
  } else {
    claims.push(claim('dev-workflow-self-routes', 'The maintainer workflow manifest routes its own scripts, registry, and tests.', false, `decoded manifest with ${workflowRuleID} rule`, 'manifest did not decode', [selectedManifestRelative], 'Fix the manifest before trusting maintainer workflow routing.'));
    claims.push(claim('dev-recommend-explicit-files', 'The router can classify explicit docs-only file input without runtime work.', false, 'docs-only route with no commands or verification', 'manifest did not decode', [selectedManifestRelative], 'Fix the manifest before trusting maintainer workflow recommendations.'));
  }
  const passed = claims.filter((item) => item.status === 'passed').length;
  const failed = claims.length - passed;
  const payload = {
    status: failed === 0 ? 'success' : 'failed',
    subject: 'maintainer-workflow',
    repo: repoRoot,
    manifest: selectedManifestRelative,
    claims,
    summary: { total: claims.length, passed, failed },
    next: failed === 0 ? 'No maintainer workflow repair needed.' : 'node scripts/aos-dev-build.mjs build --force --no-restart --json && bash tests/dev-audit.sh',
  };
  options.json ? printJSON(payload) : printAuditText(payload);
  process.exit(failed === 0 ? 0 : 1);
}

function printClassification(payload) {
  process.stdout.write(`Changed files: ${payload.changed_files.length}\n`);
  process.stdout.write(`Classes: ${(payload.summary.classes || []).join(', ')}\n`);
  process.stdout.write(`Actions: ${(payload.summary.actions || []).join(', ')}\n`);
  if (payload.summary.tcc_identity_sensitive) process.stdout.write('Risk: tcc_identity_sensitive\n');
}

function printRecommendation(payload) {
  if (payload.status === 'failed') process.stdout.write(`Status: failed (${payload.code || 'UNKNOWN'})\n`);
  process.stdout.write(payload.next_commands.length ? 'Next commands:\n' : 'Next commands: none\n');
  for (const item of payload.next_commands) process.stdout.write(`- ${item.command || ''}\n`);
  process.stdout.write(payload.verification.length ? 'Verification:\n' : 'Verification: none\n');
  for (const item of payload.verification) process.stdout.write(`- ${item.command || ''}\n`);
  if (payload.proof_worth?.status === 'failed') {
    process.stdout.write('Proof worth failures:\n');
    for (const item of payload.proof_worth.failures || []) process.stdout.write(`- ${item.path}: ${item.reason}\n`);
  }
  for (const note of payload.notes) process.stdout.write(`Note: ${note}\n`);
}

function printAuditText(payload) {
  process.stdout.write(`maintainer workflow audit: ${payload.status}\n`);
  for (const item of payload.claims) {
    const marker = item.status === 'passed' ? 'PASS' : 'FAIL';
    process.stdout.write(`${marker} ${item.id} - ${item.claim}\n`);
    if (marker === 'FAIL' && item.next) process.stdout.write(`  Next: ${item.next}\n`);
  }
  if (payload.summary.failed > 0) process.stdout.write(`Next: ${payload.next}\n`);
}

function printCapabilitiesList(payload) {
  process.stdout.write(`maintainer capabilities: ${payload.count}\n`);
  process.stdout.write(`Manifest: ${payload.manifest}\n`);
  for (const capability of payload.capabilities) {
    process.stdout.write(`- ${capability.id || 'unknown'} (${capability.label || capability.id || 'unknown'}): adapter=${capability.adapter_kind || 'unknown'} mutability=${capability.mutability_class || 'unknown'} raw_process=${capability.raw_process || false}\n`);
  }
}

function printCapabilityExplain(payload) {
  const capability = payload.capability;
  process.stdout.write(`${capability.id || 'unknown'} - ${capability.label || capability.id || 'unknown'}\n`);
  if (capability.summary) process.stdout.write(`${capability.summary}\n`);
  process.stdout.write(`Adapter: ${capability.adapter?.kind || 'unknown'}\n`);
  if (capability.adapter?.command?.length) process.stdout.write(`Command: ${capability.adapter.command.join(' ')}\n`);
  process.stdout.write(`Mutability: ${capability.mutability?.class || 'unknown'}\n`);
  process.stdout.write(`Raw process: ${capability.execution?.raw_process || false}\n`);
  process.stdout.write(`Audit: ${capability.execution?.audit || 'unknown'}\n`);
}

const [subcommand, ...rest] = process.argv.slice(2);
if (subcommand === 'classify') {
  const options = parseWorkflowOptions(rest);
  const payload = buildClassification(options);
  options.json ? printJSON(payload) : printClassification(payload);
} else if (subcommand === 'recommend') {
  const options = parseWorkflowOptions(rest);
  const payload = buildRecommendation(buildClassification(options));
  options.json ? printJSON(payload) : printRecommendation(payload);
  if (payload.status === 'failed') process.exit(1);
} else if (subcommand === 'audit') {
  auditCommand(rest);
} else if (subcommand === 'capabilities') {
  const [action, ...args] = rest;
  if (!action) error('maintainer capabilities requires a subcommand', 'MISSING_SUBCOMMAND');
  capabilitiesCommand(action, args);
} else if (subcommand === 'subagent') {
  const [action, ...args] = rest;
  if (!action) error('maintainer subagent requires a subcommand', 'MISSING_SUBCOMMAND');
  subagentCommand(action, args);
} else {
  error(`Unknown maintainer workflow command: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
}

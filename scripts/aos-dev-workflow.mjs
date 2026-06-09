#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workflowDefaultManifest = 'docs/dev/workflow-rules.json';
const capabilitiesDefaultManifest = 'docs/dev/agent-capabilities.json';
const docksDefaultRoot = '.docks';
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
      error(`Unknown dev flag: ${arg}`, 'UNKNOWN_FLAG');
    } else if (positionalMode === 'collect') {
      options.positionals.push(arg);
      i += 1;
    } else {
      error(`Unknown dev argument: ${arg}`, 'UNKNOWN_ARG');
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
        if (arg.startsWith('--')) error(`Unknown dev flag: ${arg}`, 'UNKNOWN_FLAG');
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
        error(`Unknown dev audit flag: ${arg}`, 'UNKNOWN_FLAG');
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

function buildClassification(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const manifestPath = resolveUnderRepo(options.manifest, repoRoot, workflowDefaultManifest);
  const manifest = readJSON(manifestPath, 'MISSING_MANIFEST', 'INVALID_MANIFEST', 'dev workflow manifest');
  const changed = resolveChangedFiles(options, repoRoot);
  const files = unique(changed.files.map((file) => normalizeRepoRelative(file, repoRoot))).filter(Boolean);
  const classified = classifyFiles(files, manifest, repoRoot);
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
  };
}

function buildRecommendation(classification) {
  return {
    status: 'success',
    manifest: classification.manifest || workflowDefaultManifest,
    repo: classification.repo || process.cwd(),
    diff_base: classification.diff_base ?? null,
    changed_files: classification.changed_files || [],
    next_commands: classification.summary?.commands || [],
    verification: classification.summary?.verification || [],
    notes: classification.summary?.notes || [],
    summary: classification.summary || {},
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
    '--role': 'role dock role',
    '--entry-path': 'entry-path entry path',
  });
}

function loadCapabilityManifest(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const manifestPath = resolveUnderRepo(options.manifest, repoRoot, capabilitiesDefaultManifest);
  const manifest = readJSON(manifestPath, 'MISSING_MANIFEST', 'INVALID_MANIFEST', 'dev capability manifest');
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
    if (options.positionals.length) error('dev capabilities list does not accept positional arguments', 'UNKNOWN_ARG');
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
    if (options.positionals.length === 0) error('dev capabilities explain requires exactly one capability id', 'MISSING_ARG');
    if (options.positionals.length > 1) error(`Unknown dev capabilities argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
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
  error(`Unknown dev capabilities subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
}

function parseDocksOptions(args) {
  return parseCommon(args, {
    '--repo': 'repo path',
    '--dock-root': 'dock_root path',
    '--capabilities-manifest': 'capabilities_manifest path',
    '--entry-path': 'entry_path entry path',
  });
}

function parseSubagentOptions(args) {
  return parseCommon(args, {
    '--repo': 'repo path',
    '--role': 'role name',
    '--agents-root': 'agents-root path',
    '--prompt': 'prompt text',
    '--prompt-file': 'prompt-file path',
    '--transcript': 'transcript text',
    '--transcript-file': 'transcript-file path',
  }, 'reject');
}

function readTextFile(file, missingCode, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    error(`Missing ${label}: ${file}`, missingCode);
  }
}

function tomlStringValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function developerInstructionPhrases(text) {
  const match = text.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/m);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length >= 20 && line.length <= 180)
    .filter((line) => !line.includes('```') && !line.includes('"""'));
}

function loadSubagentCatalog(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const agentsRoot = resolveUnderRepo(options.agents_root, repoRoot, '.codex/agents');
  if (!fs.existsSync(agentsRoot) || !fs.statSync(agentsRoot).isDirectory()) {
    error(`Missing native Codex agents root: ${agentsRoot}`, 'MISSING_SUBAGENT_ROOT');
  }
  const roles = fs.readdirSync(agentsRoot)
    .filter((entry) => entry.endsWith('.toml'))
    .sort()
    .map((entry) => {
      const agentConfigPath = path.join(agentsRoot, entry);
      const text = readTextFile(agentConfigPath, 'MISSING_SUBAGENT_CONFIG', 'subagent config');
      const role = tomlStringValue(text, 'name') || entry.replace(/\.toml$/, '');
      return {
        role,
        agent_config_path: normalizeRepoRelative(agentConfigPath, repoRoot),
        description: tomlStringValue(text, 'description'),
        model: tomlStringValue(text, 'model'),
        model_reasoning_effort: tomlStringValue(text, 'model_reasoning_effort'),
        sandbox_mode: tomlStringValue(text, 'sandbox_mode'),
      };
    });
  return { repoRoot, agentsRoot, agents_root: normalizeRepoRelative(agentsRoot, repoRoot), roles };
}

function loadSubagentRole(options) {
  if (!options.role) error('dev subagent requires --role <name>', 'MISSING_ROLE');
  const catalog = loadSubagentCatalog(options);
  const role = catalog.roles.find((item) => item.role === options.role);
  if (!role) error(`Unknown subagent role: ${options.role}`, 'UNKNOWN_SUBAGENT_ROLE');
  const repoConfig = path.join(catalog.repoRoot, '.codex', 'config.toml');
  const foremanConfig = path.join(catalog.repoRoot, '.docks', 'foreman', '.codex', 'config.toml');
  const repoConfigText = fs.existsSync(repoConfig) ? fs.readFileSync(repoConfig, 'utf8') : '';
  const foremanConfigText = fs.existsSync(foremanConfig) ? fs.readFileSync(foremanConfig, 'utf8') : '';
  const roleConfigPath = path.join(catalog.repoRoot, role.agent_config_path);
  const roleConfigText = readTextFile(roleConfigPath, 'MISSING_SUBAGENT_CONFIG', 'subagent config');
  return {
    ...catalog,
    role,
    role_config_text: roleConfigText,
    discovery: {
      native_project_agents_dir: role.agent_config_path === `.codex/agents/${role.role}.toml`,
      repo_root_registration: repoConfigText.includes(`[agents.${role.role}]`) && repoConfigText.includes(`config_file = "agents/${role.role}.toml"`),
      foreman_entrypoint_registration: foremanConfigText.includes(`[agents.${role.role}]`) && foremanConfigText.includes(`config_file = "../../../.codex/agents/${role.role}.toml"`),
      no_dock_local_agent_config: !fs.existsSync(path.join(catalog.repoRoot, '.docks', 'foreman', '.codex', 'agents', `${role.role}.toml`)),
    },
  };
}

function resolveOptionalText(options, inlineKey, fileKey, label) {
  const inlineValue = options[inlineKey];
  const fileValue = options[fileKey];
  if (inlineValue && fileValue) error(`Use either --${inlineKey.replaceAll('_', '-')} or --${fileKey.replaceAll('_', '-')}, not both`, 'CONFLICTING_INPUT');
  if (inlineValue) return inlineValue;
  if (fileValue) return readTextFile(path.resolve(fileValue), 'MISSING_INPUT_FILE', label);
  return null;
}

function buildSubagentPlan(options) {
  const loaded = loadSubagentRole(options);
  const prompt = resolveOptionalText(options, 'prompt', 'prompt_file', 'subagent prompt');
  if (!prompt || !prompt.trim()) error('dev subagent plan requires --prompt <text> or --prompt-file <path>', 'MISSING_PROMPT');
  const taskName = loaded.role.role.replace(/[^a-z0-9_-]/g, '_');
  return {
    status: 'success',
    subject: 'subagent-diagnostic-contract',
    dispatch_boundary: {
      canonical_dispatch: 'Codex multi_agent_v2 spawn_agent with task_name plus structured agent_type',
      helper_role: 'diagnostic readback only',
      not_a_launcher: true,
    },
    repo: loaded.repoRoot,
    agents_root: loaded.agents_root,
    role: loaded.role.role,
    agent_config_path: loaded.role.agent_config_path,
    expected: {
      task_name: taskName,
      agent_type: loaded.role.role,
      model: loaded.role.model,
      model_reasoning_effort: loaded.role.model_reasoning_effort,
      sandbox_mode: loaded.role.sandbox_mode,
    },
    native_spawn_contract: {
      tool_argument: {
        task_name: taskName,
        agent_type: loaded.role.role,
        fork_turns: 'none',
      },
      prompt,
      blocked_prompt_prefix: {
        value: `Use the custom agent named ${loaded.role.role}.`,
        reason: 'Prompt text is not a confirmed runtime role binding on multi_agent_v1 and can inherit Foreman model/effort.',
      },
    },
    discovery: loaded.discovery,
    fail_closed_on: [
      'missing registered role selection',
      'default role',
      'Default Started/Stopped voice label',
      'Foreman model/effort inheritance',
      'unverified model/effort or developer-instruction identity evidence',
    ],
    next: `This is diagnostic output only. Dispatch belongs to the live Codex multi_agent_v2 spawn_agent call. Attempt the v2 custom-agent shape with task_name=${taskName} and agent_type=${loaded.role.role}; do NOT use ./aos dev subagent or a prompt prefix as a substitute. If that call is rejected, or the child starts without the requested agent_type/model evidence, emit a subagent-runtime-blocker. Run ./aos dev subagent validate-proof only after a confirmed spawn.`,
  };
}

function transcriptLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function lineMatchesAny(lines, patterns) {
  return lines.filter((line) => patterns.some((pattern) => pattern.test(line)));
}

function buildSubagentProof(options) {
  const loaded = loadSubagentRole(options);
  const transcript = resolveOptionalText(options, 'transcript', 'transcript_file', 'subagent proof transcript');
  if (!transcript || !transcript.trim()) error('dev subagent validate-proof requires --transcript <text> or --transcript-file <path>', 'MISSING_TRANSCRIPT');
  const lines = transcriptLines(transcript);
  const role = loaded.role.role;
  const model = loaded.role.model || '';
  const effort = loaded.role.model_reasoning_effort || '';
  const rolePathName = role.replaceAll('-', '_');
  const rolePatterns = [
    new RegExp(`^\\s*(?:[-•]\\s*)?(?:spawn used|spawn requested with|requested)\\s+agent_type\\s*=\\s*["']?${role}["']?\\b`, 'i'),
    new RegExp(`^\\s*(?:[-•]\\s*)?v2 spawn\\s+task_name\\s*=\\s*["']?[a-z][a-z0-9_-]*["']?\\s+agent_type\\s*=\\s*["']?${role}["']?\\b`, 'i'),
    new RegExp(`/root/${escapeRegExp(rolePathName)}\\b`, 'i'),
  ];
  const prefixPatterns = [
    new RegExp(`^\\s*(?:[-•]\\s*)?(?:└\\s*)?(?:Use|Spawn)\\s+(?:exactly\\s+one\\s+)?(?:the\\s+)?custom\\s+agent\\s+named\\s+${escapeRegExp(role)}\\b`, 'i'),
  ];
  const modelPatterns = model ? [new RegExp(escapeRegExp(model), 'i')] : [];
  const effortPatterns = effort ? [new RegExp(`\\b${escapeRegExp(effort)}\\b`, 'i')] : [];
  const identityPhrases = developerInstructionPhrases(loaded.role_config_text);
  const defaultPatterns = [
    /\bDefault Started\b/i,
    /\bDefault Stopped\b/i,
    /\bAcknowledged Default\b/i,
    /agent_type\s*[:=]\s*["']?default["']?/i,
    /visible spawned role name:\s*(Default|Gibbs)\b/i,
  ];
  const foremanInheritancePatterns = [
    /\bSpawned\b.*\(\s*gpt-5\.5\s+(?:medium|high|xhigh)\s*\)/i,
    /visible spawned model(?: and reasoning effort)?\s*:\s*gpt-5\.5\s*(?:\/|\s)\s*(?:medium|high|xhigh)\b/i,
  ];
  const roleEvidence = lineMatchesAny(lines, rolePatterns);
  const prefixEvidence = lineMatchesAny(lines, prefixPatterns);
  const modelEvidence = lineMatchesAny(lines, modelPatterns);
  const effortEvidence = lineMatchesAny(lines, effortPatterns);
  const identityEvidence = lines.filter((line) => identityPhrases.some((phrase) => line.includes(phrase)));
  const configEvidence = modelEvidence.length && effortEvidence.length ? [...modelEvidence.slice(0, 1), ...effortEvidence.slice(0, 1)] : identityEvidence;
  const defaultEvidence = lineMatchesAny(lines, defaultPatterns);
  const foremanEvidence = lineMatchesAny(lines, foremanInheritancePatterns);
  const claims = [
    {
      id: 'registered-role-selection',
      status: roleEvidence.length && !foremanEvidence.length ? 'passed' : 'failed',
      expected: `structured agent_type=${role}; prompt-prefix text is not accepted as role selection`,
      observed: roleEvidence[0] || (prefixEvidence[0] ? `unsupported prompt prefix: ${prefixEvidence[0]}` : 'missing'),
      evidence: roleEvidence.slice(0, 3),
    },
    {
      id: 'agent-config-identity',
      status: configEvidence.length ? 'passed' : 'failed',
      expected: `visible ${model || 'model'}/${effort || 'effort'} or a developer-instruction identity response`,
      observed: configEvidence[0] || 'missing',
      evidence: configEvidence.slice(0, 3),
    },
    {
      id: 'expected-model-visible',
      status: modelEvidence.length || identityEvidence.length ? 'passed' : 'failed',
      expected: model || 'declared model',
      observed: modelEvidence[0] || (identityEvidence[0] ? `covered by identity smoke: ${identityEvidence[0]}` : 'missing'),
      evidence: modelEvidence.length ? modelEvidence.slice(0, 3) : identityEvidence.slice(0, 3),
    },
    {
      id: 'expected-effort-visible',
      status: effortEvidence.length || identityEvidence.length ? 'passed' : 'failed',
      expected: effort || 'declared effort',
      observed: effortEvidence[0] || (identityEvidence[0] ? `covered by identity smoke: ${identityEvidence[0]}` : 'missing'),
      evidence: effortEvidence.length ? effortEvidence.slice(0, 3) : identityEvidence.slice(0, 3),
    },
    {
      id: 'no-default-role-evidence',
      status: defaultEvidence.length ? 'failed' : 'passed',
      expected: 'no default-role or Gibbs evidence',
      observed: defaultEvidence[0] || 'none',
      evidence: defaultEvidence.slice(0, 3),
    },
    {
      id: 'no-foreman-model-inheritance',
      status: foremanEvidence.length ? 'failed' : 'passed',
      expected: 'no gpt-5.5 Foreman-model spawned child evidence',
      observed: foremanEvidence[0] || 'none',
      evidence: foremanEvidence.slice(0, 3),
    },
  ];
  const failed = claims.filter((item) => item.status === 'failed').length;
  return {
    status: failed ? 'failed' : 'success',
    subject: 'subagent-proof',
    dispatch_boundary: {
      canonical_dispatch: 'Codex multi_agent_v2 spawn_agent with task_name plus structured agent_type',
      helper_role: 'post-spawn proof check only',
      not_a_launcher: true,
    },
    repo: loaded.repoRoot,
    role,
    agent_config_path: loaded.role.agent_config_path,
    expected: {
      task_name: role.replace(/[^a-z0-9_-]/g, '_'),
      agent_type: role,
      blocked_prompt_prefix: `Use the custom agent named ${role}.`,
      model,
      model_reasoning_effort: effort,
    },
    claims,
    summary: {
      total: claims.length,
      passed: claims.length - failed,
      failed,
    },
    next: failed
      ? `Do not fan out. Custom-agent dispatch requires a confirmed multi_agent_v2 spawn with task_name plus agent_type. Do not retry with the prompt prefix; emit a subagent-runtime-blocker if the v2 call is rejected or the child lacks role/model evidence.`
      : 'Subagent role proof accepted for this session; broad fan-out may proceed for the proven role.',
  };
}

function subagentCommand(action, args) {
  const options = parseSubagentOptions(args);
  if (action === 'list') {
    const catalog = loadSubagentCatalog(options);
    const payload = {
      status: 'success',
      repo: catalog.repoRoot,
      agents_root: catalog.agents_root,
      count: catalog.roles.length,
      roles: catalog.roles,
    };
    options.json ? printJSON(payload) : printSubagentList(payload);
    return;
  }
  if (action === 'plan') {
    const payload = buildSubagentPlan(options);
    options.json ? printJSON(payload) : printSubagentPlan(payload);
    return;
  }
  if (action === 'validate-proof') {
    const payload = buildSubagentProof(options);
    options.json ? printJSON(payload) : printSubagentProof(payload);
    process.exit(payload.status === 'success' ? 0 : 1);
  }
  error(`Unknown dev subagent subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
}

function loadDockProfiles(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const dockRoot = resolveUnderRepo(options.dock_root, repoRoot, docksDefaultRoot);
  if (!fs.existsSync(dockRoot) || !fs.statSync(dockRoot).isDirectory()) error(`Missing dock root: ${dockRoot}`, 'MISSING_DOCK_ROOT');
  const profiles = fs.readdirSync(dockRoot)
    .sort()
    .map((entry) => path.join(dockRoot, entry))
    .filter((entryPath) => fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory())
    .map((entryPath) => path.join(entryPath, 'dock.json'))
    .filter((profilePath) => fs.existsSync(profilePath))
    .map((profilePath) => readJSON(profilePath, 'MISSING_DOCK_PROFILE', 'INVALID_DOCK_PROFILE'))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { repoRoot, dockRoot, profiles };
}

function compactDockProfile(profile) {
  return {
    name: profile.name ?? null,
    role: profile.role ?? null,
    harness: profile.harness ?? null,
    summary: profile.summary ?? null,
    default_entry_path: profile.default_entry_path ?? null,
    allowed_entry_paths: profile.allowed_entry_paths || [],
    allowed_capability_classes: profile.allowed_capability_classes || [],
    allowed_capabilities: profile.allowed_capabilities || [],
    requires_explicit_assignment_for: profile.requires_explicit_assignment_for || [],
    requires_goal_prefix: profile.handoff?.requires_goal_prefix ?? null,
  };
}

function resolveDockCapabilities(profile, capabilities, entryPath) {
  const role = profile.role;
  const allowedClasses = new Set(profile.allowed_capability_classes || []);
  const allowedIDs = new Set(profile.allowed_capabilities || []);
  return capabilities.filter((capability) => {
    if (capability.status === 'deprecated') return false;
    if (!capability.id) return false;
    if (allowedIDs.size && !allowedIDs.has(capability.id)) return false;
    if (role && (capability.roles || []).length && !(capability.roles || []).includes(role)) return false;
    if (!(capability.entry_paths || []).includes(entryPath)) return false;
    return allowedClasses.has(capability.mutability?.class);
  });
}

function docksCommand(action, args) {
  const options = parseDocksOptions(args);
  if (action === 'list') {
    if (options.positionals.length) error('dev docks list does not accept positional arguments', 'UNKNOWN_ARG');
    const loaded = loadDockProfiles(options);
    const docks = loaded.profiles.map(compactDockProfile);
    const payload = {
      status: 'success',
      dock_root: normalizeRepoRelative(loaded.dockRoot, loaded.repoRoot),
      count: docks.length,
      docks,
    };
    options.json ? printJSON(payload) : printDocksList(payload);
    return;
  }
  if (action === 'explain') {
    if (options.positionals.length === 0) error('dev docks explain requires exactly one dock name', 'MISSING_ARG');
    if (options.positionals.length > 1) error(`Unknown dev docks argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const loaded = loadDockProfiles(options);
    const profile = loaded.profiles.find((item) => item.name === options.positionals[0]);
    if (!profile) error(`Unknown dock profile: ${options.positionals[0]}`, 'UNKNOWN_DOCK');
    const payload = { status: 'success', dock_root: normalizeRepoRelative(loaded.dockRoot, loaded.repoRoot), profile };
    options.json ? printJSON(payload) : printDockExplain(payload);
    return;
  }
  if (action === 'capabilities') {
    if (options.positionals.length === 0) error('dev docks capabilities requires exactly one dock name', 'MISSING_ARG');
    if (options.positionals.length > 1) error(`Unknown dev docks argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const loaded = loadDockProfiles(options);
    const profile = loaded.profiles.find((item) => item.name === options.positionals[0]);
    if (!profile) error(`Unknown dock profile: ${options.positionals[0]}`, 'UNKNOWN_DOCK');
    const defaultEntryPath = profile.default_entry_path || 'agent_harness';
    const activeEntryPath = options.entry_path || defaultEntryPath;
    const allowedEntryPaths = profile.allowed_entry_paths || [];
    if (!allowedEntryPaths.includes(activeEntryPath)) {
      error(`Dock ${profile.name} does not allow entry path: ${activeEntryPath}`, 'ENTRY_PATH_NOT_ALLOWED');
    }
    const capabilityOptions = { repo: options.repo, manifest: options.capabilities_manifest || profile.capability_manifest };
    const capabilityManifest = loadCapabilityManifest(capabilityOptions);
    const capabilities = resolveDockCapabilities(profile, capabilityManifest.capabilities, activeEntryPath);
    const payload = {
      status: 'success',
      dock: profile.name,
      role: profile.role ?? null,
      dock_root: normalizeRepoRelative(loaded.dockRoot, loaded.repoRoot),
      default_entry_path: defaultEntryPath,
      active_entry_path: activeEntryPath,
      allowed_entry_paths: allowedEntryPaths,
      allowed_capability_classes: profile.allowed_capability_classes || [],
      capability_manifest: normalizeRepoRelative(capabilityManifest.path, capabilityManifest.repoRoot),
      count: capabilities.length,
      capabilities: capabilities.map(compactCapability),
    };
    options.json ? printJSON(payload) : printDockCapabilities(payload);
    return;
  }
  error(`Unknown dev docks subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
}

function claim(id, claimText, passed, expected, observed, evidence, next) {
  const out = { id, claim: claimText, status: passed ? 'passed' : 'failed', expected, observed, evidence };
  if (!passed && next) out.next = next;
  return out;
}

function auditFormFlagClaim(id, form, expectedFlags, defaultManifestRequired) {
  if (!form) {
    return claim(id, `The external help manifest exposes required flags for ${id}.`, false, expectedFlags.join(','), 'missing form', ['manifests/commands/aos-commands.json'], 'Restore the missing help form.');
  }
  const tokens = new Set((form.args || []).map((arg) => arg.token).filter(Boolean));
  const manifestArg = (form.args || []).find((arg) => arg.token === '--manifest');
  const manifestDefault = manifestArg?.default_value ?? manifestArg?.default;
  const hasFlags = expectedFlags.every((flag) => tokens.has(flag));
  const hasManifestDefault = !defaultManifestRequired || manifestDefault === workflowDefaultManifest;
  const observed = `${[...tokens].sort().join(',')}; manifest_default=${manifestDefault ?? 'nil'}`;
  return claim(
    id,
    `The external help manifest exposes required flags and defaults for ${form.id}.`,
    hasFlags && hasManifestDefault,
    `${expectedFlags.slice().sort().join(',')}${defaultManifestRequired ? `; manifest_default=${workflowDefaultManifest}` : ''}`,
    observed,
    ['manifests/commands/aos-commands.json', './aos help dev --json'],
    'Align InvocationForm args with the parser in scripts/aos-dev-workflow.mjs.',
  );
}

function auditRegistryClaims(repoRoot) {
  const registryPath = path.join(repoRoot, 'manifests/commands/aos-commands.json');
  const registry = readJSON(registryPath, 'MISSING_COMMAND_REGISTRY', 'INVALID_COMMAND_REGISTRY', 'command registry');
  const dev = (registry.commands || []).find((command) => command.path?.join(' ') === 'dev');
  if (!dev) {
    return [claim('dev-help-registry-present', 'The external help manifest exposes the dev command.', false, 'command path dev', 'missing', ['manifests/commands/aos-commands.json'], 'Register the dev command before trusting parser/help alignment.')];
  }
  const forms = new Map((dev.forms || []).map((form) => [form.id, form]));
  const expectedForms = ['dev-classify', 'dev-recommend', 'dev-situation', 'dev-drift-lint', 'dev-build', 'dev-afk-dry-run', 'dev-afk-launch-attempt', 'dev-afk-session-trigger', 'dev-audit', 'dev-capabilities', 'dev-docks', 'dev-agents', 'dev-subagent', 'dev-gh'];
  const observedForms = (dev.forms || []).map((form) => form.id).sort();
  return [
    claim('dev-help-forms', 'External help manifest exposes the complete dev command surface.', expectedForms.every((id) => observedForms.includes(id)), expectedForms.slice().sort().join(','), observedForms.join(','), ['manifests/commands/aos-commands.json', './aos help dev --json'], 'Add the missing dev InvocationForm so agents can discover the command.'),
    auditFormFlagClaim('dev-classify-help-flags', forms.get('dev-classify'), ['--paths', '--files', '--manifest', '--base', '--repo', '--json'], true),
    auditFormFlagClaim('dev-recommend-help-flags', forms.get('dev-recommend'), ['--paths', '--files', '--manifest', '--base', '--repo', '--json'], true),
    auditFormFlagClaim('dev-situation-help-flags', forms.get('dev-situation'), ['--repo', '--issue-limit', '--recent-issue-limit', '--pr-limit', '--json'], false),
    auditFormFlagClaim('dev-drift-lint-help-flags', forms.get('dev-drift-lint'), ['--paths', '--files', '--all-markdown', '--repo', '--json'], false),
    auditFormFlagClaim('dev-afk-dry-run-help-flags', forms.get('dev-afk-dry-run'), ['--packet', '--provider', '--dock', '--repo', '--timestamp', '--out', '--json'], false),
    auditFormFlagClaim('dev-afk-launch-attempt-help-flags', forms.get('dev-afk-launch-attempt'), ['--packet', '--provider', '--dock', '--repo', '--timestamp', '--out', '--json', '--duplicate-in-process', '--catalog-fixture', '--bridge-visibility-fixture', '--provider-session-id', '--launch-observed-at', '--codex-home-fixture', '--codex-home'], false),
    auditFormFlagClaim('dev-afk-session-trigger-help-flags', forms.get('dev-afk-session-trigger'), ['--packet', '--afk-work-queue', '--queue-run-fixture', '--afk-authorization', '--sleep-lease', '--provider', '--dock', '--repo', '--timestamp', '--out', '--result-route', '--idempotence-salt', '--existing-receipt', '--replacement-for', '--dry-run', '--supervised-live-launch', '--afk-live-launch', '--sleep-lease-live-launch', '--i-am-present', '--provider-launch-dry-run', '--bridge-visibility-fixture', '--cleanup-proof-fixture', '--provider-session-id', '--launch-observed-at', '--codex-home-fixture', '--codex-home', '--json'], false),
    auditFormFlagClaim('dev-audit-help-flags', forms.get('dev-audit'), ['--manifest', '--repo', '--json'], true),
    auditFormFlagClaim('dev-capabilities-help-flags', forms.get('dev-capabilities'), ['--manifest', '--repo', '--role', '--entry-path', '--json'], false),
    auditFormFlagClaim('dev-docks-help-flags', forms.get('dev-docks'), ['--dock-root', '--capabilities-manifest', '--entry-path', '--repo', '--json'], false),
    auditFormFlagClaim('dev-agents-help-flags', forms.get('dev-agents'), ['--self-test', '--list-runs', '--read-run', '--role', '--task', '--execute', '--patch-output', '--max-turns', '--repo', '--json'], false),
    auditFormFlagClaim('dev-subagent-help-flags', forms.get('dev-subagent'), ['--repo', '--agents-root', '--role', '--prompt', '--prompt-file', '--transcript', '--transcript-file', '--json'], false),
    auditFormFlagClaim('dev-gh-help-flags', forms.get('dev-gh'), ['--repo', '--cwd', '--json', '--body-file', '--pr'], false),
  ];
}

function auditWorkflowManifestClaims(manifest) {
  const rule = (manifest.rules || []).find((item) => item.id === workflowRuleID);
  if (!rule) return [claim('dev-workflow-self-routes', 'The dev workflow manifest routes its own command, registry, and tests.', false, workflowRuleID, 'missing', [workflowDefaultManifest], `Add a ${workflowRuleID} rule to the workflow manifest.`)];
  const expectedPatterns = ['docs/dev/workflow-rules.json', 'docs/dev/agent-capabilities.json', 'scripts/aos-dev-workflow.mjs', 'scripts/aos-dev-situation.mjs', 'scripts/aos-dev-drift-lint.mjs', 'manifests/commands/aos-commands.json', 'manifests/commands/aos-external-commands.json', 'tests/dev-workflow-router.sh', 'tests/dev-audit.sh', 'tests/dev-situation.sh', 'tests/dev-drift-lint.sh', 'tests/schemas/dev-workflow-rules.test.mjs'];
  const expectedCommands = ['node --test tests/schemas/dev-workflow-rules.test.mjs', 'bash tests/dev-workflow-router.sh', 'bash tests/dev-audit.sh', 'bash tests/dev-situation.sh', 'bash tests/dev-drift-lint.sh'];
  const patterns = rule.patterns || [];
  const commands = (rule.commands || []).map((item) => item.command);
  return [
    claim('dev-workflow-self-routes', 'The dev workflow manifest routes its own command, registry, and tests.', expectedPatterns.every((item) => patterns.includes(item)), expectedPatterns.slice().sort().join(','), patterns.slice().sort().join(','), [workflowDefaultManifest], `Add missing dev workflow source/test patterns to ${workflowDefaultManifest}.`),
    claim('dev-workflow-self-verifies', 'The dev workflow rule recommends schema, router, and audit verification.', expectedCommands.every((item) => commands.includes(item)), expectedCommands.slice().sort().join(','), commands.slice().sort().join(','), [workflowDefaultManifest], `Add missing verification commands to the ${workflowRuleID} rule.`),
  ];
}

function auditExplicitRecommendationClaims(manifest, repoRoot) {
  const summary = aggregateWorkflow(classifyFiles(['docs/guides/example.md'], manifest, repoRoot));
  const passed = JSON.stringify(summary.rule_ids) === JSON.stringify(['docs-only']) && summary.commands.length === 0 && summary.verification.length === 0;
  return [claim('dev-recommend-explicit-files', 'The router can classify explicit docs-only file input without runtime work.', passed, 'rule_ids=docs-only; commands=0; verification=0', `rule_ids=${summary.rule_ids.join(',')}; commands=${summary.commands.length}; verification=${summary.verification.length}`, ['./aos dev recommend --json --files docs/guides/example.md'], 'Fix dev workflow matching so explicit file input does not trigger unrelated runtime loops.')];
}

function auditCommand(args) {
  const options = parseAuditOptions(args);
  const repoRoot = resolveRepoRoot(options.repo);
  const defaultManifestPath = resolveUnderRepo(null, repoRoot, workflowDefaultManifest);
  const selectedManifestPath = resolveUnderRepo(options.manifest, repoRoot, workflowDefaultManifest);
  const selectedManifestRelative = normalizeRepoRelative(selectedManifestPath, repoRoot);
  const claims = [];
  const defaultManifestRelative = normalizeRepoRelative(defaultManifestPath, repoRoot);
  claims.push(claim('dev-default-manifest-path', 'The dev workflow router default manifest path is canonical.', defaultManifestRelative === workflowDefaultManifest, workflowDefaultManifest, defaultManifestRelative, ['scripts/aos-dev-workflow.mjs:workflowDefaultManifest'], `Update workflowDefaultManifest to use ${workflowDefaultManifest}.`));
  const manifestExists = fs.existsSync(selectedManifestPath);
  claims.push(claim('dev-manifest-readable', 'The selected dev workflow manifest exists on disk.', manifestExists, `exists=true at ${selectedManifestRelative}`, `exists=${manifestExists}`, [selectedManifestRelative], 'Restore the manifest or pass --manifest <path> to a valid rules file.'));
  let manifest = null;
  if (manifestExists) {
    try {
      manifest = JSON.parse(fs.readFileSync(selectedManifestPath, 'utf8'));
      claims.push(claim('dev-manifest-decodes', 'The selected dev workflow manifest decodes as schema version 1.', manifest.schema_version === 1, 'schema_version=1', `schema_version=${manifest.schema_version}`, [selectedManifestRelative, 'shared/schemas/dev-workflow-rules.schema.json'], 'Run node --test tests/schemas/dev-workflow-rules.test.mjs.'));
    } catch (err) {
      claims.push(claim('dev-manifest-decodes', 'The selected dev workflow manifest decodes as schema version 1.', false, 'valid schema_version=1 manifest', err.message, [selectedManifestRelative, 'shared/schemas/dev-workflow-rules.schema.json'], 'Run node --test tests/schemas/dev-workflow-rules.test.mjs.'));
    }
  } else {
    claims.push(claim('dev-manifest-decodes', 'The selected dev workflow manifest decodes as schema version 1.', false, 'valid schema_version=1 manifest', `missing: ${selectedManifestPath}`, [selectedManifestRelative, 'shared/schemas/dev-workflow-rules.schema.json'], 'Run node --test tests/schemas/dev-workflow-rules.test.mjs.'));
  }
  claims.push(...auditRegistryClaims(repoRoot));
  if (manifest) {
    claims.push(...auditWorkflowManifestClaims(manifest));
    claims.push(...auditExplicitRecommendationClaims(manifest, repoRoot));
  } else {
    claims.push(claim('dev-workflow-self-routes', 'The dev workflow manifest routes its own command, registry, and tests.', false, `decoded manifest with ${workflowRuleID} rule`, 'manifest did not decode', [selectedManifestRelative], 'Fix the manifest before trusting dev workflow routing.'));
    claims.push(claim('dev-recommend-explicit-files', 'The router can classify explicit docs-only file input without runtime work.', false, 'docs-only route with no commands or verification', 'manifest did not decode', [selectedManifestRelative], 'Fix the manifest before trusting dev recommend.'));
  }
  const passed = claims.filter((item) => item.status === 'passed').length;
  const failed = claims.length - passed;
  const payload = {
    status: failed === 0 ? 'success' : 'failed',
    subject: 'dev-grammar',
    repo: repoRoot,
    manifest: selectedManifestRelative,
    claims,
    summary: { total: claims.length, passed, failed },
    next: failed === 0 ? 'No dev grammar repair needed.' : './aos dev build --force --no-restart && bash tests/dev-audit.sh',
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
  process.stdout.write(payload.next_commands.length ? 'Next commands:\n' : 'Next commands: none\n');
  for (const item of payload.next_commands) process.stdout.write(`- ${item.command || ''}\n`);
  process.stdout.write(payload.verification.length ? 'Verification:\n' : 'Verification: none\n');
  for (const item of payload.verification) process.stdout.write(`- ${item.command || ''}\n`);
  for (const note of payload.notes) process.stdout.write(`Note: ${note}\n`);
}

function printAuditText(payload) {
  process.stdout.write(`dev audit: ${payload.status}\n`);
  for (const item of payload.claims) {
    const marker = item.status === 'passed' ? 'PASS' : 'FAIL';
    process.stdout.write(`${marker} ${item.id} - ${item.claim}\n`);
    if (marker === 'FAIL' && item.next) process.stdout.write(`  Next: ${item.next}\n`);
  }
  if (payload.summary.failed > 0) process.stdout.write(`Next: ${payload.next}\n`);
}

function printCapabilitiesList(payload) {
  process.stdout.write(`dev capabilities: ${payload.count}\n`);
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

function printDocksList(payload) {
  process.stdout.write(`dev docks: ${payload.count}\nDock root: ${payload.dock_root}\n`);
  for (const dock of payload.docks) {
    process.stdout.write(`- ${dock.name || 'unknown'}: role=${dock.role || 'unknown'} default_entry_path=${dock.default_entry_path || 'unknown'} classes=${(dock.allowed_capability_classes || []).join(',')}\n`);
  }
}

function printDockExplain(payload) {
  const profile = payload.profile;
  process.stdout.write(`${profile.name || 'unknown'} - ${profile.role || 'unknown'}\n`);
  if (profile.summary) process.stdout.write(`${profile.summary}\n`);
  process.stdout.write(`Default entry path: ${profile.default_entry_path || 'unknown'}\n`);
  process.stdout.write(`Allowed entry paths: ${(profile.allowed_entry_paths || []).join(', ')}\n`);
  process.stdout.write(`Allowed classes: ${(profile.allowed_capability_classes || []).join(', ')}\n`);
}

function printDockCapabilities(payload) {
  process.stdout.write(`dev dock capabilities: ${payload.dock || 'unknown'} entry_path=${payload.active_entry_path || 'unknown'} count=${payload.count}\n`);
  for (const capability of payload.capabilities) {
    process.stdout.write(`- ${capability.id || 'unknown'}: adapter=${capability.adapter_kind || 'unknown'} mutability=${capability.mutability_class || 'unknown'} raw_process=${capability.raw_process || false}\n`);
  }
}

function printSubagentList(payload) {
  process.stdout.write(`dev subagent diagnostics: ${payload.count} registered roles\n`);
  process.stdout.write(`Agents root: ${payload.agents_root}\n`);
  for (const role of payload.roles) {
    process.stdout.write(`- ${role.role}: model=${role.model || 'unknown'} effort=${role.model_reasoning_effort || 'unknown'} config=${role.agent_config_path}\n`);
  }
}

function printSubagentPlan(payload) {
  process.stdout.write(`dev subagent diagnostic contract: ${payload.role}\n`);
  process.stdout.write(`Dispatch boundary: ${payload.dispatch_boundary.canonical_dispatch}; this helper is not a launcher.\n`);
  process.stdout.write(`Agent config: ${payload.agent_config_path}\n`);
  process.stdout.write(`Expected: task_name=${payload.expected.task_name} role=${payload.expected.agent_type} model=${payload.expected.model} effort=${payload.expected.model_reasoning_effort}\n`);
  process.stdout.write('Native spawn contract:\n');
  process.stdout.write(`task_name: ${payload.native_spawn_contract.tool_argument.task_name}\n`);
  process.stdout.write(`agent_type: ${payload.native_spawn_contract.tool_argument.agent_type}\n`);
  process.stdout.write(`blocked_prompt_prefix: ${payload.native_spawn_contract.blocked_prompt_prefix.value}\n`);
  process.stdout.write(`prompt: ${payload.native_spawn_contract.prompt}\n`);
  process.stdout.write(`Next: ${payload.next}\n`);
}

function printSubagentProof(payload) {
  process.stdout.write(`dev subagent proof: ${payload.status}\n`);
  process.stdout.write(`Dispatch boundary: ${payload.dispatch_boundary.canonical_dispatch}; this helper is not a launcher.\n`);
  for (const item of payload.claims) {
    const marker = item.status === 'passed' ? 'PASS' : 'FAIL';
    process.stdout.write(`${marker} ${item.id} expected=${item.expected} observed=${item.observed}\n`);
  }
  process.stdout.write(`Next: ${payload.next}\n`);
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
} else if (subcommand === 'audit') {
  auditCommand(rest);
} else if (subcommand === 'capabilities') {
  const [action, ...args] = rest;
  if (!action) error('dev capabilities requires a subcommand', 'MISSING_SUBCOMMAND');
  capabilitiesCommand(action, args);
} else if (subcommand === 'docks') {
  const [action, ...args] = rest;
  if (!action) error('dev docks requires a subcommand', 'MISSING_SUBCOMMAND');
  docksCommand(action, args);
} else if (subcommand === 'subagent') {
  const [action, ...args] = rest;
  if (!action) error('dev subagent requires a subcommand', 'MISSING_SUBCOMMAND');
  subagentCommand(action, args);
} else {
  error(`Unknown dev workflow command: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
}

#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

class OpsFailure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function mode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function aosPath() {
  const configured = process.env.AOS_PATH;
  return configured && !configured.startsWith('$') ? configured : path.join(process.cwd(), 'aos');
}

function invocationName() {
  const configured = process.env.AOS_INVOCATION_DISPLAY_NAME;
  return configured && !configured.startsWith('$') ? configured : 'aos';
}

function publicSurface() {
  const configured = process.env.AOS_RECIPE_SURFACE;
  return configured && !configured.startsWith('$') ? configured : 'recipe';
}

function envValue(name) {
  const value = process.env[name];
  return value && !value.startsWith('$') ? value : undefined;
}

function isoNow() {
  return new Date().toISOString();
}

function prettyJSON(value) {
  return JSON.stringify(value, null, 2).replace(/"([A-Za-z0-9_]+)":/g, '"$1" :');
}

function emitJSON(value, stderr = false) {
  const text = `${prettyJSON(value)}\n`;
  if (stderr) process.stderr.write(text);
  else process.stdout.write(text);
}

function exitFailure(message, code) {
  emitJSON({ status: 'failure', code, error: message }, true);
  process.exit(1);
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) return { subcommand: null, json: false, positional: [] };
  const json = rest.includes('--json');
  for (const arg of rest) {
    if (arg.startsWith('--') && arg !== '--json') throw new OpsFailure(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  }
  return { subcommand, json, positional: rest.filter((arg) => arg !== '--json') };
}

function readObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('expected object');
    return parsed;
  } catch (err) {
    if (err instanceof OpsFailure) throw err;
    throw new OpsFailure(`Could not read ${file}: ${err.message}`, 'RECIPE_READ_FAILED');
  }
}

function recipeFromManifest(manifest, owner, recipePath, sourceKind) {
  if (!manifest.id) throw new OpsFailure(`Recipe missing id: ${recipePath}`, 'INVALID_RECIPE');
  const version = Number(manifest.version || 0);
  if (!Number.isInteger(version) || version <= 0) {
    throw new OpsFailure(`Recipe ${manifest.id} must declare positive integer version`, 'INVALID_RECIPE');
  }
  return {
    id: manifest.id,
    version,
    summary: manifest.summary || '',
    owner,
    path: recipePath,
    sourceKind,
    manifest,
  };
}

function loadRecipeFiles(root, owner, sourceKind) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const dir = path.join(root, rel);
    for (const child of fs.readdirSync(dir).sort()) {
      const childRel = path.join(rel, child);
      const full = path.join(root, childRel);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) stack.push(childRel);
      else if (child.endsWith('.json')) out.push(recipeFromManifest(readObject(full), owner, full, sourceKind));
    }
  }
  return out;
}

function bundledRecipeIndexPath() {
  const exe = path.resolve(aosPath());
  return path.join(path.dirname(path.dirname(path.dirname(exe))), 'Contents', 'Resources', 'agent-os', 'recipes-index.json');
}

function loadRecipeIndex(indexPath) {
  const root = readObject(indexPath);
  if (!Array.isArray(root.recipes)) throw new OpsFailure(`Recipe index missing recipes array: ${indexPath}`, 'INVALID_RECIPE_INDEX');
  return root.recipes.map((entry) => {
    const manifest = entry.manifest && typeof entry.manifest === 'object' ? entry.manifest : entry;
    return recipeFromManifest(
      manifest,
      entry.owner || 'package',
      entry.path || indexPath,
      entry.source_kind || 'package',
    );
  });
}

function discoverSourceRecipes() {
  const override = envValue('AOS_OPS_RECIPE_ROOTS');
  if (override) {
    return override.split(':').flatMap((root) => loadRecipeFiles(root, root, 'fixture'));
  }
  const repoRoot = process.cwd();
  let recipes = loadRecipeFiles(path.join(repoRoot, 'recipes'), 'repo', 'repo');
  recipes = recipes.concat(loadRecipeFiles(path.join(repoRoot, 'packages/toolkit/recipes'), 'packages/toolkit', 'toolkit'));
  const appsRoot = path.join(repoRoot, 'apps');
  if (fs.existsSync(appsRoot)) {
    for (const app of fs.readdirSync(appsRoot).sort()) {
      recipes = recipes.concat(loadRecipeFiles(path.join(appsRoot, app, 'recipes'), `apps/${app}`, 'app'));
    }
  }
  return recipes;
}

function loadRecipes() {
  let recipes;
  const indexOverride = envValue('AOS_OPS_RECIPE_INDEX');
  if (indexOverride) recipes = loadRecipeIndex(indexOverride);
  else if (mode() === 'installed') {
    const indexPath = bundledRecipeIndexPath();
    if (!fs.existsSync(indexPath)) {
      throw new OpsFailure('Installed-mode executable recipe index not found in packaged resources', 'RECIPE_DISCOVERY_FAILED');
    }
    recipes = loadRecipeIndex(indexPath);
  } else recipes = discoverSourceRecipes();

  const seen = new Map();
  for (const recipe of recipes) {
    if (seen.has(recipe.id)) {
      throw new OpsFailure(`Duplicate executable recipe id '${recipe.id}' in ${seen.get(recipe.id).path} and ${recipe.path}`, 'DUPLICATE_RECIPE_ID');
    }
    seen.set(recipe.id, recipe);
  }
  return [...recipes].sort((a, b) => a.id.localeCompare(b.id));
}

function recipeSummary(recipe) {
  return {
    id: recipe.id,
    version: recipe.version,
    summary: recipe.summary,
    owner: recipe.owner,
    path: recipe.path,
    source_kind: recipe.sourceKind,
  };
}

let commandRegistry = null;
function loadCommandRegistry() {
  if (commandRegistry) return commandRegistry;
  const result = spawnSync(aosPath(), ['help', '--json'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, env: process.env });
  if (result.status !== 0) throw new OpsFailure('Could not load command registry from aos help --json', 'INTERNAL');
  commandRegistry = JSON.parse(result.stdout);
  return commandRegistry;
}

function findCommandForm(commandPath, formID) {
  const registry = loadCommandRegistry();
  const command = registry.commands.find((item) => JSON.stringify(item.path) === JSON.stringify(commandPath));
  return command?.forms?.find((form) => form.id === formID);
}

function argvHasFlag(argv, flag) {
  return argv.some((arg) => arg === flag || String(arg).startsWith(`${flag}=`));
}

function formMutatesForArgv(form, argv) {
  if (form.execution?.mutates_state === true) return true;
  return (form.execution?.mutates_when_flags ?? []).some((flag) => argvHasFlag(argv, flag));
}

function validateAssertions(assertions, stepID) {
  for (const assertion of assertions) {
    const hasPath = Array.isArray(assertion.path);
    const hasSelect = assertion.select && typeof assertion.select === 'object';
    if (!hasPath && !hasSelect) throw new OpsFailure(`Assertion in step ${stepID} must declare path or select`, 'INVALID_RECIPE');
    const operators = ['exists', 'not_exists', 'equals', 'contains'].filter((key) => Object.prototype.hasOwnProperty.call(assertion, key));
    if (operators.length !== 1) throw new OpsFailure(`Assertion in step ${stepID} must declare exactly one operator`, 'INVALID_RECIPE');
  }
}

function blockKind(step) {
  return step.kind || (step.command ? 'aos_command' : null);
}

function repoRoot() {
  return process.cwd();
}

function resolveRepoPath(relPath, fieldName) {
  if (typeof relPath !== 'string' || !relPath) throw new OpsFailure(`${fieldName} must be a repo-relative path`, 'INVALID_RECIPE');
  if (path.isAbsolute(relPath)) throw new OpsFailure(`${fieldName} must not be absolute: ${relPath}`, 'INVALID_RECIPE');
  const root = path.resolve(repoRoot());
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new OpsFailure(`${fieldName} must stay under the repo: ${relPath}`, 'INVALID_RECIPE');
  }
  return resolved;
}

function planRecipe(recipe) {
  const steps = recipe.manifest.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new OpsFailure(`Recipe ${recipe.id} must declare at least one step`, 'INVALID_RECIPE');
  const planned = steps.map((step) => {
    if (!step.id) throw new OpsFailure(`Recipe ${recipe.id} contains a step without id`, 'INVALID_RECIPE');
    const timeoutMs = Number(step.timeout_ms || 5000);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new OpsFailure(`Step ${step.id} timeout_ms must be positive`, 'INVALID_RECIPE');
    const assertions = Array.isArray(step.assertions) ? step.assertions : [];
    validateAssertions(assertions, step.id);
    const kind = blockKind(step);
    const base = {
      id: step.id,
      kind,
      timeoutMs,
      finally: Boolean(step.finally),
      cleanupResources: Array.isArray(step.cleanup_resources) ? step.cleanup_resources : [],
      assertions,
    };
    if (kind === 'aos_command') {
      const commandPath = step.command?.path;
      const formID = step.command?.form_id;
      if (!Array.isArray(commandPath) || !formID) throw new OpsFailure(`Step ${step.id} must use command.path and command.form_id`, 'INVALID_RECIPE');
      const form = findCommandForm(commandPath, formID);
      if (!form) throw new OpsFailure(`Step ${step.id} references unknown command form ${commandPath.join(' ')}/${formID}`, 'UNKNOWN_COMMAND_FORM');
      const argv = Array.isArray(step.argv) ? step.argv : [];
      const mutates = Boolean(step.mutates) || formMutatesForArgv(form, argv);
      return {
        ...base,
        commandPath,
        formID,
        argv,
        mutates,
        supportsDelegateDryRun: Boolean(form.execution?.supports_dry_run),
      };
    }
    if (kind === 'shell') {
      const shell = step.shell || {};
      const script = shell.script;
      const scriptPath = resolveRepoPath(script, `Step ${step.id} shell.script`);
      if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
        throw new OpsFailure(`Step ${step.id} shell.script does not exist: ${script}`, 'INVALID_RECIPE');
      }
      let cwd = shell.cwd || '.';
      const cwdPath = resolveRepoPath(cwd, `Step ${step.id} shell.cwd`);
      if (!fs.existsSync(cwdPath) || !fs.statSync(cwdPath).isDirectory()) {
        throw new OpsFailure(`Step ${step.id} shell.cwd does not exist: ${cwd}`, 'INVALID_RECIPE');
      }
      return {
        ...base,
        script,
        scriptPath,
        cwd,
        cwdPath,
        argv: Array.isArray(step.argv) ? step.argv : [],
        mutates: Boolean(step.mutates),
        supportsDelegateDryRun: false,
      };
    }
    if (['recipe_call', 'assert', 'cleanup', 'signal', 'gate', 'condition', 'loop'].includes(kind)) {
      throw new OpsFailure(`Step ${step.id} uses reserved recipe block kind '${kind}' without execution support in this engine version`, 'INVALID_RECIPE');
    }
    throw new OpsFailure(`Step ${step.id} uses unknown recipe block kind '${kind}'`, 'INVALID_RECIPE');
  });
  validateOwnedResourcePlan(recipe, planned);
  return planned;
}

function ownedResourceTemplates(recipe) {
  const raw = recipe.manifest.owned_resources;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!item.name || !item.type || !item.id) throw new OpsFailure(`Recipe ${recipe.id} has invalid owned_resources entry`, 'INVALID_RECIPE');
    return { name: item.name, type: item.type, id: item.id, ttlSeconds: item.ttl_seconds };
  });
}

function resourceNeedsCleanup(resource) {
  return resource.type === 'canvas';
}

function recipePlanMutates(recipe, plan) {
  return recipe.manifest.mutates === true || plan.some((step) => step.mutates);
}

function validateOwnedResourcePlan(recipe, plan) {
  const mutates = recipePlanMutates(recipe, plan);
  const owned = ownedResourceTemplates(recipe);
  const ownedNames = new Set();
  for (const resource of owned) {
    if (ownedNames.has(resource.name)) throw new OpsFailure(`Recipe ${recipe.id} declares duplicate owned resource '${resource.name}'`, 'INVALID_RECIPE');
    ownedNames.add(resource.name);
  }
  for (const step of plan) {
    if (step.cleanupResources.length && !step.finally) {
      throw new OpsFailure(`Step ${step.id} declares cleanup_resources but is not marked finally`, 'INVALID_RECIPE');
    }
    for (const name of step.cleanupResources) {
      if (!ownedNames.has(name)) throw new OpsFailure(`Step ${step.id} references unknown cleanup resource '${name}'`, 'INVALID_RECIPE');
    }
  }
  if (!mutates) return;
  const cleanupRequired = owned.some(resourceNeedsCleanup);
  if (cleanupRequired && !plan.some((step) => step.finally && step.cleanupResources.length)) {
    throw new OpsFailure(`Mutating recipe ${recipe.id} must declare cleanup finally steps for owned cleanup resources`, 'INVALID_RECIPE');
  }
}

function resolveTemplate(value, runID, resources) {
  let out = String(value).replaceAll('${run_id}', runID);
  for (const [key, resourceValue] of Object.entries(resources)) {
    out = out.replaceAll(`\${resources.${key}}`, resourceValue);
  }
  return out;
}

function resolvedResources(recipe, runID) {
  const resources = {};
  for (const [key, value] of Object.entries(recipe.manifest.resources || {})) {
    resources[key] = resolveTemplate(value, runID, resources);
  }
  return resources;
}

function resolvedOwnedResources(recipe, runID, resources) {
  return ownedResourceTemplates(recipe).map((resource) => ({
    name: resource.name,
    type: resource.type,
    id: resolveTemplate(resource.id, runID, resources),
    ttlSeconds: resource.ttlSeconds,
  }));
}

function ownedResourcesJSON(resources, runID, cleanupStatus = undefined) {
  return resources.map((resource) => {
    const out = { name: resource.name, type: resource.type, id: resource.id, owned: true, run_id: runID };
    if (resource.ttlSeconds !== undefined) out.ttl_seconds = resource.ttlSeconds;
    if (cleanupStatus !== undefined) out.cleanup_status = cleanupStatus;
    return out;
  });
}

function stepPlanJSON(step) {
  const out = {
    id: step.id,
    kind: step.kind,
    argv: step.argv,
    timeout_ms: step.timeoutMs,
    mutates: step.mutates,
    finally: step.finally,
    supports_delegate_dry_run: step.supportsDelegateDryRun,
    cleanup_resources: step.cleanupResources,
    would_run: true,
    assertions: step.assertions.length,
  };
  if (step.kind === 'aos_command') out.command = { path: step.commandPath, form_id: step.formID };
  if (step.kind === 'shell') out.shell = { script: step.script, cwd: step.cwd };
  return out;
}

function stepResult(step, status, durationMs, observed, resolvedArgv = undefined) {
  const out = stepPlanJSON(step);
  if (resolvedArgv) out.argv = resolvedArgv;
  out.status = status;
  if (durationMs !== undefined && durationMs !== null) out.duration_ms = durationMs;
  if (observed) out.observed = observed;
  return out;
}

function opsResult(status, code, error, recipe, dryRun, steps, mutatedResources, cleanup) {
  return {
    status,
    code,
    error: error ?? null,
    recipe: { id: recipe.id, version: recipe.version },
    mode: mode(),
    dry_run: dryRun,
    started_at: isoNow(),
    finished_at: isoNow(),
    mutated_resources: mutatedResources,
    steps,
    cleanup,
  };
}

function valuesEqual(lhs, rhs) {
  return JSON.stringify(lhs) === JSON.stringify(rhs);
}

function jsonContains(container, expected) {
  if (Array.isArray(container)) return container.some((item) => valuesEqual(item, expected));
  if (typeof container === 'string' && typeof expected === 'string') return container.includes(expected);
  return false;
}

function valueAt(keys, root) {
  let current = root;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) return { found: false };
    current = current[key];
  }
  return { found: true, value: current };
}

function resolveJSONTemplates(value, runID, resources) {
  if (typeof value === 'string') return resolveTemplate(value, runID, resources);
  if (Array.isArray(value)) return value.map((item) => resolveJSONTemplates(item, runID, resources));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveJSONTemplates(v, runID, resources)]));
  return value;
}

function resolveAssertionTarget(assertion, root, runID, resources) {
  if (Array.isArray(assertion.path)) return valueAt(assertion.path, root);
  const select = assertion.select;
  if (!select || !Array.isArray(select.path) || !select.where) return { found: false };
  const base = valueAt(select.path, root);
  if (!base.found || !Array.isArray(base.value)) return { found: false };
  const matches = base.value.filter((item) => Object.entries(select.where).every(([key, expected]) => valuesEqual(item[key], resolveJSONTemplates(expected, runID, resources))));
  if (matches.length !== 1) return { found: false };
  if (Array.isArray(assertion.field)) return valueAt(assertion.field, matches[0]);
  return { found: true, value: matches[0] };
}

function firstAssertionFailure(assertions, root, runID, resources) {
  for (const assertion of assertions) {
    const target = resolveAssertionTarget(assertion, root, runID, resources);
    if (Object.prototype.hasOwnProperty.call(assertion, 'exists')) {
      if (target.found !== assertion.exists) return `exists expected ${assertion.exists}`;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(assertion, 'not_exists')) {
      if (target.found === assertion.not_exists) return `not_exists expected ${assertion.not_exists}`;
      continue;
    }
    if (!target.found) return 'target missing';
    if (Object.prototype.hasOwnProperty.call(assertion, 'equals')) {
      const expected = resolveJSONTemplates(assertion.equals, runID, resources);
      if (!valuesEqual(target.value, expected)) return `equals expected ${JSON.stringify(expected)}, got ${JSON.stringify(target.value)}`;
    } else if (Object.prototype.hasOwnProperty.call(assertion, 'contains')) {
      const expected = resolveJSONTemplates(assertion.contains, runID, resources);
      if (!jsonContains(target.value, expected)) return `contains expected ${JSON.stringify(expected)}, got ${JSON.stringify(target.value)}`;
    }
  }
  return null;
}

function parseJSON(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function runProcess(executable, args, timeoutMs, cwd = undefined) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 100 * 1024 * 1024,
    env: process.env,
    cwd,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    timedOut,
    exitCode: timedOut ? 124 : (result.status ?? 1),
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error && !timedOut ? String(result.error.message) : ''),
  };
}

function transientIPCFailure(output) {
  const text = `${output.stderr || ''}\n${output.stdout || ''}`;
  return text.includes('IPC failure') || text.includes('NO_DAEMON') || text.includes('starting repo daemon via launchd service');
}

function runStepProcess(args, timeoutMs, mayRetry = true) {
  let output = runProcess(aosPath(), args, timeoutMs);
  let attempts = 1;
  while (mayRetry && (output.timedOut || output.exitCode !== 0) && attempts < 3 && transientIPCFailure(output)) {
    spawnSync('/bin/sleep', ['0.5']);
    output = runProcess(aosPath(), args, timeoutMs);
    attempts += 1;
  }
  return { ...output, attempts };
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function recoverMutatingTransient(step, argv, output) {
  if (!step.mutates || !transientIPCFailure(output)) return output;
  if (step.commandPath.length !== 1 || step.commandPath[0] !== 'show') return output;
  if (argv[0] !== 'create' && argv[0] !== 'remove') return output;
  const id = argValue(argv, '--id');
  if (!id) return output;
  const exists = runProcess(aosPath(), ['show', 'exists', '--id', id], step.timeoutMs);
  const parsed = parseJSON(exists.stdout);
  if (argv[0] === 'create' && exists.exitCode === 0 && parsed?.exists === true) {
    return {
      timedOut: false,
      exitCode: 0,
      stdout: '{"status":"success"}\n',
      stderr: output.stderr,
      attempts: output.attempts,
      recovered: 'verified-created-resource',
    };
  }
  if (argv[0] === 'remove' && exists.exitCode === 0 && parsed?.exists === false) {
    return {
      timedOut: false,
      exitCode: 0,
      stdout: '{"status":"success"}\n',
      stderr: output.stderr,
      attempts: output.attempts,
      recovered: 'verified-removed-resource',
    };
  }
  return output;
}

function executeStep(step, runID, resources) {
  const argv = step.argv.map((item) => resolveTemplate(item, runID, resources));
  const started = Date.now();
  let output;
  if (step.kind === 'aos_command') {
    output = runStepProcess([...step.commandPath, ...argv], step.timeoutMs, !step.mutates);
    output = recoverMutatingTransient(step, argv, output);
  } else if (step.kind === 'shell') {
    output = runProcess(step.scriptPath, argv, step.timeoutMs, step.cwdPath);
    output.attempts = 1;
  } else {
    throw new OpsFailure(`Unsupported execution block '${step.kind}'`, 'INVALID_RECIPE');
  }
  const durationMs = Date.now() - started;
  const observed = { exit_code: output.exitCode };
  if (output.attempts > 1) observed.attempts = output.attempts;
  if (output.recovered) observed.recovered = output.recovered;
  const stderr = output.stderr.trim();
  if (stderr) observed.stderr = stderr;
  const stdout = output.stdout.trim();
  if (stdout) observed.stdout = stdout;
  if (output.timedOut) {
    return {
      result: stepResult(step, 'timeout', durationMs, observed, argv),
      code: 'TIMEOUT',
      error: `Step ${step.id} timed out after ${step.timeoutMs}ms.`,
    };
  }
  if (output.exitCode !== 0) {
    return {
      result: stepResult(step, 'failure', durationMs, observed, argv),
      code: 'COMMAND_FAILED',
      error: `Step ${step.id} exited with code ${output.exitCode}.`,
    };
  }
  const parsed = parseJSON(output.stdout);
  if (parsed !== null) observed.stdout_json = parsed;
  if (step.assertions.length) {
    if (parsed === null) {
      return {
        result: stepResult(step, 'failure', durationMs, observed, argv),
        code: 'ASSERTION_FAILED',
        error: `Step ${step.id} produced non-JSON stdout for assertions.`,
      };
    }
    const failure = firstAssertionFailure(step.assertions, parsed, runID, resources);
    if (failure) {
      observed.assertion_failure = failure;
      return {
        result: stepResult(step, 'failure', durationMs, observed, argv),
        code: 'ASSERTION_FAILED',
        error: `Step ${step.id} assertion failed: ${failure}`,
      };
    }
  }
  return { result: stepResult(step, 'success', durationMs, observed, argv), code: null, error: null };
}

function validateCleanupSafety(cleanupPlan, ownedResources, runID, resources) {
  const ownedByName = new Map(ownedResources.map((resource) => [resource.name, resource]));
  const ownedIDs = new Set(ownedResources.map((resource) => resource.id));
  for (const step of cleanupPlan) {
    if (!step.cleanupResources.length) throw new OpsFailure(`Cleanup step ${step.id} must declare cleanup_resources`, 'INVALID_RECIPE');
    const argv = step.argv.map((item) => resolveTemplate(item, runID, resources));
    for (const name of step.cleanupResources) {
      const resource = ownedByName.get(name);
      if (!resource) throw new OpsFailure(`Cleanup step ${step.id} references unknown owned resource ${name}`, 'INVALID_RECIPE');
      if (resourceNeedsCleanup(resource) && !argv.includes(resource.id)) throw new OpsFailure(`Cleanup step ${step.id} does not target owned resource ${name}`, 'INVALID_RECIPE');
    }
    if (JSON.stringify(step.commandPath) === JSON.stringify(['show']) && step.formID === 'show-remove') {
      const ids = argv.flatMap((value, index) => (value === '--id' && index + 1 < argv.length ? [argv[index + 1]] : []));
      if (!ids.length) throw new OpsFailure(`Cleanup step ${step.id} show remove must include --id`, 'INVALID_RECIPE');
      for (const id of ids) {
        if (!ownedIDs.has(id)) throw new OpsFailure(`Cleanup step ${step.id} targets unowned canvas id ${id}`, 'INVALID_RECIPE');
      }
    }
  }
}

function runCleanup(cleanupPlan, runID, resources) {
  if (!cleanupPlan.length) return { status: 'not_needed', steps: [] };
  const steps = [];
  let failed = false;
  for (const step of cleanupPlan) {
    const execution = executeStep(step, runID, resources);
    steps.push(execution.result);
    if (execution.code) failed = true;
  }
  return { status: failed ? 'failed' : 'success', steps };
}

function runRecipe(recipe, plan, asJSON) {
  const runID = cryptoRandomID();
  const resources = resolvedResources(recipe, runID);
  const ownedResources = resolvedOwnedResources(recipe, runID, resources);
  const mutates = recipePlanMutates(recipe, plan);
  const mainPlan = plan.filter((step) => !step.finally);
  const cleanupPlan = plan.filter((step) => step.finally);
  if (mutates) validateCleanupSafety(cleanupPlan, ownedResources, runID, resources);
  else if (cleanupPlan.length) {
    const result = opsResult('failure', 'INVALID_RECIPE', `Read-only recipe ${recipe.id} must not declare cleanup finally steps.`, recipe, false, plan.map((step) => stepResult(step, 'skipped', null, null)), [], { status: 'not_needed', steps: [] });
    emitJSON(result, true);
    process.exit(1);
  }
  const stepResults = [];
  let failureCode = null;
  let failureError = null;
  for (const step of mainPlan) {
    const execution = executeStep(step, runID, resources);
    stepResults.push(execution.result);
    if (execution.code) {
      failureCode = execution.code;
      failureError = execution.error;
      break;
    }
  }
  const cleanup = mutates ? runCleanup(cleanupPlan, runID, resources) : { status: 'not_needed', steps: [] };
  const mutatedResources = ownedResourcesJSON(ownedResources, runID, cleanup.status === 'not_needed' ? undefined : cleanup.status);
  if (cleanup.status === 'failed') {
    emitJSON(opsResult('partial', 'CLEANUP_FAILED', failureError ? `${failureError} Cleanup also failed.` : `Cleanup failed for ${recipe.id}.`, recipe, false, stepResults, mutatedResources, cleanup), true);
    process.exit(1);
  }
  if (failureCode) {
    emitJSON(opsResult('failure', failureCode, failureError, recipe, false, stepResults, mutatedResources, cleanup), true);
    process.exit(1);
  }
  const result = opsResult('success', 'OK', null, recipe, false, stepResults, mutatedResources, cleanup);
  if (asJSON) emitJSON(result, false);
  else emitRunText(recipe, result);
}

function cryptoRandomID() {
  return Math.random().toString(16).slice(2, 10);
}

function emitList(recipes, asJSON) {
  if (asJSON) emitJSON({ status: 'success', recipes: recipes.map(recipeSummary) }, false);
  else for (const recipe of recipes) process.stdout.write(`${recipe.id}${recipe.summary ? ` - ${recipe.summary}` : ''}\n`);
}

function emitExplain(recipe, plan, asJSON) {
  if (asJSON) {
    emitJSON({ status: 'success', surface: publicSurface(), recipe: recipeSummary(recipe), parameters: recipe.manifest.parameters || {}, resources: recipe.manifest.resources || {}, mutates: recipePlanMutates(recipe, plan), steps: plan.map(stepPlanJSON) }, false);
    return;
  }
  process.stdout.write(`${recipe.id} v${recipe.version}\n`);
  if (recipe.summary) process.stdout.write(`${recipe.summary}\n`);
  for (const step of plan) {
    const label = step.kind === 'shell' ? step.script : `${step.commandPath.join(' ')} ${step.argv.join(' ')}`;
    process.stdout.write(`- ${step.id}: ${step.kind} ${label} [${step.mutates ? 'mutates' : 'read-only'}]\n`);
  }
}

function emitDryRunText(recipe, plan, ownedResources, runID, resources) {
  const mutatingCount = plan.filter((step) => step.mutates).length;
  process.stdout.write(`dry-run ${recipe.id} v${recipe.version}: ${plan.length} step(s), ${mutatingCount} mutating\n`);
  for (const resource of ownedResources) process.stdout.write(`- owns ${resource.type} ${resource.id} as ${resource.name}\n`);
  for (const step of plan) {
    const argv = step.argv.map((item) => resolveTemplate(item, runID, resources));
    const command = step.kind === 'shell'
      ? [step.script, ...argv].join(' ')
      : [invocationName(), ...step.commandPath, ...argv].join(' ');
    process.stdout.write(`- ${step.id}: ${step.kind} ${command} [${step.mutates ? 'mutates' : 'read-only'}, planned]\n`);
  }
}

function emitRunText(recipe, result) {
  process.stdout.write(`success ${recipe.id} v${recipe.version}: ${result.steps.length} step(s)\n`);
  for (const resource of result.mutated_resources) process.stdout.write(`- owns ${resource.type} ${resource.id}${resource.cleanup_status ? `, cleanup=${resource.cleanup_status}` : ''}\n`);
  for (const step of result.steps) process.stdout.write(`- ${step.id}: ${step.status}${Number.isInteger(step.duration_ms) ? ` ${step.duration_ms}ms` : ''}\n`);
  if (result.cleanup.status !== 'not_needed') process.stdout.write(`- cleanup: ${result.cleanup.status} ${result.cleanup.steps.length} step(s)\n`);
}

function findRecipe(id) {
  const recipe = loadRecipes().find((item) => item.id === id);
  if (!recipe) throw new OpsFailure(`Recipe not found: ${id}`, 'RECIPE_NOT_FOUND');
  return recipe;
}

function singleRecipeID(positional, usage) {
  if (positional.length === 0 || !positional[0]) throw new OpsFailure(`Usage: ${invocationName()} ${usage}`, 'MISSING_ARG');
  if (positional.length > 1) throw new OpsFailure(`Unknown argument: ${positional[1]}`, 'UNKNOWN_ARG');
  return positional[0];
}

function main() {
  try {
    const { subcommand, json, positional } = parseArgs(process.argv.slice(2));
    if (!subcommand) {
      process.stdout.write(`Usage: aos ${publicSurface()} <list|explain|dry-run|run> ...\n`);
      return;
    }
    if (subcommand === 'list') {
      if (positional.length) throw new OpsFailure(`Unknown argument: ${positional[0]}`, 'UNKNOWN_ARG');
      emitList(loadRecipes(), json);
    } else if (subcommand === 'explain') {
      const recipe = findRecipe(singleRecipeID(positional, `${publicSurface()} explain <id> [--json]`));
      emitExplain(recipe, planRecipe(recipe), json);
    } else if (subcommand === 'dry-run') {
      const recipe = findRecipe(singleRecipeID(positional, `${publicSurface()} dry-run <id> [--json]`));
      const plan = planRecipe(recipe);
      const runID = 'dry-run';
      const resources = resolvedResources(recipe, runID);
      const owned = resolvedOwnedResources(recipe, runID, resources);
      if (json) {
        const steps = plan.map((step) => stepResult(step, 'planned', null, null, step.argv.map((item) => resolveTemplate(item, runID, resources))));
        const cleanupPlan = plan.filter((step) => step.finally);
        const cleanup = cleanupPlan.length ? { status: 'planned', steps: cleanupPlan.map((step) => stepResult(step, 'planned', null, null, step.argv.map((item) => resolveTemplate(item, runID, resources)))) } : { status: 'not_needed', steps: [] };
        const result = opsResult('dry_run', 'OK', null, recipe, true, steps, ownedResourcesJSON(owned, runID, 'planned'), cleanup);
        result.parameters = recipe.manifest.parameters || {};
        result.resources = resources;
        emitJSON(result, false);
      } else emitDryRunText(recipe, plan, owned, runID, resources);
    } else if (subcommand === 'run') {
      const recipe = findRecipe(singleRecipeID(positional, `${publicSurface()} run <id> [--json]`));
      runRecipe(recipe, planRecipe(recipe), json);
    } else {
      throw new OpsFailure(`Unknown ${publicSurface()} subcommand: ${subcommand}`, 'UNKNOWN_SUBCOMMAND');
    }
  } catch (err) {
    if (err instanceof OpsFailure) exitFailure(err.message, err.code);
    exitFailure(String(err.stack || err), 'INTERNAL');
  }
}

main();

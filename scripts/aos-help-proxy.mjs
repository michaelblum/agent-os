#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function prettyJSON(value) {
  return JSON.stringify(value, null, 2).replace(/":/g, '" :');
}

function error(message, code) {
  process.stderr.write(`${prettyJSON({ code, error: message })}\n`);
  process.exit(1);
}

function repoRootFrom(startDir) {
  const result = spawnSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], {
    cwd: startDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status === 0) {
    const root = result.stdout.trim();
    if (root) return root;
  }
  return startDir;
}

function registryPath() {
  if (process.env.AOS_COMMAND_REGISTRY) return process.env.AOS_COMMAND_REGISTRY;
  return path.join(repoRootFrom(process.cwd()), 'manifests/commands/aos-commands.json');
}

function externalManifestPath() {
  if (process.env.AOS_EXTERNAL_COMMAND_MANIFEST) return process.env.AOS_EXTERNAL_COMMAND_MANIFEST;
  return path.join(repoRootFrom(process.cwd()), 'manifests/commands/aos-external-commands.json');
}

function loadRegistry() {
  const file = registryPath();
  try {
    const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(registry.commands)) {
      error(`Invalid command registry manifest ${file}: missing commands`, 'INVALID_COMMAND_REGISTRY');
    }
    return registry;
  } catch (err) {
    if (err?.code === 'ENOENT') {
      error(`Missing command registry manifest. Checked: ${file}`, 'MISSING_COMMAND_REGISTRY');
    }
    error(`Invalid command registry manifest ${file}: ${err.message}`, 'INVALID_COMMAND_REGISTRY');
  }
}

function loadExternalManifest() {
  const file = externalManifestPath();
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(manifest.commands)) {
      error(`Invalid external command manifest ${file}: missing commands`, 'INVALID_MANIFEST');
    }
    return manifest;
  } catch (err) {
    if (err?.code === 'ENOENT') return { commands: [] };
    error(`Invalid external command manifest ${file}: ${err.message}`, 'INVALID_MANIFEST');
  }
}

function recipeCommandFromOps(command) {
  if (!arrayEqual(command.path || [], ['ops'])) return null;
  return {
    ...command,
    path: ['recipe'],
    summary: 'Recipes — discover, explain, dry-run, and run source-backed executable recipes',
    forms: (command.forms || []).map((form) => ({
      ...form,
      id: String(form.id).replace(/^ops-/, 'recipe-'),
      usage: String(form.usage).replace('aos ops ', 'aos recipe '),
      examples: (form.examples || []).map((example) => String(example).replace('aos ops ', 'aos recipe ')),
    })),
  };
}

function withRecipeAlias(registry) {
  if ((registry.commands || []).some((command) => arrayEqual(command.path || [], ['recipe']))) return registry;
  const ops = (registry.commands || []).find((command) => arrayEqual(command.path || [], ['ops']));
  const recipe = ops ? recipeCommandFromOps(ops) : null;
  if (!recipe) return registry;
  return { ...registry, commands: [...registry.commands, recipe] };
}

function invocationDisplayName() {
  if (process.env.AOS_INVOCATION_DISPLAY_NAME) return process.env.AOS_INVOCATION_DISPLAY_NAME;
  return './aos';
}

function renderInvocationText(value) {
  return String(value).replaceAll('aos ', `${invocationDisplayName()} `);
}

function findCommand(commands, pathArgs) {
  const exact = commands.find((command) => arrayEqual(command.path, pathArgs));
  if (exact) return exact;
  if (pathArgs.length < 2) return null;
  const parentPath = pathArgs.slice(0, -1);
  const sub = pathArgs[pathArgs.length - 1];
  const formPrefix = `${parentPath[parentPath.length - 1]}-${sub}`;
  const parent = commands.find((command) => arrayEqual(command.path, parentPath));
  if (!parent) return null;
  const forms = (parent.forms || []).filter((form) => String(form.id).startsWith(formPrefix));
  if (forms.length === 0) return null;
  return { ...parent, path: pathArgs, forms };
}

function arrayEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function externalRouteMatches(command, args) {
  if (args.length < command.path.length) return false;
  if (!command.path.every((part, index) => args[index] === part)) return false;
  if (!command.when) return true;
  const childArgs = args.slice(command.path.length);
  const childArgIndex = command.when.child_arg_index;
  if (childArgIndex === undefined) return true;
  const childArg = childArgs[childArgIndex];
  if (childArg === undefined) return command.when.child_arg_missing === true;
  if (command.when.child_arg_missing === true) return false;
  if (command.when.prefix !== undefined && !childArg.startsWith(command.when.prefix)) return false;
  if (command.when.excluded_prefixes?.some((prefix) => childArg.startsWith(prefix))) return false;
  if (command.when.excluded_values?.includes(childArg)) return false;
  return true;
}

function findHelpPassthrough(pathArgs) {
  const manifest = loadExternalManifest();
  return (manifest.commands || [])
    .filter((command) => command.help_passthrough === true)
    .filter((command) => externalRouteMatches(command, pathArgs))
    .sort((left, right) => right.path.length - left.path.length)[0] ?? null;
}

function resolveExternalValue(value, repoRoot) {
  if (value === '$REPO_ROOT') return repoRoot;
  if (value?.startsWith('$REPO_ROOT/')) return path.join(repoRoot, value.slice('$REPO_ROOT/'.length));
  if (value === '$AOS_PATH') return process.env.AOS_PATH || './aos';
  if (value === '$AOS_INVOCATION_DISPLAY_NAME') return invocationDisplayName();
  if (value === '$AOS_RUNTIME_MODE') return process.env.AOS_RUNTIME_MODE || 'repo';
  if (value === '$AOS_STATE_ROOT') return process.env.AOS_STATE_ROOT || '';
  if (value === '$AOS_SESSION_KEY') return process.env.AOS_SESSION_KEY || '';
  if (value === '$AOS_SESSION_HARNESS') return process.env.AOS_SESSION_HARNESS || '';
  return value;
}

function runHelpPassthrough(command, pathArgs) {
  const repoRoot = repoRootFrom(process.cwd());
  const childArgs = pathArgs.slice(command.path.length);
  const executable = resolveExternalValue(command.executable, repoRoot);
  const argv = (command.argv_prefix || []).map((arg) => resolveExternalValue(arg, repoRoot)).concat(childArgs, '--help');
  const cwd = command.cwd === 'repo'
    ? repoRoot
    : command.cwd
      ? resolveExternalValue(command.cwd, repoRoot)
      : process.cwd();
  const env = { ...process.env };
  for (const [key, value] of Object.entries(command.env || {})) {
    env[key] = resolveExternalValue(value, repoRoot);
  }
  if (!env.AOS_INVOCATION_DISPLAY_NAME) env.AOS_INVOCATION_DISPLAY_NAME = invocationDisplayName();

  const result = spawnSync(executable, argv, { cwd, env, encoding: 'utf8' });
  if (result.error) {
    error(`Help passthrough failed for ${command.path.join(' ')}: ${result.error.message}`, 'HELP_PASSTHROUGH_FAILED');
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

function printFullRegistryJSON(registry) {
  process.stdout.write(`${prettyJSON(registry)}\n`);
}

function printCommandJSON(command) {
  process.stdout.write(`${prettyJSON(command)}\n`);
}

function printFullRegistryText(registry) {
  const prefix = invocationDisplayName();
  const commands = registry.commands || [];
  const verbs = new Map();
  for (const command of commands) {
    const verb = command.path?.[0] || 'other';
    if (!verbs.has(verb)) verbs.set(verb, []);
    verbs.get(verb).push(command);
  }

  const preferredVerbOrder = [
    'status',
    'recipe',
    'ops',
    'see',
    'do',
    'show',
    'focus',
    'graph',
    'introspect',
    'wiki',
    'tell',
    'listen',
    'say',
    'voice',
    'config',
    'set',
    'content',
    'serve',
    'service',
    'runtime',
    'dev',
    'permissions',
    'doctor',
    'clean',
    'reset',
    'daemon-snapshot',
    'inspect',
    'log',
  ];
  const ordered = [
    ...preferredVerbOrder.filter((verb) => verbs.has(verb)),
    ...[...verbs.keys()].filter((verb) => !preferredVerbOrder.includes(verb)).sort(),
  ];

  const lines = [
    `${prefix} — agent operating system\n`,
    `Usage: ${prefix} <command> [options]\n`,
    'Commands:',
  ];
  for (const verb of ordered) {
    const group = verbs.get(verb);
    const topLevel = group.find((command) => command.path.length === 1);
    const summary = topLevel?.summary || group[0]?.summary || '';
    lines.push(`  ${verb.padEnd(20, ' ')}${summary}`);
    for (const sub of group.filter((command) => command.path.length > 1)) {
      const subName = sub.path.slice(1).join(' ');
      lines.push(`    ${subName.padEnd(18, ' ')}${sub.summary}`);
    }
  }
  lines.push(`\nRun '${prefix} help <command> [--json]' for details on a specific command.`);
  lines.push(`Run '${prefix} help --json' for machine-readable full registry.`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printCommandText(command) {
  const prefix = invocationDisplayName();
  const lines = [`${prefix} ${command.path.join(' ')} — ${command.summary}\n`];
  for (const form of command.forms || []) {
    lines.push(`  ${renderInvocationText(form.usage)}`);
    if (form.args?.length) {
      lines.push('');
      for (const arg of form.args) {
        const name = arg.token || `<${arg.id}>`;
        const req = arg.required ? ' (required)' : '';
        const def = arg.default_value === undefined ? '' : ` [default: ${formatJSONValue(arg.default_value)}]`;
        lines.push(`    ${name}\t${arg.summary}${req}${def}`);
      }
    }
    if (form.stdin?.supported) {
      lines.push(`    stdin\t${form.stdin.used_when} (${form.stdin.content_type})`);
    }
    const tags = [];
    if (form.execution?.read_only) tags.push('read-only');
    if (form.execution?.mutates_state) tags.push('mutates-state');
    if (form.execution?.interactive) tags.push('interactive');
    if (form.execution?.streaming) tags.push('streaming');
    if (form.execution?.auto_starts_daemon) tags.push('auto-starts-daemon');
    if (form.execution?.requires_permissions) tags.push('requires-permissions');
    if (tags.length) lines.push(`    [execution: ${tags.join(', ')}]`);
    lines.push(`    [output: ${form.output.default_mode}${form.output.supports_json_flag ? ', supports --json' : ''}]`);
    if (form.examples?.length) {
      lines.push('\n  Examples:');
      for (const example of form.examples) lines.push(`    ${renderInvocationText(example)}`);
    }
    lines.push('');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function formatJSONValue(value) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  return String(value);
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const pathArgs = args.filter((arg) => !['--json', '--help', '-h'].includes(arg));
const registry = withRecipeAlias(loadRegistry());

if (pathArgs.length === 0) {
  if (jsonMode) printFullRegistryJSON(registry);
  else printFullRegistryText(registry);
} else {
  if (!jsonMode) {
    const passthrough = findHelpPassthrough(pathArgs);
    if (passthrough) runHelpPassthrough(passthrough, pathArgs);
  }

  const command = findCommand(registry.commands, pathArgs);
  if (!command) {
    error(`Unknown command: ${pathArgs.join(' ')}. Run '${invocationDisplayName()} help --json' for full registry.`, 'UNKNOWN_COMMAND');
  }
  if (jsonMode) printCommandJSON(command);
  else printCommandText(command);
}

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
const registry = loadRegistry();

if (pathArgs.length === 0) {
  if (jsonMode) printFullRegistryJSON(registry);
  else printFullRegistryText(registry);
} else {
  const command = findCommand(registry.commands, pathArgs);
  if (!command) {
    error(`Unknown command: ${pathArgs.join(' ')}. Run '${invocationDisplayName()} help --json' for full registry.`, 'UNKNOWN_COMMAND');
  }
  if (jsonMode) printCommandJSON(command);
  else printCommandText(command);
}

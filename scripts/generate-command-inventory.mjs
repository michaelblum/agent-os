#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const aosSourceDir = path.join(repoRoot, 'manifests/commands/source/aos');
const registryPath = path.join(repoRoot, 'manifests/commands/aos-commands.json');
const externalManifestPath = path.join(repoRoot, 'manifests/commands/aos-external-commands.json');
const outputPath = path.join(repoRoot, 'docs/dev/reports/aos-command-capability-inventory-v0.md');

const SOURCE_FILE_RE = /^\d{2}-[a-z0-9_.-]+\.json$/;
const CAPABILITY_DOC_GROUPS = new Set([
  'Core desktop',
  'Core readiness',
  'Desktop discovery',
  'Capture and perception',
  'Saved workspace',
  'Desktop/native control',
  'Pointer and keyboard',
  'Canvas and vision',
  'Browser companion',
  'Overlay/display',
  'Diagnostics/debug',
  'Verification/evidence',
  'Operator input',
  'Skills and recipes',
  'Runtime/service',
]);

function usage() {
  return `Usage: node scripts/generate-command-inventory.mjs [--check]\n`;
}

function fail(message) {
  process.stderr.write(`generate-command-inventory: ${message}\n`);
  process.exit(1);
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    fail(`cannot read ${path.relative(repoRoot, file)}: ${err.message}`);
  }
}

function pathKey(parts) {
  return parts.join('\0');
}

function displayPath(parts) {
  return parts.join(' ');
}

function relative(file) {
  return path.relative(repoRoot, file);
}

function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

function code(value) {
  if (!value) return '';
  return `\`${escapeCell(value)}\``;
}

function boolText(value) {
  return value ? 'yes' : 'no';
}

function arrayEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function startsWithPath(pathArgs, prefix) {
  return prefix.length <= pathArgs.length && prefix.every((value, index) => pathArgs[index] === value);
}

function concreteUsagePath(form) {
  const usage = form?.usage;
  if (typeof usage !== 'string') return null;
  const aosUsage = usage.startsWith('aos ')
    ? usage
    : usage.split(/\s+\|\s+/).find((part) => part.startsWith('aos '));
  if (!aosUsage) return null;
  const concrete = [];
  for (const token of aosUsage.split(/\s+/).slice(1)) {
    if (
      token.startsWith('[')
      || token.startsWith('(')
      || token.startsWith('<')
      || token.startsWith('--')
    ) {
      break;
    }
    concrete.push(token);
  }
  return concrete;
}

function sourceIDFromFile(file) {
  return file.replace(/^\d{2}-/, '').replace(/\.json$/, '');
}

async function sourceFiles(dir) {
  const entries = await fs.readdir(dir);
  const files = entries.filter((entry) => entry.endsWith('.json')).sort();
  for (const file of files) {
    if (!SOURCE_FILE_RE.test(file)) fail(`${relative(path.join(dir, file))} must use NN-family.json naming`);
  }
  return files.map((file) => path.join(dir, file));
}

async function buildSourceIndex() {
  const formSources = new Map();
  const commandSources = new Map();
  for (const file of await sourceFiles(aosSourceDir)) {
    const doc = await readJSON(file);
    const rel = relative(file);
    if (doc.id !== sourceIDFromFile(path.basename(file))) {
      fail(`${rel} id must match filename`);
    }
    for (const command of doc.commands || []) {
      const key = pathKey(command.path || []);
      commandSources.set(key, [...(commandSources.get(key) ?? []), rel]);
      for (const form of command.forms || []) {
        formSources.set(form.id, rel);
      }
    }
  }
  return { commandSources, formSources };
}

function routeCandidates(routes, pathArgs) {
  const exact = routes.filter((route) => arrayEqual(route.path || [], pathArgs));
  if (exact.length) return exact;
  return routes
    .filter((route) => startsWithPath(pathArgs, route.path || []))
    .sort((left, right) => right.path.length - left.path.length)
    .filter((route, index, list) => route.path.length === list[0].path.length);
}

function whenSummary(route) {
  const when = route.when || {};
  const parts = [];
  if (when.child_arg_missing === true) parts.push('missing child');
  if (when.prefix) parts.push(`prefix ${when.prefix}`);
  if (when.excluded_prefixes?.length) parts.push(`not ${when.excluded_prefixes.join('/')}`);
  if (when.excluded_values?.length) parts.push(`not ${when.excluded_values.slice(0, 4).join('/')}...`);
  if (!parts.length && when.child_arg_index !== undefined) parts.push(`child ${when.child_arg_index}`);
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

function routeSummary(routes, pathArgs) {
  const candidates = routeCandidates(routes, pathArgs);
  if (!candidates.length) return 'missing external route';
  const rendered = new Set(candidates.map((route) => `${(route.argv_prefix || []).join(' ')}${whenSummary(route)}`));
  return [...rendered].join('; ');
}

function mutability(form) {
  const execution = form?.execution || {};
  if (execution.mutates_when_flags?.length) return `conditional ${execution.mutates_when_flags.join('/')}`;
  if (execution.mutates_state === true) return 'mutates';
  if (execution.read_only === true) return 'read-only';
  return 'unspecified';
}

function jsonMode(form) {
  const output = form?.output || {};
  const conditional = (output.conditional_modes || []).some((mode) => (
    mode.default_mode === 'json'
    || mode.default_mode === 'ndjson'
    || mode.supports_json_flag === true
  ));
  if (output.supports_json_flag === true) return '--json';
  if (output.default_mode === 'json' || output.default_mode === 'ndjson') return 'default';
  if (conditional) return 'conditional';
  return 'no';
}

function isPublic(command) {
  return command.consumer_discovery !== false;
}

function capabilityGroup(command, form) {
  const pathArgs = command.path || [];
  const top = pathArgs[0] || '';
  const second = pathArgs[1] || '';
  const id = form?.id || '';

  if (top === 'launch' || top === 'experience' || top === 'focus') return 'Core desktop';
  if (top === 'ready' || top === 'status' || top === 'doctor') return 'Core readiness';
  if (top === 'permissions') {
    return id === 'permissions-reset-runtime' ? 'Runtime/service' : 'Core readiness';
  }
  if (top === 'graph') return 'Desktop discovery';
  if (top === 'see' && second === 'annotation') return 'Operator input';
  if (top === 'see' && second === 'zone') return 'Canvas and vision';
  if (top === 'see' && ['see-refs', 'see-workspaces', 'see-workspace', 'see-workspace-prune', 'see-workspace-delete', 'see-snapshot-delete'].includes(id)) {
    return 'Saved workspace';
  }
  if (top === 'see') return 'Capture and perception';
  if (top === 'do' && ['do-press', 'do-set-value', 'do-focus', 'do-raise', 'do-move', 'do-resize'].includes(id)) {
    return 'Desktop/native control';
  }
  if (top === 'do' && ['do-drag-canvas'].includes(id)) return 'Canvas and vision';
  if (top === 'do' && ['do-type-browser', 'do-key-browser', 'do-fill', 'do-navigate'].includes(id)) return 'Browser companion';
  if (top === 'do' && ['do-click', 'do-hover', 'do-drag', 'do-drag-native', 'do-scroll', 'do-type', 'do-type-ref', 'do-key', 'do-key-ref'].includes(id)) {
    return 'Pointer and keyboard';
  }
  if (top === 'do') return 'Desktop/native control';
  if (top === 'show') return 'Overlay/display';
  if (top === 'scene') return 'Overlay/display';
  if (top === 'browser') return 'Browser companion';
  if (top === 'skills' && second === 'companion') return 'Browser companion';
  if (top === 'skills' || top === 'recipe') return 'Skills and recipes';
  if (top === 'gate' || top === 'work-record') return 'Verification/evidence';
  if (top === 'tell' || top === 'listen') return 'Operator messaging';
  if (top === 'say' || top === 'voice' || top === 'play') return 'Voice and speech';
  if (top === 'shortcut') return 'Desktop/native control';
  if (top === 'wiki' || top === 'content') return 'Content/wiki';
  if (top === 'config' || top === 'set') return 'Storage/config';
  if (top === 'service' || top === 'runtime' || top === 'serve' || top === 'reset' || top === 'clean') return 'Runtime/service';
  if (top === 'daemon-snapshot' || top === 'inspect' || top === 'introspect' || top === 'log') return 'Diagnostics/debug';
  if (top === 'help') return 'CLI metadata';
  return 'Unclassified';
}

function docRefs(command, group) {
  const groups = String(group).split(', ');
  const refs = new Set();
  if (isPublic(command)) refs.add('docs/api/aos.md');
  if (groups.some((item) => CAPABILITY_DOC_GROUPS.has(item))) refs.add('docs/api/aos-capabilities.md');
  if (!isPublic(command)) refs.add('docs/dev/command-surface.md');
  if (groups.includes('Diagnostics/debug')) refs.add('docs/dev/command-surface.md');
  return [...refs].join(', ') || 'source manifest only';
}

function formRows(registry, externalRoutes, sourceIndex) {
  const rows = [];
  for (const command of registry.commands || []) {
    for (const form of command.forms || []) {
      const concrete = concreteUsagePath(form) || command.path || [];
      const group = capabilityGroup(command, form);
      rows.push({
        command: displayPath(concrete),
        form: form.id,
        group,
        public: boolText(isPublic(command)),
        mutability: mutability(form),
        json: jsonMode(form),
        dryRun: boolText(form.execution?.supports_dry_run === true),
        source: sourceIndex.formSources.get(form.id) || (sourceIndex.commandSources.get(pathKey(command.path || [])) || []).join(', '),
        implementation: routeSummary(externalRoutes, concrete),
        docs: docRefs(command, group),
      });
    }
  }
  return rows;
}

function commandRows(registry, sourceIndex, externalRoutes) {
  return (registry.commands || []).map((command) => {
    const key = displayPath(command.path || []);
    const forms = command.forms || [];
    const groups = new Set(forms.map((form) => capabilityGroup(command, form)));
    if (!groups.size) groups.add(capabilityGroup(command, null));
    const mutabilitySet = new Set(forms.map((form) => mutability(form)));
    const jsonSet = new Set(forms.map((form) => jsonMode(form)));
    const group = groups.size === 1 ? [...groups][0] : [...groups].join(', ');
    return {
      command: key,
      forms: String(forms.length),
      group,
      public: boolText(isPublic(command)),
      mutability: forms.length ? [...mutabilitySet].sort().join(', ') : 'family only',
      json: forms.length ? [...jsonSet].sort().join(', ') : 'family only',
      source: (sourceIndex.commandSources.get(pathKey(command.path || [])) || []).join(', '),
      implementation: routeSummary(externalRoutes, command.path || []),
      docs: docRefs(command, group),
    };
  });
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) || 0) + 1);
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function table(headers, rows) {
  const lines = [
    `| ${headers.map((header) => escapeCell(header.label)).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => {
      const value = row[header.key];
      return header.code ? code(value) : escapeCell(value);
    }).join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderSummary(registry, formRowsList, commandRowsList) {
  const publicForms = formRowsList.filter((row) => row.public === 'yes').length;
  const mutatingForms = formRowsList.filter((row) => row.mutability.includes('mutates') || row.mutability.includes('conditional')).length;
  const unspecifiedMutabilityForms = formRowsList.filter((row) => row.mutability === 'unspecified').length;
  const jsonForms = formRowsList.filter((row) => row.json !== 'no').length;
  const dryRunForms = formRowsList.filter((row) => row.dryRun === 'yes').length;
  const internalCommands = commandRowsList.filter((row) => row.public === 'no').length;
  return [
    `- Command paths: ${registry.commands.length}`,
    `- Concrete forms: ${formRowsList.length}`,
    `- Consumer-discoverable forms: ${publicForms}`,
    `- Internal/transitional command paths: ${internalCommands}`,
    `- Mutating or conditionally mutating forms: ${mutatingForms}`,
    `- Forms with unspecified mutability metadata: ${unspecifiedMutabilityForms}`,
    `- Forms with JSON output path: ${jsonForms}`,
    `- Forms with dry-run support: ${dryRunForms}`,
  ].join('\n');
}

function validateInventoryRows(forms, commands) {
  const unclassified = [...forms, ...commands].filter((row) => String(row.group).includes('Unclassified'));
  if (unclassified.length) {
    fail(`unclassified command inventory rows: ${unclassified.map((row) => row.form || row.command).join(', ')}`);
  }
  const missingRoutes = [...forms, ...commands].filter((row) => row.implementation === 'missing external route');
  if (missingRoutes.length) {
    fail(`command inventory rows missing external routes: ${missingRoutes.map((row) => row.form || row.command).join(', ')}`);
  }
  const unspecified = forms.filter((row) => row.mutability === 'unspecified');
  if (unspecified.length) {
    fail(`command inventory forms missing mutability metadata: ${unspecified.map((row) => row.form).join(', ')}`);
  }
}

function renderInventory(registry, externalManifest, sourceIndex) {
  const forms = formRows(registry, externalManifest.commands || [], sourceIndex);
  const commands = commandRows(registry, sourceIndex, externalManifest.commands || []);
  validateInventoryRows(forms, commands);
  const groupCounts = countBy(forms, 'group').map(([group, count]) => ({ group, forms: String(count) }));

  return `# AOS Command Capability Inventory

Generated from \`manifests/commands/source/aos/\`,
\`manifests/commands/aos-commands.json\`, and
\`manifests/commands/aos-external-commands.json\`.

Do not hand-edit this report. Update source command manifests or
\`scripts/generate-command-inventory.mjs\`, then run:

\`\`\`bash
node scripts/generate-command-inventory.mjs
\`\`\`

This is a development inventory, not a consumer API contract. Use
\`docs/api/aos-capabilities.md\` for the public desktop-agent capability map.
The "group" column is a proposed capability classification used to audit the
current command tree before public CLI and self-hosting boundary changes.

## Summary

${renderSummary(registry, forms, commands)}

## Capability Group Counts

${table([
    { key: 'group', label: 'Group' },
    { key: 'forms', label: 'Forms' },
  ], groupCounts)}

## Command Paths

${table([
    { key: 'command', label: 'Command path', code: true },
    { key: 'forms', label: 'Forms' },
    { key: 'group', label: 'Group' },
    { key: 'public', label: 'Public' },
    { key: 'mutability', label: 'Mutability' },
    { key: 'json', label: 'JSON' },
    { key: 'source', label: 'Source manifest', code: true },
    { key: 'implementation', label: 'External implementation', code: true },
    { key: 'docs', label: 'Doc owner(s)', code: true },
  ], commands)}

## Concrete Forms

${table([
    { key: 'command', label: 'Concrete command', code: true },
    { key: 'form', label: 'Form id', code: true },
    { key: 'group', label: 'Group' },
    { key: 'public', label: 'Public' },
    { key: 'mutability', label: 'Mutability' },
    { key: 'json', label: 'JSON' },
    { key: 'dryRun', label: 'Dry-run' },
    { key: 'source', label: 'Source manifest', code: true },
    { key: 'implementation', label: 'External implementation', code: true },
    { key: 'docs', label: 'Doc owner(s)', code: true },
  ], forms)}
`;
}

function firstDiff(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

async function writeOrCheck(content, check) {
  if (!check) {
    await fs.writeFile(outputPath, content);
    process.stdout.write(`generated ${relative(outputPath)}\n`);
    return;
  }
  let current;
  try {
    current = await fs.readFile(outputPath, 'utf8');
  } catch (err) {
    fail(`cannot read ${relative(outputPath)} for drift check: ${err.message}`);
  }
  if (current === content) {
    process.stdout.write('command capability inventory is generated and up to date\n');
    return;
  }
  fail(`${relative(outputPath)} is out of date; first byte diff at ${firstDiff(current, content)}. Run node scripts/generate-command-inventory.mjs`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  const check = args.includes('--check');
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length) fail(`unknown arguments: ${unknown.join(' ')}`);

  const [registry, externalManifest, sourceIndex] = await Promise.all([
    readJSON(registryPath),
    readJSON(externalManifestPath),
    buildSourceIndex(),
  ]);
  if (!Array.isArray(registry.commands)) fail(`${relative(registryPath)} missing commands`);
  if (!Array.isArray(externalManifest.commands)) fail(`${relative(externalManifestPath)} missing commands`);
  await writeOrCheck(renderInventory(registry, externalManifest, sourceIndex), check);
}

main().catch((err) => fail(err.stack || err.message));

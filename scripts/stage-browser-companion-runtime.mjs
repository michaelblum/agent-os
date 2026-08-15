#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const resourceRoot = path.resolve(String(process.argv[2] || ''));

function fail(message) {
  process.stderr.write(`stage-browser-companion-runtime: ${message}\n`);
  process.exit(1);
}

if (!process.argv[2] || resourceRoot === path.parse(resourceRoot).root) {
  fail('one non-root resource destination is required.');
}

function copyFile(relative) {
  const source = path.join(repoRoot, relative);
  const destination = path.join(resourceRoot, relative);
  if (!fs.statSync(source).isFile()) fail(`required source is not a file: ${relative}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyModules() {
  const relativeRoot = 'scripts/lib/browser-companion';
  const sourceRoot = path.join(repoRoot, relativeRoot);
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) copyFile(path.join(relativeRoot, entry.name));
  }
}

function copyDirectoryModules(relativeRoot) {
  const sourceRoot = path.join(repoRoot, relativeRoot);
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) copyFile(path.join(relativeRoot, entry.name));
  }
}

copyFile('scripts/aos-browser-companion.mjs');
copyFile('scripts/aos-browser-broker.mjs');
copyFile('scripts/aos-browser-worker-guardian.mjs');
copyFile('scripts/aos-browser-worker-group.mjs');
copyFile('scripts/aos-browser-internal.mjs');
copyFile('scripts/aos-do-browser.mjs');
copyFile('scripts/aos-focus-graph.mjs');
copyFile('scripts/aos-see-native.mjs');
copyFile('scripts/aos-agent-workspace.mjs');
copyFile('scripts/browser-evidence-capture.mjs');
copyFile('scripts/aos-help-proxy.mjs');
copyFile('scripts/lib/external-command-routes.mjs');
copyFile('scripts/lib/focus-daemon.mjs');
copyFile('scripts/lib/focus-depth.mjs');
copyFile('scripts/lib/aos-agent-workspace.mjs');
copyFile('scripts/lib/aos-see-child-runner.mjs');
copyFile('scripts/lib/aos-see-supervision.mjs');
copyFile('scripts/lib/target-handle-runtime.mjs');
copyModules();
copyDirectoryModules('scripts/lib/agent-workspace');
copyFile('packages/toolkit/package.json');
copyFile('packages/toolkit/workbench/browser-evidence-capture.js');
copyFile('packages/toolkit/workbench/browser-evidence-model.js');
copyFile('manifests/companions/playwright-cli-v1.json');
copyFile('shared/schemas/aos-browser-companion-descriptor-v1.schema.json');
copyFile('shared/schemas/aos-browser-companion-result-v1.schema.json');
copyFile('shared/schemas/aos-browser-session-result-v1.schema.json');
copyFile('shared/schemas/aos-browser-backend-identity-v2.schema.json');
copyFile('shared/schemas/browser-evidence-capture-v0.schema.json');

const sourceManifest = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'manifests/commands/aos-external-commands.json'),
  'utf8',
));
const companionCommands = sourceManifest.commands.filter((command) =>
  command.path[0] === 'browser' && command.path[1] === 'companion');
if (companionCommands.length !== 5) fail('generated external manifest has an incomplete browser companion family.');
const browserCommands = sourceManifest.commands.filter((command) => command.path[0] === 'browser');
if (browserCommands.length !== 10) fail('generated external manifest has an incomplete managed browser family.');
const focusCommands = sourceManifest.commands.filter((command) => command.path[0] === 'focus');
if (focusCommands.length !== 5) fail('generated external manifest has an incomplete managed focus family.');
const allBrowserConsumerCommands = sourceManifest.commands.filter((command) =>
  command.argv_prefix?.some((value) => value.endsWith('/scripts/aos-do-browser.mjs') || value.endsWith('/scripts/aos-see-native.mjs')));
if (allBrowserConsumerCommands.length !== 10) fail('generated external manifest has an incomplete managed browser consumer family.');
const stagedDoOperations = new Set(['scroll', 'type', 'key', 'navigate']);
const browserConsumerCommands = allBrowserConsumerCommands.filter((command) => (
  command.argv_prefix.some((value) => value.endsWith('/scripts/aos-do-browser.mjs'))
    ? command.path.length === 2 && stagedDoOperations.has(command.path[1])
    : JSON.stringify(command.path) === JSON.stringify(['see', 'capture'])
));
if (browserConsumerCommands.length !== 5) fail('generated external manifest has an incomplete supported browser consumer family.');
const helpCommands = sourceManifest.commands.filter((command) =>
  command.path.length === 1 && command.path[0] === 'help');
if (helpCommands.length !== 1) fail('generated external manifest has an incomplete help route.');

const manifestDestination = path.join(resourceRoot, 'manifests/commands/aos-external-commands.json');
let retained = [];
const selectedCommands = [...helpCommands, ...browserCommands, ...focusCommands, ...browserConsumerCommands];
const selectedKeys = new Set([
  ...selectedCommands.map((command) => JSON.stringify(command.path)),
  ...allBrowserConsumerCommands.map((command) => JSON.stringify(command.path)),
]);
if (fs.existsSync(manifestDestination)) {
  const staged = JSON.parse(fs.readFileSync(manifestDestination, 'utf8'));
  retained = staged.commands.filter((command) => !selectedKeys.has(JSON.stringify(command.path)));
}
fs.mkdirSync(path.dirname(manifestDestination), { recursive: true });
fs.writeFileSync(manifestDestination, `${JSON.stringify({
  ...sourceManifest,
  commands: [...retained, ...selectedCommands],
}, null, 2)}\n`);

const sourceRegistry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/commands/aos-commands.json'), 'utf8'));
const installedForms = new Map([
  ['help', ['help-full', 'help-command']],
  ['browser companion', ['browser-companion-status', 'browser-companion-install', 'browser-companion-update', 'browser-companion-uninstall']],
  ['browser', ['browser-parse-target', 'browser-parse-snapshot', 'browser-identity', 'browser-page-identity']],
  ['focus', ['focus-create', 'focus-update', 'focus-list', 'focus-remove']],
  ['do', ['do-scroll-browser', 'do-type-browser', 'do-key-browser', 'do-navigate']],
  ['see', ['see-capture-browser', 'see-capture-browser-save']],
]);
const projectedCommands = [];
for (const command of sourceRegistry.commands) {
  const allowed = installedForms.get(command.path.join(' '));
  if (!allowed) continue;
  const forms = command.forms.filter((form) => allowed.includes(form.id));
  if (forms.length !== allowed.length || forms.some((form) => !allowed.includes(form.id))) {
    fail(`generated command registry differs for installed route: ${command.path.join(' ')}.`);
  }
  projectedCommands.push({ ...command, forms });
}
if (projectedCommands.length !== installedForms.size) fail('generated command registry lacks an installed route family.');
const registryDestination = path.join(resourceRoot, 'manifests/commands/aos-commands.json');
fs.mkdirSync(path.dirname(registryDestination), { recursive: true });
fs.writeFileSync(registryDestination, `${JSON.stringify({ ...sourceRegistry, commands: projectedCommands }, null, 2)}\n`);

process.stdout.write('staged browser companion runtime\n');

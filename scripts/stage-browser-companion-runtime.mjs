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

copyFile('scripts/aos-browser-companion.mjs');
copyFile('scripts/aos-help-proxy.mjs');
copyFile('scripts/lib/external-command-routes.mjs');
copyModules();
copyFile('manifests/companions/playwright-cli-v1.json');
copyFile('manifests/commands/aos-commands.json');
copyFile('shared/schemas/aos-browser-companion-descriptor-v1.schema.json');
copyFile('shared/schemas/aos-browser-companion-result-v1.schema.json');

const sourceManifest = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'manifests/commands/aos-external-commands.json'),
  'utf8',
));
const companionCommands = sourceManifest.commands.filter((command) =>
  command.path[0] === 'browser' && command.path[1] === 'companion');
if (companionCommands.length !== 5) fail('generated external manifest has an incomplete browser companion family.');
const helpCommands = sourceManifest.commands.filter((command) =>
  command.path.length === 1 && command.path[0] === 'help');
if (helpCommands.length !== 1) fail('generated external manifest has an incomplete help route.');

const manifestDestination = path.join(resourceRoot, 'manifests/commands/aos-external-commands.json');
let retained = [];
if (fs.existsSync(manifestDestination)) {
  const staged = JSON.parse(fs.readFileSync(manifestDestination, 'utf8'));
  retained = staged.commands.filter((command) =>
    command.path[0] !== 'help'
    && !(command.path[0] === 'browser' && command.path[1] === 'companion'));
}
fs.mkdirSync(path.dirname(manifestDestination), { recursive: true });
fs.writeFileSync(manifestDestination, `${JSON.stringify({
  ...sourceManifest,
  commands: [...retained, ...helpCommands, ...companionCommands],
}, null, 2)}\n`);

process.stdout.write('staged browser companion runtime\n');

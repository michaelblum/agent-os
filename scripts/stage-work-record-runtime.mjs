#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertExternalCommandManifestGeneratorCurrent,
  validateExternalCommandManifestV1,
} from './lib/external-command-manifest-v1.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const resourceRoot = path.resolve(String(process.argv[2] || ''));

function fail(message) {
  process.stderr.write(`stage-work-record-runtime: ${message}\n`);
  process.exit(1);
}

if (!process.argv[2] || resourceRoot === path.parse(resourceRoot).root) {
  fail('one non-root resource destination is required.');
}

function copyFile(relativeSource, relativeDestination = relativeSource) {
  const source = path.join(repoRoot, relativeSource);
  const destination = path.join(resourceRoot, relativeDestination);
  if (!fs.statSync(source).isFile()) fail(`required source is not a file: ${relativeSource}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyTree(relativeSource, relativeDestination, allowedExtensions) {
  const sourceRoot = path.join(repoRoot, relativeSource);
  const destinationRoot = path.join(resourceRoot, relativeDestination);
  const visit = (sourceDirectory, destinationDirectory) => {
    fs.mkdirSync(destinationDirectory, { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      const source = path.join(sourceDirectory, entry.name);
      const destination = path.join(destinationDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(source, destination);
      } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name))) {
        fs.copyFileSync(source, destination);
      }
    }
  };
  visit(sourceRoot, destinationRoot);
}

const manifestSource = path.join(repoRoot, 'manifests/commands/aos-external-commands.json');
const manifest = JSON.parse(fs.readFileSync(manifestSource, 'utf8'));
try {
  validateExternalCommandManifestV1(manifest, { canonicalAggregate: true });
  assertExternalCommandManifestGeneratorCurrent(repoRoot);
} catch (error) {
  fail(error.message);
}

copyTree(
  'packages/toolkit/workbench',
  'packages/toolkit/workbench',
  new Set(['.css', '.html', '.js', '.json', '.mjs', '.node']),
);
copyFile('packages/toolkit/package.json');
copyFile('packages/toolkit/components/inspector-panel/index.html');
copyFile('scripts/aos-work-record.mjs');
copyFile('scripts/lib/work-record-command-families.mjs');
copyTree(
  'shared/schemas/fixtures/aos-work-record-v1',
  'shared/schemas/fixtures/aos-work-record-v1',
  new Set(['.json']),
);

const workRecordCommands = Array.isArray(manifest.commands)
  ? manifest.commands.filter((command) => command?.path?.[0] === 'work-record')
  : [];
if (workRecordCommands.length === 0) fail('generated external manifest has no Work Record commands.');
const stagedManifest = {
  ...manifest,
  commands: workRecordCommands,
};
const manifestDestination = path.join(resourceRoot, 'manifests/commands/aos-external-commands.json');
fs.mkdirSync(path.dirname(manifestDestination), { recursive: true });
fs.writeFileSync(manifestDestination, `${JSON.stringify(stagedManifest, null, 2)}\n`);

const addon = path.join(
  resourceRoot,
  'packages/toolkit/workbench/native/build',
  `${process.platform}-${process.arch}`,
  'descriptor-relative-fs.node',
);
if (!fs.existsSync(addon)) fail(`current-architecture descriptor-relative addon is missing: ${addon}`);

process.stdout.write(`${resourceRoot}\n`);

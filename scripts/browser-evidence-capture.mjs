#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  captureBrowserEvidenceManifest,
} from '../packages/toolkit/workbench/browser-evidence-capture.js';

function usage() {
  return `Usage: node scripts/browser-evidence-capture.mjs --manifest <manifest.json> --out <registry.json> [--asset-dir evidence] [--playwright-cli playwright-cli]

Captures local fixture browser elements into a Browser Evidence Capture V0 registry.
Only file, data, relative fixture, and localhost URLs are accepted.`;
}

function parseArgs(argv) {
  const args = {
    assetDir: 'evidence',
    playwrightCli: 'playwright-cli',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--manifest') {
      args.manifest = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (arg === '--asset-dir') {
      args.assetDir = argv[index + 1];
      index += 1;
    } else if (arg === '--playwright-cli') {
      args.playwrightCli = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.manifest || !args.out) {
    throw new Error('Both --manifest and --out are required.');
  }

  const manifestPath = path.resolve(args.manifest);
  const outputPath = path.resolve(args.out);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const registry = captureBrowserEvidenceManifest(manifest, {
    assetDir: args.assetDir,
    cwd: path.dirname(manifestPath),
    outputPath,
    playwrightCli: args.playwrightCli,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), outputPath)} (${registry.summary.captured_count} captured, ${registry.summary.failed_count} failed)`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

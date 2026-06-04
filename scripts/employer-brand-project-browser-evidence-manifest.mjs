#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  compileBrowserEvidenceManifestFromEmployerBrandAuditProject,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-project-browser-evidence.js';

function usage() {
  return `Usage: node scripts/employer-brand-project-browser-evidence-manifest.mjs --project <project.json> --out <manifest.json> [--html-root html]

Derives a local-only Browser Evidence Capture V0 planning manifest skeleton from
an Employer Brand Audit Project V0 fixture. This is deterministic planning only;
it does not collect pages, browse websites, generate reports, or execute exports.`;
}

function parseArgs(argv) {
  const args = {
    htmlRoot: 'html',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--project') {
      args.project = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (arg === '--html-root') {
      args.htmlRoot = argv[index + 1];
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
  if (!args.project || !args.out) {
    throw new Error('Both --project and --out are required.');
  }

  const projectPath = path.resolve(args.project);
  const outputPath = path.resolve(args.out);
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const manifest = compileBrowserEvidenceManifestFromEmployerBrandAuditProject(project, {
    htmlRoot: args.htmlRoot,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), outputPath)} (${manifest.requests.length} planning requests)`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

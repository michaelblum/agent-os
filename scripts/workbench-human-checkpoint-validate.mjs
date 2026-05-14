#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateWorkbenchHumanCheckpoint } from '../packages/toolkit/workbench/human-checkpoint.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const requireCommittedAnnotation = args.includes('--require-committed-annotation');
const target = args.find((arg) => !arg.startsWith('--'));

if (!target || target === '--help' || target === '-h') {
  console.log(`Usage: scripts/workbench-human-checkpoint-validate.mjs <checkpoint.json> [--require-committed-annotation]

Validates the checkpoint helper normalizer and JSON Schema. The optional gate
requires at least one committed/resolved/rejected annotation in the checkpoint
or resume payload.`);
  process.exit(target ? 0 : 1);
}

const checkpointPath = path.resolve(repoRoot, target);
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
validateWorkbenchHumanCheckpoint(checkpoint);

const result = spawnSync(
  'python3',
  [
    '-c',
    `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
    path.join(repoRoot, 'shared/schemas/workbench-human-checkpoint-v0.schema.json'),
    checkpointPath,
  ],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  process.stderr.write(`${result.stdout}${result.stderr}`);
  process.exit(result.status || 1);
}

if (requireCommittedAnnotation) {
  const committed = (checkpoint.annotations || []).filter((annotation) => (
    annotation.status === 'committed' || annotation.status === 'resolved' || annotation.status === 'rejected'
  ));
  const resumeCommitted = checkpoint.resume?.annotations || [];
  if (committed.length === 0 && resumeCommitted.length === 0) {
    process.stderr.write('checkpoint has no committed annotation intent records\n');
    process.exit(1);
  }
}

console.log(`valid workbench human checkpoint: ${checkpoint.checkpoint_id}`);

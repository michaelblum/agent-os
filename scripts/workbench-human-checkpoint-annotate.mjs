#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addMarkdownWorkbenchAnnotation,
  clearMarkdownWorkbenchAnnotations,
  commitMarkdownWorkbenchAnnotations,
  resolveMarkdownWorkbenchAnnotation,
} from '../packages/toolkit/components/markdown-workbench/checkpoint.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    checkpoint: '',
    output: '',
    annotationJson: [],
    annotationFiles: [],
    commit: false,
    clear: false,
    resolve: [],
    reject: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--checkpoint') out.checkpoint = argv[++i] || '';
    else if (arg === '--output') out.output = argv[++i] || '';
    else if (arg === '--annotation-json') out.annotationJson.push(argv[++i] || '{}');
    else if (arg === '--annotation-file') out.annotationFiles.push(argv[++i] || '');
    else if (arg === '--commit') out.commit = true;
    else if (arg === '--clear') out.clear = true;
    else if (arg === '--resolve') out.resolve.push(argv[++i] || '');
    else if (arg === '--reject') out.reject.push(argv[++i] || '');
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!out.checkpoint) out.checkpoint = arg;
  }
  return out;
}

function usage() {
  console.log(`Usage: scripts/workbench-human-checkpoint-annotate.mjs --checkpoint checkpoint.json [--output checkpoint.json] [options]

Adds or updates structured annotation intent records without editing the
underlying Markdown file. Use this before checkpoint resume during smoke tests.

Options:
  --annotation-json '<json>'       Add one annotation intent record.
  --annotation-file annotations.json
                                  Add annotations from an array or
                                  {"annotations":[...]} sidecar.
  --commit                         Move draft annotations to committed.
  --resolve <annotation-id>         Mark an annotation resolved.
  --reject <annotation-id>          Mark an annotation rejected.
  --clear                          Clear current checkpoint annotations.`);
}

function readAnnotationsFromFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(repoRoot, filePath), 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.annotations)) return parsed.annotations;
  return [parsed];
}

function writeRecord(record, output) {
  const json = `${JSON.stringify(record, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(repoRoot, output), json);
  else process.stdout.write(json);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.checkpoint) {
  usage();
  process.exit(args.help ? 0 : 1);
}

let checkpoint = JSON.parse(fs.readFileSync(path.resolve(repoRoot, args.checkpoint), 'utf8'));

if (args.clear) checkpoint = clearMarkdownWorkbenchAnnotations(checkpoint, { actor: 'operator-cli' });

for (const raw of args.annotationJson) {
  checkpoint = addMarkdownWorkbenchAnnotation(checkpoint, JSON.parse(raw));
}
for (const filePath of args.annotationFiles.filter(Boolean)) {
  for (const annotation of readAnnotationsFromFile(filePath)) {
    checkpoint = addMarkdownWorkbenchAnnotation(checkpoint, annotation);
  }
}
for (const id of args.resolve.filter(Boolean)) {
  checkpoint = resolveMarkdownWorkbenchAnnotation(checkpoint, id, 'resolved');
}
for (const id of args.reject.filter(Boolean)) {
  checkpoint = resolveMarkdownWorkbenchAnnotation(checkpoint, id, 'rejected');
}
if (args.commit) checkpoint = commitMarkdownWorkbenchAnnotations(checkpoint);

writeRecord(checkpoint, args.output);

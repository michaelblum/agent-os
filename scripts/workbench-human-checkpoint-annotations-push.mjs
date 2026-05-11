#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = { checkpoint: '', canvasId: '', output: '', dryRun: false, clear: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--checkpoint') out.checkpoint = argv[++i] || '';
    else if (arg === '--canvas-id') out.canvasId = argv[++i] || '';
    else if (arg === '--output') out.output = argv[++i] || '';
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--clear') out.clear = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!out.checkpoint) out.checkpoint = arg;
  }
  return out;
}

function usage() {
  console.log(`Usage: scripts/workbench-human-checkpoint-annotations-push.mjs --checkpoint checkpoint.json [--canvas-id markdown-workbench] [--dry-run]

Posts committed/resolved/rejected checkpoint annotations into an open Markdown
Workbench canvas without editing or saving the Markdown body. Use --clear to
clear the badge layer instead of loading annotations.`);
}

export function buildAnnotationPushEvent(checkpoint = {}, { clear = false } = {}) {
  if (clear) {
    return { type: 'markdown_workbench.annotations.clear', payload: {} };
  }
  const annotations = Array.isArray(checkpoint.annotations)
    ? checkpoint.annotations
    : Array.isArray(checkpoint.resume?.annotations)
      ? checkpoint.resume.annotations
      : [];
  return {
    type: 'markdown_workbench.annotations.replace',
    payload: {
      checkpoint_id: checkpoint.checkpoint_id || null,
      subject: checkpoint.subject || null,
      annotations: annotations.filter((annotation) => (
        annotation?.status === 'committed'
        || annotation?.status === 'open'
        || annotation?.status === 'resolved'
        || annotation?.status === 'rejected'
      )),
    },
  };
}

function postEvent(canvasId, event) {
  const result = spawnSync('./aos', ['show', 'post', '--id', canvasId, '--event', JSON.stringify(event)], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`failed to post annotations to ${canvasId}: ${result.stderr || result.stdout}`);
  }
  return result;
}

if (process.argv[1] === modulePath) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.checkpoint) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const checkpoint = JSON.parse(fs.readFileSync(path.resolve(repoRoot, args.checkpoint), 'utf8'));
  const canvasId = args.canvasId || checkpoint.canvas_id || 'markdown-workbench';
  const event = buildAnnotationPushEvent(checkpoint, { clear: args.clear });
  const json = `${JSON.stringify({ canvas_id: canvasId, event }, null, 2)}\n`;
  if (args.output) fs.writeFileSync(path.resolve(repoRoot, args.output), json);
  else if (args.dryRun) process.stdout.write(json);
  else {
    postEvent(canvasId, event);
    process.stdout.write(json);
  }
}

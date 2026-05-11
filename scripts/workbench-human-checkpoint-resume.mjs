#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resumeMarkdownWorkbenchCheckpoint } from '../packages/toolkit/components/markdown-workbench/checkpoint.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { checkpoint: '', output: '', behavior: 'draft', createdBy: 'agent' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--checkpoint') out.checkpoint = argv[++i] || '';
    else if (arg === '--output') out.output = argv[++i] || '';
    else if (arg === '--behavior') out.behavior = argv[++i] || out.behavior;
    else if (arg === '--resumed-by') out.createdBy = argv[++i] || out.createdBy;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!out.checkpoint) out.checkpoint = arg;
  }
  return out;
}

function usage() {
  console.log(`Usage: scripts/workbench-human-checkpoint-resume.mjs --checkpoint checkpoint.json [--behavior save|draft|abort] [--output resumed.json]

Reads the recorded Markdown Workbench canvas state, computes the checkpoint diff,
preserves committed annotation intent records in the resume payload, and
optionally persists through markdown-workbench/save-current.sh.`);
}

function readCanvasState(canvasId) {
  const result = spawnSync('./aos', ['show', 'eval', '--id', canvasId, '--js', 'JSON.stringify(window.__markdownWorkbenchState || null)'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`failed to read canvas ${canvasId}: ${result.stderr || result.stdout}`);
  const outer = JSON.parse(result.stdout);
  const state = JSON.parse(outer.result || 'null');
  if (!state || typeof state !== 'object') throw new Error(`canvas ${canvasId} did not expose Markdown Workbench state`);
  return state;
}

function saveCanvas(canvasId) {
  const result = spawnSync('bash', ['packages/toolkit/components/markdown-workbench/save-current.sh', canvasId], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {
      type: 'markdown_document.save.result',
      status: 'rejected',
      message: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
  }
  return JSON.parse(result.stdout);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.checkpoint) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const checkpointPath = path.resolve(repoRoot, args.checkpoint);
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const state = readCanvasState(checkpoint.canvas_id);
const saveResult = args.behavior === 'save' ? saveCanvas(checkpoint.canvas_id) : null;
const resumed = resumeMarkdownWorkbenchCheckpoint({
  checkpoint,
  state,
  saveBehavior: args.behavior,
  saveResult,
  resumedBy: args.createdBy,
});
const json = `${JSON.stringify(resumed, null, 2)}\n`;
if (args.output) fs.writeFileSync(path.resolve(repoRoot, args.output), json);
else process.stdout.write(json);

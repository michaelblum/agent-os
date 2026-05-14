#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildMarkdownWorkCardHtmlExpression,
} from '../packages/toolkit/workbench/html-workbench-expression.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_INPUT = 'docs/design/work-cards/aos-html-workbench-expression-v0.md';
const DEFAULT_OUTPUT_DIR = 'docs/design/fixtures/aos-html-workbench-expression-v0';
const DEFAULT_CREATED_AT = '2026-05-10T00:00:00.000Z';
const DEFAULT_OUTPUT_BASENAME = 'expression';

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

const input = argValue('input', DEFAULT_INPUT);
const outputDir = argValue('output-dir', DEFAULT_OUTPUT_DIR);
const createdAt = argValue('created-at', DEFAULT_CREATED_AT);
const expressionId = argValue('expression-id', null);
const artifactKind = argValue('artifact-kind', 'work_card');
const outputBasename = argValue('output-basename', DEFAULT_OUTPUT_BASENAME);
const stdout = process.argv.includes('--stdout');
const open = process.argv.includes('--open');
const inputPath = path.resolve(repoRoot, input);
const outputPath = path.resolve(repoRoot, outputDir);
const htmlPath = path.join(outputPath, `${outputBasename}.html`);
const metadataPath = path.join(outputPath, `${outputBasename}.json`);
const markdown = readFileSync(inputPath, 'utf8');
const sourcePath = relativeToRepo(inputPath);
const htmlFixturePath = relativeToRepo(htmlPath);

const expression = buildMarkdownWorkCardHtmlExpression({
  markdown,
  sourcePath,
  generatedAt: createdAt,
  expressionId,
  htmlPath: htmlFixturePath,
  artifactKind,
});

if (stdout) {
  process.stdout.write(`${JSON.stringify(expression.metadata, null, 2)}\n`);
} else {
  mkdirSync(outputPath, { recursive: true });
  writeFileSync(htmlPath, expression.html);
  writeFileSync(metadataPath, `${JSON.stringify(expression.metadata, null, 2)}\n`);
  process.stdout.write(`${relativeToRepo(metadataPath)}\n`);
}

if (open) {
  const launch = path.join(repoRoot, 'packages/toolkit/components/html-workbench-expression/launch.sh');
  const result = spawnSync(launch, [metadataPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'shared/schemas/input-event-v2.schema.json');
const toolkitPackagePath = path.join(repoRoot, 'packages/toolkit/package.json');
const outputPath = path.join(repoRoot, 'packages/toolkit/runtime/input-event-validator.generated.js');
const regenerationCommand = 'node scripts/generate-input-event-validator.mjs';
const toolkitRequire = createRequire(toolkitPackagePath);
const Ajv2020 = toolkitRequire('ajv/dist/2020').default;
const standaloneCode = toolkitRequire('ajv/dist/standalone').default;
const allowedRuntimeModules = new Set(['ajv/dist/runtime/ucs2length']);

function fail(message) {
  process.stderr.write(`generate-input-event-validator: ${message}\n`);
  process.exit(1);
}

async function generatedSource(schema) {
  let standalone;
  try {
    const ajv = new Ajv2020({
      allErrors: false,
      inlineRefs: false,
      strict: true,
      // Conditional branches require properties declared by their parent schema.
      strictRequired: false,
      code: {
        esm: true,
        lines: false,
        optimize: 2,
        source: true,
      },
    });
    standalone = standaloneCode(ajv, ajv.compile(schema));
  } catch (error) {
    fail(`canonical schema cannot compile with Ajv standalone: ${error.message}`);
  }

  const runtimeRequire = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(["']([^"']+)["']\)\.default;/g;
  const browserStandalone = standalone.replace(runtimeRequire, (_statement, binding, moduleID) => {
    if (!allowedRuntimeModules.has(moduleID)) fail(`unexpected Ajv runtime dependency: ${moduleID}`);
    const runtimeHelper = toolkitRequire(moduleID).default;
    if (typeof runtimeHelper !== 'function') fail(`Ajv runtime dependency is not inlineable: ${moduleID}`);
    return `const ${binding} = ${runtimeHelper.toString()};`;
  });
  if (/\brequire\s*\(/.test(browserStandalone)) {
    fail('compiled validator retains an unexpected runtime require');
  }

  return [
    '// Generated from shared/schemas/input-event-v2.schema.json. Do not edit.',
    '// Compiled with Ajv standalone; referenced Ajv runtime helpers are inlined.',
    `// Regenerate with: ${regenerationCommand}`,
    browserStandalone.trimEnd(),
    '',
  ].join('\n');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Usage: ${regenerationCommand} [--check]\n`);
  process.exit(0);
}
if (args.some((arg) => arg !== '--check')) fail(`unknown argument: ${args.find((arg) => arg !== '--check')}`);

let schema;
try {
  schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
} catch (error) {
  fail(`cannot read canonical schema: ${error.message}`);
}
const expected = await generatedSource(schema);

if (args.includes('--check')) {
  let actual;
  try {
    actual = await fs.readFile(outputPath, 'utf8');
  } catch (error) {
    fail(`missing generated artifact: ${path.relative(repoRoot, outputPath)}`);
  }
  if (actual !== expected) fail(`generated artifact is stale; run ${regenerationCommand}`);
  process.stdout.write('input event validator artifact is current\n');
} else {
  await fs.writeFile(outputPath, expected);
  process.stdout.write(`generated ${path.relative(repoRoot, outputPath)}\n`);
}

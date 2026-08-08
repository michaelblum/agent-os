#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const toolkitPackagePath = path.join(repoRoot, 'packages/toolkit/package.json');
const regenerationCommand = 'node scripts/generate-work-record-contract-validators.mjs';
const toolkitRequire = createRequire(toolkitPackagePath);
const Ajv2020 = toolkitRequire('ajv/dist/2020').default;
const standaloneCode = toolkitRequire('ajv/dist/standalone').default;
const allowedRuntimeModules = new Set([
  'ajv/dist/runtime/equal',
  'ajv/dist/runtime/ucs2length',
]);
const contracts = [
  {
    schema: 'shared/schemas/aos-work-record-v1.schema.json',
    output: 'packages/toolkit/workbench/work-record-v1-validator.generated.js',
  },
  {
    schema: 'shared/schemas/aos-step-descriptor-v1.schema.json',
    output: 'packages/toolkit/workbench/step-descriptor-v1-validator.generated.js',
  },
  {
    schema: 'shared/schemas/aos-work-record-repair-plan-v1.schema.json',
    output: 'packages/toolkit/workbench/work-record-repair-plan-v1-validator.generated.js',
  },
  {
    schema: 'shared/schemas/aos-work-record-repair-attempt-plan-v1.schema.json',
    output: 'packages/toolkit/workbench/work-record-repair-attempt-plan-v1-validator.generated.js',
  },
  {
    schema: 'shared/schemas/aos-work-record-repair-attempt-artifact-v1.schema.json',
    output: 'packages/toolkit/workbench/work-record-repair-attempt-artifact-v1-validator.generated.js',
  },
];

function fail(message) {
  process.stderr.write(`generate-work-record-contract-validators: ${message}\n`);
  process.exit(1);
}

function compiledSource(schema, schemaRelative, registeredSchemas = []) {
  let standalone;
  try {
    const ajv = new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      inlineRefs: false,
      strict: true,
      strictRequired: false,
      formats: {
        'date-time': /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
      },
      code: { esm: true, lines: false, optimize: 2, source: true },
    });
    for (const registered of registeredSchemas) {
      if (registered.$id && registered.$id !== schema.$id) ajv.addSchema(registered);
    }
    standalone = standaloneCode(ajv, ajv.compile(schema));
  } catch (error) {
    fail(`${schemaRelative} cannot compile with Ajv standalone: ${error.message}`);
  }

  const runtimeRequire = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(["']([^"']+)["']\)\.default;/g;
  const standaloneWithoutRuntimeImports = standalone.replace(runtimeRequire, (_statement, binding, moduleID) => {
    if (!allowedRuntimeModules.has(moduleID)) fail(`unexpected Ajv runtime dependency: ${moduleID}`);
    const runtimeHelper = toolkitRequire(moduleID).default;
    if (typeof runtimeHelper !== 'function') fail(`Ajv runtime dependency is not inlineable: ${moduleID}`);
    return `const ${binding} = ${runtimeHelper.toString()};`;
  });
  if (/\brequire\s*\(/.test(standaloneWithoutRuntimeImports)) fail('compiled validator retains an unexpected runtime require');

  return [
    `// Generated from ${schemaRelative}. Do not edit.`,
    '// Compiled with Ajv standalone; referenced Ajv runtime helpers are inlined.',
    `// Regenerate with: ${regenerationCommand}`,
    standaloneWithoutRuntimeImports.trimEnd(),
    '',
  ].join('\n');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Usage: ${regenerationCommand} [--check]\n`);
  process.exit(0);
}
if (args.some((arg) => arg !== '--check')) fail(`unknown argument: ${args.find((arg) => arg !== '--check')}`);

const loadedContracts = [];
for (const contract of contracts) {
  try {
    loadedContracts.push({
      ...contract,
      schemaValue: JSON.parse(await fs.readFile(path.join(repoRoot, contract.schema), 'utf8')),
    });
  } catch (error) {
    fail(`cannot read ${contract.schema}: ${error.message}`);
  }
}

for (const contract of loadedContracts) {
  const expected = compiledSource(
    contract.schemaValue,
    contract.schema,
    loadedContracts.map((item) => item.schemaValue),
  );
  const outputPath = path.join(repoRoot, contract.output);
  if (args.includes('--check')) {
    let actual;
    try {
      actual = await fs.readFile(outputPath, 'utf8');
    } catch {
      fail(`missing generated artifact: ${contract.output}`);
    }
    if (actual !== expected) fail(`generated artifact is stale: ${contract.output}`);
  } else {
    await fs.writeFile(outputPath, expected);
    process.stdout.write(`generated ${contract.output}\n`);
  }
}

if (args.includes('--check')) process.stdout.write('Work Record contract validator artifacts are current\n');

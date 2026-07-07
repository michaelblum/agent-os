#!/usr/bin/env node

import { formatJSON, validateSkillRegistry } from './lib/aos-skills-registry.mjs';

function usage() {
  return `Usage: node scripts/aos-skills-validate.mjs [--json] [--repo <path>] [--registry <path>]\n`;
}

function parseArgs(argv) {
  const options = { json: false };
  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--repo') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw Object.assign(new Error('--repo requires a path'), { code: 'MISSING_ARG' });
      }
      options.repoRoot = argv[i + 1];
      i += 2;
    } else if (arg === '--registry') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw Object.assign(new Error('--registry requires a path'), { code: 'MISSING_ARG' });
      }
      options.registryPath = argv[i + 1];
      i += 2;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
      i += 1;
    } else {
      throw Object.assign(new Error(`Unknown argument: ${arg}`), { code: 'UNKNOWN_ARG' });
    }
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const result = await validateSkillRegistry(options);
  if (options.json) {
    process.stdout.write(formatJSON(result));
  } else if (result.ok) {
    process.stdout.write(`AOS skill registry ok: ${result.summary.skills} skills, ${result.summary.warnings} warnings\n`);
  } else {
    process.stderr.write(formatJSON(result));
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(formatJSON({
    code: error.code ?? 'AOS_SKILLS_VALIDATE_FAILED',
    error: error.message,
  }));
  process.exit(1);
}

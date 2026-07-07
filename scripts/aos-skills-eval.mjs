#!/usr/bin/env node

import path from 'node:path';

import {
  AosSkillsError,
  evaluateSkillEfficacy,
  formatJSON,
  loadEvalFixture,
  loadResponseRuns,
  runOpenAIResponsesEval,
  writePromptPackets,
} from './lib/aos-skills/registry.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/aos-skills-eval.mjs --fixture <path> [--responses-dir <dir>] [--case <id> ...] [--run <id> ...] [--pass-score <n>] [--json] [--fail-on-threshold]',
    '  node scripts/aos-skills-eval.mjs --fixture <path> --emit-prompts <dir> [--case <id> ...] [--matrix <id> ...] [--json]',
    '  node scripts/aos-skills-eval.mjs --fixture <path> --run-openai --output-dir <dir> [--case <id> ...] [--matrix <id> ...] [--session-id <id>] [--replace] [--max-output-tokens <n>] [--json]',
    '',
    'Scores captured model responses for AOS installable-skill efficacy.',
    'The default path is deterministic/offline; --run-openai captures live Responses API output for later scoring through --responses-dir.',
    '',
  ].join('\n');
}

function requireValue(args, index, flag) {
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
    throw new AosSkillsError(`${flag} requires a value`, 'MISSING_ARG', { flag });
  }
  return args[index + 1];
}

function parseArgs(argv) {
  const options = {
    json: false,
    caseIds: [],
    runIds: [],
    matrixIds: [],
    failOnThreshold: false,
    runOpenAI: false,
  };
  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      i += 1;
    } else if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--fixture') {
      options.fixturePath = requireValue(argv, i, '--fixture');
      i += 2;
    } else if (arg === '--responses-dir') {
      options.responsesDir = requireValue(argv, i, '--responses-dir');
      i += 2;
    } else if (arg === '--emit-prompts') {
      options.emitPrompts = requireValue(argv, i, '--emit-prompts');
      i += 2;
    } else if (arg === '--run-openai') {
      options.runOpenAI = true;
      i += 1;
    } else if (arg === '--output-dir') {
      options.outputDir = requireValue(argv, i, '--output-dir');
      i += 2;
    } else if (arg === '--base-url') {
      options.baseUrl = requireValue(argv, i, '--base-url');
      i += 2;
    } else if (arg === '--max-output-tokens') {
      options.maxOutputTokens = requireValue(argv, i, '--max-output-tokens');
      i += 2;
    } else if (arg === '--session-id') {
      options.sessionId = requireValue(argv, i, '--session-id');
      i += 2;
    } else if (arg === '--replace') {
      options.replace = true;
      i += 1;
    } else if (arg === '--case') {
      options.caseIds.push(requireValue(argv, i, '--case'));
      i += 2;
    } else if (arg === '--run') {
      options.runIds.push(requireValue(argv, i, '--run'));
      i += 2;
    } else if (arg === '--matrix') {
      options.matrixIds.push(requireValue(argv, i, '--matrix'));
      i += 2;
    } else if (arg === '--pass-score') {
      const value = Number(requireValue(argv, i, '--pass-score'));
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new AosSkillsError('--pass-score must be a number from 0 to 100', 'INVALID_ARG', {
          flag: '--pass-score',
        });
      }
      options.passScore = value;
      i += 2;
    } else if (arg === '--fail-on-threshold') {
      options.failOnThreshold = true;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new AosSkillsError(`Unknown aos skills eval flag: ${arg}`, 'UNKNOWN_FLAG', { flag: arg });
    } else {
      throw new AosSkillsError(`Unknown aos skills eval argument: ${arg}`, 'UNKNOWN_ARG', { argument: arg });
    }
  }
  return options;
}

function printReportText(report) {
  const lines = [
    `AOS skill efficacy eval: ${report.fixture_id}`,
    `Status: ${report.status}`,
    `Runs: ${report.summary.evaluated}, passed: ${report.summary.passed}, failed: ${report.summary.failed}`,
  ];
  if (report.summary.average_score !== null) lines.push(`Average score: ${report.summary.average_score}`);
  for (const run of report.runs) {
    lines.push(`  ${run.id}: ${run.average_score} ${run.passed ? 'PASS' : 'FAIL'}`);
    for (const result of run.cases.filter((item) => !item.passed)) {
      const failedChecks = result.checks.filter((item) => !item.ok).map((item) => item.id).join(', ');
      lines.push(`    ${result.case_id}: ${result.score} failed_checks=${failedChecks}`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.fixturePath) {
    throw new AosSkillsError('--fixture is required', 'MISSING_ARG', { flag: '--fixture' });
  }

  const fixture = await loadEvalFixture(path.resolve(options.fixturePath));
  if (options.emitPrompts) {
    const result = await writePromptPackets(fixture, path.resolve(options.emitPrompts), {
      caseIds: options.caseIds,
      matrixIds: options.matrixIds,
    });
    if (options.json) process.stdout.write(formatJSON(result));
    else process.stdout.write(`Wrote ${result.packets_written} prompt packets to ${result.output_dir}\n`);
    return;
  }
  if (options.runOpenAI) {
    const result = await runOpenAIResponsesEval(fixture, options.outputDir && path.resolve(options.outputDir), {
      caseIds: options.caseIds,
      matrixIds: options.matrixIds,
      baseUrl: options.baseUrl,
      maxOutputTokens: options.maxOutputTokens,
      replace: options.replace,
      sessionId: options.sessionId,
    });
    if (options.json) process.stdout.write(formatJSON(result));
    else {
      process.stdout.write(`Captured ${result.packets_requested - result.errors.length}/${result.packets_requested} OpenAI eval responses into ${result.output_dir}\n`);
    }
    return;
  }

  const extraRuns = await loadResponseRuns(options.responsesDir && path.resolve(options.responsesDir));
  const report = await evaluateSkillEfficacy(fixture, {
    repoRoot: process.cwd(),
    caseIds: options.caseIds,
    runIds: options.runIds,
    passScore: options.passScore,
    extraRuns,
  });
  if (options.json) process.stdout.write(formatJSON(report));
  else printReportText(report);

  if (options.failOnThreshold && report.summary.failed > 0) process.exit(1);
}

main().catch((error) => {
  if (error instanceof AosSkillsError) {
    process.stderr.write(formatJSON(error.toJSON()));
  } else {
    process.stderr.write(`${error.stack || error.message}\n`);
  }
  process.exit(1);
});

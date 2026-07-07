#!/usr/bin/env node

import {
  AosSkillsError,
  checkSkills,
  checkSkillCompanion,
  formatJSON,
  installSkills,
  listSkills,
  planSkillCompanionInstall,
  planSkillInstall,
} from './lib/aos-skills/registry.mjs';

function usage() {
  return [
    'Usage:',
    '  aos skills list [--json]',
    '  aos skills check --target <codex|claude|agents|path> [--path <absolute-dir>] [--skill <name> ...] [--json]',
    '  aos skills install --target <codex|claude|agents|path> [--path <absolute-dir>] [--skill <name> ...] [--dry-run] [--json]',
    '  aos skills companion check --name playwright-cli --target <codex|claude|agents|path> [--path <absolute-dir>] [--json]',
    '  aos skills companion install --name playwright-cli --target <codex|claude|agents|path> [--path <absolute-dir>] --dry-run [--json]',
    '',
  ].join('\n');
}

function error(message, code, details = {}) {
  process.stderr.write(formatJSON({ code, error: message, ...details }));
  process.exit(1);
}

function requireValue(args, index, flag) {
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
    throw new AosSkillsError(`${flag} requires a value`, 'MISSING_ARG', { flag });
  }
  return args[index + 1];
}

function parseCommon(args, allowedFlags) {
  const options = {
    json: false,
    dryRun: false,
    skills: [],
  };
  const positionals = [];
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--dry-run' && allowedFlags.has('--dry-run')) {
      options.dryRun = true;
      i += 1;
    } else if (arg === '--target' && allowedFlags.has('--target')) {
      options.target = requireValue(args, i, '--target');
      i += 2;
    } else if (arg === '--path' && allowedFlags.has('--path')) {
      options.path = requireValue(args, i, '--path');
      i += 2;
    } else if (arg === '--skill' && allowedFlags.has('--skill')) {
      options.skills.push(requireValue(args, i, '--skill'));
      i += 2;
    } else if (arg === '--name' && allowedFlags.has('--name')) {
      options.name = requireValue(args, i, '--name');
      i += 2;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new AosSkillsError(`Unknown aos skills flag: ${arg}`, 'UNKNOWN_FLAG', { flag: arg });
    } else {
      positionals.push(arg);
      i += 1;
    }
  }
  if (positionals.length) {
    throw new AosSkillsError(`Unknown aos skills argument: ${positionals[0]}`, 'UNKNOWN_ARG', {
      argument: positionals[0],
    });
  }
  return options;
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    return { subcommand: subcommand ? 'help' : null, help: true };
  }
  if (subcommand.startsWith('--')) {
    throw new AosSkillsError('aos skills requires a subcommand', 'MISSING_SUBCOMMAND');
  }
  if (subcommand === 'list') {
    return { subcommand, ...parseCommon(rest, new Set()) };
  }
  if (subcommand === 'check') {
    return { subcommand, ...parseCommon(rest, new Set(['--target', '--path', '--skill'])) };
  }
  if (subcommand === 'install') {
    return { subcommand, ...parseCommon(rest, new Set(['--target', '--path', '--skill', '--dry-run'])) };
  }
  if (subcommand === 'companion') {
    const [action, ...companionRest] = rest;
    if (!action || action.startsWith('--')) {
      throw new AosSkillsError('aos skills companion requires check or install', 'MISSING_SUBCOMMAND');
    }
    if (action === 'check') {
      return {
        subcommand,
        companionAction: action,
        ...parseCommon(companionRest, new Set(['--name', '--target', '--path'])),
      };
    }
    if (action === 'install') {
      return {
        subcommand,
        companionAction: action,
        ...parseCommon(companionRest, new Set(['--name', '--target', '--path', '--dry-run'])),
      };
    }
    throw new AosSkillsError(`Unknown aos skills companion action: ${action}`, 'UNKNOWN_SUBCOMMAND', {
      subcommand: action,
    });
  }
  throw new AosSkillsError(`Unknown aos skills subcommand: ${subcommand}`, 'UNKNOWN_SUBCOMMAND', {
    subcommand,
  });
}

function printListText(payload) {
  const lines = [
    `AOS skills (${payload.summary.total} total, ${payload.summary.installable} installable)`,
  ];
  for (const skill of payload.skills) {
    const marker = skill.installable ? 'installable' : skill.status;
    lines.push(`  ${skill.name.padEnd(28, ' ')}${marker}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printCheckText(payload) {
  const lines = [
    `AOS skills check: ${payload.target.name} -> ${payload.target.root}`,
  ];
  for (const skill of payload.skills) {
    lines.push(`  ${skill.name.padEnd(28, ' ')}${skill.state} - ${skill.reason}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printInstallPlanText(payload) {
  const mode = payload.dry_run ? 'dry-run' : 'install';
  const lines = [
    `AOS skills ${mode}: ${payload.target.name} -> ${payload.target.root}`,
    `Planned writes: ${payload.summary.planned_writes}`,
  ];
  if (payload.summary.written !== undefined) {
    lines.push(`Written: ${payload.summary.written}`);
  }
  for (const write of payload.planned_writes) {
    lines.push(`  ${write.kind.padEnd(12, ' ')}${write.destination}`);
  }
  for (const blocked of payload.blocked) {
    lines.push(`  blocked     ${blocked.skill}: ${blocked.reason}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printCompanionText(payload) {
  const lines = [
    `AOS skills companion ${payload.companion.name}: ${payload.status}`,
    `Runtime: ${payload.runtime.status}`,
    `Installed: ${payload.installation.state}`,
  ];
  if (payload.planned_invocation) {
    lines.push(`Planned: ${payload.planned_invocation.executable} ${payload.planned_invocation.argv.join(' ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  if (options.subcommand === 'list') {
    const payload = await listSkills(options);
    if (options.json) process.stdout.write(formatJSON(payload));
    else printListText(payload);
    return;
  }

  if (options.subcommand === 'check') {
    const payload = await checkSkills(options);
    if (options.json) process.stdout.write(formatJSON(payload));
    else printCheckText(payload);
    return;
  }

  if (options.subcommand === 'install') {
    const payload = options.dryRun
      ? await planSkillInstall(options)
      : await installSkills(options);
    if (options.json) process.stdout.write(formatJSON(payload));
    else printInstallPlanText(payload);
    if (payload.status === 'blocked') process.exit(1);
    return;
  }

  if (options.subcommand === 'companion') {
    const payload = options.companionAction === 'check'
      ? await checkSkillCompanion(options)
      : await planSkillCompanionInstall(options);
    if (options.json) process.stdout.write(formatJSON(payload));
    else printCompanionText(payload);
    if (payload.status === 'blocked') process.exit(1);
    return;
  }

  error('aos skills requires a subcommand', 'MISSING_SUBCOMMAND');
}

main().catch((err) => {
  if (err instanceof AosSkillsError) {
    error(err.message, err.code, err.details);
  }
  error(err.stack || err.message, 'AOS_SKILLS_FAILED');
});

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAosBin = path.join(repoRoot, 'aos');
const defaultOutDir = '.aos-test-tmp/gdi-handoffs';
const textLimit = 4000;

const commandStartPattern = /^(?:\.\/aos|node|npm|pnpm|yarn|bun|npx|git|python3?|bash|sh|swift|xcodebuild)\b/;
const commandResultSeparatorPattern = /\s+(?:->|=>|[-:=])\s*(?:pass(?:ed)?|ok|success(?:ful)?|succeeded|ready=true|fail(?:ed)?|error|skipp?ed|skip|exit(?: code)?\s+\d+)\b/i;
const guardrailPatterns = [
  /\bguardrail\b/i,
  /\bno codex tui automation\b/i,
  /\/goal|\/model|\/clear/,
  /\bkeyboard driving\b/i,
  /\bAppleScript shortcuts?\b/i,
  /\bterminal scripting\b/i,
  /\bnew public `?aos`? command\b/i,
  /\bmission runtime\b/i,
  /\bworkflow engine\b/i,
  /\bdaemon pub\/sub\b/i,
  /\bGDI exit interview\b/i,
];

export function usage() {
  return `Usage: node scripts/aos-gdi-handoff-packet.mjs [--input <tail.txt>] [--write] [--out-dir <dir>] [--say|--notify]

Reads a GDI completion tail from stdin or --input and emits a compact JSON handoff packet.
--write stores the same packet under .aos-test-tmp/gdi-handoffs/<timestamp>.json by default.`;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseArgs(argv) {
  const args = {
    input: null,
    outDir: defaultOutDir,
    write: false,
    say: false,
    notify: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--input') {
      args.input = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--out-dir') {
      args.outDir = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--say') {
      args.say = true;
    } else if (arg === '--notify') {
      args.notify = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.say && args.notify) {
    throw new Error('Use only one of --say or --notify.');
  }

  return args;
}

function trimText(value, limit = textLimit) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

function firstLine(text) {
  return splitLines(text).find((line) => line.trim().length > 0)?.trim() ?? '';
}

function commandDisplay(file, args) {
  if (path.resolve(file) === path.resolve(defaultAosBin)) {
    return `./aos ${args.join(' ')}`;
  }
  return [file, ...args].join(' ');
}

export function runCommand(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 10000,
  });
  return {
    ok: result.status === 0,
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

function compactResult(command, result) {
  return {
    command,
    ok: result.ok,
    exit_code: result.exit_code,
    stdout: trimText(result.stdout.trim()),
    stderr: trimText(result.stderr.trim()),
    error: result.error ?? null,
  };
}

function parseCommitLog(stdout) {
  return splitLines(stdout)
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, short, ...subjectParts] = line.split('\0');
      return {
        sha: sha || null,
        short: short || null,
        subject: subjectParts.join('\0') || null,
      };
    });
}

function parseStatusPaths(stdout) {
  const paths = [];
  for (const line of splitLines(stdout)) {
    if (!line || line.startsWith('##')) continue;
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    if (rawPath.includes(' -> ')) {
      paths.push(rawPath.split(' -> ').pop().replace(/^"|"$/g, ''));
    } else {
      paths.push(rawPath.replace(/^"|"$/g, ''));
    }
  }
  return paths;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function collectGitState(options) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd;
  const branchResult = run('git', ['branch', '--show-current'], { cwd });
  const statusResult = run('git', ['status', '--short', '--branch', '--untracked-files=all'], { cwd });
  const upstreamResult = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd });
  const originMainResult = run('git', ['rev-parse', '--verify', 'origin/main'], { cwd });

  const upstream = upstreamResult.ok ? firstLine(upstreamResult.stdout) : null;
  const base = upstream ?? (originMainResult.ok ? 'origin/main' : null);

  const commitResult = base
    ? run('git', ['log', '--format=%H%x00%h%x00%s', '--reverse', `${base}...HEAD`], { cwd })
    : { ok: false, stdout: '', stderr: 'No upstream or origin/main base found.' };
  const committedPathsResult = base
    ? run('git', ['diff', '--name-only', `${base}...HEAD`], { cwd })
    : { ok: false, stdout: '' };
  const unstagedPathsResult = run('git', ['diff', '--name-only'], { cwd });
  const stagedPathsResult = run('git', ['diff', '--cached', '--name-only'], { cwd });

  const changedPaths = sortedUnique([
    ...splitLines(committedPathsResult.stdout).map((line) => line.trim()),
    ...splitLines(unstagedPathsResult.stdout).map((line) => line.trim()),
    ...splitLines(stagedPathsResult.stdout).map((line) => line.trim()),
    ...parseStatusPaths(statusResult.stdout),
  ]);

  return {
    branch: {
      name: firstLine(branchResult.stdout) || null,
      base,
      upstream,
      status: statusResult.ok ? statusResult.stdout.trim() : null,
    },
    commits: commitResult.ok ? parseCommitLog(commitResult.stdout) : [],
    changed_paths: changedPaths,
    git_errors: [
      branchResult.ok ? null : compactResult('git branch --show-current', branchResult),
      statusResult.ok ? null : compactResult('git status --short --branch --untracked-files=all', statusResult),
      commitResult.ok ? null : compactResult(base ? `git log ${base}...HEAD` : 'git log', commitResult),
    ].filter(Boolean),
  };
}

function collectAosState(options) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd;
  const aosBin = options.aosBin ?? defaultAosBin;

  const readyArgs = ['ready'];
  const readyResult = run(aosBin, readyArgs, { cwd, timeoutMs: 15000 });
  const listArgs = ['show', 'list', '--json'];
  const listResult = run(aosBin, listArgs, { cwd, timeoutMs: 10000 });

  let parsedList = null;
  let listError = null;
  if (listResult.ok) {
    try {
      parsedList = JSON.parse(listResult.stdout);
    } catch (caught) {
      listError = caught.message;
    }
  }

  const canvases = Array.isArray(parsedList?.canvases) ? parsedList.canvases : [];

  return {
    aos_readiness: {
      ...compactResult(commandDisplay(aosBin, readyArgs), readyResult),
      ready: readyResult.ok && /\bready=true\b/.test(readyResult.stdout),
    },
    open_canvases: {
      command: commandDisplay(aosBin, listArgs),
      ok: listResult.ok && !listError,
      exit_code: listResult.exit_code,
      count: canvases.length,
      canvases,
      error: listError ?? listResult.error ?? (listResult.ok ? null : trimText(listResult.stderr.trim())),
    },
  };
}

function stripCommandPrefix(line) {
  return line
    .trim()
    .replace(/^[>*]\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^\$\s+/, '')
    .replace(/^(?:ran|run|verified|verification|test|tests|command|cmd)\s*:\s*/i, '')
    .trim();
}

function commandFromCandidate(candidate) {
  let command = candidate.trim().replace(/^`|`$/g, '').trim();
  if (command.includes('`')) return null;
  const separatorMatch = command.match(commandResultSeparatorPattern);
  if (separatorMatch?.index > 0) {
    command = command.slice(0, separatorMatch.index).trim();
  }
  return commandStartPattern.test(command) ? command : null;
}

function extractResult(line) {
  const lower = line.toLowerCase();
  if (/\b(?:failed|fail|error|non-zero|exit(?: code)?\s+[1-9]\d*)\b/.test(lower)) return 'failed';
  if (/\b(?:skipped|skip)\b/.test(lower)) return 'skipped';
  if (/\bready=true\b|\b(?:passed|pass|ok|success|successful|succeeded|green|exit(?: code)?\s+0)\b/.test(lower)) return 'passed';
  return 'unknown';
}

export function parseVerificationCommands(tailText) {
  const found = [];
  const seen = new Set();
  splitLines(tailText).forEach((line, index) => {
    const candidates = [];
    const inlinePattern = /`([^`]+)`/g;
    let match = inlinePattern.exec(line);
    while (match) {
      candidates.push(match[1]);
      match = inlinePattern.exec(line);
    }
    candidates.push(stripCommandPrefix(line));

    for (const candidate of candidates) {
      const command = commandFromCandidate(candidate);
      if (!command || seen.has(command)) continue;
      seen.add(command);
      found.push({
        command,
        result: extractResult(line),
        line: index + 1,
        text: line.trim(),
      });
    }
  });
  return found;
}

export function parseGuardrailClaims(tailText) {
  const claims = [];
  let inGuardrails = false;

  splitLines(tailText).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      inGuardrails = false;
      return;
    }
    if (/^#{1,6}\s+/.test(trimmed) && !/^#{1,6}\s+guardrails?\b/i.test(trimmed)) {
      inGuardrails = false;
    }
    if (/^(?:#{1,6}\s+)?guardrails?\b/i.test(trimmed)) {
      inGuardrails = true;
      if (/:\s*\S/.test(trimmed.replace(/^(?:#{1,6}\s+)?guardrails?\b/i, ''))) {
        claims.push({ claim: trimmed, line: index + 1 });
      }
      return;
    }
    const looksLikeSectionClaim = /^[-*]\s+/.test(trimmed) || /^(?:no|do not|never|avoid)\b/i.test(trimmed);
    const matchesGuardrailPattern = guardrailPatterns.some((pattern) => pattern.test(trimmed));
    if (inGuardrails && !looksLikeSectionClaim && !matchesGuardrailPattern) {
      inGuardrails = false;
      return;
    }
    if ((inGuardrails && looksLikeSectionClaim) || matchesGuardrailPattern) {
      claims.push({
        claim: trimmed.replace(/^[-*]\s+/, ''),
        line: index + 1,
      });
    }
  });

  const seen = new Set();
  return claims.filter((claim) => {
    const key = claim.claim.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseDurationSeconds(raw) {
  const text = String(raw ?? '').toLowerCase();
  const hms = text.match(/\b(?:(\d+):)?(\d{1,2}):(\d{2})\b/);
  if (hms) {
    const hours = Number(hms[1] ?? 0);
    const minutes = Number(hms[2] ?? 0);
    const seconds = Number(hms[3] ?? 0);
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  let total = 0;
  let matched = false;
  const unitPattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m(?!s)|seconds?|secs?|s)\b/g;
  let match = unitPattern.exec(text);
  while (match) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith('h')) total += amount * 3600;
    else if (unit.startsWith('m')) total += amount * 60;
    else total += amount;
    match = unitPattern.exec(text);
  }
  return matched ? Math.round(total) : null;
}

export function parseGoalTime(tailText) {
  const patterns = [
    /\b(?:time spent pursuing goal|goal time|elapsed time|final elapsed time)\s*[:=-]\s*([^\n]+)/i,
    /\btime used\s*[:=-]\s*([^\n]+)/i,
    /\bgoal completed in\s+([^\n]+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(tailText ?? '').match(pattern);
    if (match) {
      const raw = match[1].trim();
      return {
        raw,
        seconds: parseDurationSeconds(raw),
      };
    }
  }
  return {
    raw: null,
    seconds: null,
  };
}

function summarizeVerification(commands) {
  return {
    command_count: commands.length,
    passed_count: commands.filter((command) => command.result === 'passed').length,
    failed_count: commands.filter((command) => command.result === 'failed').length,
    skipped_count: commands.filter((command) => command.result === 'skipped').length,
    unknown_count: commands.filter((command) => command.result === 'unknown').length,
  };
}

export function buildPacket(options) {
  const tailText = String(options.tailText ?? '');
  const now = options.now ?? new Date();
  const gitState = collectGitState(options);
  const aosState = collectAosState(options);
  const verificationCommands = parseVerificationCommands(tailText);

  return {
    type: 'aos.gdi_handoff_packet.v0',
    created_at: now.toISOString(),
    branch: gitState.branch,
    commits: gitState.commits,
    changed_paths: gitState.changed_paths,
    verification: {
      summary: summarizeVerification(verificationCommands),
      commands: verificationCommands,
    },
    guardrail_claims: parseGuardrailClaims(tailText),
    goal_time: parseGoalTime(tailText),
    aos_readiness: aosState.aos_readiness,
    open_canvases: aosState.open_canvases,
    raw_tail_text: tailText,
    tail: {
      line_count: splitLines(tailText).length,
      byte_count: Buffer.byteLength(tailText, 'utf8'),
    },
    git_errors: gitState.git_errors,
  };
}

export function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function outputPathFor(options) {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  return path.resolve(cwd, options.outDir ?? defaultOutDir, `${timestampForPath(now)}.json`);
}

export function writePacket(packet, options = {}) {
  const outputPath = outputPathFor(options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(packet)}\n`);
  return outputPath;
}

function readTailInput(args) {
  if (args.input) {
    return fs.readFileSync(path.resolve(args.input), 'utf8');
  }
  if (process.stdin.isTTY) {
    throw new Error('No GDI completion tail on stdin. Pass --input <path> or pipe text into the helper.');
  }
  return fs.readFileSync(0, 'utf8');
}

function notifyHuman(packet, args, options = {}) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd ?? process.cwd();
  const aosBin = options.aosBin ?? defaultAosBin;
  const text = packet.output_path
    ? `GDI handoff packet ready: ${packet.output_path}`
    : 'GDI handoff packet ready.';
  const notificationText = text.length > 120 ? 'GDI handoff packet ready.' : text;
  const notifyArgs = args.notify ? ['tell', 'human', notificationText] : ['say', notificationText];
  const result = run(aosBin, notifyArgs, { cwd, timeoutMs: 10000 });
  return compactResult(commandDisplay(aosBin, notifyArgs), result);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const cwd = process.cwd();
  const now = new Date();
  const tailText = readTailInput(args);
  const packet = buildPacket({ tailText, cwd, now, aosBin: defaultAosBin });

  if (args.write) {
    const outputPath = outputPathFor({ cwd, now, outDir: args.outDir });
    packet.output_path = path.relative(cwd, outputPath);
  }

  if (args.say || args.notify) {
    packet.notification = notifyHuman(packet, args, { cwd, aosBin: defaultAosBin });
  }

  if (args.write) {
    writePacket(packet, { cwd, now, outDir: args.outDir });
  }

  process.stdout.write(`${JSON.stringify(packet)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (caught) {
    console.error(caught.message);
    process.exitCode = 1;
  }
}

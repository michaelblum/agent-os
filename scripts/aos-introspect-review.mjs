#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

function sanitizeSessionComponent(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function defaultSessionKey() {
  if (process.env.AOS_SESSION_ID) return sanitizeSessionComponent(process.env.AOS_SESSION_ID);
  if (process.env.CODEX_THREAD_ID) return sanitizeSessionComponent(`codex-${process.env.CODEX_THREAD_ID}`);
  if (process.env.AOS_SESSION_NAME) return sanitizeSessionComponent(`name-${process.env.AOS_SESSION_NAME}`);
  if (process.env.CLAUDE_CODE_SSE_PORT) return sanitizeSessionComponent(`claude-port-${process.env.CLAUDE_CODE_SSE_PORT}`);
  return sanitizeSessionComponent(`pid-${process.pid}`);
}

function currentHarness() {
  if (process.env.AOS_SESSION_HARNESS) return process.env.AOS_SESSION_HARNESS;
  if (process.env.CODEX_THREAD_ID) return 'codex';
  if (process.env.CLAUDE_CODE_SSE_PORT) return 'claude-code';
  return 'unknown';
}

function stateRoot() {
  return process.env.AOS_STATE_ROOT || join(homedir(), '.config', 'aos');
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function introspectionDir() {
  return join(stateRoot(), runtimeMode(), 'agent-introspection');
}

function error(message, code) {
  console.error(JSON.stringify({ code, error: message }, null, 2));
  process.exit(1);
}

async function readJsonLines(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split(/\n+/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function commandPathString(event) {
  return Array.isArray(event.command_path) && event.command_path.length ? event.command_path.join('/') : '';
}

function parseArgs(argv) {
  const parsed = { json: false, session: defaultSessionKey() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') {
      parsed.json = true;
    } else if (argv[i] === '--session') {
      i += 1;
      if (i >= argv.length) error('--session requires a key. Usage: aos introspect review [--session <key>] [--json]', 'MISSING_ARG');
      parsed.session = sanitizeSessionComponent(argv[i]);
    } else {
      error(`Unknown flag: ${argv[i]}`, argv[i].startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
    }
  }
  return parsed;
}

function sortedFailureEntries(failureCounts) {
  return [...failureCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key} (${count})`);
}

async function buildReview(args) {
  const logPath = join(introspectionDir(), 'aos-usage.jsonl');
  const events = (await readJsonLines(logPath)).filter((event) => event.session === args.session);
  const state = await readJson(join(introspectionDir(), 'sessions', `${args.session}.json`));
  const harness = state?.harness || events.map((event) => event.harness).filter(Boolean).at(-1) || currentHarness();

  let successes = 0;
  let failures = 0;
  let blocked = 0;
  const mastered = new Set();
  const failureCounts = new Map();
  let usedStatus = false;
  let usedDoctor = false;
  let usedDaemonSnapshot = false;
  let usedClean = false;
  let misuseRepoBinary = false;
  let invalidCommandLoops = false;
  const recent = [];

  for (const event of events) {
    const path = commandPathString(event);
    if (event.outcome === 'success') {
      successes += 1;
      if (path) mastered.add(path);
    } else if (event.outcome === 'blocked') {
      blocked += 1;
      failures += 1;
      if (path) failureCounts.set(path, (failureCounts.get(path) || 0) + 1);
    } else if (event.outcome === 'error') {
      failures += 1;
      if (path) failureCounts.set(path, (failureCounts.get(path) || 0) + 1);
    }

    if (event.error_code === 'USE_REPO_AOS') misuseRepoBinary = true;
    if (['UNKNOWN_COMMAND', 'UNKNOWN_ARG', 'UNKNOWN_FLAG', 'MISSING_ARG'].includes(event.error_code)) invalidCommandLoops = true;
    if (path === 'status') usedStatus = true;
    if (path === 'doctor') usedDoctor = true;
    if (path === 'daemon-snapshot') usedDaemonSnapshot = true;
    if (path === 'clean') usedClean = true;
    recent.push({
      timestamp: event.timestamp,
      command: path || event.command || '(unknown)',
      outcome: event.outcome || 'unknown',
      error_code: event.error_code ?? null,
    });
  }

  const invocation = process.env.AOS_INVOCATION_DISPLAY_NAME || './aos';
  const learnings = [];
  if (misuseRepoBinary) learnings.push('In repo mode, invoke the binary as `./aos`, not `aos`.');
  if ((usedDoctor || usedDaemonSnapshot || usedClean) && !usedStatus) {
    learnings.push(`\`${invocation} status\` is the primary runtime entrypoint; use it before dropping to \`doctor\`, \`daemon-snapshot\`, or \`clean\`.`);
  }
  if (invalidCommandLoops) learnings.push(`When commands or flags miss, recover with \`${invocation} help <command> [--json]\` before retrying.`);
  if (mastered.size) learnings.push(`Successful command paths so far: ${[...mastered].sort().join(', ')}.`);

  const recommendations = [];
  if (!events.length) {
    recommendations.push(`Start with \`${invocation} status\`.`);
    recommendations.push(`Use \`${invocation} help <command> [--json]\` to inspect a specific surface.`);
  }
  if (misuseRepoBinary) recommendations.push(`Replace bare \`aos\` invocations with \`${invocation}\`.`);
  if ((usedDoctor || usedDaemonSnapshot || usedClean) && !usedStatus) {
    recommendations.push(`Use \`${invocation} status\` for routine runtime checks instead of chaining \`doctor\`, \`daemon-snapshot\`, and \`clean\` manually.`);
  }
  if (invalidCommandLoops) recommendations.push(`Use \`${invocation} help <command>\` before another retry loop.`);
  if (!recommendations.length) {
    recommendations.push(`Keep using \`${invocation} status\` as the point of entry and \`${invocation} introspect review\` for self-review.`);
  }

  return {
    status: failures === 0 ? 'ok' : 'review',
    session: args.session,
    harness,
    total_attempts: events.length,
    successes,
    failures,
    blocked,
    consecutive_failures: state?.consecutive_failures ?? 0,
    mastered_commands: [...mastered].sort(),
    repeated_failure_commands: sortedFailureEntries(failureCounts),
    learnings,
    recommendations,
    recent: recent.slice(-8).reverse(),
    log_path: logPath,
  };
}

function printText(response) {
  console.log(`status=${response.status} session=${response.session} harness=${response.harness} attempts=${response.total_attempts} successes=${response.successes} failures=${response.failures} blocked=${response.blocked} streak=${response.consecutive_failures}`);
  console.log(`Mastered: ${response.mastered_commands.length ? response.mastered_commands.join(', ') : '(none yet)'}`);
  console.log(`Repeated failures: ${response.repeated_failure_commands.length ? response.repeated_failure_commands.join(', ') : '(none)'}`);
  console.log('Learnings:');
  if (!response.learnings.length) console.log('- No issues detected yet.');
  else for (const line of response.learnings) console.log(`- ${line}`);
  console.log('Recommendations:');
  for (const line of response.recommendations) console.log(`- ${line}`);
  console.log('Recent:');
  for (const entry of response.recent) {
    const suffix = entry.error_code ? ` [${entry.error_code}]` : '';
    console.log(`- ${entry.timestamp} ${entry.outcome} ${entry.command}${suffix}`);
  }
  console.log(`log_path=${response.log_path}`);
}

const args = parseArgs(process.argv.slice(2));
const response = await buildReview(args);
if (args.json) console.log(JSON.stringify(response, null, 2));
else printText(response);

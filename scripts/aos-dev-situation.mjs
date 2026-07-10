#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readSuccessorNote, successorNoteRelativePath } from './aos-successor-note.mjs';

function printJSON(value) {
  process.stdout.write(formatJSON(value));
}

function formatJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exitError(message, code) {
  process.stderr.write(formatJSON({ code, error: message }));
  process.exit(1);
}

function parsePositiveInteger(value, flag) {
  if (!/^[0-9]+$/.test(value)) exitError(`${flag} must be numeric: ${value}`, 'INVALID_ARG');
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1) exitError(`${flag} must be greater than zero: ${value}`, 'INVALID_ARG');
  return parsed;
}

function commandTimeoutMs() {
  const raw = process.env.AOS_DEV_SITUATION_TIMEOUT_MS || '10000';
  if (!/^[0-9]+$/.test(raw)) return 10000;
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : 10000;
}

function situationDeadlineMs() {
  const raw = process.env.AOS_DEV_SITUATION_DEADLINE_MS || '30000';
  if (!/^[0-9]+$/.test(raw)) return 30000;
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : 30000;
}

function createDeadline(deadlineMs = situationDeadlineMs(), label = 'packet') {
  return {
    deadlineMs,
    label,
    expiresAt: Date.now() + deadlineMs,
  };
}

function remainingDeadlineMs(deadline) {
  return Math.max(0, deadline.expiresAt - Date.now());
}

function createCollectorBudgets() {
  const packetMs = situationDeadlineMs();
  const gitMs = Math.floor(packetMs * 0.3);
  const githubMs = Math.floor(packetMs * 0.4);
  const runtimeMs = Math.max(1, packetMs - gitMs - githubMs);
  return {
    git: gitMs,
    github: githubMs,
    runtime: runtimeMs,
  };
}

function deadlineDescription(deadline) {
  return `maintainer situation ${deadline.label} deadline ${deadline.deadlineMs}ms`;
}

function parseArgs(args) {
  const options = {
    json: false,
    issueLimit: 50,
    recentIssueLimit: 20,
    prLimit: 50,
  };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--repo') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) exitError('--repo requires a path', 'MISSING_ARG');
      options.repo = args[i + 1];
      i += 2;
    } else if (arg === '--issue-limit') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) exitError('--issue-limit requires a number', 'MISSING_ARG');
      options.issueLimit = parsePositiveInteger(args[i + 1], '--issue-limit');
      i += 2;
    } else if (arg === '--recent-issue-limit') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) exitError('--recent-issue-limit requires a number', 'MISSING_ARG');
      options.recentIssueLimit = parsePositiveInteger(args[i + 1], '--recent-issue-limit');
      i += 2;
    } else if (arg === '--pr-limit') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) exitError('--pr-limit requires a number', 'MISSING_ARG');
      options.prLimit = parsePositiveInteger(args[i + 1], '--pr-limit');
      i += 2;
    } else if (arg.startsWith('--')) {
      exitError(`Unknown maintainer situation flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      exitError(`Unknown maintainer situation argument: ${arg}`, 'UNKNOWN_ARG');
    }
  }
  return options;
}

function run(command, args, cwd, deadline) {
  const remainingMs = deadline ? remainingDeadlineMs(deadline) : commandTimeoutMs();
  if (remainingMs <= 0) {
    return {
      exitCode: 124,
      stdout: '',
      stderr: `${commandString(command, args)} skipped because ${deadlineDescription(deadline)} was exhausted\n`,
    };
  }
  const timeoutMs = Math.min(commandTimeoutMs(), remainingMs);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    return {
      exitCode: 124,
      stdout: result.stdout ?? '',
      stderr: `${commandString(command, args)} timed out after ${timeoutMs}ms within ${deadline ? deadlineDescription(deadline) : `maintainer situation deadline ${timeoutMs}ms`}\n${result.stderr ?? ''}`,
    };
  }
  if (result.error) {
    return {
      exitCode: 127,
      stdout: '',
      stderr: `${result.error.message}\n`,
    };
  }
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function git(args, cwd) {
  return run('/usr/bin/git', args, cwd);
}

function resolveRepoRoot(requested) {
  const start = path.resolve(requested || process.env.REPO_ROOT || process.cwd());
  const result = git(['-C', start, 'rev-parse', '--show-toplevel'], start);
  if (result.exitCode === 0 && result.stdout.trim()) return path.resolve(result.stdout.trim());
  return start;
}

function clip(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return undefined;
  const firstLines = trimmed.split(/\r?\n/).slice(0, 5).join('\n');
  return firstLines.length > 700 ? `${firstLines.slice(0, 700)}...` : firstLines;
}

function commandString(executableLabel, args) {
  return [executableLabel, ...args].join(' ');
}

function runSource(sources, id, executable, args, cwd, executableLabel = executable, deadline = undefined) {
  const result = run(executable, args, cwd, deadline);
  const source = {
    id,
    command: commandString(executableLabel, args),
    status: result.exitCode === 0 ? 'success' : 'failed',
    exit_code: result.exitCode,
  };
  if (source.status === 'failed') source.note = clip(result.stderr || result.stdout) || `exit=${result.exitCode}`;
  sources.push(source);
  return { source, result };
}

function parseJSONSource(source, result) {
  if (source.status !== 'success') return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    source.status = 'failed';
    source.note = 'stdout was not valid JSON';
    return null;
  }
}

function outputLines(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function parseStatus(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith('## ')) || '';
  const branchText = branchLine.replace(/^##\s+/, '');
  const branch = branchText.split(/[ .[]/, 1)[0] || null;
  return {
    branch,
    dirty_files: lines.filter((line) => !line.startsWith('## ')).length,
    raw: lines,
  };
}

function parseAheadBehind(stdout) {
  const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindRaw, 10);
  const ahead = Number.parseInt(aheadRaw, 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

function parseStash(line) {
  const match = line.match(/^(stash@\{\d+\}):(?:\s+On\s+([^:]+):)?\s*(.*)$/);
  if (!match) return { ref: null, branch: null, message: line, raw: line };
  return {
    ref: match[1],
    branch: match[2] || null,
    message: match[3] || '',
    raw: line,
  };
}

function setTrace(trace, key, ids) {
  trace[key] = ids.filter(Boolean);
}

function buildAgentExecutionPolicy(repoRoot) {
  void repoRoot;
  return {
    status: 'retired',
    authority: 'repo_dox_and_installable_skills',
    execution_surface: null,
    default_engine: null,
    native_custom_agents_enabled: false,
    codex_config_registration_allowed: false,
    roles_dir: null,
    team_doc: null,
    registered_roles: [],
    routing_scope: [],
    standing_authorization_intent: false,
    ask_user_if_runtime_requires_turn_authorization: false,
    fail_closed_without_registered_role: false,
    fail_closed_without_session_authorization: false,
    direct_specialist_fallback_allowed: false,
    extra_mutation_authorized: false,
    source_status: {
      retirement: 'project-agent orchestration is not an active AOS core surface',
    },
  };
}

function limitedCount(value, limit) {
  if (!Array.isArray(value)) {
    return {
      count: null,
      limit,
      limitReached: null,
    };
  }
  return {
    count: value.length,
    limit,
    limitReached: value.length >= limit,
  };
}

function collectGitSources(sources, repoRoot, deadline) {
  return {
    gitStatus: runSource(sources, 'git_status', '/usr/bin/git', ['status', '--short', '--branch'], repoRoot, 'git', deadline),
    gitHead: runSource(sources, 'git_head', '/usr/bin/git', ['rev-parse', 'HEAD'], repoRoot, 'git', deadline),
    gitOriginMain: runSource(sources, 'git_origin_main', '/usr/bin/git', ['rev-parse', 'origin/main'], repoRoot, 'git', deadline),
    gitAheadBehind: runSource(sources, 'git_ahead_behind', '/usr/bin/git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], repoRoot, 'git', deadline),
    gitLocalBranches: runSource(sources, 'git_local_branches', '/usr/bin/git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repoRoot, 'git', deadline),
    gitRemoteBranches: runSource(sources, 'git_remote_branches', '/usr/bin/git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], repoRoot, 'git', deadline),
    gitStashes: runSource(sources, 'git_stashes', '/usr/bin/git', ['stash', 'list'], repoRoot, 'git', deadline),
  };
}

function collectGitHubSources(sources, repoRoot, options, ghExecutable, ghBaseArgs, ghLabel, deadline) {
  return {
    ghContext: runSource(sources, 'github_context', ghExecutable, [...ghBaseArgs, 'context', '--json'], repoRoot, ghLabel, deadline),
    ghOpenIssues: runSource(sources, 'github_open_issues', ghExecutable, [...ghBaseArgs, 'issue', 'list', '--state', 'open', '--limit', String(options.issueLimit), '--json'], repoRoot, ghLabel, deadline),
    ghRecentIssues: runSource(sources, 'github_recent_issues', ghExecutable, [...ghBaseArgs, 'issue', 'list', '--state', 'all', '--limit', String(options.recentIssueLimit), '--json'], repoRoot, ghLabel, deadline),
    ghOpenPRs: runSource(sources, 'github_open_prs', ghExecutable, [...ghBaseArgs, 'pr', 'list', '--state', 'open', '--limit', String(options.prLimit), '--json'], repoRoot, ghLabel, deadline),
  };
}

function collectRuntimeSources(sources, repoRoot, aosPath, aosLabel, deadline) {
  return {
    ready: runSource(sources, 'aos_ready', aosPath, ['ready', '--json'], repoRoot, aosLabel, deadline),
    status: runSource(sources, 'aos_status', aosPath, ['status', '--json'], repoRoot, aosLabel, deadline),
  };
}

function buildSituation(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const sources = [];
  const trace = {};
  const budgets = createCollectorBudgets();
  const aosPath = process.env.AOS_DEV_SITUATION_AOS_PATH || process.env.AOS_PATH || path.join(repoRoot, 'aos');
  const aosLabel = './aos';
  const ghPath = process.env.AOS_DEV_SITUATION_GH_PATH || path.join(repoRoot, 'scripts', 'aos-dev-gh.mjs');
  const ghExecutable = process.env.AOS_DEV_SITUATION_GH_PATH ? ghPath : process.execPath;
  const ghBaseArgs = process.env.AOS_DEV_SITUATION_GH_PATH ? [] : [ghPath];
  const ghLabel = process.env.AOS_DEV_SITUATION_GH_PATH ? ghPath : 'node scripts/aos-dev-gh.mjs';

  const {
    gitStatus,
    gitHead,
    gitOriginMain,
    gitAheadBehind,
    gitLocalBranches,
    gitRemoteBranches,
    gitStashes,
  } = collectGitSources(sources, repoRoot, createDeadline(budgets.git, 'git collector'));
  const {
    ghContext,
    ghOpenIssues,
    ghRecentIssues,
    ghOpenPRs,
  } = collectGitHubSources(sources, repoRoot, options, ghExecutable, ghBaseArgs, ghLabel, createDeadline(budgets.github, 'github collector'));
  const { ready, status } = collectRuntimeSources(sources, repoRoot, aosPath, aosLabel, createDeadline(budgets.runtime, 'runtime collector'));

  const statusFacts = gitStatus.source.status === 'success' ? parseStatus(gitStatus.result.stdout) : null;
  const aheadBehind = gitAheadBehind.source.status === 'success' ? parseAheadBehind(gitAheadBehind.result.stdout) : null;
  const githubContext = parseJSONSource(ghContext.source, ghContext.result);
  const openIssues = parseJSONSource(ghOpenIssues.source, ghOpenIssues.result);
  const recentIssues = parseJSONSource(ghRecentIssues.source, ghRecentIssues.result);
  const openPRs = parseJSONSource(ghOpenPRs.source, ghOpenPRs.result);
  const readyJSON = parseJSONSource(ready.source, ready.result);
  const statusJSON = parseJSONSource(status.source, status.result);

  const gitPayload = {
    branch: statusFacts?.branch ?? null,
    head: gitHead.source.status === 'success' ? gitHead.result.stdout.trim() : null,
    origin_main: gitOriginMain.source.status === 'success' ? gitOriginMain.result.stdout.trim() : null,
    ahead_of_origin_main: aheadBehind?.ahead ?? null,
    behind_origin_main: aheadBehind?.behind ?? null,
    dirty_files: statusFacts?.dirty_files ?? null,
    local_branches: gitLocalBranches.source.status === 'success' ? outputLines(gitLocalBranches.result) : null,
    remote_branches: gitRemoteBranches.source.status === 'success' ? outputLines(gitRemoteBranches.result) : null,
    stashes: gitStashes.source.status === 'success' ? outputLines(gitStashes.result).map(parseStash) : null,
  };
  setTrace(trace, 'git.branch', ['git_status']);
  setTrace(trace, 'git.head', ['git_head']);
  setTrace(trace, 'git.origin_main', ['git_origin_main']);
  setTrace(trace, 'git.ahead_of_origin_main', ['git_ahead_behind']);
  setTrace(trace, 'git.behind_origin_main', ['git_ahead_behind']);
  setTrace(trace, 'git.dirty_files', ['git_status']);
  setTrace(trace, 'git.local_branches', ['git_local_branches']);
  setTrace(trace, 'git.remote_branches', ['git_remote_branches']);
  setTrace(trace, 'git.stashes', ['git_stashes']);

  const successorNote = readSuccessorNote(repoRoot, 'foreman', {
    gitBranch: gitPayload.branch,
    gitHead: gitPayload.head,
  });
  sources.push({
    id: 'successor_note',
    command: `read ${successorNoteRelativePath('foreman')}`,
    status: 'success',
    exit_code: 0,
    note: successorNote.status,
  });
  setTrace(trace, 'successor_note.status', ['successor_note']);
  setTrace(trace, 'successor_note.note', successorNote.note ? ['successor_note'] : []);

  const agentExecution = buildAgentExecutionPolicy(repoRoot);
  sources.push({
    id: 'agent_execution_policy',
    command: 'read retired project-agent policy',
    status: 'success',
    exit_code: 0,
    note: agentExecution.status,
  });
  setTrace(trace, 'agent_execution.status', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.execution_surface', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.default_engine', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.native_custom_agents_enabled', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.codex_config_registration_allowed', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.registered_roles', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.routing_scope', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.standing_authorization_intent', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.ask_user_if_runtime_requires_turn_authorization', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.fail_closed_without_registered_role', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.fail_closed_without_session_authorization', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.direct_specialist_fallback_allowed', ['agent_execution_policy']);
  setTrace(trace, 'agent_execution.extra_mutation_authorized', ['agent_execution_policy']);

  const openIssueCount = limitedCount(openIssues, options.issueLimit);
  const openPRCount = limitedCount(openPRs, options.prLimit);
  const summary = {
    clean: gitPayload.dirty_files === null ? null : gitPayload.dirty_files === 0,
    synced_with_origin_main: gitPayload.ahead_of_origin_main === null || gitPayload.behind_origin_main === null
      ? null
      : gitPayload.ahead_of_origin_main === 0 && gitPayload.behind_origin_main === 0,
    open_pr_count: openPRCount.count,
    open_pr_count_limit: openPRCount.limit,
    open_pr_count_limit_reached: openPRCount.limitReached,
    open_issue_count: openIssueCount.count,
    open_issue_count_limit: openIssueCount.limit,
    open_issue_count_limit_reached: openIssueCount.limitReached,
    stash_count: Array.isArray(gitPayload.stashes) ? gitPayload.stashes.length : null,
    runtime_ready: readyJSON && typeof readyJSON.ready === 'boolean' ? readyJSON.ready : null,
  };
  setTrace(trace, 'summary.clean', ['git_status']);
  setTrace(trace, 'summary.synced_with_origin_main', ['git_ahead_behind']);
  setTrace(trace, 'summary.open_pr_count', ['github_open_prs']);
  setTrace(trace, 'summary.open_pr_count_limit', ['github_open_prs']);
  setTrace(trace, 'summary.open_pr_count_limit_reached', ['github_open_prs']);
  setTrace(trace, 'summary.open_issue_count', ['github_open_issues']);
  setTrace(trace, 'summary.open_issue_count_limit', ['github_open_issues']);
  setTrace(trace, 'summary.open_issue_count_limit_reached', ['github_open_issues']);
  setTrace(trace, 'summary.stash_count', ['git_stashes']);
  setTrace(trace, 'summary.runtime_ready', ['aos_ready']);

  const failedSources = sources.filter((source) => source.status !== 'success');
  const statusValue = failedSources.length === 0 ? 'success' : failedSources.length === sources.length ? 'failed' : 'partial';
  return {
    status: statusValue,
    schema_version: 1,
    generated_at: new Date().toISOString(),
    repo: repoRoot,
    sources,
    source_trace: trace,
    git: gitPayload,
    github: {
      context: githubContext,
      open_issues: Array.isArray(openIssues) ? openIssues : null,
      recent_issues: Array.isArray(recentIssues) ? recentIssues : null,
      open_prs: Array.isArray(openPRs) ? openPRs : null,
    },
    runtime: {
      ready: readyJSON,
      status: statusJSON,
    },
    successor_note: successorNote,
    agent_execution: agentExecution,
    summary,
  };
}

function printText(payload) {
  process.stdout.write(`maintainer situation: ${payload.status}\n`);
  process.stdout.write(`Repo: ${payload.repo}\n`);
  process.stdout.write(`Branch: ${payload.git.branch ?? 'unknown'}\n`);
  process.stdout.write(`Head: ${payload.git.head ?? 'unknown'}\n`);
  process.stdout.write(`Clean: ${payload.summary.clean}\n`);
  process.stdout.write(`Synced with origin/main: ${payload.summary.synced_with_origin_main}\n`);
  process.stdout.write(`Open PRs: ${limitedCountText(payload.summary.open_pr_count, payload.summary.open_pr_count_limit, payload.summary.open_pr_count_limit_reached)}\n`);
  process.stdout.write(`Open issues: ${limitedCountText(payload.summary.open_issue_count, payload.summary.open_issue_count_limit, payload.summary.open_issue_count_limit_reached)}\n`);
  process.stdout.write(`Stashes: ${payload.summary.stash_count ?? 'unknown'}\n`);
  process.stdout.write(`Runtime ready: ${payload.summary.runtime_ready ?? 'unknown'}\n`);
  process.stdout.write(`Agent execution: ${payload.agent_execution?.status ?? 'unknown'}\n`);
  if (payload.successor_note?.status && payload.successor_note.status !== 'missing') {
    process.stdout.write(`Successor note: ${payload.successor_note.status} (${payload.successor_note.path})\n`);
  }
  const failed = payload.sources.filter((source) => source.status !== 'success');
  for (const source of failed) process.stdout.write(`Source failed: ${source.id} exit=${source.exit_code}${source.note ? ` ${source.note}` : ''}\n`);
}

function limitedCountText(count, limit, limitReached) {
  if (count === null || count === undefined) return 'unknown';
  return limitReached ? `${count} (limit ${limit} reached)` : String(count);
}

const options = parseArgs(process.argv.slice(2));
const payload = buildSituation(options);
options.json ? printJSON(payload) : printText(payload);
process.exit(payload.status === 'failed' ? 1 : 0);

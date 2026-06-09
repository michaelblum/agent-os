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
      exitError(`Unknown dev situation flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      exitError(`Unknown dev situation argument: ${arg}`, 'UNKNOWN_ARG');
    }
  }
  return options;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
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

function runSource(sources, id, executable, args, cwd, executableLabel = executable) {
  const result = run(executable, args, cwd);
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

function buildSubagentDelegationPolicy(repoRoot) {
  const rolesDir = '.codex/agents';
  const teamDoc = '.docks/foreman/AGENTS.md';
  const rolesPath = path.join(repoRoot, rolesDir);
  let registeredRoles = [];
  let rolesDirStatus = 'present';
  try {
    registeredRoles = fs.readdirSync(rolesPath)
      .filter((entry) => entry.endsWith('.toml'))
      .map((entry) => entry.replace(/\.toml$/, ''))
      .sort();
  } catch {
    rolesDirStatus = 'missing';
  }
  const teamDocStatus = fs.existsSync(path.join(repoRoot, teamDoc)) ? 'present' : 'missing';
  return {
    status: rolesDirStatus === 'present' && teamDocStatus === 'present' && registeredRoles.length > 0
      ? 'active'
      : 'unavailable',
    authority: 'orientation_policy',
    roles_dir: rolesDir,
    team_doc: teamDoc,
    registered_roles: registeredRoles,
    routing_scope: [
      'bounded_specialist_work',
      'routine_git_github_hygiene',
      'review',
      'validation',
      'reconnaissance',
      'implementation',
    ],
    standing_authorization_intent: true,
    ask_user_if_runtime_requires_turn_authorization: true,
    fail_closed_without_registered_role: true,
    fail_closed_without_session_authorization: true,
    direct_specialist_fallback_allowed: false,
    extra_mutation_authorized: false,
    source_status: {
      roles_dir: rolesDirStatus,
      team_doc: teamDocStatus,
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

function buildSituation(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const sources = [];
  const trace = {};
  const aosPath = process.env.AOS_DEV_SITUATION_AOS_PATH || process.env.AOS_PATH || path.join(repoRoot, 'aos');
  const aosLabel = './aos';

  const gitStatus = runSource(sources, 'git_status', '/usr/bin/git', ['status', '--short', '--branch'], repoRoot, 'git');
  const gitHead = runSource(sources, 'git_head', '/usr/bin/git', ['rev-parse', 'HEAD'], repoRoot, 'git');
  const gitOriginMain = runSource(sources, 'git_origin_main', '/usr/bin/git', ['rev-parse', 'origin/main'], repoRoot, 'git');
  const gitAheadBehind = runSource(sources, 'git_ahead_behind', '/usr/bin/git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], repoRoot, 'git');
  const gitLocalBranches = runSource(sources, 'git_local_branches', '/usr/bin/git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repoRoot, 'git');
  const gitRemoteBranches = runSource(sources, 'git_remote_branches', '/usr/bin/git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], repoRoot, 'git');
  const gitStashes = runSource(sources, 'git_stashes', '/usr/bin/git', ['stash', 'list'], repoRoot, 'git');

  const ghContext = runSource(sources, 'github_context', aosPath, ['dev', 'gh', 'context', '--json'], repoRoot, aosLabel);
  const ghOpenIssues = runSource(sources, 'github_open_issues', aosPath, ['dev', 'gh', 'issue', 'list', '--state', 'open', '--limit', String(options.issueLimit), '--json'], repoRoot, aosLabel);
  const ghRecentIssues = runSource(sources, 'github_recent_issues', aosPath, ['dev', 'gh', 'issue', 'list', '--state', 'all', '--limit', String(options.recentIssueLimit), '--json'], repoRoot, aosLabel);
  const ghOpenPRs = runSource(sources, 'github_open_prs', aosPath, ['dev', 'gh', 'pr', 'list', '--state', 'open', '--limit', String(options.prLimit), '--json'], repoRoot, aosLabel);
  const ready = runSource(sources, 'aos_ready', aosPath, ['ready', '--json'], repoRoot, aosLabel);
  const status = runSource(sources, 'aos_status', aosPath, ['status', '--json'], repoRoot, aosLabel);

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

  const subagentDelegation = buildSubagentDelegationPolicy(repoRoot);
  sources.push({
    id: 'subagent_delegation_policy',
    command: `read ${subagentDelegation.roles_dir} and ${subagentDelegation.team_doc}`,
    status: subagentDelegation.status === 'active' ? 'success' : 'failed',
    exit_code: subagentDelegation.status === 'active' ? 0 : 1,
    note: subagentDelegation.status,
  });
  setTrace(trace, 'subagent_delegation.status', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.registered_roles', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.routing_scope', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.standing_authorization_intent', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.ask_user_if_runtime_requires_turn_authorization', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.fail_closed_without_registered_role', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.fail_closed_without_session_authorization', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.direct_specialist_fallback_allowed', ['subagent_delegation_policy']);
  setTrace(trace, 'subagent_delegation.extra_mutation_authorized', ['subagent_delegation_policy']);

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
    subagent_delegation: subagentDelegation,
    summary,
  };
}

function printText(payload) {
  process.stdout.write(`dev situation: ${payload.status}\n`);
  process.stdout.write(`Repo: ${payload.repo}\n`);
  process.stdout.write(`Branch: ${payload.git.branch ?? 'unknown'}\n`);
  process.stdout.write(`Head: ${payload.git.head ?? 'unknown'}\n`);
  process.stdout.write(`Clean: ${payload.summary.clean}\n`);
  process.stdout.write(`Synced with origin/main: ${payload.summary.synced_with_origin_main}\n`);
  process.stdout.write(`Open PRs: ${limitedCountText(payload.summary.open_pr_count, payload.summary.open_pr_count_limit, payload.summary.open_pr_count_limit_reached)}\n`);
  process.stdout.write(`Open issues: ${limitedCountText(payload.summary.open_issue_count, payload.summary.open_issue_count_limit, payload.summary.open_issue_count_limit_reached)}\n`);
  process.stdout.write(`Stashes: ${payload.summary.stash_count ?? 'unknown'}\n`);
  process.stdout.write(`Runtime ready: ${payload.summary.runtime_ready ?? 'unknown'}\n`);
  process.stdout.write(`Subagent delegation: ${payload.subagent_delegation?.status ?? 'unknown'} (${payload.subagent_delegation?.roles_dir ?? 'unknown'})\n`);
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

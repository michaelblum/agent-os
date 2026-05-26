#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function die(message, code = 'ERROR', exitCode = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
}

function parseOptions(args) {
  const options = {
    json: false,
    repo: null,
    cwd: null,
    bodyFile: null,
    prNumber: null,
    positionals: [],
  };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--repo') {
      if (i + 1 >= args.length) die('--repo requires a GitHub repository in owner/name form', 'MISSING_ARG');
      options.repo = args[i + 1];
      i += 2;
    } else if (arg === '--cwd') {
      if (i + 1 >= args.length) die('--cwd requires a local checkout path', 'MISSING_ARG');
      options.cwd = args[i + 1];
      i += 2;
    } else if (arg === '--body-file') {
      if (i + 1 >= args.length) die('--body-file requires a path', 'MISSING_ARG');
      options.bodyFile = args[i + 1];
      i += 2;
    } else if (arg === '--pr') {
      if (i + 1 >= args.length) die('--pr requires a PR number', 'MISSING_ARG');
      options.prNumber = args[i + 1];
      i += 2;
    } else if (arg.startsWith('--')) {
      die(`Unknown dev gh flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      options.positionals.push(arg);
      i += 1;
    }
  }
  return options;
}

function repoRootFrom(options) {
  if (options.cwd) return path.resolve(options.cwd);
  return process.env.REPO_ROOT || process.cwd();
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) {
    return {
      status: 127,
      stdout: '',
      stderr: `${result.error.message}\n`,
    };
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runGit(args, cwd) {
  return run('git', args, cwd);
}

function runGh(args, cwd) {
  return run('gh', args, cwd);
}

function writeProcessOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function runGhAndExit(args, cwd) {
  const result = runGh(args, cwd);
  writeProcessOutput(result);
  process.exit(result.status);
}

function emitCompositeErrorAndExit(command, result, json) {
  if (json) {
    printJSON({
      status: 'error',
      authority: 'gh_cli',
      command: ['gh', ...command].join(' '),
      exit_code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } else {
    writeProcessOutput(result);
  }
  process.exit(result.status);
}

function parseJSON(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.length > 0) ?? null;
}

function findExecutable(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function parseGitHubRemote(remote) {
  let value = remote.trim();
  if (value.endsWith('.git')) value = value.slice(0, -4);
  if (value.startsWith('git@github.com:')) return normalizeRepoTail(value.slice('git@github.com:'.length));
  const marker = 'github.com/';
  const index = value.indexOf(marker);
  if (index >= 0) return normalizeRepoTail(value.slice(index + marker.length));
  return null;
}

function normalizeRepoTail(tail) {
  const clean = tail.split(/[?#]/, 1)[0];
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

function appendRepo(args, repoFullName) {
  if (repoFullName) args.push('--repo', repoFullName);
}

function repositoryInfo(repoFullName, repoRoot) {
  const args = ['repo', 'view'];
  if (repoFullName) args.push(repoFullName);
  args.push('--json', 'nameWithOwner,defaultBranchRef');
  const result = runGh(args, repoRoot);
  if (result.status !== 0) return null;
  return parseJSON(result.stdout);
}

function repositoryFullName(options, repoRoot) {
  if (options.repo) return options.repo;
  const remote = runGit(['remote', 'get-url', 'origin'], repoRoot);
  if (remote.status === 0) {
    const parsed = parseGitHubRemote(firstLine(remote.stdout) ?? '');
    if (parsed) return parsed;
  }
  const info = repositoryInfo(null, repoRoot);
  return info?.nameWithOwner ?? null;
}

function currentPRInfo(repoFullName, repoRoot) {
  const args = ['pr', 'view'];
  appendRepo(args, repoFullName);
  args.push('--json', 'number,url,headRefName,baseRefName,state');
  const result = runGh(args, repoRoot);
  if (result.status !== 0) return null;
  return parseJSON(result.stdout);
}

function resolvePRNumber(requested, repoFullName, repoRoot, json) {
  if (requested) return requested;
  const args = ['pr', 'view'];
  appendRepo(args, repoFullName);
  args.push('--json', 'number,url');
  const result = runGh(args, repoRoot);
  if (result.status !== 0) emitCompositeErrorAndExit(args, result, json);
  const payload = parseJSON(result.stdout);
  if (payload?.number === undefined || payload?.number === null) {
    die('Could not infer current PR number from gh pr view', 'MISSING_PR');
  }
  return `${payload.number}`;
}

function resolveUserPath(value) {
  const expanded = value.startsWith('~') ? path.join(process.env.HOME || '', value.slice(1)) : value;
  return path.resolve(expanded);
}

function sanitizeAuthStatus(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('- Token'))
    .join('\n')
    .trim();
}

function gitStatusFiles(repoRoot) {
  const result = runGit(['status', '--porcelain=v1'], repoRoot);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function checkFailed(check) {
  const failed = new Set(['fail', 'failure', 'failed', 'cancelled', 'timed_out', 'action_required']);
  return failed.has(String(check.state ?? '').toLowerCase()) || failed.has(String(check.bucket ?? '').toLowerCase());
}

function actionsRunID(link) {
  const match = String(link ?? '').match(/\/actions\/runs\/([0-9]+)/);
  return match?.[1] ?? null;
}

function splitRepoFullName(value) {
  const parts = String(value ?? '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1] };
}

function flattenReviewThreads(raw) {
  const nodes = raw?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return nodes.map((node) => ({
    is_resolved: node.isResolved ?? false,
    is_outdated: node.isOutdated ?? false,
    path: node.path ?? null,
    line: node.line ?? null,
    start_line: node.startLine ?? null,
    comments: (node.comments?.nodes ?? []).map((comment) => ({
      id: comment.id ?? null,
      url: comment.url ?? null,
      body: comment.body ?? null,
      created_at: comment.createdAt ?? null,
      author: comment.author?.login ?? null,
    })),
  }));
}

function contextCommand(args) {
  const options = parseOptions(args);
  if (options.positionals.length > 0) die('dev gh context does not accept positional arguments', 'UNKNOWN_ARG');
  const repoRoot = repoRootFrom(options);
  const repoFullName = repositoryFullName(options, repoRoot);
  const ghPath = findExecutable('gh');
  const auth = runGh(['auth', 'status'], repoRoot);
  const repoInfo = repositoryInfo(repoFullName, repoRoot);
  const prInfo = currentPRInfo(repoFullName, repoRoot);
  const branch = firstLine(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).stdout);
  const upstream = firstLine(runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot).stdout);
  const dirtyFiles = gitStatusFiles(repoRoot);
  const defaultBranch = repoInfo?.defaultBranchRef?.name ?? null;
  const status = ghPath == null ? 'error' : auth.status === 0 ? 'success' : 'degraded';
  const payload = {
    status,
    authority: 'gh_cli',
    tool: 'gh',
    repo_root: repoRoot,
    repository: repoFullName ?? repoInfo?.nameWithOwner ?? null,
    branch,
    upstream,
    default_branch: defaultBranch,
    gh: {
      available: ghPath != null,
      path: ghPath,
      auth_exit_code: auth.status,
      authenticated: auth.status === 0,
      auth_stdout: sanitizeAuthStatus(auth.stdout),
      auth_stderr: sanitizeAuthStatus(auth.stderr),
    },
    current_pr: prInfo,
    dirty: {
      count: dirtyFiles.length,
      files: dirtyFiles,
    },
  };
  if (options.json) printJSON(payload);
  else process.stdout.write(`dev gh context: ${status}\n`);
}

function issueCommand(args) {
  const action = args[0];
  if (!action) die('dev gh issue requires a subcommand: view or comment', 'MISSING_SUBCOMMAND');
  const options = parseOptions(args.slice(1));
  const repoRoot = repoRootFrom(options);
  const repoFullName = repositoryFullName(options, repoRoot);
  if (action === 'view') {
    if (options.positionals.length === 0) die('dev gh issue view requires exactly one issue number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh issue argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const ghArgs = ['issue', 'view', options.positionals[0]];
    appendRepo(ghArgs, repoFullName);
    if (options.json) ghArgs.push('--json', 'number,title,state,url,body,labels,comments');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'comment') {
    if (options.positionals.length === 0) die('dev gh issue comment requires exactly one issue number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh issue argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    if (!options.bodyFile) die('dev gh issue comment requires --body-file <path>', 'MISSING_ARG');
    const bodyFile = resolveUserPath(options.bodyFile);
    if (!fs.existsSync(bodyFile)) die(`Missing issue comment body file: ${bodyFile}`, 'MISSING_BODY_FILE');
    const ghArgs = ['issue', 'comment', options.positionals[0]];
    appendRepo(ghArgs, repoFullName);
    ghArgs.push('--body-file', bodyFile);
    runGhAndExit(ghArgs, repoRoot);
  } else {
    die(`Unknown dev gh issue subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
  }
}

function prCommand(args) {
  const action = args[0];
  if (!action) die('dev gh pr requires a subcommand: view, checks, or comment', 'MISSING_SUBCOMMAND');
  const options = parseOptions(args.slice(1));
  const repoRoot = repoRootFrom(options);
  const repoFullName = repositoryFullName(options, repoRoot);
  if (action === 'view') {
    if (options.positionals.length > 1) die('dev gh pr view accepts at most one PR number', 'UNKNOWN_ARG');
    const ghArgs = ['pr', 'view'];
    if (options.positionals[0]) ghArgs.push(options.positionals[0]);
    appendRepo(ghArgs, repoFullName);
    if (options.json) ghArgs.push('--json', 'number,title,state,url,headRefName,baseRefName,isDraft,body,comments,reviews');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'checks') {
    if (options.positionals.length > 1) die('dev gh pr checks accepts at most one PR number', 'UNKNOWN_ARG');
    const ghArgs = ['pr', 'checks'];
    if (options.positionals[0]) ghArgs.push(options.positionals[0]);
    appendRepo(ghArgs, repoFullName);
    if (options.json) ghArgs.push('--json', 'name,state,bucket,link,startedAt,completedAt,workflow');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'comment') {
    if (options.positionals.length === 0) die('dev gh pr comment requires exactly one PR number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh pr argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    if (!options.bodyFile) die('dev gh pr comment requires --body-file <path>', 'MISSING_ARG');
    const bodyFile = resolveUserPath(options.bodyFile);
    if (!fs.existsSync(bodyFile)) die(`Missing PR comment body file: ${bodyFile}`, 'MISSING_BODY_FILE');
    const ghArgs = ['pr', 'comment', options.positionals[0]];
    appendRepo(ghArgs, repoFullName);
    ghArgs.push('--body-file', bodyFile);
    runGhAndExit(ghArgs, repoRoot);
  } else {
    die(`Unknown dev gh pr subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
  }
}

function ciCommand(args) {
  const action = args[0];
  if (!action) die('dev gh ci requires a subcommand: inspect', 'MISSING_SUBCOMMAND');
  if (action !== 'inspect') die(`Unknown dev gh ci subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
  const options = parseOptions(args.slice(1));
  if (options.positionals.length > 1) die('dev gh ci inspect accepts at most one PR number', 'UNKNOWN_ARG');
  const repoRoot = repoRootFrom(options);
  const repoFullName = repositoryFullName(options, repoRoot);
  const prNumber = resolvePRNumber(options.prNumber ?? options.positionals[0], repoFullName, repoRoot, options.json);
  const checksArgs = ['pr', 'checks', prNumber];
  appendRepo(checksArgs, repoFullName);
  checksArgs.push('--json', 'name,state,bucket,link,startedAt,completedAt,workflow');
  const checksResult = runGh(checksArgs, repoRoot);
  if (checksResult.status !== 0) emitCompositeErrorAndExit(checksArgs, checksResult, options.json);
  const checks = parseJSON(checksResult.stdout) ?? [];
  const failedLogs = [];
  for (const check of checks.filter(checkFailed)) {
    const runID = actionsRunID(check.link);
    if (!runID) {
      failedLogs.push({ check, source: 'external', status: 'report_only', reason: 'check link is not a GitHub Actions run URL' });
      continue;
    }
    const logArgs = ['run', 'view', runID];
    appendRepo(logArgs, repoFullName);
    logArgs.push('--log-failed');
    const logResult = runGh(logArgs, repoRoot);
    failedLogs.push({
      check,
      source: 'github_actions',
      run_id: runID,
      status: logResult.status === 0 ? 'success' : 'error',
      exit_code: logResult.status,
      stdout: logResult.stdout,
      stderr: logResult.stderr,
    });
  }
  const payload = {
    status: 'success',
    authority: 'gh_cli',
    pr: prNumber,
    repository: repoFullName,
    checks,
    failed_logs: failedLogs,
  };
  if (options.json) printJSON(payload);
  else process.stdout.write(`dev gh ci inspect: PR #${prNumber}\n`);
}

function reviewCommentsCommand(args) {
  const options = parseOptions(args);
  if (options.positionals.length > 1) die('dev gh review-comments accepts at most one PR number', 'UNKNOWN_ARG');
  const repoRoot = repoRootFrom(options);
  const repoFullName = repositoryFullName(options, repoRoot);
  if (!repoFullName) die('Could not infer GitHub repository. Pass --repo owner/name.', 'MISSING_REPO');
  const parts = splitRepoFullName(repoFullName);
  if (!parts) die(`Invalid GitHub repository '${repoFullName}'. Expected owner/name.`, 'INVALID_REPO');
  const prNumber = resolvePRNumber(options.prNumber ?? options.positionals[0], repoFullName, repoRoot, options.json);
  if (!/^[0-9]+$/.test(prNumber)) die(`PR number must be numeric for review-comments: ${prNumber}`, 'INVALID_PR');
  const query = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      url
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          startLine
          comments(first: 50) {
            nodes {
              id
              url
              body
              createdAt
              author { login }
            }
          }
        }
      }
    }
  }
}`;
  const graphQLArgs = [
    'api', 'graphql',
    '-f', `owner=${parts.owner}`,
    '-f', `name=${parts.name}`,
    '-F', `number=${prNumber}`,
    '-f', `query=${query}`,
  ];
  const result = runGh(graphQLArgs, repoRoot);
  if (result.status !== 0) emitCompositeErrorAndExit(graphQLArgs, result, options.json);
  const threads = flattenReviewThreads(parseJSON(result.stdout) ?? {});
  const unresolved = threads.filter((thread) => thread.is_resolved === false);
  const payload = {
    status: 'success',
    authority: 'gh_cli',
    repository: repoFullName,
    pr: prNumber,
    thread_count: threads.length,
    unresolved_count: unresolved.length,
    threads,
  };
  if (options.json) printJSON(payload);
  else process.stdout.write(`dev gh review-comments: PR #${prNumber}\n`);
}

const [group, ...rest] = process.argv.slice(2);
if (!group) {
  process.stdout.write('Usage: aos dev gh <context|issue|pr|ci|review-comments> ...\n');
  process.exit(0);
}

if (group === 'context') contextCommand(rest);
else if (group === 'issue') issueCommand(rest);
else if (group === 'pr') prCommand(rest);
else if (group === 'ci') ciCommand(rest);
else if (group === 'review-comments') reviewCommentsCommand(rest);
else die(`Unknown dev gh group: ${group}`, 'UNKNOWN_SUBCOMMAND');

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

function parseOptions(args, config = {}) {
  const options = {
    json: false,
    repo: null,
    cwd: null,
    bodyFile: null,
    title: null,
    prNumber: null,
    state: null,
    limit: null,
    labels: [],
    author: null,
    assignee: null,
    assignees: [],
    search: null,
    milestone: null,
    base: null,
    head: null,
    draft: false,
    mergeStrategy: null,
    autoMerge: false,
    deleteBranch: false,
    matchHeadCommit: null,
    closeReason: null,
    sort: null,
    order: null,
    positionals: [],
  };
  const listKind = config.listKind ?? null;
  const issueCreate = config.issueCreate ?? false;
  const issueClose = config.issueClose ?? false;
  const prMerge = config.prMerge ?? false;
  const labelList = listKind === 'label';
  const commonListOnlyFlags = new Set(['--state', '--limit', '--author', '--search']);
  const prListFlags = new Set(['--base', '--head', '--draft']);
  const prMergeStrategyFlags = new Set(['--squash', '--merge', '--rebase']);
  const requireValueAt = (index, flag, summary) => {
    if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
      die(`${flag} requires ${summary}`, 'MISSING_ARG');
    }
    return args[index + 1];
  };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--repo') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) die('--repo requires a GitHub repository in owner/name form', 'MISSING_ARG');
      options.repo = args[i + 1];
      i += 2;
    } else if (arg === '--cwd') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) die('--cwd requires a local checkout path', 'MISSING_ARG');
      options.cwd = args[i + 1];
      i += 2;
    } else if (arg === '--body-file') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) die('--body-file requires a path', 'MISSING_ARG');
      options.bodyFile = args[i + 1];
      i += 2;
    } else if (arg === '--title' && issueCreate) {
      options.title = requireValueAt(i, arg, 'an issue title');
      i += 2;
    } else if (arg === '--title') {
      die('--title is only valid for issue create subcommands', 'UNKNOWN_FLAG');
    } else if (arg === '--pr') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) die('--pr requires a PR number', 'MISSING_ARG');
      options.prNumber = args[i + 1];
      i += 2;
    } else if (arg === '--reason' && issueClose) {
      options.closeReason = requireValueAt(i, arg, 'completed or not planned');
      i += 2;
    } else if (arg === '--reason') {
      die('--reason is only valid for issue close subcommands', 'UNKNOWN_FLAG');
    } else if (arg === '--sort' && labelList) {
      options.sort = requireValueAt(i, arg, 'created or name');
      i += 2;
    } else if (arg === '--sort') {
      die('--sort is only valid for label list subcommands', 'UNKNOWN_FLAG');
    } else if (arg === '--order' && labelList) {
      options.order = requireValueAt(i, arg, 'asc or desc');
      i += 2;
    } else if (arg === '--order') {
      die('--order is only valid for label list subcommands', 'UNKNOWN_FLAG');
    } else if (commonListOnlyFlags.has(arg) && !listKind) {
      die(`${arg} is only valid for list subcommands`, 'UNKNOWN_FLAG');
    } else if (prListFlags.has(arg) && !listKind) {
      die(`${arg} is only valid for PR list subcommands`, 'UNKNOWN_FLAG');
    } else if ((prMergeStrategyFlags.has(arg) || arg === '--auto' || arg === '--delete-branch' || arg === '--match-head-commit') && !prMerge) {
      die(`${arg} is only valid for PR merge subcommands`, 'UNKNOWN_FLAG');
    } else if (arg === '--state' && listKind && !labelList) {
      const stateSummary = listKind === 'pr' ? 'open, closed, merged, or all' : 'open, closed, or all';
      options.state = requireValueAt(i, arg, stateSummary);
      i += 2;
    } else if (arg === '--limit' && listKind) {
      const limit = requireValueAt(i, arg, 'a numeric result limit');
      if (!/^[0-9]+$/.test(limit)) die(`--limit must be numeric: ${limit}`, 'INVALID_ARG');
      options.limit = Number.parseInt(limit, 10);
      i += 2;
    } else if (arg === '--label' && ((listKind && !labelList) || issueCreate)) {
      options.labels.push(requireValueAt(i, arg, 'a label name'));
      i += 2;
    } else if (arg === '--label') {
      die('--label is only valid for issue create and issue/PR list subcommands', 'UNKNOWN_FLAG');
    } else if (arg === '--author' && listKind && !labelList) {
      options.author = requireValueAt(i, arg, 'a GitHub login');
      i += 2;
    } else if (arg === '--assignee' && issueCreate) {
      options.assignees.push(requireValueAt(i, arg, 'a GitHub login or @me'));
      i += 2;
    } else if (arg === '--assignee' && listKind && !labelList) {
      options.assignee = requireValueAt(i, arg, 'a GitHub login or @me');
      i += 2;
    } else if (arg === '--assignee') {
      die('--assignee is only valid for issue create and list subcommands', 'UNKNOWN_FLAG');
    } else if (arg === '--search' && listKind) {
      options.search = requireValueAt(i, arg, 'a search query');
      i += 2;
    } else if (arg === '--milestone' && (listKind === 'issue' || issueCreate)) {
      options.milestone = requireValueAt(i, arg, 'an issue milestone name');
      i += 2;
    } else if (arg === '--base' && listKind === 'pr') {
      options.base = requireValueAt(i, arg, 'a base branch name');
      i += 2;
    } else if (arg === '--head' && listKind === 'pr') {
      options.head = requireValueAt(i, arg, 'a head branch name');
      i += 2;
    } else if (arg === '--draft' && listKind === 'pr') {
      options.draft = true;
      i += 1;
    } else if (prMergeStrategyFlags.has(arg) && prMerge) {
      if (options.mergeStrategy) die('dev gh pr merge accepts exactly one merge strategy', 'INVALID_ARG');
      options.mergeStrategy = arg;
      i += 1;
    } else if (arg === '--auto' && prMerge) {
      options.autoMerge = true;
      i += 1;
    } else if (arg === '--delete-branch' && prMerge) {
      options.deleteBranch = true;
      i += 1;
    } else if (arg === '--match-head-commit' && prMerge) {
      options.matchHeadCommit = requireValueAt(i, arg, 'a commit SHA');
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

function appendListFilters(args, options, kind) {
  if (options.state) args.push('--state', options.state);
  if (options.limit != null) args.push('--limit', String(options.limit));
  for (const label of options.labels) args.push('--label', label);
  if (options.author) args.push('--author', options.author);
  if (options.assignee) args.push('--assignee', options.assignee);
  if (options.search) args.push('--search', options.search);
  if (kind === 'issue' && options.milestone) args.push('--milestone', options.milestone);
  if (kind === 'pr') {
    if (options.base) args.push('--base', options.base);
    if (options.head) args.push('--head', options.head);
    if (options.draft) args.push('--draft');
  }
}

function appendLabelListFilters(args, options) {
  if (options.limit != null) args.push('--limit', String(options.limit));
  if (options.search) args.push('--search', options.search);
  if (options.sort) args.push('--sort', options.sort);
  if (options.order) args.push('--order', options.order);
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

function appendIssueCreateMetadata(args, options) {
  for (const label of options.labels) args.push('--label', label);
  for (const assignee of options.assignees) args.push('--assignee', assignee);
  if (options.milestone) args.push('--milestone', options.milestone);
}

function issueCommand(args) {
  const action = args[0];
  if (!action) die('dev gh issue requires a subcommand: list, view, create, comment, or close', 'MISSING_SUBCOMMAND');
  if (action === 'list') {
    const options = parseOptions(args.slice(1), { listKind: 'issue' });
    if (options.positionals.length > 0) die(`Unknown dev gh issue argument: ${options.positionals[0]}`, 'UNKNOWN_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['issue', 'list'];
    appendRepo(ghArgs, repoFullName);
    appendListFilters(ghArgs, options, 'issue');
    if (options.json) ghArgs.push('--json', 'number,title,state,url,createdAt,updatedAt,labels,assignees,author');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'view') {
    const options = parseOptions(args.slice(1));
    if (options.positionals.length === 0) die('dev gh issue view requires exactly one issue number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh issue argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['issue', 'view', options.positionals[0]];
    appendRepo(ghArgs, repoFullName);
    if (options.json) ghArgs.push('--json', 'number,title,state,url,body,labels,comments');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'comment') {
    const options = parseOptions(args.slice(1));
    if (options.positionals.length === 0) die('dev gh issue comment requires exactly one issue number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh issue argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    if (!options.bodyFile) die('dev gh issue comment requires --body-file <path>', 'MISSING_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const bodyFile = resolveUserPath(options.bodyFile);
    if (!fs.existsSync(bodyFile)) die(`Missing issue comment body file: ${bodyFile}`, 'MISSING_BODY_FILE');
    const ghArgs = ['issue', 'comment', options.positionals[0]];
    appendRepo(ghArgs, repoFullName);
    ghArgs.push('--body-file', bodyFile);
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'create') {
    const options = parseOptions(args.slice(1), { issueCreate: true });
    if (options.positionals.length > 0) die(`Unknown dev gh issue argument: ${options.positionals[0]}`, 'UNKNOWN_ARG');
    if (!options.title) die('dev gh issue create requires --title <title>', 'MISSING_ARG');
    if (!options.bodyFile) die('dev gh issue create requires --body-file <path>', 'MISSING_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const bodyFile = resolveUserPath(options.bodyFile);
    if (!fs.existsSync(bodyFile)) die(`Missing issue body file: ${bodyFile}`, 'MISSING_BODY_FILE');
    const ghArgs = ['issue', 'create'];
    appendRepo(ghArgs, repoFullName);
    ghArgs.push('--title', options.title, '--body-file', bodyFile);
    appendIssueCreateMetadata(ghArgs, options);
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'close') {
    const options = parseOptions(args.slice(1), { issueClose: true });
    if (options.positionals.length === 0) die('dev gh issue close requires exactly one issue number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh issue argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    if (options.bodyFile) die('dev gh issue close does not accept --body-file; post a separate issue comment first', 'UNKNOWN_FLAG');
    const issueNumber = options.positionals[0];
    if (!/^[0-9]+$/.test(issueNumber)) die(`Issue number must be numeric for close: ${issueNumber}`, 'INVALID_ISSUE');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['issue', 'close', issueNumber];
    appendRepo(ghArgs, repoFullName);
    if (options.closeReason) ghArgs.push('--reason', options.closeReason);
    runGhAndExit(ghArgs, repoRoot);
  } else {
    die(`Unknown dev gh issue subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
  }
}

function labelCommand(args) {
  const action = args[0];
  if (!action) die('dev gh label requires a subcommand: list', 'MISSING_SUBCOMMAND');
  if (action === 'list') {
    const options = parseOptions(args.slice(1), { listKind: 'label' });
    if (options.positionals.length > 0) die(`Unknown dev gh label argument: ${options.positionals[0]}`, 'UNKNOWN_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['label', 'list'];
    appendRepo(ghArgs, repoFullName);
    appendLabelListFilters(ghArgs, options);
    if (options.json) ghArgs.push('--json', 'name,description,color,isDefault,url');
    runGhAndExit(ghArgs, repoRoot);
  } else {
    die(`Unknown dev gh label subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
  }
}

function prCommand(args) {
  const action = args[0];
  if (!action) die('dev gh pr requires a subcommand: list, view, checks, comment, or merge', 'MISSING_SUBCOMMAND');
  if (action === 'list') {
    const options = parseOptions(args.slice(1), { listKind: 'pr' });
    if (options.positionals.length > 0) die(`Unknown dev gh pr argument: ${options.positionals[0]}`, 'UNKNOWN_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['pr', 'list'];
    appendRepo(ghArgs, repoFullName);
    appendListFilters(ghArgs, options, 'pr');
    if (options.json) ghArgs.push('--json', 'number,title,state,url,createdAt,updatedAt,headRefName,baseRefName,isDraft,labels,author');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'view') {
    const options = parseOptions(args.slice(1));
    if (options.positionals.length > 1) die('dev gh pr view accepts at most one PR number', 'UNKNOWN_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['pr', 'view'];
    if (options.positionals[0]) ghArgs.push(options.positionals[0]);
    appendRepo(ghArgs, repoFullName);
    if (options.json) ghArgs.push('--json', 'number,title,state,url,headRefName,baseRefName,isDraft,reviewDecision,body,comments,reviews');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'checks') {
    const options = parseOptions(args.slice(1));
    if (options.positionals.length > 1) die('dev gh pr checks accepts at most one PR number', 'UNKNOWN_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['pr', 'checks'];
    if (options.positionals[0]) ghArgs.push(options.positionals[0]);
    appendRepo(ghArgs, repoFullName);
    if (options.json) ghArgs.push('--json', 'name,state,bucket,link,startedAt,completedAt,workflow');
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'comment') {
    const options = parseOptions(args.slice(1));
    if (options.positionals.length === 0) die('dev gh pr comment requires exactly one PR number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh pr argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    if (!options.bodyFile) die('dev gh pr comment requires --body-file <path>', 'MISSING_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const bodyFile = resolveUserPath(options.bodyFile);
    if (!fs.existsSync(bodyFile)) die(`Missing PR comment body file: ${bodyFile}`, 'MISSING_BODY_FILE');
    const ghArgs = ['pr', 'comment', options.positionals[0]];
    appendRepo(ghArgs, repoFullName);
    ghArgs.push('--body-file', bodyFile);
    runGhAndExit(ghArgs, repoRoot);
  } else if (action === 'merge') {
    const options = parseOptions(args.slice(1), { prMerge: true });
    if (options.positionals.length === 0) die('dev gh pr merge requires exactly one PR number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh pr argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const prNumber = options.positionals[0];
    if (!/^[0-9]+$/.test(prNumber)) die(`PR number must be numeric for merge: ${prNumber}`, 'INVALID_PR');
    if (!options.mergeStrategy) die('dev gh pr merge requires one of --squash, --merge, or --rebase', 'MISSING_ARG');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['pr', 'merge', prNumber];
    appendRepo(ghArgs, repoFullName);
    ghArgs.push(options.mergeStrategy);
    if (options.autoMerge) ghArgs.push('--auto');
    if (options.deleteBranch) ghArgs.push('--delete-branch');
    if (options.matchHeadCommit) ghArgs.push('--match-head-commit', options.matchHeadCommit);
    if (options.bodyFile) {
      const bodyFile = resolveUserPath(options.bodyFile);
      if (!fs.existsSync(bodyFile)) die(`Missing PR merge body file: ${bodyFile}`, 'MISSING_BODY_FILE');
      ghArgs.push('--body-file', bodyFile);
    }
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
  process.stdout.write('Usage: aos dev gh <context|issue|label|pr|ci|review-comments> ...\n');
  process.exit(0);
}

if (group === 'context') contextCommand(rest);
else if (group === 'issue') issueCommand(rest);
else if (group === 'label') labelCommand(rest);
else if (group === 'pr') prCommand(rest);
else if (group === 'ci') ciCommand(rest);
else if (group === 'review-comments') reviewCommentsCommand(rest);
else die(`Unknown dev gh group: ${group}`, 'UNKNOWN_SUBCOMMAND');

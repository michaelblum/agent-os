#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  devGhGroups,
  devGhSubcommandsFor,
  findDevGhCommandSpec,
  formatDevGhHelp,
} from './aos-dev-gh-spec.mjs';

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function die(message, code = 'ERROR', exitCode = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(exitCode);
}

function invocationDisplayName() {
  return process.env.AOS_INVOCATION_DISPLAY_NAME || './aos';
}

function printHelpAndExit(pathParts) {
  const help = formatDevGhHelp(pathParts, { invocation: invocationDisplayName() });
  if (!help) die(`Unknown dev gh command: ${pathParts.join(' ')}`, 'UNKNOWN_SUBCOMMAND');
  process.stdout.write(help);
  process.exit(0);
}

function pathIsDispatchable(pathParts) {
  return findDevGhCommandSpec(pathParts)?.handler != null;
}

function requireDispatchable(pathParts) {
  if (!pathIsDispatchable(pathParts)) {
    die(`Unknown dev gh command: ${pathParts.join(' ')}`, 'UNKNOWN_SUBCOMMAND');
  }
}

const COMMON_FLAGS = new Set(['--json', '--repo', '--cwd', '--body-file', '--pr']);
const LIST_FLAGS = new Set(['--state', '--limit', '--label', '--author', '--assignee', '--search']);
const PR_LIST_FLAGS = new Set(['--base', '--head', '--draft']);
const PR_MERGE_STRATEGY_FLAGS = new Set(['--squash', '--merge', '--rebase']);
const ISSUE_VIEW_JSON_FIELDS = 'number,title,state,url,body,labels,comments';
const ISSUE_VIEW_TEMPLATE = '{{printf "#%v %s\\n%s\\n\\n%s\\n" .number .title .url .body}}';

function appendOperation(options, value, _command, flag) {
  options.issueEditOperations.push({ flag, value });
}

const FLAG_SPECS = {
  '--json': { assign: (options) => { options.json = true; } },
  '--repo': {
    summary: 'a GitHub repository in owner/name form',
    assign: (options, value) => { options.repo = value; },
  },
  '--cwd': {
    summary: 'a local checkout path',
    assign: (options, value) => { options.cwd = value; },
  },
  '--body-file': {
    summary: 'a path',
    assign: (options, value, command, flag) => {
      options.bodyFile = value;
      if (command === 'issue:edit') appendOperation(options, value, command, flag);
    },
  },
  '--title': {
    summary: 'an issue title',
    assign: (options, value, command, flag) => {
      options.title = value;
      if (command === 'issue:edit') appendOperation(options, value, command, flag);
    },
    invalid: '--title is only valid for issue create and edit subcommands',
  },
  '--pr': {
    summary: 'a PR number',
    assign: (options, value) => { options.prNumber = value; },
  },
  '--reason': {
    summary: 'completed or not planned',
    assign: (options, value) => { options.closeReason = value; },
    invalid: '--reason is only valid for issue close subcommands',
  },
  '--sort': {
    summary: 'created or name',
    assign: (options, value) => { options.sort = value; },
    invalid: '--sort is only valid for label list subcommands',
  },
  '--order': {
    summary: 'asc or desc',
    assign: (options, value) => { options.order = value; },
    invalid: '--order is only valid for label list subcommands',
  },
  '--state': {
    summary: (command) => command === 'pr:list' ? 'open, closed, merged, or all' : 'open, closed, or all',
    assign: (options, value) => { options.state = value; },
    invalid: '--state is only valid for list subcommands',
  },
  '--limit': {
    summary: 'a numeric result limit',
    assign: (options, value) => {
      if (!/^[0-9]+$/.test(value)) die(`--limit must be numeric: ${value}`, 'INVALID_ARG');
      options.limit = Number.parseInt(value, 10);
    },
    invalid: '--limit is only valid for list subcommands',
  },
  '--label': {
    summary: 'a label name',
    assign: (options, value) => { options.labels.push(value); },
    invalid: '--label is only valid for issue create and issue/PR list subcommands',
  },
  '--add-label': {
    summary: 'a label name',
    assign: appendOperation,
    invalid: '--add-label is only valid for issue edit subcommands',
  },
  '--remove-label': {
    summary: 'a label name',
    assign: appendOperation,
    invalid: '--remove-label is only valid for issue edit subcommands',
  },
  '--author': {
    summary: 'a GitHub login',
    assign: (options, value) => { options.author = value; },
    invalid: '--author is only valid for list subcommands',
  },
  '--assignee': {
    summary: 'a GitHub login or @me',
    assign: (options, value, command) => {
      if (command === 'issue:create') options.assignees.push(value);
      else options.assignee = value;
    },
    invalid: '--assignee is only valid for issue create and list subcommands',
  },
  '--add-assignee': {
    summary: 'a GitHub login or @me',
    assign: appendOperation,
    invalid: '--add-assignee is only valid for issue edit subcommands',
  },
  '--remove-assignee': {
    summary: 'a GitHub login or @me',
    assign: appendOperation,
    invalid: '--remove-assignee is only valid for issue edit subcommands',
  },
  '--search': {
    summary: 'a search query',
    assign: (options, value) => { options.search = value; },
    invalid: '--search is only valid for list subcommands',
  },
  '--milestone': {
    summary: 'an issue milestone name',
    assign: (options, value, command, flag) => {
      options.milestone = value;
      if (command === 'issue:edit') appendOperation(options, value, command, flag);
    },
  },
  '--base': {
    summary: 'a base branch name',
    assign: (options, value) => { options.base = value; },
  },
  '--head': {
    summary: 'a head branch name',
    assign: (options, value) => { options.head = value; },
  },
  '--draft': { assign: (options) => { options.draft = true; } },
  '--squash': {
    assign: (options, _value, _command, flag) => {
      if (options.mergeStrategy) die('dev gh pr merge accepts exactly one merge strategy', 'INVALID_ARG');
      options.mergeStrategy = flag;
    },
    invalid: '--squash is only valid for PR merge subcommands',
  },
  '--merge': {
    assign: (options, _value, _command, flag) => {
      if (options.mergeStrategy) die('dev gh pr merge accepts exactly one merge strategy', 'INVALID_ARG');
      options.mergeStrategy = flag;
    },
    invalid: '--merge is only valid for PR merge subcommands',
  },
  '--rebase': {
    assign: (options, _value, _command, flag) => {
      if (options.mergeStrategy) die('dev gh pr merge accepts exactly one merge strategy', 'INVALID_ARG');
      options.mergeStrategy = flag;
    },
    invalid: '--rebase is only valid for PR merge subcommands',
  },
  '--match-head-commit': {
    summary: 'a commit SHA',
    assign: (options, value) => { options.matchHeadCommit = value; },
    invalid: '--match-head-commit is only valid for PR merge subcommands',
  },
};

const COMMAND_FLAGS = new Map([
  ['common', COMMON_FLAGS],
  ['issue:list', new Set([...COMMON_FLAGS, ...LIST_FLAGS, '--milestone'])],
  ['issue:create', new Set([...COMMON_FLAGS, '--title', '--label', '--assignee', '--milestone'])],
  ['issue:close', new Set([...COMMON_FLAGS, '--reason'])],
  ['issue:edit', new Set([
    ...COMMON_FLAGS,
    '--add-label',
    '--remove-label',
    '--add-assignee',
    '--remove-assignee',
    '--milestone',
    '--title',
  ])],
  ['label:list', new Set([...COMMON_FLAGS, '--limit', '--search', '--sort', '--order'])],
  ['pr:list', new Set([...COMMON_FLAGS, ...LIST_FLAGS, ...PR_LIST_FLAGS])],
  ['pr:merge', new Set([...COMMON_FLAGS, ...PR_MERGE_STRATEGY_FLAGS, '--match-head-commit'])],
]);

function flagErrorMessage(flag, command, allowedFlags) {
  const spec = FLAG_SPECS[flag];
  if (!spec) return null;
  if (allowedFlags.has(flag)) return null;
  if (command === 'label:list' && flag === '--state') return `Unknown dev gh flag: ${flag}`;
  if (spec.invalid) return spec.invalid;
  if (LIST_FLAGS.has(flag) && !command.endsWith(':list')) return `${flag} is only valid for list subcommands`;
  if (PR_LIST_FLAGS.has(flag) && !command.endsWith(':list')) return `${flag} is only valid for PR list subcommands`;
  if ((PR_MERGE_STRATEGY_FLAGS.has(flag) || flag === '--match-head-commit') && command !== 'pr:merge') {
    return `${flag} is only valid for PR merge subcommands`;
  }
  return null;
}

function parseOptions(args, command = 'common') {
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
    matchHeadCommit: null,
    closeReason: null,
    sort: null,
    order: null,
    issueEditOperations: [],
    positionals: [],
  };
  const allowedFlags = COMMAND_FLAGS.get(command) ?? COMMAND_FLAGS.get('common');
  const requireValueAt = (index, flag, summary) => {
    if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
      die(`${flag} requires ${summary}`, 'MISSING_ARG');
    }
    return args[index + 1];
  };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    const spec = FLAG_SPECS[arg];
    if (spec) {
      const error = flagErrorMessage(arg, command, allowedFlags);
      if (error) die(error, 'UNKNOWN_FLAG');
      if (!allowedFlags.has(arg)) die(`Unknown dev gh flag: ${arg}`, 'UNKNOWN_FLAG');
      if (spec.summary) {
        const summary = typeof spec.summary === 'function' ? spec.summary(command) : spec.summary;
        const value = requireValueAt(i, arg, summary);
        spec.assign(options, value, command, arg);
        i += 2;
      } else {
        spec.assign(options, null, command, arg);
        i += 1;
      }
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

function appendIssueEditMetadata(args, options) {
  for (const operation of options.issueEditOperations) {
    if (operation.flag === '--body-file') {
      const bodyFile = resolveUserPath(operation.value);
      if (!fs.existsSync(bodyFile)) die(`Missing issue body file: ${bodyFile}`, 'MISSING_BODY_FILE');
      args.push(operation.flag, bodyFile);
    } else {
      args.push(operation.flag, operation.value);
    }
  }
  return options.issueEditOperations.length;
}

function issueCommand(args) {
  const action = args[0];
  if (!action) die(`dev gh issue requires a subcommand: ${devGhSubcommandsFor('issue').join(', ')}`, 'MISSING_SUBCOMMAND');
  requireDispatchable(['issue', action]);
  if (action === 'list') {
    const options = parseOptions(args.slice(1), 'issue:list');
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
    if (options.json) ghArgs.push('--json', ISSUE_VIEW_JSON_FIELDS);
    else ghArgs.push('--json', ISSUE_VIEW_JSON_FIELDS, '--template', ISSUE_VIEW_TEMPLATE);
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
    const options = parseOptions(args.slice(1), 'issue:create');
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
    const options = parseOptions(args.slice(1), 'issue:close');
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
  } else if (action === 'edit') {
    const options = parseOptions(args.slice(1), 'issue:edit');
    if (options.positionals.length === 0) die('dev gh issue edit requires exactly one issue number', 'MISSING_ARG');
    if (options.positionals.length > 1) die(`Unknown dev gh issue argument: ${options.positionals[1]}`, 'UNKNOWN_ARG');
    const issueNumber = options.positionals[0];
    if (!/^[0-9]+$/.test(issueNumber)) die(`Issue number must be numeric for edit: ${issueNumber}`, 'INVALID_ISSUE');
    const repoRoot = repoRootFrom(options);
    const repoFullName = repositoryFullName(options, repoRoot);
    const ghArgs = ['issue', 'edit', issueNumber];
    appendRepo(ghArgs, repoFullName);
    const editCount = appendIssueEditMetadata(ghArgs, options);
    if (editCount === 0) {
      die('dev gh issue edit requires at least one edit flag', 'MISSING_ARG');
    }
    runGhAndExit(ghArgs, repoRoot);
  } else {
    die(`Unknown dev gh issue subcommand: ${action}`, 'UNKNOWN_SUBCOMMAND');
  }
}

function labelCommand(args) {
  const action = args[0];
  if (!action) die(`dev gh label requires a subcommand: ${devGhSubcommandsFor('label').join(', ')}`, 'MISSING_SUBCOMMAND');
  requireDispatchable(['label', action]);
  if (action === 'list') {
    const options = parseOptions(args.slice(1), 'label:list');
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
  if (!action) die(`dev gh pr requires a subcommand: ${devGhSubcommandsFor('pr').join(', ')}`, 'MISSING_SUBCOMMAND');
  requireDispatchable(['pr', action]);
  if (action === 'list') {
    const options = parseOptions(args.slice(1), 'pr:list');
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
    const options = parseOptions(args.slice(1), 'pr:merge');
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
  if (!action) die(`dev gh ci requires a subcommand: ${devGhSubcommandsFor('ci').join(', ')}`, 'MISSING_SUBCOMMAND');
  requireDispatchable(['ci', action]);
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

const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  printHelpAndExit(cliArgs.filter((arg) => arg !== '--help' && arg !== '-h'));
}

const [group, ...rest] = cliArgs;
if (!group) {
  printHelpAndExit([]);
}

if (group === 'context') {
  requireDispatchable(['context']);
  contextCommand(rest);
}
else if (group === 'issue') issueCommand(rest);
else if (group === 'label') labelCommand(rest);
else if (group === 'pr') prCommand(rest);
else if (group === 'ci') ciCommand(rest);
else if (group === 'review-comments') {
  requireDispatchable(['review-comments']);
  reviewCommentsCommand(rest);
}
else die(`Unknown dev gh group: ${group}. Expected one of: ${devGhGroups().join(', ')}`, 'UNKNOWN_SUBCOMMAND');

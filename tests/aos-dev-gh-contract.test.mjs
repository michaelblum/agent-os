import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input: options.input,
    env: options.env || process.env,
  });
}

function createFixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-dev-gh-contract-'));
  const ghPath = path.join(tmp, 'gh');
  const argsLog = path.join(tmp, 'gh-args.log');
  const bodyLog = path.join(tmp, 'gh-body.log');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.GH_ARGS_LOG, JSON.stringify(argv) + '\\n');

function out(line) {
  process.stdout.write(line + '\\n');
}

function err(line) {
  process.stderr.write(line + '\\n');
}

function ok(line) {
  if (line != null) out(line);
  process.exit(0);
}

function fail(line, code = 1) {
  err(line);
  process.exit(code);
}

function matches(pattern) {
  return argv.length === pattern.length && pattern.every((item, index) => item === '*' || argv[index] === item);
}

function appendBodyFile() {
  const index = argv.indexOf('--body-file');
  if (index < 0 || index + 1 >= argv.length) fail('missing fake body file', 64);
  fs.appendFileSync(process.env.GH_BODY_LOG, fs.readFileSync(argv[index + 1], 'utf8') + '\\n---\\n');
}

if (matches(['auth', 'status'])) ok('Logged in to github.com');
if (matches(['repo', 'view', 'michaelblum/agent-os', '--json', 'nameWithOwner,defaultBranchRef'])) {
  ok('{"nameWithOwner":"michaelblum/agent-os","defaultBranchRef":{"name":"main"}}');
}
if (matches(['pr', 'view', '--repo', 'michaelblum/agent-os', '--json', 'number,url,headRefName,baseRefName,state'])) {
  ok('{"number":298,"url":"https://github.com/michaelblum/agent-os/pull/298","headRefName":"codex/example","baseRefName":"main","state":"OPEN"}');
}
if (matches(['issue', 'comment', '298', '--repo', 'michaelblum/agent-os', '--body-file', '*'])) {
  appendBodyFile();
  ok('https://github.com/michaelblum/agent-os/issues/298#issuecomment-test');
}
if (matches(['issue', 'create', '--repo', 'michaelblum/agent-os', '--title', 'Strategic follow-up', '--body-file', '*', '--label', 'governance', '--label', 'follow-up', '--assignee', '@me', '--milestone', 'v1'])) {
  ok('https://github.com/michaelblum/agent-os/issues/411');
}
if (matches(['issue', 'close', '411', '--repo', 'michaelblum/agent-os', '--reason', 'completed'])) {
  ok('Closed issue michaelblum/agent-os#411');
}
if (matches(['issue', 'edit', '407', '--repo', 'michaelblum/agent-os', '--remove-label', 'lane:active', '--add-label', 'lane:parked', '--add-assignee', '@me', '--remove-assignee', 'old-owner', '--milestone', 'v1', '--title', 'Parked ledger', '--body-file', '*'])) {
  ok('https://github.com/michaelblum/agent-os/issues/407');
}
if (matches(['issue', 'view', '298', '--repo', 'michaelblum/agent-os', '--json', 'number,title,state,url,body,labels,comments'])) {
  ok('{"number":298,"title":"Governance ledger","state":"OPEN","url":"https://github.com/michaelblum/agent-os/issues/298","labels":[],"comments":[]}');
}
if (matches(['issue', 'view', '298', '--repo', 'michaelblum/agent-os', '--json', 'number,title,state,url,body,labels,comments', '--template', '*'])) {
  ok('#298 Governance ledger\\nhttps://github.com/michaelblum/agent-os/issues/298');
}
if (matches(['issue', 'view', '298', '--repo', 'michaelblum/agent-os'])) {
  fail('GraphQL: Projects (classic) is being deprecated. (repository.issue.projectCards)');
}
if (argv[0] === 'issue' && argv[1] === 'view' && argv.includes('projectCards')) {
  fail('GraphQL: Projects (classic) is being deprecated. (repository.issue.projectCards)');
}
if (matches(['issue', 'list', '--repo', 'michaelblum/agent-os', '--state', 'all', '--limit', '20', '--label', 'bug', '--label', 'docs', '--search', 'semantic target', '--milestone', 'v0', '--json', 'number,title,state,url,createdAt,updatedAt,labels,assignees,author'])) {
  ok('[{"number":399,"title":"Track semantic target cleanup","state":"CLOSED","url":"https://github.com/michaelblum/agent-os/issues/399"}]');
}
if (matches(['label', 'list', '--repo', 'michaelblum/agent-os', '--limit', '10', '--search', 'governance', '--sort', 'name', '--order', 'desc', '--json', 'name,description,color,isDefault,url'])) {
  ok('[{"name":"governance","description":"Governance and coordination","color":"5319e7","isDefault":false,"url":"https://github.com/michaelblum/agent-os/labels/governance"}]');
}
if (matches(['pr', 'view', '298', '--repo', 'michaelblum/agent-os', '--json', 'number,title,state,url,headRefName,baseRefName,isDraft,reviewDecision,body,comments,reviews'])) {
  ok('{"number":298,"title":"Review target","state":"OPEN","reviewDecision":"CHANGES_REQUESTED"}');
}
if (matches(['pr', 'list', '--repo', 'michaelblum/agent-os', '--state', 'all', '--limit', '30', '--author', 'michaelblum', '--base', 'main', '--head', 'maintainer/example', '--draft', '--json', 'number,title,state,url,createdAt,updatedAt,headRefName,baseRefName,isDraft,labels,author'])) {
  ok('[{"number":404,"title":"Reuse semantic target primitives","state":"MERGED","headRefName":"maintainer/example","baseRefName":"main","isDraft":true}]');
}
if (matches(['pr', 'checks', '298', '--repo', 'michaelblum/agent-os', '--json', 'name,state,bucket,link,startedAt,completedAt,workflow'])) {
  ok('[{"name":"unit","state":"failure","bucket":"fail","link":"https://github.com/michaelblum/agent-os/actions/runs/987","workflow":"CI"}]');
}
if (matches(['pr', 'checks', '299', '--repo', 'michaelblum/agent-os', '--json', 'name,state,bucket,link,startedAt,completedAt,workflow'])) {
  out('[{"name":"lint","state":"failure","bucket":"fail","link":"https://github.com/michaelblum/agent-os/actions/runs/988","workflow":"CI"}]');
  fail('checks failed');
}
if (matches(['pr', 'create', '--repo', 'michaelblum/agent-os', '--base', 'main', '--head', 'maintainer/dev-gh-pr-create-v0', '--title', 'Add PR create', '--body-file', '*'])) {
  appendBodyFile();
  ok('https://github.com/michaelblum/agent-os/pull/433');
}
if (matches(['pr', 'view', 'https://github.com/michaelblum/agent-os/pull/433', '--repo', 'michaelblum/agent-os', '--json', 'number,url,state,headRefName,baseRefName'])) {
  ok('{"number":433,"url":"https://github.com/michaelblum/agent-os/pull/433","state":"OPEN","headRefName":"maintainer/dev-gh-pr-create-v0","baseRefName":"main"}');
}
if (matches(['pr', 'merge', '410', '--repo', 'michaelblum/agent-os', '--merge', '--match-head-commit', 'abc123', '--body-file', '*'])) {
  ok('Merged pull request #410');
}
if (matches(['run', 'view', '987', '--repo', 'michaelblum/agent-os', '--log-failed'])) {
  ok('unit failed log');
}
if (matches(['run', 'view', '988', '--repo', 'michaelblum/agent-os', '--log-failed'])) {
  ok('lint failed log');
}
if (argv[0] === 'api' && argv[1] === 'graphql') {
  ok('{"data":{"repository":{"pullRequest":{"number":298,"url":"https://github.com/michaelblum/agent-os/pull/298","reviewThreads":{"nodes":[{"isResolved":false,"isOutdated":false,"path":"src/example.swift","line":12,"startLine":null,"comments":{"nodes":[{"id":"c1","url":"https://github.com/comment","body":"Please fix this.","createdAt":"2026-05-13T00:00:00Z","author":{"login":"reviewer"}}]}}]}}}}}');
}
fail('unexpected fake gh invocation: ' + argv.join(' '), 64);
`;
  fs.writeFileSync(ghPath, script);
  fs.chmodSync(ghPath, 0o755);
  fs.writeFileSync(argsLog, '');
  fs.writeFileSync(bodyLog, '');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return {
    tmp,
    argsLog,
    bodyLog,
    env: {
      ...process.env,
      PATH: `${tmp}${path.delimiter}${process.env.PATH || ''}`,
      GH_ARGS_LOG: argsLog,
      GH_BODY_LOG: bodyLog,
    },
  };
}

function runDevGh(fixture, args, options = {}) {
  return runNode(['scripts/aos-dev-gh.mjs', ...args], {
    input: options.input,
    env: fixture?.env || process.env,
  });
}

function parseJSONResult(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertFailure(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}

function bodyFile(fixture, text = 'body text\n') {
  const file = path.join(fixture.tmp, `body-${Math.random().toString(16).slice(2)}.md`);
  fs.writeFileSync(file, text);
  return file;
}

function readArgvLog(fixture) {
  return fs.readFileSync(fixture.argsLog, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hasArgv(invocations, expected) {
  return invocations.some((argv) => (
    argv.length === expected.length &&
    expected.every((item, index) => item === '*' || argv[index] === item)
  ));
}

test('GitHub helper direct help and capability metadata stay discoverable', () => {
  const help = runDevGh(null, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^node scripts\/aos-dev-gh\.mjs — sanctioned GitHub workflow subset/m);
  assert.match(help.stdout, /^    issue list/m);
  assert.match(help.stdout, /^    review-comments/m);

  const list = parseJSONResult(runNode(['scripts/aos-dev-workflow.mjs', 'capabilities', 'list', '--entry-path', 'aos_developer', '--json']));
  const ids = new Set(list.capabilities.map((item) => item.id));
  for (const id of [
    'dev.github.issue_list',
    'dev.github.pr_list',
    'dev.github.issue_comment',
    'dev.github.issue_create',
    'dev.github.issue_close',
    'dev.github.issue_edit',
    'dev.github.label_list',
    'dev.github.pr_comment',
    'dev.github.pr_create',
    'dev.github.pr_merge',
    'dev.github.pr_checks',
  ]) {
    assert.equal(ids.has(id), true, id);
  }

  for (const id of ['dev.github.issue_comment', 'dev.github.pr_comment', 'dev.github.pr_create', 'dev.github.issue_create']) {
    const data = parseJSONResult(runNode(['scripts/aos-dev-workflow.mjs', 'capabilities', 'explain', id, '--json']));
    assert.equal(data.capability.adapter.kind, 'node');
    assert.deepEqual(data.capability.adapter.command.slice(0, 2), ['node', 'scripts/aos-dev-gh.mjs']);
    assert.equal(data.capability.mutability.class, 'external_write');
    assert.equal(data.capability.mutability.requires_body_file, true);
    assert.equal(data.capability.execution.raw_process, true);
  }

  assertFailure(runNode(['scripts/aos-dev-workflow.mjs', 'capabilities', 'list', '--role', '--json']), /"code" : "MISSING_ARG"/);
});

test('GitHub helper wraps issue, label, PR, CI, and review-comment commands through gh', (t) => {
  const fixture = createFixture(t);
  const body = bodyFile(fixture, 'file body\n');

  const context = parseJSONResult(runDevGh(fixture, ['context', '--json']));
  assert.equal(context.authority, 'gh_cli');
  assert.equal(context.tool, 'gh');
  assert.equal(context.repository, 'michaelblum/agent-os');

  const issueList = parseJSONResult(runDevGh(fixture, ['issue', 'list', '--state', 'all', '--limit', '20', '--label', 'bug', '--label', 'docs', '--search', 'semantic target', '--milestone', 'v0', '--json']));
  assert.equal(issueList[0].number, 399);

  const issueView = parseJSONResult(runDevGh(fixture, ['issue', 'view', '298', '--json']));
  assert.equal(issueView.title, 'Governance ledger');

  const issueText = runDevGh(fixture, ['issue', 'view', '298']);
  assert.equal(issueText.status, 0, issueText.stderr);
  assert.match(issueText.stdout, /#298 Governance ledger/);

  const comment = runDevGh(fixture, ['issue', 'comment', '298', '--body-file', body]);
  assert.equal(comment.status, 0, comment.stderr);
  assert.match(comment.stdout, /issuecomment-test/);

  const stdinComment = runDevGh(fixture, ['issue', 'comment', '298', '--body-file', '-'], { input: 'stdin accepted\n' });
  assert.equal(stdinComment.status, 0, stdinComment.stderr);

  const devStdinComment = runDevGh(fixture, ['issue', 'comment', '298', '--body-file', '/dev/stdin'], { input: 'dev stdin accepted\n' });
  assert.equal(devStdinComment.status, 0, devStdinComment.stderr);

  const createdIssue = runDevGh(fixture, ['issue', 'create', '--title', 'Strategic follow-up', '--body-file', body, '--label', 'governance', '--label', 'follow-up', '--assignee', '@me', '--milestone', 'v1']);
  assert.equal(createdIssue.status, 0, createdIssue.stderr);
  assert.match(createdIssue.stdout, /issues\/411/);

  const closedIssue = runDevGh(fixture, ['issue', 'close', '411', '--reason', 'completed']);
  assert.equal(closedIssue.status, 0, closedIssue.stderr);
  assert.match(closedIssue.stdout, /Closed issue/);

  const editedIssue = runDevGh(fixture, ['issue', 'edit', '407', '--remove-label', 'lane:active', '--add-label', 'lane:parked', '--add-assignee', '@me', '--remove-assignee', 'old-owner', '--milestone', 'v1', '--title', 'Parked ledger', '--body-file', body]);
  assert.equal(editedIssue.status, 0, editedIssue.stderr);
  assert.match(editedIssue.stdout, /issues\/407/);

  const labels = parseJSONResult(runDevGh(fixture, ['label', 'list', '--limit', '10', '--search', 'governance', '--sort', 'name', '--order', 'desc', '--json']));
  assert.equal(labels[0].name, 'governance');

  const prs = parseJSONResult(runDevGh(fixture, ['pr', 'list', '--state', 'all', '--limit', '30', '--author', 'michaelblum', '--base', 'main', '--head', 'maintainer/example', '--draft', '--json']));
  assert.equal(prs[0].headRefName, 'maintainer/example');

  const prView = parseJSONResult(runDevGh(fixture, ['pr', 'view', '298', '--json']));
  assert.equal(prView.reviewDecision, 'CHANGES_REQUESTED');

  const prCreate = parseJSONResult(runDevGh(fixture, ['pr', 'create', '--base', 'main', '--head', 'maintainer/dev-gh-pr-create-v0', '--title', 'Add PR create', '--body-file', body, '--json']));
  assert.equal(prCreate.number, 433);
  assert.equal(prCreate.head, 'maintainer/dev-gh-pr-create-v0');

  const prMerge = runDevGh(fixture, ['pr', 'merge', '410', '--merge', '--match-head-commit', 'abc123', '--body-file', body]);
  assert.equal(prMerge.status, 0, prMerge.stderr);
  assert.match(prMerge.stdout, /Merged pull request #410/);

  const ci = parseJSONResult(runDevGh(fixture, ['ci', 'inspect', '--pr', '298', '--json']));
  assert.equal(ci.failed_logs[0].source, 'github_actions');
  assert.equal(ci.failed_logs[0].run_id, '987');
  assert.match(ci.failed_logs[0].stdout, /unit failed log/);

  const ciNonZero = parseJSONResult(runDevGh(fixture, ['ci', 'inspect', '--pr', '299', '--json']));
  assert.equal(ciNonZero.checks_exit_code, 1);
  assert.match(ciNonZero.checks_stderr, /checks failed/);
  assert.equal(ciNonZero.failed_logs[0].run_id, '988');

  const comments = parseJSONResult(runDevGh(fixture, ['review-comments', '--pr', '298', '--json']));
  assert.equal(comments.thread_count, 1);
  assert.equal(comments.unresolved_count, 1);
  assert.equal(comments.threads[0].comments[0].author, 'reviewer');

  const argvLog = readArgvLog(fixture);
  assert.equal(hasArgv(argvLog, [
    'issue',
    'list',
    '--repo',
    'michaelblum/agent-os',
    '--state',
    'all',
    '--limit',
    '20',
    '--label',
    'bug',
    '--label',
    'docs',
    '--search',
    'semantic target',
    '--milestone',
    'v0',
    '--json',
    'number,title,state,url,createdAt,updatedAt,labels,assignees,author',
  ]), true);
  assert.equal(hasArgv(argvLog, [
    'issue',
    'create',
    '--repo',
    'michaelblum/agent-os',
    '--title',
    'Strategic follow-up',
    '--body-file',
    body,
    '--label',
    'governance',
    '--label',
    'follow-up',
    '--assignee',
    '@me',
    '--milestone',
    'v1',
  ]), true);
  assert.equal(hasArgv(argvLog, [
    'pr',
    'create',
    '--repo',
    'michaelblum/agent-os',
    '--base',
    'main',
    '--head',
    'maintainer/dev-gh-pr-create-v0',
    '--title',
    'Add PR create',
    '--body-file',
    body,
  ]), true);
  assert.equal(JSON.stringify(argvLog).includes('projectCards'), false);
  const bodyLog = fs.readFileSync(fixture.bodyLog, 'utf8');
  assert.match(bodyLog, /file body/);
  assert.match(bodyLog, /stdin accepted/);
  assert.match(bodyLog, /dev stdin accepted/);
});

test('GitHub helper rejects ambiguous or interactive-prone argument forms', (t) => {
  const fixture = createFixture(t);
  const body = bodyFile(fixture);
  const missing = path.join(fixture.tmp, 'missing.md');

  const cases = [
    [['context', '--repo', '--json'], /--repo requires a GitHub repository/],
    [['issue', 'view', '298', 'extra', '--json'], /Unknown dev gh issue argument: extra/],
    [['issue', 'list', '--limit', '--json'], /--limit requires a numeric result limit/],
    [['issue', 'view', '298', '--state', 'all', '--json'], /--state is only valid for list subcommands/],
    [['issue', 'list', '--base', 'main', '--json'], /Unknown dev gh flag: --base/],
    [['issue', 'comment', '298', 'extra', '--body-file', body], /Unknown dev gh issue argument: extra/],
    [['issue', 'comment', '298', '--body-file', '--json'], /--body-file requires a path or -/],
    [['issue', 'create', '--body-file', body], /dev gh issue create requires --title/],
    [['issue', 'create', '--title', 'Strategic follow-up', '--body-file', '--json'], /--body-file requires a path or -/],
    [['issue', 'create', '--title', 'Strategic follow-up', '--body-file', missing], /Missing issue body file:/],
    [['issue', 'close', 'current', '--reason', 'completed'], /Issue number must be numeric for close: current/],
    [['issue', 'close', '411', '--body-file', body], /dev gh issue close does not accept --body-file/],
    [['issue', 'edit'], /dev gh issue edit requires exactly one issue number/],
    [['issue', 'edit', 'current', '--add-label', 'lane:parked'], /Issue number must be numeric for edit: current/],
    [['issue', 'edit', '407'], /dev gh issue edit requires at least one edit flag/],
    [['issue', 'edit', '407', '--body-file', missing], /Missing issue body file:/],
    [['label', 'list', '--limit', '--json'], /--limit requires a numeric result limit/],
    [['label', 'list', '--label', 'bug', '--json'], /--label is only valid for issue create and issue\/PR list subcommands/],
    [['pr', 'comment', '298', 'extra', '--body-file', body], /Unknown dev gh pr argument: extra/],
    [['pr', 'list', '--base', '--json'], /--base requires a base branch/],
    [['pr', 'create', '--base', 'main', '--head', 'maintainer/dev-gh-pr-create-v0', '--body-file', body, '--json'], /dev gh pr create requires --title/],
    [['pr', 'create', '--head', 'maintainer/dev-gh-pr-create-v0', '--title', 'Add PR create', '--body-file', body, '--json'], /dev gh pr create requires --base/],
    [['pr', 'create', '--base', 'main', '--title', 'Add PR create', '--body-file', body, '--json'], /dev gh pr create requires --head/],
    [['pr', 'create', '--base', 'main', '--head', 'maintainer/dev-gh-pr-create-v0', '--title', 'Add PR create', '--json'], /dev gh pr create requires --body-file/],
    [['pr', 'create', '--base', 'main', '--head', 'maintainer/dev-gh-pr-create-v0', '--title', 'Add PR create', '--body-file', '--json'], /--body-file requires a path or -/],
    [['pr', 'merge', '410', '--match-head-commit', 'abc123'], /dev gh pr merge requires one of --squash, --merge, or --rebase/],
    [['pr', 'merge', '410', '--merge', '--squash'], /dev gh pr merge accepts exactly one merge strategy/],
    [['pr', 'merge', 'current', '--merge'], /PR number must be numeric for merge: current/],
    [['pr', 'merge', '410', '--merge', '--auto'], /Unknown dev gh flag: --auto/],
    [['pr', 'merge', '410', '--merge', '--delete-branch'], /Unknown dev gh flag: --delete-branch/],
    [['pr', 'merge', '410', '--merge', '--body-file', missing], /Missing PR merge body file:/],
    [['ci', 'inspect', '--pr', '--json'], /--pr requires a PR number/],
  ];

  for (const [args, pattern] of cases) {
    assertFailure(runDevGh(fixture, args), pattern);
  }

  const ciInfer = runDevGh(fixture, ['ci', 'inspect', '--json']);
  assert.notEqual(ciInfer.status, 0, ciInfer.stdout);
  const ciError = JSON.parse(ciInfer.stdout);
  assert.equal(ciError.status, 'error');
  assert.equal(ciError.command, 'gh pr view --repo michaelblum/agent-os --json number,url');
  assert.match(ciError.stderr, /unexpected fake gh invocation/);

  const reviewInfer = runDevGh(fixture, ['review-comments', '--json']);
  assert.notEqual(reviewInfer.status, 0, reviewInfer.stdout);
  const reviewError = JSON.parse(reviewInfer.stdout);
  assert.equal(reviewError.status, 'error');
  assert.equal(reviewError.command, 'gh pr view --repo michaelblum/agent-os --json number,url');
  assert.match(reviewError.stderr, /unexpected fake gh invocation/);
});

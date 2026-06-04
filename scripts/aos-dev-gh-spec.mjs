const COMMON_OPTIONS = [
  { name: '--repo', summary: 'GitHub repository in owner/name form' },
  { name: '--cwd', summary: 'Local checkout path used for git context and gh execution' },
];

const JSON_OPTION = { name: '--json', summary: 'Emit machine-readable output where supported' };
const BODY_FILE_OPTION = { name: '--body-file', summary: 'Markdown body file path' };
const ISSUE_NUMBER_ARG = { name: '<issue-number>', summary: 'GitHub issue number', required: true };
const PR_NUMBER_ARG = { name: '<pr-number>', summary: 'GitHub pull request number', required: true };

const ISSUE_LIST_OPTIONS = [
  { name: '--state', summary: 'Issue state filter: open, closed, or all' },
  { name: '--limit', summary: 'Maximum result count' },
  { name: '--label', summary: 'Issue label filter; repeat for multiple labels' },
  { name: '--author', summary: 'Author login filter' },
  { name: '--assignee', summary: 'Assignee login filter' },
  { name: '--search', summary: 'Issue search query' },
  { name: '--milestone', summary: 'Issue milestone filter' },
];

const PR_LIST_OPTIONS = [
  { name: '--state', summary: 'Pull request state filter: open, closed, merged, or all' },
  { name: '--limit', summary: 'Maximum result count' },
  { name: '--label', summary: 'Pull request label filter; repeat for multiple labels' },
  { name: '--author', summary: 'Author login filter' },
  { name: '--assignee', summary: 'Assignee login filter' },
  { name: '--search', summary: 'Pull request search query' },
  { name: '--base', summary: 'Base branch filter' },
  { name: '--head', summary: 'Head branch filter' },
  { name: '--draft', summary: 'Filter draft pull requests' },
];

export const DEV_GH_ROOT_SUMMARY = 'GitHub workflow helpers through local gh';

export const DEV_GH_COMMAND_SPECS = [
  {
    path: ['context'],
    handler: 'context',
    summary: 'Inspect local GitHub CLI, repository, branch, PR, and dirty checkout context.',
    usage: './aos dev gh context [--repo owner/name] [--cwd <path>] [--json]',
    args: [...COMMON_OPTIONS, JSON_OPTION],
    examples: ['./aos dev gh context --json'],
  },
  {
    path: ['issue', 'list'],
    handler: 'issue:list',
    summary: 'List GitHub issues with bounded inventory filters.',
    usage: './aos dev gh issue list [--state <state>] [--limit <n>] [--label <name>] [--author <login>] [--assignee <login>] [--search <query>] [--milestone <name>] [--repo owner/name] [--cwd <path>] [--json]',
    args: [...ISSUE_LIST_OPTIONS, ...COMMON_OPTIONS, JSON_OPTION],
    examples: ['./aos dev gh issue list --state open --limit 50 --json'],
  },
  {
    path: ['issue', 'view'],
    handler: 'issue:view',
    summary: 'Read one GitHub issue.',
    usage: './aos dev gh issue view <issue-number> [--repo owner/name] [--cwd <path>] [--json]',
    args: [ISSUE_NUMBER_ARG, ...COMMON_OPTIONS, JSON_OPTION],
    examples: ['./aos dev gh issue view 416 --json'],
  },
  {
    path: ['issue', 'comment'],
    handler: 'issue:comment',
    summary: 'Write a GitHub issue comment from a body file.',
    usage: './aos dev gh issue comment <issue-number> --body-file <path> [--repo owner/name] [--cwd <path>]',
    args: [ISSUE_NUMBER_ARG, { ...BODY_FILE_OPTION, required: true }, ...COMMON_OPTIONS],
    examples: ['./aos dev gh issue comment 416 --body-file /tmp/comment.md'],
  },
  {
    path: ['issue', 'create'],
    handler: 'issue:create',
    summary: 'Create a GitHub issue from an explicit title and body file.',
    usage: './aos dev gh issue create --title <title> --body-file <path> [--label <name>] [--assignee <login>] [--milestone <name>] [--repo owner/name] [--cwd <path>]',
    args: [
      { name: '--title', summary: 'Issue title', required: true },
      { ...BODY_FILE_OPTION, required: true },
      { name: '--label', summary: 'Issue label; repeat for multiple labels' },
      { name: '--assignee', summary: 'Assignee login or @me; repeat for multiple assignees' },
      { name: '--milestone', summary: 'Issue milestone' },
      ...COMMON_OPTIONS,
    ],
    examples: ['./aos dev gh issue create --title "Follow-up" --body-file /tmp/issue.md'],
  },
  {
    path: ['issue', 'close'],
    handler: 'issue:close',
    summary: 'Close a GitHub issue with an optional close reason.',
    usage: './aos dev gh issue close <issue-number> [--reason <completed|not planned>] [--repo owner/name] [--cwd <path>]',
    args: [ISSUE_NUMBER_ARG, { name: '--reason', summary: 'Close reason: completed or not planned' }, ...COMMON_OPTIONS],
    examples: ['./aos dev gh issue close 416 --reason completed'],
  },
  {
    path: ['issue', 'edit'],
    handler: 'issue:edit',
    summary: 'Edit GitHub issue lifecycle metadata with explicit non-interactive flags.',
    usage: './aos dev gh issue edit <issue-number> (--add-label <name>|--remove-label <name>|--add-assignee <login>|--remove-assignee <login>|--milestone <name>|--title <title>|--body-file <path>) [--repo owner/name] [--cwd <path>]',
    args: [
      ISSUE_NUMBER_ARG,
      { name: '--add-label', summary: 'Label to add; repeat for multiple labels' },
      { name: '--remove-label', summary: 'Label to remove; repeat for multiple labels' },
      { name: '--add-assignee', summary: 'Assignee login or @me to add' },
      { name: '--remove-assignee', summary: 'Assignee login or @me to remove' },
      { name: '--milestone', summary: 'Issue milestone' },
      { name: '--title', summary: 'Replacement issue title' },
      BODY_FILE_OPTION,
      ...COMMON_OPTIONS,
    ],
    examples: ['./aos dev gh issue edit 416 --add-label lane:active'],
  },
  {
    path: ['label', 'list'],
    handler: 'label:list',
    summary: 'List GitHub repository labels with bounded inventory filters.',
    usage: './aos dev gh label list [--limit <n>] [--search <query>] [--sort <created|name>] [--order <asc|desc>] [--repo owner/name] [--cwd <path>] [--json]',
    args: [
      { name: '--limit', summary: 'Maximum result count' },
      { name: '--search', summary: 'Label search query' },
      { name: '--sort', summary: 'Sort field: created or name' },
      { name: '--order', summary: 'Sort direction: asc or desc' },
      ...COMMON_OPTIONS,
      JSON_OPTION,
    ],
    examples: ['./aos dev gh label list --limit 100 --json'],
  },
  {
    path: ['pr', 'list'],
    handler: 'pr:list',
    summary: 'List GitHub pull requests with bounded inventory filters.',
    usage: './aos dev gh pr list [--state <state>] [--limit <n>] [--label <name>] [--author <login>] [--assignee <login>] [--search <query>] [--base <branch>] [--head <branch>] [--draft] [--repo owner/name] [--cwd <path>] [--json]',
    args: [...PR_LIST_OPTIONS, ...COMMON_OPTIONS, JSON_OPTION],
    examples: ['./aos dev gh pr list --state all --limit 30 --json'],
  },
  {
    path: ['pr', 'view'],
    handler: 'pr:view',
    summary: 'Read one GitHub pull request, or infer the current PR when omitted.',
    usage: './aos dev gh pr view [<pr-number>] [--repo owner/name] [--cwd <path>] [--json]',
    args: [{ ...PR_NUMBER_ARG, required: false }, ...COMMON_OPTIONS, JSON_OPTION],
    examples: ['./aos dev gh pr view 415 --json'],
  },
  {
    path: ['pr', 'checks'],
    handler: 'pr:checks',
    summary: 'Read GitHub pull request check status.',
    usage: './aos dev gh pr checks [<pr-number>] [--repo owner/name] [--cwd <path>] [--json]',
    args: [{ ...PR_NUMBER_ARG, required: false }, ...COMMON_OPTIONS, JSON_OPTION],
    examples: ['./aos dev gh pr checks 415 --json'],
  },
  {
    path: ['pr', 'comment'],
    handler: 'pr:comment',
    summary: 'Write a GitHub pull request comment from a body file.',
    usage: './aos dev gh pr comment <pr-number> --body-file <path> [--repo owner/name] [--cwd <path>]',
    args: [PR_NUMBER_ARG, { ...BODY_FILE_OPTION, required: true }, ...COMMON_OPTIONS],
    examples: ['./aos dev gh pr comment 415 --body-file /tmp/comment.md'],
  },
  {
    path: ['pr', 'merge'],
    handler: 'pr:merge',
    summary: 'Merge a GitHub pull request through an explicit strategy.',
    usage: './aos dev gh pr merge <pr-number> (--squash|--merge|--rebase) [--match-head-commit <sha>] [--body-file <path>] [--repo owner/name] [--cwd <path>]',
    args: [
      PR_NUMBER_ARG,
      { name: '--squash', summary: 'Use squash merge strategy' },
      { name: '--merge', summary: 'Use merge commit strategy' },
      { name: '--rebase', summary: 'Use rebase merge strategy' },
      { name: '--match-head-commit', summary: 'Only merge if the PR head matches this commit SHA' },
      BODY_FILE_OPTION,
      ...COMMON_OPTIONS,
    ],
    examples: ['./aos dev gh pr merge 415 --squash --match-head-commit <sha>'],
  },
  {
    path: ['ci', 'inspect'],
    handler: 'ci:inspect',
    summary: 'Inspect PR checks and retrieve failed GitHub Actions logs.',
    usage: './aos dev gh ci inspect [<pr-number>|--pr <number>] [--repo owner/name] [--cwd <path>] [--json]',
    args: [
      { ...PR_NUMBER_ARG, required: false },
      { name: '--pr', summary: 'PR number to inspect' },
      ...COMMON_OPTIONS,
      JSON_OPTION,
    ],
    examples: ['./aos dev gh ci inspect --pr 415 --json'],
  },
  {
    path: ['review-comments'],
    handler: 'review-comments',
    summary: 'Read thread-level PR review comment state through gh GraphQL.',
    usage: './aos dev gh review-comments [<pr-number>|--pr <number>] [--repo owner/name] [--cwd <path>] [--json]',
    args: [
      { ...PR_NUMBER_ARG, required: false },
      { name: '--pr', summary: 'PR number whose review threads should be read' },
      ...COMMON_OPTIONS,
      JSON_OPTION,
    ],
    examples: ['./aos dev gh review-comments --pr 415 --json'],
  },
];

export function devGhPathKey(pathParts) {
  return pathParts.join(' ');
}

export function dispatchableDevGhCommandPaths() {
  return DEV_GH_COMMAND_SPECS
    .filter((spec) => spec.handler)
    .map((spec) => spec.path);
}

export function exposedDevGhCommandPaths() {
  return DEV_GH_COMMAND_SPECS
    .filter((spec) => spec.usage)
    .map((spec) => spec.path);
}

export function findDevGhCommandSpec(pathParts) {
  const key = devGhPathKey(pathParts);
  return DEV_GH_COMMAND_SPECS.find((spec) => devGhPathKey(spec.path) === key) ?? null;
}

export function devGhGroups() {
  return [...new Set(DEV_GH_COMMAND_SPECS.map((spec) => spec.path[0]))];
}

export function devGhSubcommandsFor(group) {
  return DEV_GH_COMMAND_SPECS
    .filter((spec) => spec.path[0] === group && spec.path.length > 1)
    .map((spec) => spec.path.slice(1).join(' '));
}

export function formatDevGhHelp(pathParts = [], options = {}) {
  const invocation = options.invocation ?? './aos';
  if (pathParts.length === 0) return formatDevGhRootHelp(invocation);

  const spec = findDevGhCommandSpec(pathParts);
  if (!spec) return null;
  return formatDevGhCommandHelp(spec, invocation);
}

function formatDevGhRootHelp(invocation) {
  const commandLabel = `${invocation} dev gh`;
  const commandNames = dispatchableDevGhCommandPaths().map((pathParts) => pathParts.join(' '));
  const width = Math.max(...commandNames.map((name) => name.length));
  const lines = [
    `${commandLabel} — ${DEV_GH_ROOT_SUMMARY}`,
    '',
    `  ${commandLabel} <subcommand> [options]`,
    '',
    '  Subcommands:',
  ];

  for (const spec of DEV_GH_COMMAND_SPECS) {
    const name = spec.path.join(' ');
    lines.push(`    ${name.padEnd(width, ' ')}  ${spec.summary}`);
  }

  lines.push('');
  lines.push(`Run '${commandLabel} <subcommand> --help' for details on a specific command.`);
  return `${lines.join('\n')}\n`;
}

function formatDevGhCommandHelp(spec, invocation) {
  const commandLabel = `${invocation} dev gh ${spec.path.join(' ')}`;
  const lines = [
    `${commandLabel} — ${spec.summary}`,
    '',
    `  ${renderInvocation(spec.usage, invocation)}`,
  ];

  if (spec.args?.length) {
    lines.push('');
    for (const arg of spec.args) {
      const required = arg.required ? ' (required)' : '';
      lines.push(`    ${arg.name}\t${arg.summary}${required}`);
    }
  }

  if (spec.examples?.length) {
    lines.push('', '  Examples:');
    for (const example of spec.examples) {
      lines.push(`    ${renderInvocation(example, invocation)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderInvocation(value, invocation) {
  return String(value)
    .replace(/^\.\/aos\b/, invocation)
    .replace(/^aos\b/, invocation);
}

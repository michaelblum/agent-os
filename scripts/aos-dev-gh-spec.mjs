export const DEV_GH_COMMAND_PATHS = [
  ['context'],
  ['issue', 'list'],
  ['issue', 'view'],
  ['issue', 'comment'],
  ['issue', 'create'],
  ['issue', 'close'],
  ['issue', 'edit'],
  ['label', 'list'],
  ['pr', 'list'],
  ['pr', 'view'],
  ['pr', 'checks'],
  ['pr', 'create'],
  ['pr', 'comment'],
  ['pr', 'merge'],
  ['ci', 'inspect'],
  ['review-comments'],
];

export function devGhPathKey(pathParts) {
  return pathParts.join(' ');
}

export function dispatchableDevGhCommandPaths() {
  return DEV_GH_COMMAND_PATHS.map((pathParts) => [...pathParts]);
}

export function findDevGhCommandSpec(pathParts) {
  const key = devGhPathKey(pathParts);
  const path = DEV_GH_COMMAND_PATHS.find((candidate) => devGhPathKey(candidate) === key);
  return path ? { path } : null;
}

export function devGhGroups() {
  return [...new Set(DEV_GH_COMMAND_PATHS.map((pathParts) => pathParts[0]))];
}

export function devGhSubcommandsFor(group) {
  return DEV_GH_COMMAND_PATHS
    .filter((pathParts) => pathParts[0] === group && pathParts.length > 1)
    .map((pathParts) => pathParts.slice(1).join(' '));
}

export function formatDevGhHelp(_pathParts = [], options = {}) {
  const invocation = options.invocation ?? './aos';
  const commandLabel = `${invocation} dev gh`;
  const commandNames = DEV_GH_COMMAND_PATHS.map(devGhPathKey);
  const width = Math.max(...commandNames.map((name) => name.length));
  const lines = [
    `${commandLabel} — sanctioned GitHub workflow subset`,
    '',
    `  ${commandLabel} <subcommand> [options]`,
    '',
    '  Allowed subcommands:',
  ];

  for (const commandName of commandNames) {
    lines.push(`    ${commandName.padEnd(width, ' ')}  ${deltaSummary(commandName)}`);
  }

  lines.push(
    '',
    '  Delta from gh:',
    '    Non-interactive only: commands fail instead of prompting.',
    '    Body-writing commands use --body-file <path|->; stdin is accepted via - or /dev/stdin.',
    '    pr merge requires exactly one explicit strategy: --squash, --merge, or --rebase.',
    '    List commands take bounded --limit values for inventory scans.',
    '',
    '  AOS-only helpers:',
    '    context          Reports local gh auth, repository, branch, current PR, and dirty checkout state.',
    '    ci inspect       Reads PR checks and failed GitHub Actions logs for review triage.',
    '    review-comments  Reads PR review thread state through gh GraphQL.',
    '',
    'This surface intentionally exposes a constrained allowlist, not every gh command.',
  );

  return `${lines.join('\n')}\n`;
}

function deltaSummary(commandName) {
  switch (commandName) {
    case 'context':
      return 'AOS helper: local GitHub/repo context.';
    case 'ci inspect':
      return 'AOS helper: PR checks plus failed Actions logs.';
    case 'review-comments':
      return 'AOS helper: PR review thread state.';
    default:
      return 'Wrapped gh command.';
  }
}

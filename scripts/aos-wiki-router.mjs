#!/usr/bin/env node

const subcommands = [
  'list',
  'show',
  'graph',
  'add',
  'put',
  'rm',
  'link',
  'search',
  'seed',
  'project-docs',
  'reindex',
  'lint',
  'invoke',
  'create-plugin',
  'migrate-namespaces',
];

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

const [subcommand] = process.argv.slice(2);
if (!subcommand) {
  error(`wiki requires a subcommand. Usage: aos wiki <${subcommands.join('|')}> ...`, 'MISSING_SUBCOMMAND');
}
error(`Unknown wiki subcommand: ${subcommand}`, 'UNKNOWN_SUBCOMMAND');

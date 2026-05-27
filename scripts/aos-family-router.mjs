#!/usr/bin/env node

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

const [family, code, label, subcommand] = process.argv.slice(2);
if (!family || !code || !label || !subcommand) {
  error('aos-family-router requires <family> <code> <label> <subcommand>', 'MISSING_ARG');
}

error(`Unknown ${label}: ${subcommand}`, code);

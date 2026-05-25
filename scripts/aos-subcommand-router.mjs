#!/usr/bin/env node

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

const [family, missingCode, missingMessage, unknownCode, label, subcommand] = process.argv.slice(2);
if (!family || !missingCode || !missingMessage || !unknownCode || !label) {
  error(
    'aos-subcommand-router requires <family> <missing-code> <missing-message> <unknown-code> <label> [subcommand]',
    'MISSING_ARG'
  );
}

if (!subcommand) error(missingMessage, missingCode);
error(`Unknown ${label}: ${subcommand}`, unknownCode);

#!/usr/bin/env node

import {
  emitAgentWorkspaceError,
  isAgentWorkspaceError,
  runRefAction,
} from './lib/aos-agent-workspace.mjs';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

try {
  const [action, ...args] = process.argv.slice(2);
  if (!action) error('saved-ref action wrapper requires an action', 'MISSING_ARG');
  runRefAction(action, args);
} catch (err) {
  if (isAgentWorkspaceError(err)) emitAgentWorkspaceError(err);
  throw err;
}

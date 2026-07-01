#!/usr/bin/env node

import {
  agentWorkspaceCLI,
  emitAgentWorkspaceError,
  isAgentWorkspaceError,
} from './lib/aos-agent-workspace.mjs';

try {
  agentWorkspaceCLI(process.argv.slice(2));
} catch (error) {
  if (isAgentWorkspaceError(error)) emitAgentWorkspaceError(error);
  throw error;
}

#!/usr/bin/env node

import { agentWorkspaceCLI } from './lib/aos-agent-workspace.mjs';

agentWorkspaceCLI(process.argv.slice(2));

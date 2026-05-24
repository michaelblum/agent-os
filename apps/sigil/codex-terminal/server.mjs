#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  appendProcessStderr,
  startServer,
} from '../../../packages/toolkit/components/agent-terminal/bridge-server.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startServer();
}

export { appendProcessStderr, startServer };

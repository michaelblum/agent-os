#!/usr/bin/env node

import { runWorkerGroupSentinel } from './lib/browser-companion/worker-group-sentinel.mjs';

try {
  await runWorkerGroupSentinel();
} catch {
  process.exitCode = 1;
}

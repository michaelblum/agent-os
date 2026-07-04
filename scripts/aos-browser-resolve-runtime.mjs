#!/usr/bin/env node

import { resolvePlaywrightCliRuntime } from './lib/playwright-cli-runtime.mjs';

const runtime = resolvePlaywrightCliRuntime();
const text = `${JSON.stringify(runtime, null, 2)}\n`;
if (runtime.status === 'ok') {
  process.stdout.write(text);
  process.exit(0);
}
process.stderr.write(text);
process.exit(1);

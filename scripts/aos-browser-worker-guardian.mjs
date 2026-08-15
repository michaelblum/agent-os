#!/usr/bin/env node

import { runGuardianProcess } from './lib/browser-companion/worker-guardian.mjs';

function parse(argv) {
  const values = {};
  const names = new Set(['--state-root', '--runtime-mode', '--store-id', '--lock-token', '--session-id', '--generation', '--nonce', '--operation']);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || typeof value !== 'string' || value.length === 0 || Object.hasOwn(values, name)) {
      throw new Error('guardian arguments differ');
    }
    values[name] = value;
  }
  if (Object.keys(values).length !== names.size || !['repo', 'installed'].includes(values['--runtime-mode'])) {
    throw new Error('guardian arguments differ');
  }
  return values;
}

try {
  const values = parse(process.argv.slice(2));
  await runGuardianProcess({
    env: { AOS_STATE_ROOT: values['--state-root'], AOS_RUNTIME_MODE: values['--runtime-mode'] },
    binding: {
      store_id: values['--store-id'], lock_token: values['--lock-token'],
      session_id: values['--session-id'], generation: values['--generation'],
      nonce: values['--nonce'], operation: values['--operation'],
    },
  });
} catch {
  process.exitCode = 1;
}

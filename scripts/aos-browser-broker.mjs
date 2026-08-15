#!/usr/bin/env node

import {
  captureManagedBrowserEvidence,
  executeManagedSessionOperation,
  managedSessionIdentity,
} from './lib/browser-companion/session-lifecycle.mjs';
import { sessionErrorReceipt } from './lib/browser-companion/session-model.mjs';

const MAX_REQUEST_BYTES = 128 * 1024;

async function readRequest() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw Object.assign(new Error('request exceeds limit'), { code: 'BROWSER_SESSION_INVALID' });
    chunks.push(chunk);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).trim();
  const value = JSON.parse(text);
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['input', 'operation', 'session_id'])
    || !value.input || typeof value.input !== 'object' || Array.isArray(value.input)
  ) throw Object.assign(new Error('request shape'), { code: 'BROWSER_SESSION_INVALID' });
  return value;
}

let operation = 'broker';
try {
  const request = await readRequest();
  const requestedOperation = String(request.operation ?? '');
  if (requestedOperation === 'identity') {
    operation = requestedOperation;
    const result = await managedSessionIdentity(request.session_id);
    process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
  } else {
    const allowed = new Set(['snapshot', 'screenshot', 'page_identity', 'evidence_capture']);
    if (!allowed.has(requestedOperation)) throw Object.assign(new Error('operation unsupported'), { code: 'BROWSER_SESSION_OPERATION_UNSUPPORTED' });
    operation = requestedOperation;
    const result = operation === 'evidence_capture'
      ? await captureManagedBrowserEvidence(request.session_id, request.input ?? {})
      : await executeManagedSessionOperation(request.session_id, operation, request.input ?? {});
    const payload = { status: 'ok', receipt: result.receipt };
    if (operation === 'snapshot') payload.markdown = result.worker.artifact;
    else if (operation === 'screenshot') payload.base64 = result.worker.artifact.toString('base64');
    else if (operation === 'evidence_capture') {
      payload.result = result.result;
      payload.base64 = result.screenshot?.toString('base64') ?? null;
    } else payload.result = result.worker.result;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify(sessionErrorReceipt(error, operation))}\n`);
  process.exitCode = 1;
}

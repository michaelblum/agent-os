import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentDoc, MINIMAL_DEFAULT } from '../../apps/sigil/renderer/agent-loader.js';

const FM = `---
type: agent
id: test
name: Test
---
`;

function docWith(instance) {
  return `${FM}\n\n\`\`\`json\n${JSON.stringify({
    version: 1,
    appearance: MINIMAL_DEFAULT.appearance,
    minds: MINIMAL_DEFAULT.minds,
    instance,
  }, null, 2)}\n\`\`\`\n`;
}

test('parseAgentDoc: birthplace-only passes through', () => {
  const md = docWith({ birthplace: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  const out = parseAgentDoc(md);
  assert.equal(out.instance.birthplace.nonant, 'top-left');
  assert.equal(out.instance.home, undefined);
});

test('parseAgentDoc: home-only passes through untouched (migration happens in loadAgent, not here)', () => {
  const md = docWith({ home: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  const out = parseAgentDoc(md);
  // parseAgentDoc is pure; it does not rewrite.
  assert.equal(out.instance.home.nonant, 'top-left');
  assert.equal(out.instance.birthplace, undefined);
});

test('parseAgentDoc: malformed json falls back to MINIMAL_DEFAULT', () => {
  const md = `${FM}\n\n\`\`\`json\n{ not valid\n\`\`\`\n`;
  const out = parseAgentDoc(md);
  assert.equal(out.instance.birthplace.nonant, 'bottom-right');
});

// loadAgent migration tests — stub global fetch
import { loadAgent } from '../../apps/sigil/renderer/agent-loader.js';

function stubFetch(responses) {
  // responses: Map<url, { status, text, onPut?: (body) => void }>
  const calls = { get: [], put: [] };
  globalThis.fetch = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const entry = responses.get(url);
    if (!entry) throw new Error(`unstubbed url: ${method} ${url}`);
    if (method === 'GET') {
      calls.get.push(url);
      return { ok: entry.status === 200, status: entry.status, text: async () => entry.text };
    }
    if (method === 'PUT') {
      calls.put.push({ url, body: init.body });
      if (entry.onPut) entry.onPut(init.body);
      return { ok: true, status: 200, text: async () => '' };
    }
    throw new Error(`unsupported method: ${method}`);
  };
  return calls;
}

test('loadAgent: birthplace-only → no PUT', async () => {
  const md = docWith({ birthplace: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  const calls = stubFetch(new Map([['/wiki/sigil/agents/test.md', { status: 200, text: md }]]));
  const out = await loadAgent('sigil/agents/test');
  assert.equal(out.instance.birthplace.nonant, 'top-left');
  assert.equal(calls.put.length, 0, 'no PUT expected');
});

test('loadAgent: home-only → PUT with home rewritten to birthplace', async () => {
  const md = docWith({ home: { anchor: 'nonant', nonant: 'top-left', display: 'main' }, size: 200 });
  let putBody = null;
  const calls = stubFetch(new Map([
    ['/wiki/sigil/agents/test.md', { status: 200, text: md, onPut: (b) => { putBody = b; } }],
  ]));
  const out = await loadAgent('sigil/agents/test');
  assert.equal(calls.put.length, 1, 'expected one PUT');
  assert.ok(putBody.includes('"birthplace"'), 'PUT body contains birthplace');
  assert.ok(!putBody.includes('"home"'), 'PUT body has no home key');
  assert.equal(out.instance.birthplace.nonant, 'top-left', 'returned agent uses birthplace');
  assert.equal(out.instance.home, undefined);
});

test('loadAgent: both present → birthplace wins, no PUT, advisory logged', async () => {
  const md = docWith({
    birthplace: { anchor: 'nonant', nonant: 'top-left', display: 'main' },
    home: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    size: 200,
  });
  const calls = stubFetch(new Map([['/wiki/sigil/agents/test.md', { status: 200, text: md }]]));
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const out = await loadAgent('sigil/agents/test');
    assert.equal(out.instance.birthplace.nonant, 'top-left');
    assert.equal(calls.put.length, 0, 'no PUT on both-present');
    assert.ok(warnings.some(w => /orphaned|both/i.test(w)), 'advisory warn logged');
  } finally {
    console.warn = origWarn;
  }
});

test('loadAgent: fetch fails → MINIMAL_DEFAULT with birthplace', async () => {
  stubFetch(new Map([['/wiki/sigil/agents/test.md', { status: 404, text: '' }]]));
  const out = await loadAgent('sigil/agents/test');
  assert.equal(out.instance.birthplace.nonant, 'bottom-right');
});

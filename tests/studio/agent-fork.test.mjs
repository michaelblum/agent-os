import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkAgent } from '../../apps/sigil/renderer/agent-fork.js';

const SOURCE = `---
type: agent
id: old
name: Old One
tags: [sigil, blue]
---

Some prose about the agent.

\`\`\`json
{
  "version": 1,
  "appearance": { "shape": 6, "opacity": 0.5 },
  "minds": { "skills": ["think"], "tools": [], "workflows": [] },
  "instance": { "home": { "anchor": "nonant", "nonant": "bottom-right", "display": "main" }, "size": 300 }
}
\`\`\`
`;

test('frontmatter id and name are replaced; tags preserved', () => {
  const out = forkAgent(SOURCE, 'new', 'New One');
  assert.match(out, /^---\ntype: agent\nid: new\nname: New One\ntags: \[sigil, blue\]\n---/);
});

test('json block fully preserved', () => {
  const out = forkAgent(SOURCE, 'new', 'New One');
  const m = out.match(/```json\s*\n([\s\S]*?)\n```/);
  assert.ok(m, 'json block present');
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.appearance.shape, 6);
  assert.deepEqual(parsed.minds.skills, ['think']);
});

test('missing source falls back to a valid doc', () => {
  const out = forkAgent('', 'fresh', 'Fresh');
  assert.match(out, /id: fresh/);
  assert.match(out, /name: Fresh/);
  assert.match(out, /```json/);
});

test('rejects invalid ids', () => {
  assert.throws(() => forkAgent(SOURCE, '', 'x'), /id/);
  assert.throws(() => forkAgent(SOURCE, 'bad/id', 'x'), /id/);
  assert.throws(() => forkAgent(SOURCE, '../escape', 'x'), /id/);
});

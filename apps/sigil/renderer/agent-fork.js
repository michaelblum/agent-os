// agent-fork.js — deterministic fork of an agent wiki doc.
// Rewrites frontmatter id/name; preserves tags, prose, and the json body
// (including appearance, minds, instance). Used by the three fork entry
// points (+ new, save-as, clone).

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function forkAgent(sourceMarkdown, newId, newName) {
  if (!ID_RE.test(newId) || newId.includes('..') || newId.includes('/')) {
    throw new Error(`invalid agent id: ${JSON.stringify(newId)}`);
  }
  const src = sourceMarkdown || defaultDoc(newId, newName);
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return defaultDoc(newId, newName);

  const body = src.slice(fmMatch[0].length);
  const originalFm = fmMatch[1];
  const fmLines = originalFm.split('\n');
  let sawId = false, sawName = false;
  const rewritten = fmLines.map(line => {
    if (/^id:\s*/.test(line)) { sawId = true; return `id: ${newId}`; }
    if (/^name:\s*/.test(line)) { sawName = true; return `name: ${newName}`; }
    return line;
  });
  if (!sawId) rewritten.push(`id: ${newId}`);
  if (!sawName) rewritten.push(`name: ${newName}`);
  return `---\n${rewritten.join('\n')}\n---\n${body.startsWith('\n') ? body : '\n' + body}`;
}

function defaultDoc(id, name) {
  const body = {
    version: 1,
    appearance: {},
    minds: { skills: [], tools: [], workflows: [] },
    instance: {
      birthplace: { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
      size: 180,
    },
  };
  return `---
type: agent
id: ${id}
name: ${name}
tags: [sigil]
---

Sigil agent: ${name}.

\`\`\`json
${JSON.stringify(body, null, 2)}
\`\`\`
`;
}

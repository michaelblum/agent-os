import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function assertPathExists(relativePath) {
  await assert.doesNotReject(
    stat(path.join(repoRoot, relativePath)),
    `active authority pointer does not resolve: ${relativePath}`,
  );
}

async function assertMentions(sourcePath, targetPath) {
  const content = await text(sourcePath);
  assert.match(
    content,
    new RegExp(targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${sourcePath} must route to ${targetPath}`,
  );
}

test('active authority map points to existing runtime primitive contract owners', async () => {
  const requiredPointers = [
    ['CONTEXT-MAP.md', 'CONTEXT.md'],
    ['CONTEXT-MAP.md', 'ARCHITECTURE.md'],
    ['CONTEXT-MAP.md', 'AGENTS.md'],
    ['CONTEXT-MAP.md', 'docs/api/README.md'],
    ['CONTEXT-MAP.md', 'docs/api/aos.md'],
    ['CONTEXT-MAP.md', 'shared/schemas/'],
    ['CONTEXT-MAP.md', 'shared/schemas/CONTRACT-GOVERNANCE.md'],
    ['CONTEXT-MAP.md', 'manifests/commands/aos-commands.json'],
    ['CONTEXT-MAP.md', 'manifests/commands/aos-external-commands.json'],
    ['CONTEXT-MAP.md', 'skills/aos-agent-workspace/SKILL.md'],
    ['CONTEXT-MAP.md', 'docs/design/'],
    ['README.md', 'docs/api/aos.md'],
    ['README.md', 'ARCHITECTURE.md'],
    ['README.md', 'AGENTS.md'],
    ['docs/api/README.md', 'ARCHITECTURE.md'],
    ['docs/api/README.md', 'docs/design/'],
    ['skills/aos-agent-workspace/SKILL.md', 'docs/api/aos.md'],
    ['skills/aos-agent-workspace/SKILL.md', 'shared/schemas/aos-agent-workspace-v0.md'],
    ['skills/aos-agent-workspace/SKILL.md', 'tests/agent-workspace-saved-ref.sh'],
  ];

  const targetPaths = [...new Set(requiredPointers.map(([, target]) => target))];

  await Promise.all(targetPaths.map(assertPathExists));
  await Promise.all(requiredPointers.map(([source, target]) => assertMentions(source, target)));
});

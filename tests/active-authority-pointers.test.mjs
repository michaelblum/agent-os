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
    ['CONTEXT-MAP.md', 'docs/api/aos-capabilities.md'],
    ['CONTEXT-MAP.md', 'shared/schemas/'],
    ['CONTEXT-MAP.md', 'shared/schemas/CONTRACT-GOVERNANCE.md'],
    ['CONTEXT-MAP.md', 'manifests/commands/source/'],
    ['CONTEXT-MAP.md', 'manifests/commands/aos-commands.json'],
    ['CONTEXT-MAP.md', 'manifests/commands/aos-external-commands.json'],
    ['CONTEXT-MAP.md', 'scripts/generate-command-manifests.mjs'],
    ['CONTEXT-MAP.md', 'tests/command-manifest-generation.sh'],
    ['CONTEXT-MAP.md', 'skills/registry.json'],
    ['CONTEXT-MAP.md', 'skills/aos-desktop/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/aos-saved-workspace/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/aos-canvas-vision/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/aos-focus-sessions/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/aos-browser/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/aos-verification/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/aos-agent-workspace/SKILL.md'],
    ['CONTEXT-MAP.md', 'skills/browser-adapter/SKILL.md'],
    ['CONTEXT-MAP.md', 'docs/design/'],
    ['README.md', 'docs/api/aos.md'],
    ['README.md', 'ARCHITECTURE.md'],
    ['README.md', 'AGENTS.md'],
    ['docs/api/README.md', 'ARCHITECTURE.md'],
    ['docs/api/README.md', 'docs/api/aos-capabilities.md'],
    ['docs/api/README.md', 'docs/design/'],
    ['docs/api/README.md', 'manifests/commands/source/'],
    ['docs/api/README.md', 'scripts/generate-command-manifests.mjs'],
    ['docs/api/README.md', 'tests/command-manifest-generation.sh'],
    ['docs/api/README.md', 'tests/help-contract.sh'],
    ['skills/aos-agent-workspace/SKILL.md', 'docs/api/aos.md'],
    ['skills/aos-agent-workspace/SKILL.md', 'shared/schemas/aos-agent-workspace-v0.md'],
    ['skills/aos-agent-workspace/SKILL.md', 'tests/agent-workspace-saved-ref.sh'],
  ];

  const targetPaths = [...new Set(requiredPointers.map(([, target]) => target))];

  await Promise.all(targetPaths.map(assertPathExists));
  await Promise.all(requiredPointers.map(([source, target]) => assertMentions(source, target)));
});

test('root AGENTS keeps orchestration doctrine invisible to repo-root sessions', async () => {
  const rootAgents = await text('AGENTS.md');
  assert.doesNotMatch(rootAgents, /\.docks/);
  assert.doesNotMatch(rootAgents, /\bdock/i);
  assert.doesNotMatch(rootAgents, /\bForeman\b/);
  assert.doesNotMatch(rootAgents, /docs\/guides\//);
  assert.doesNotMatch(rootAgents, /docs\/dev\//);
  assert.doesNotMatch(rootAgents, /^## Repo Model$/m);
  assert.doesNotMatch(rootAgents, /^## Architecture Compass$/m);
  assert.doesNotMatch(rootAgents, /^## AOS And Development$/m);
  assert.match(rootAgents, /^## DOX Framework$/m);
  assert.match(rootAgents, /^## Child DOX Index$/m);
});

test('codex subtree contract does not route repo-root sessions into orchestration doctrine', async () => {
  const codexAgents = await text('.codex/AGENTS.md');
  assert.doesNotMatch(codexAgents, /\.docks/);
  assert.doesNotMatch(codexAgents, /\bdock/i);
  assert.doesNotMatch(codexAgents, /\bForeman\b/);
  assert.doesNotMatch(codexAgents, /Orchestrator Defaults/);
  assert.doesNotMatch(codexAgents, /active-profile/);
  assert.match(codexAgents, /Keep this file scoped to `\.codex\/` configuration/);
});

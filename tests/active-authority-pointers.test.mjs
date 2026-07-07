import assert from 'node:assert/strict';
import { readdir, stat, readFile } from 'node:fs/promises';
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

async function directChildAgentsPaths() {
  const ignored = new Set([
    '.aos-browser-tmp',
    '.aos-test-tmp',
    '.build',
    '.fallow',
    '.git',
    '.playwright-cli',
    '.runtime',
    'node_modules',
  ]);
  const entries = await readdir(repoRoot, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const relativePath = `${entry.name}/AGENTS.md`;
    try {
      await stat(path.join(repoRoot, relativePath));
      paths.push(relativePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return paths.sort();
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

test('root Child DOX Index covers every live top-level child AGENTS file', async () => {
  const rootAgents = await text('AGENTS.md');
  const childAgentsPaths = await directChildAgentsPaths();
  const missing = childAgentsPaths.filter((childPath) => !rootAgents.includes(childPath));
  assert.deepEqual(missing, [], 'root Child DOX Index must mention every live top-level child AGENTS.md');
});

test('root AGENTS stays a DOX rail instead of an orchestration contract', async () => {
  const rootAgents = await text('AGENTS.md');
  assert.doesNotMatch(rootAgents, /\bForeman\b/);
  assert.doesNotMatch(rootAgents, /active-profile/);
  assert.doesNotMatch(rootAgents, /\.docks\/foreman/);
  assert.doesNotMatch(rootAgents, /docs\/guides\//);
  assert.doesNotMatch(rootAgents, /docs\/dev\//);
  assert.doesNotMatch(rootAgents, /^## Repo Model$/m);
  assert.doesNotMatch(rootAgents, /^## Architecture Compass$/m);
  assert.doesNotMatch(rootAgents, /^## AOS And Development$/m);
  assert.match(rootAgents, /project-agent orchestration is retired from AOS core/);
  assert.match(rootAgents, /^## DOX Framework$/m);
  assert.match(rootAgents, /^## Child DOX Index$/m);
});

test('root Child DOX Index has no stale removed child docs', async () => {
  const rootAgents = await text('AGENTS.md');
  assert.doesNotMatch(rootAgents, /ai-agents\/AGENTS\.md/);
});

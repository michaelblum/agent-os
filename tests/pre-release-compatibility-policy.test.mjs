import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);
const declarationPath = path.join(repoRoot, 'docs/dev/product-maturity.json');
const markerPrefix = 'AOS_COMPATIBILITY_RESIDUE:';
const activeExactPaths = new Set([
  'AGENTS.md',
  'ARCHITECTURE.md',
  'CONTEXT.md',
  'CONTEXT-MAP.md',
  'CLAUDE.md',
  'GEMINI.md',
  'README.md',
]);
const activePrefixes = [
  '.agents/',
  '.claude/',
  '.codex/',
  'apps/',
  'docs/',
  'experiences/',
  'manifests/commands/source/',
  'packages/',
  'recipes/',
  'scripts/',
  'shared/',
  'skills/',
  'src/',
  'wiki-seed/',
];
const historicalPrefixes = [
  'docs/adr/',
  'docs/archive/',
  'docs/dev/reports/',
];
const textExtensions = new Set([
  '.c', '.cc', '.css', '.h', '.html', '.js', '.json', '.jsonc', '.md', '.mjs',
  '.py', '.sh', '.swift', '.toml', '.ts', '.tsx', '.yaml', '.yml',
]);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function activeSurface(relativePath) {
  return !historicalPrefixes.some((prefix) => relativePath.startsWith(prefix))
    && (activeExactPaths.has(relativePath)
      || activePrefixes.some((prefix) => relativePath.startsWith(prefix)));
}

function readableSource(relativePath) {
  return activeSurface(relativePath) && textExtensions.has(path.extname(relativePath));
}

async function trackedActiveSources() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(readableSource)
    .filter((relativePath) => existsSync(path.join(repoRoot, relativePath)))
    .sort();
}

function activeInstructionSurface(relativePath) {
  if (relativePath.startsWith('tests/fixtures/')) return false;
  if (historicalPrefixes.some((prefix) => relativePath.startsWith(prefix))) return false;
  const basename = path.posix.basename(relativePath);
  return ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(basename)
    || ['.agents/', '.claude/', '.codex/'].some((prefix) => relativePath.startsWith(prefix));
}

async function trackedActiveInstructionSurfaces() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(activeInstructionSurface)
    .filter((relativePath) => textExtensions.has(path.extname(relativePath)))
    .filter((relativePath) => existsSync(path.join(repoRoot, relativePath)))
    .sort();
}

test('machine declaration fixes the zero-installed-base migration policy', async () => {
  const declaration = await json('docs/dev/product-maturity.json');
  assert.equal(declaration.schema_version, 'aos.product-maturity.v0');
  assert.equal(declaration.product, 'agent-os');
  assert.equal(declaration.maturity, 'pre_release');
  assert.deepEqual(declaration.distribution, {
    ever_distributed: false,
    external_installed_base: false,
    external_compatibility_obligations: false,
  });
  assert.deepEqual(declaration.migration_policy, {
    internal_consumers: 'atomic',
    superseded_implementation: 'delete_same_change',
  });
  assert.deepEqual(declaration.compatibility_policy.allowed_evidence, [
    'external_consumer',
    'persisted_data_dependency',
  ]);
  assert.equal(declaration.compatibility_policy.residue_marker, markerPrefix);

  const rootContract = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  assert.match(rootContract, /pre-release with no installed base or external backward-compatibility/);
  assert.match(rootContract, /Migrate real current consumers atomically and delete superseded/);
  assert.match(rootContract, /language as a tripwire—not as a default requirement/);
  assert.match(rootContract, /show why atomic cutover or a bounded reset is unsafe/);
  assert.match(rootContract, /Deletion of superseded tracked material and cleanup of session-created test/);
  assert.match(rootContract, /retained exception needs a named\s+owner, measured size, and finite or event-based deletion trigger/);
  assert.match(rootContract, /Do not use the\s+production implementation as an exploratory scratchpad/);
  assert.match(rootContract, /do not require a\s+spike when a focused regression already makes the repair falsifiable/);
});

test('repository orchestration partitions delegated evidence ownership', async () => {
  const rootContract = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const normalizedRootContract = rootContract.replace(/\s+/g, ' ');

  for (const marker of [
    'assign each fact lane one primary evidence owner',
    'Delegate or re-derive—do not do both',
    'at most three targeted decision-critical spot checks',
    "must not repeat that lane's broad searches, source walk, or proof suite",
    'A seam-focused integration reviewer may test relationships on one stable snapshot',
    'Duplicate verification needs a named high-risk reason',
    'Contradictions get one focused adjudication, not a new audit tree',
  ]) {
    assert.ok(normalizedRootContract.includes(marker), `root orchestration guidance must retain: ${marker}`);
  }
});

test('compatibility exceptions own exact active paths, evidence, removal, and focused tests', async () => {
  const declaration = await json('docs/dev/product-maturity.json');
  const exceptions = declaration.compatibility_exceptions;
  const byId = new Map(exceptions.map((entry) => [entry.id, entry]));
  assert.equal(byId.size, exceptions.length, 'compatibility exception ids must be unique');

  for (const entry of exceptions) {
    assert.ok(['external_consumer', 'persisted_data_dependency'].includes(entry.evidence.kind));
    assert.ok(entry.owner.trim());
    assert.ok(entry.justification.trim());
    assert.ok(entry.removal.condition?.trim() || entry.removal.milestone?.trim());

    if (!/^https?:\/\//.test(entry.evidence.reference)) {
      assert.equal(
        existsSync(path.join(repoRoot, entry.evidence.reference)),
        true,
        `${entry.id} evidence reference must exist`,
      );
    }

    for (const relativePath of entry.active_paths) {
      assert.equal(activeSurface(relativePath), true, `${entry.id} path is not an active product/source surface`);
      assert.doesNotMatch(relativePath, /^(?:docs\/archive|docs\/dev\/reports|tests\/fixtures)\//);
      const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
      assert.match(content, new RegExp(`${markerPrefix}${entry.id}(?![a-z0-9-])`));
    }

    for (const relativePath of entry.regression_tests) {
      assert.match(relativePath, /^tests\//);
      assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${entry.id} regression test must exist`);
    }
  }

  const markers = [];
  for (const relativePath of await trackedActiveSources()) {
    const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const match of content.matchAll(/AOS_COMPATIBILITY_RESIDUE:([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      markers.push({ id: match[1], path: relativePath });
    }
  }

  for (const marker of markers) {
    const entry = byId.get(marker.id);
    assert.ok(entry, `${marker.path} has unregistered compatibility residue ${marker.id}`);
    assert.ok(entry.active_paths.includes(marker.path), `${marker.path} is not owned by ${marker.id}`);
  }
});

test('retired skills cannot remain discoverable product metadata or redirects', async () => {
  const removedSkills = ['agent-sync', 'aos-agent-workspace', 'browser-adapter'];
  const registry = await json('skills/registry.json');
  const registryNames = new Set(registry.skills.map((skill) => skill.name));

  for (const name of removedSkills) {
    assert.equal(registryNames.has(name), false, `${name} must not remain registered`);
    assert.equal(existsSync(path.join(repoRoot, 'skills', name)), false, `${name} package must be absent`);
  }
  assert.equal(existsSync(path.join(repoRoot, 'scripts/agent-sync.sh')), false);
  assert.equal(registry.skills.some((skill) => skill.status === 'retired'), false);
  assert.equal(registry.skills.some((skill) => skill.invocation === 'retired'), false);

  const workflowScript = await readFile(path.join(repoRoot, 'scripts/aos-dev-workflow.mjs'), 'utf8');
  const capabilityManifest = await readFile(path.join(repoRoot, 'docs/dev/agent-capabilities.json'), 'utf8');
  assert.doesNotMatch(workflowScript, /RETIRED_SUBAGENT_COMMAND|subcommand === 'subagent'/);
  assert.doesNotMatch(workflowScript, /'--role': 'role legacy compatibility filter'/);
  assert.doesNotMatch(capabilityManifest, /role_filter_compatibility/);

  for (const relativePath of ['skills/AGENTS.md', 'CONTEXT-MAP.md', 'docs/api/aos.md']) {
    const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const name of removedSkills) {
      assert.doesNotMatch(content, new RegExp(`skills/${name.replaceAll('-', '\\-')}(?:/|\\b)`));
    }
  }
});

test('zero-exception ledger has no retained compatibility behavior in active sources', async () => {
  const declaration = await json('docs/dev/product-maturity.json');
  assert.deepEqual(declaration.compatibility_exceptions, []);

  const ledger = await readFile(path.join(repoRoot, 'docs/dev/residue-drift-ledger.md'), 'utf8');
  for (const surface of [
    'Retired gate continuation session field',
    'Non-envelope daemon subscription request',
    'Flat daemon input-tap health shape',
    'Retired annotation entry-source alias',
  ]) {
    assert.match(ledger, new RegExp(`\\| ${surface} \\| deleted \\|`));
  }

  const forbiddenExactTokens = [
    'input_tap_status',
    'input_tap_attempts',
    'sigil_radial',
    'session.dock',
  ];
  for (const relativePath of await trackedActiveSources()) {
    const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const token of forbiddenExactTokens) {
      assert.equal(content.includes(token), false, `${relativePath} retains retired token ${token}`);
    }
    assert.doesNotMatch(
      content,
      /["']action["']\s*:\s*["']subscribe["']/,
      `${relativePath} retains a non-envelope subscribe request`,
    );
  }
});

test('active agent-instruction surfaces contain no retired agent-sync invocation', async () => {
  const surfaces = await trackedActiveInstructionSurfaces();
  for (const required of ['.codex/AGENTS.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    assert.ok(surfaces.includes(required), `missing active instruction surface ${required}`);
  }
  assert.ok(surfaces.some((relativePath) => relativePath.startsWith('.agents/')));
  assert.ok(surfaces.some((relativePath) => relativePath.startsWith('.claude/')));

  for (const relativePath of surfaces) {
    const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(content, /\$agent-sync\b/, `${relativePath} retains retired agent-sync guidance`);
  }
});

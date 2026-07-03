import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const burnDownPath = 'docs/dev/reports/aos-code-review-2026-07-03-burn-down.md';
const perceptionPlanPath = 'docs/design/work-cards/perception-engine-shared-state-race-plan-v0.md';

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function assertPath(relativePath) {
  await assert.doesNotReject(
    stat(path.join(repoRoot, relativePath)),
    `expected evidence path to exist: ${relativePath}`,
  );
}

test('July 3 code review burn-down keeps critical and high findings dispositioned', async () => {
  const report = await text(burnDownPath);
  const requiredRows = [
    {
      id: '1. Host tool-result message shape',
      paths: [
        'packages/host/src/provider/anthropic.ts',
        'packages/host/src/session-store.ts',
        'packages/host/src/agent-loop.ts',
        'packages/host/test/provider/anthropic.test.ts',
      ],
    },
    {
      id: '2. `aos wiki` path traversal',
      paths: [
        'scripts/aos-wiki-mutate.mjs',
        'scripts/aos-wiki-read.mjs',
        'tests/wiki-read-external.sh',
        'tests/wiki-mutate-external.sh',
        'tests/wiki-seed.sh',
      ],
    },
    {
      id: '3. Sigil selection-mode ReferenceError',
      paths: [
        'apps/sigil/renderer/live-modules/interaction-overlay.js',
        'tests/code-review-burn-down-status.test.mjs',
      ],
    },
    {
      id: '4. Sigil glTF fallback ReferenceError',
      paths: [
        'apps/sigil/renderer/live-modules/radial-gesture-visuals.js',
        'tests/renderer/radial-gesture-visuals.test.mjs',
      ],
    },
    {
      id: '5. Canvas removal lifecycle leak',
      paths: ['src/display/canvas.swift', 'tests/canvas-close-callback-contract.test.mjs'],
    },
    {
      id: '6. Malformed click count kills `aos do` session',
      paths: ['src/act/actions.swift', 'src/act/act-cli.swift', 'tests/click-count-contract.test.mjs'],
    },
    {
      id: '7. Dead-session keystroke crashes terminal bridge',
      paths: [
        'packages/toolkit/components/agent-terminal/terminal-session-manager.mjs',
        'tests/sigil-agent-terminal-server.test.mjs',
      ],
    },
    {
      id: '8. Surface Inspector pin self-loop hang',
      paths: [
        'packages/toolkit/workbench/surface-inspector-annotations.js',
        'tests/toolkit/surface-inspector-annotations.test.mjs',
      ],
    },
    {
      id: '9. Decision Gate Tab handling crash',
      paths: ['packages/toolkit/components/decision-gate/index.js', 'tests/toolkit/decision-gate.test.mjs'],
    },
    {
      id: '10. HTML Workbench Expression sanitizer gap',
      paths: [
        'packages/toolkit/components/html-workbench-expression/index.js',
        'tests/toolkit/html-workbench-expression.test.mjs',
      ],
    },
  ];

  for (const row of requiredRows) {
    assert.match(report, new RegExp(`\\| ${row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| fixed \\|`));
    for (const evidencePath of row.paths) {
      assert.match(report, new RegExp(evidencePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await assertPath(evidencePath);
    }
  }

  const interactionOverlay = await text('apps/sigil/renderer/live-modules/interaction-overlay.js');
  assert.match(
    interactionOverlay,
    /const time = Number\(snapshot\.time\) \|\| 0;[\s\S]*drawFrame\([^;]+,\s*\{ time \}\);/,
    'selection-mode frame drawing must bind time before passing it to drawFrame',
  );
});

test('PerceptionEngine shared-state race remains plan-gated, not silently closed', async () => {
  const report = await text(burnDownPath);
  const plan = await text(perceptionPlanPath);

  assert.match(report, /Deferred By Plan Gate/);
  assert.match(report, /PerceptionEngine.*shared-state race/);
  assert.match(report, new RegExp(perceptionPlanPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(plan, /Status: plan only\. Do not implement this slice without explicit approval\./);
  assert.match(plan, /files, invariants, proof strategy, rollback risk, and stop conditions|Invariants[\s\S]*Proof Strategy[\s\S]*Rollback Boundary[\s\S]*Stop Conditions/);
});

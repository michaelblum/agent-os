import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, repoUrl), 'utf8');
}

function escaped(pattern) {
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('surface interaction decision tree recipe exposes stable choices and audit anchors', async () => {
  const recipe = await text('docs/guides/aos-surface-interaction-decision-tree.md');

  for (const heading of [
    '# AOS Surface Interaction Decision Tree',
    '## Decision Tree',
    '## First Conformance Audit',
    '## What Changed Since StageAffordance And ResourceScope',
  ]) {
    assert.match(recipe, escaped(heading));
  }

  for (const phrase of [
    'DOM interaction inside an already interactive canvas',
    'Toolkit panel/windowing behavior',
    'Passive DesktopWorld visual with small hit areas',
    'Visual-only global decoration or diagnostic layer',
    'Full interactive surface',
    'Private app renderer or 3D stage',
    'Daemon primitive',
    'createStageAffordance',
    'createResourceScope',
    'daemon input regions',
  ]) {
    assert.match(recipe, escaped(phrase));
  }

  for (const auditedSurface of [
    'Default minimized chips',
    'Explicit WebView minimized-chip fallback',
    'Panel chrome minimize, maximize, restore, close, drag, resize',
    'Drag transfer visuals',
    'DesktopWorld stage layers',
    'Surface Inspector/action controls',
    'Daemon input regions and canvas lifecycle events',
    'Daemon Sigil-specific input paths',
    'Sigil `avatar-main` and product visuals',
    'Sigil radial/menu/extension affordances',
  ]) {
    assert.match(recipe, escaped(auditedSurface));
  }

  for (const status of ['Acceptable', 'Transitional', 'Needs follow-up']) {
    assert.match(recipe, new RegExp(`\\b${status}\\b`));
  }
});

test('surface interaction decision tree is discoverable from toolkit and Sigil guardrails', async () => {
  const requiredPath = 'docs/guides/aos-surface-interaction-decision-tree.md';
  const docs = await Promise.all([
    text('docs/api/toolkit.md'),
    text('docs/api/toolkit/runtime.md'),
    text('docs/api/toolkit/panel-window.md'),
    text('docs/design/aos-surface-system.md'),
    text('docs/design/aos-canon-surface-boundary-alignment-plan.md'),
    text('packages/toolkit/AGENTS.md'),
    text('packages/toolkit/runtime/AGENTS.md'),
    text('packages/toolkit/panel/AGENTS.md'),
    text('apps/sigil/AGENTS.md'),
  ]);

  for (const doc of docs) {
    assert.match(doc, escaped(requiredPath));
  }
});

test('surface stack integration ledger records accepted V0 closure evidence', async () => {
  const ledger = await text('docs/design/aos-surface-stack-v0-integration-ledger.md');
  const recipe = await text('docs/guides/aos-surface-interaction-decision-tree.md');
  const alignment = await text('docs/design/aos-canon-surface-boundary-alignment-plan.md');

  assert.match(ledger, escaped('# AOS Surface Stack V0 Integration Ledger'));
  assert.match(ledger, escaped('accepted #304 real-pointer stage-chip proof'));
  for (const readinessField of ['ready=true', 'mode=repo', 'daemon=reachable', 'tap=active']) {
    assert.match(ledger, escaped(readinessField));
  }
  assert.match(ledger, escaped('stageEnsureStatus.status: "already_exists"'));
  assert.match(ledger, escaped('no `aos-chip-*`'));

  for (const issue of ['#304', '#303', '#122', '#120', '#123', '#261', '#305', '#118', '#119', '#45']) {
    assert.match(ledger, escaped(issue));
  }
  assert.match(ledger, escaped('#118 And #119 Closure Audit'));
  assert.match(ledger, /#118[^\n]*Closed as accepted V0/);
  assert.match(ledger, /#119[^\n]*Closed as folded V0/);
  assert.match(ledger, escaped('createDesktopWorldInteractionRouter'));
  assert.match(ledger, escaped('createDesktopWorldHitRegionController'));
  assert.match(ledger, /Future Sigil-as-second-client platform adoption should\s+stay in #305/);
  assert.match(alignment, /#118:[\s\S]*?Closed\s+as\s+accepted\s+V0/);
  assert.match(alignment, /#119:[\s\S]*?Closed\s+as\s+folded\s+V0/);

  assert.doesNotMatch(recipe, /#304[^\n]*pending live smoke/i);
  assert.doesNotMatch(recipe, /Live pointer smoke after repo-mode TCC reset/i);
});

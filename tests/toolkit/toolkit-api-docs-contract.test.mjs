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

function lineCount(doc) {
  return doc.trimEnd().split('\n').length;
}

const scopedFiles = [
  'docs/api/toolkit/runtime.md',
  'docs/api/toolkit/scene.md',
  'docs/api/toolkit/controls.md',
  'docs/api/toolkit/panel-window.md',
  'docs/api/toolkit/workbench.md',
  'docs/api/toolkit/components.md',
  'docs/api/toolkit/content-host.md',
];

test('toolkit API index is an overview with links to scoped references', async () => {
  const index = await text('docs/api/toolkit.md');

  assert.match(index, /^# Toolkit API/m);
  assert.match(index, /## API Map/);
  assert.match(index, /## One-Click Contract Index/);
  assert.ok(lineCount(index) < 400, `toolkit API index should stay below 400 lines, got ${lineCount(index)}`);

  for (const file of scopedFiles) {
    assert.match(index, escaped(file.replace('docs/api/', './')));
  }

  for (const phrase of [
    'createResourceScope',
    'createStageAffordance',
    'createPanelWindowController',
    'mountChrome',
    'controls API',
    'DesktopWorld stage/surface runtime',
    'external Three scene authoring',
    'input regions/events',
    'workbench contracts',
    'Surface Inspector and Surface-Zoom Inspector',
    'content/host contract',
    'styling boundary',
  ]) {
    assert.match(index, escaped(phrase));
  }
});

test('toolkit scoped API files exist and own expected stable terms', async () => {
  const docs = Object.fromEntries(await Promise.all(scopedFiles.map(async (file) => [file, await text(file)])));

  assert.match(docs['docs/api/toolkit/runtime.md'], /createResourceScope/);
  assert.match(docs['docs/api/toolkit/runtime.md'], /DesktopWorldSurfaceAdapter/);
  assert.match(docs['docs/api/toolkit/runtime.md'], /registerInputRegion/);
  assert.match(docs['docs/api/toolkit/runtime.md'], /input_region\.event/);
  assert.match(docs['docs/api/toolkit/runtime.md'], /subscribe\(events, options\?\)/);

  assert.match(docs['docs/api/toolkit/scene.md'], /@agent-os\/toolkit\/scene/);
  assert.match(docs['docs/api/toolkit/scene.md'], /createThreeRenderLifecycle/);
  assert.match(docs['docs/api/toolkit/scene.md'], /evaluateDesktopWorldPerformanceAcceptance/);
  assert.match(docs['docs/api/toolkit/scene.md'], /DesktopWorldSurfaceThree/);
  assert.match(docs['docs/api/toolkit/scene.md'], /createVisualObjectDescriptor/);
  assert.match(docs['docs/api/toolkit/scene.md'], /bindVisualObjectForm/);
  assert.match(docs['docs/api/toolkit/scene.md'], /aos\.scene\.document\.v1/);
  assert.match(docs['docs/api/toolkit/scene.md'], /createLocalSceneViewportHost/);
  assert.match(docs['docs/api/toolkit/scene.md'], /createDesktopWorldSceneHost/);
  assert.match(docs['docs/api/toolkit/scene.md'], /aos\.scene\.signal\.bind/);
  assert.match(docs['docs/api/toolkit/scene.md'], /aos\.scene\.animation\.bind/);
  assert.match(docs['docs/api/toolkit/scene.md'], /allocates no event object per binding per tick/);
  assert.match(docs['docs/api/toolkit/scene.md'], /aos\.scene\.inspection\.v1/);
  assert.match(docs['docs/api/toolkit/scene.md'], /validateSceneTransaction/);
  assert.match(docs['docs/api/toolkit/scene.md'], /global DesktopWorld coordinate plane/);
  assert.match(docs['docs/api/toolkit/scene.md'], /authoritative public result after the all-segment barrier settles/);
  assert.match(docs['docs/api/toolkit/scene.md'], /grants no AOS command execution/);
  assert.match(docs['docs/api/toolkit/scene.md'], /SceneAffordanceDescriptor/);
  assert.match(docs['docs/api/toolkit/scene.md'], /createSceneInteractionController/);
  assert.match(docs['docs/api/toolkit/scene.md'], /start, end, and cancel\s+are never dropped/);
  assert.match(docs['docs/api/toolkit/scene.md'], /never carry product text, audio, prompts/);

  assert.match(docs['docs/api/toolkit/controls.md'], /createButton/);
  assert.match(docs['docs/api/toolkit/controls.md'], /createButtonGroup/);
  assert.match(docs['docs/api/toolkit/controls.md'], /createTextField/);
  assert.match(docs['docs/api/toolkit/controls.md'], /createTextarea/);
  assert.match(docs['docs/api/toolkit/controls.md'], /createTimerBar/);
  assert.match(docs['docs/api/toolkit/controls.md'], /wireNumberFieldControls/);

  assert.match(docs['docs/api/toolkit/panel-window.md'], /createStageAffordance/);
  assert.match(docs['docs/api/toolkit/panel-window.md'], /mountChrome/);
  assert.match(docs['docs/api/toolkit/panel-window.md'], /createForm/);
  assert.match(docs['docs/api/toolkit/panel-window.md'], /createPanelWindowController/);
  assert.match(docs['docs/api/toolkit/panel-window.md'], /createSplitPane/);
  assert.match(docs['docs/api/toolkit/panel-window.md'], /Tabs\(factoriesOrContents, options\?\)/);

  assert.match(docs['docs/api/toolkit/workbench.md'], /aos\.workbench\.subject/);
  assert.match(docs['docs/api/toolkit/workbench.md'], /HTML Workbench Expression V0/);
  assert.match(docs['docs/api/toolkit/workbench.md'], /Workbench Human Checkpoint V0/);
  assert.match(docs['docs/api/toolkit/workbench.md'], /Artifact Bundle Subject V0/);
  assert.match(docs['docs/api/toolkit/workbench.md'], /Step Descriptor Workbench V0/);
  assert.match(docs['docs/api/toolkit/workbench.md'], /Wiki Subject Browser V0/);

  assert.match(docs['docs/api/toolkit/components.md'], /Surface Inspector/);
  assert.match(docs['docs/api/toolkit/components.md'], /Surface-Zoom Inspector Proof/);
  assert.match(docs['docs/api/toolkit/components.md'], /Spatial Telemetry/);
  assert.match(docs['docs/api/toolkit/components.md'], /Render Performance/);
  assert.match(docs['docs/api/toolkit/components.md'], /Object Transform Panel/);
  assert.match(docs['docs/api/toolkit/components.md'], /Supervised Run Test Console/);
  assert.match(docs['docs/api/toolkit/components.md'], /Integration Hub/);

  assert.match(docs['docs/api/toolkit/content-host.md'], /Import \/ Hosting Model/);
  assert.match(docs['docs/api/toolkit/content-host.md'], /Content Contract/);
  assert.match(docs['docs/api/toolkit/content-host.md'], /ContentHost/);
  assert.match(docs['docs/api/toolkit/content-host.md'], /Styling Boundary/);
  assert.match(docs['docs/api/toolkit/content-host.md'], /Minimal Standalone Template/);
});

test('surface interaction decision tree remains discoverable from toolkit API docs', async () => {
  const requiredPath = 'docs/guides/aos-surface-interaction-decision-tree.md';
  const docs = await Promise.all([
    text('docs/api/toolkit.md'),
    text('docs/api/toolkit/runtime.md'),
    text('docs/api/toolkit/panel-window.md'),
  ]);

  for (const doc of docs) {
    assert.match(doc, escaped(requiredPath));
    assert.doesNotMatch(doc, /\.\.\/(?:\.\.\/)?recipes\/aos-surface-interaction-decision-tree\.md/);
  }
});

test('toolkit runtime docs keep canvas host targets separate from saved refs', async () => {
  const runtime = await text('docs/api/toolkit/runtime.md');
  const section = runtime.split('## Canvas Host Target Semantics', 2)[1].split('## ', 1)[0];

  assert.match(section, /`aos show --id <canvas-id>` owns canvas resource lifecycle/);
  assert.match(section, /`aos see capture\s+--canvas <canvas-id>` scopes perception to the current canvas host/);
  assert.match(section, /`canvas:<canvas-id>\/<ref>` is the direct current Target-with-Ref/);
  assert.match(section, /Saved workspace refs remain the model-facing durable\s+handle/);
  assert.match(section, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(section, /canvas id as a resource id, not as durable object\s+identity/);
  assert.match(section, /`provenance\.do_target` provide[s]? the action vocabulary/);
  assert.match(section, /DesktopWorld surfaces,\s+segmented canvases, passthrough visuals, child hit WebViews, and interactive\s+affordances/);
  assert.match(section, /daemon primitives own lifecycle,\s+geometry, input routing, and current canvas host state/);
  assert.match(section, /toolkit policy owns\s+panel\/window behavior, stage affordances, semantic target descriptors/);
});

test('generated artifact lifecycle policy is discoverable from workbench docs', async () => {
  const policyPath = 'docs/design/generated-artifact-lifecycle-policy.md';
  const [workbench, audit, recipe, policy] = await Promise.all([
    text('docs/api/toolkit/workbench.md'),
    text('docs/design/html-workbench-expression-adoption-audit-2026-05-13.md'),
    text('docs/guides/layered-subject-expressions.md'),
    text(policyPath),
  ]);

  assert.match(workbench, escaped(policyPath));
  assert.match(audit, escaped(policyPath));
  assert.match(recipe, escaped(policyPath));
  for (const phrase of [
    'HTML Workbench Expressions',
    'Runtime wiki repo-doc projections',
    'User-signal gate records',
    'Producer Requirements',
    'source hash/provenance',
    'Surviving structured result',
  ]) {
    assert.match(policy, escaped(phrase));
  }
});

test('canvas_object.marks documents fixed minimap and DesktopWorld-projected sizes', async () => {
  const doc = await text('docs/api/toolkit/components.md');
  const compact = doc.replace(/\s+/g, ' ');

  for (const phrase of [
    'x` and `y` are DesktopWorld coordinates',
    'not local canvas coordinates',
    'minimap-local logical pixels for stable fixed-size markers',
    '`"minimap"` (default) keeps `w`/`h` fixed in mini-map pixels',
    '`"desktop_world"` treats `w`/`h` as DesktopWorld dimensions',
    'projects them by the current mini-map scale',
    'Accepted wire aliases are `minimapSizeMode`, `minimap_size_mode`, `sizeMode`,',
    'and `size_mode`; new producers should prefer `minimapSizeMode`',
    'Use this for points, cursors, debug pings, object centers',
    'Use this for hit boxes, radial target extents, child surface bounds',
  ]) {
    assert.match(compact, escaped(phrase));
  }
});

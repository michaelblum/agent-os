import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function existingFiles(relativeRoots) {
  const files = [];
  async function walk(relativePath) {
    const absolutePath = path.join(repoRoot, relativePath);
    const info = await stat(absolutePath);
    if (info.isFile()) {
      files.push(relativePath);
      return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
      if (entry.name === 'archive' || entry.name === 'fixtures') continue;
      await walk(path.join(relativePath, entry.name));
    }
  }
  for (const root of relativeRoots) {
    if (fs.existsSync(path.join(repoRoot, root))) await walk(root);
  }
  return files.sort();
}

test('Markdown guidance lives under docs/guides, not docs/recipes', async () => {
  const recipesPath = path.join(repoRoot, 'docs/recipes');
  if (!fs.existsSync(recipesPath)) {
    assert.ok(true);
    return;
  }

  const entries = await readdir(recipesPath);
  assert.deepEqual(entries, ['README.md'], 'docs/recipes may only contain a temporary tombstone');
  const tombstone = await text('docs/recipes/README.md');
  assert.match(tombstone, /temporary compatibility/i);
  assert.match(tombstone, /removal gate/i);
});

test('current guide headings do not advertise Markdown guides as recipes', async () => {
  const guideFiles = (await existingFiles(['docs/guides']))
    .filter((file) => file.endsWith('.md'));
  const badHeadings = [];

  for (const file of guideFiles) {
    const firstLine = (await text(file)).split(/\r?\n/, 1)[0];
    if (/^# Recipe:/.test(firstLine)) badHeadings.push(file);
  }

  assert.deepEqual(badHeadings, []);
});

test('current execution model surfaces keep Recipe executable-only', async () => {
  const guides = await text('docs/guides/README.md');
  const context = await text('CONTEXT.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(guides, /not\s+executable Recipes/);
  assert.match(context, /Markdown procedures under\n`docs\/guides\/` are Guides\/SOPs, not executable Recipes/);
  assert.match(adr, /Markdown Guides\/SOPs\nlive under `docs\/guides\/`/);
  assert.doesNotMatch(`${guides}\n${context}\n${adr}`, /documentation-only Recipe|Markdown Recipe/);
});

test('aos ops is retired, not compatibility vocabulary', async () => {
  const aosApi = await text('docs/api/aos.md');
  const architecture = await text('ARCHITECTURE.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(aosApi, /old `aos ops` command surface is retired/);
  assert.match(architecture, /old `aos ops` command surface is retired/);
  assert.match(adr, /`aos recipe` is the canonical public command surface/);
  assert.match(adr, /old `aos ops`\ncommand surface is retired/);
  assert.doesNotMatch(`${aosApi}\n${architecture}\n${adr}`, /aos ops[^\n.]*compatibility alias|compatibility alias[^\n.]*aos ops/);
});

test('current code and docs use Step Descriptor instead of Playbook Step substrate', async () => {
  const files = await existingFiles([
    'CONTEXT.md',
    'docs/adr',
    'docs/api',
    'docs/design/browser-capture-ladder-projection.md',
    'packages/toolkit/workbench',
    'packages/toolkit/components/step-descriptor-workbench',
    'shared/schemas',
    'tests/schemas',
    'tests/toolkit',
  ]);
  const fileTexts = await Promise.all(files.map(async (file) => [file, await text(file)]));
  const matchingFiles = (pattern) => fileTexts
    .filter(([, content]) => pattern.test(content))
    .map(([file]) => file);

  assert.ok(matchingFiles(/aos\.step_descriptor/).length > 0, 'expected current Step Descriptor schema references');
  assert.deepEqual(
    matchingFiles(/aos\.playbook_step|aos-playbook-step|playbook_step|playbook-step:/),
    [],
  );
});

test('active V1 harness remains neutral and historical Gate coupling is not current authority', async () => {
  const context = await text('CONTEXT.md');
  const workRecords = await text('docs/design/aos-work-records-and-self-healing-recipes.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');
  const workRecordV1 = await text('shared/schemas/aos-work-record-v1.md');
  const stepDescriptorV1 = await text('shared/schemas/aos-step-descriptor-v1.md');

  assert.match(context, /active Step Descriptor V1 harness is neutral/);
  assert.match(context, /no Workflow Gate, approval,\s+risk, or operation-registry field authorizes execution/);
  assert.match(context, /use\s+`claim_results\[\]` as the source of truth/);
  assert.match(workRecords, /active AOS action capture slice is intentionally saved-evidence only/);
  assert.match(workRecords, /execution-mode harness accepts\s+only a caller-supplied adapter/);
  assert.match(workRecords, /Work Record commands expose no fixture executor/);
  assert.match(adr, /active descriptor contract is `aos\.step_descriptor` V1/);
  assert.match(adr, /descriptor carries no Workflow Gate, approval, risk, or AOS-owned operation\s+registry/);
  assert.match(workRecordV1, /active neutral evidence\/history contract/);
  assert.match(workRecordV1, /does not grant\s+permission/);
  assert.match(stepDescriptorV1, /active neutral one-step descriptor contract/);
  assert.match(stepDescriptorV1, /does not\s+grant permission/);
  const activeV1 = `${context}\n${workRecords}\n${adr}\n${workRecordV1}\n${stepDescriptorV1}`;
  assert.doesNotMatch(activeV1, /current legacy browser\s+harness as Workflow-gated/);
  assert.doesNotMatch(activeV1, /Gate coupling awaits ADR 0040 migration/);
  assert.doesNotMatch(workRecords, /Playbook-step substrate/);
  assert.doesNotMatch(workRecords, /future Playbook harness/);
  assert.doesNotMatch(context, /Pending: plan revision/);
});

test('browser capture remains a projection, not a taxonomy source', async () => {
  const browser = await text('docs/design/browser-capture-ladder-projection.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(browser, /do not execute a\s+workflow, authorize a future attempt, or add a parallel browser-capture\s+taxonomy/);
  assert.match(browser, /target\/app surface\n-> control primitive\n-> observation\/capture\/evidence block\n-> caller-selected run\n-> optional Work Record with evidence/);
  assert.match(adr, /downstream projections, not the source of truth/);
});

test('browser target guidance separates public handles from current browser transports', async () => {
  const architecture = await text('ARCHITECTURE.md');
  const aosApi = await text('docs/api/aos.md');
  const browserSkill = await text('skills/aos-browser/SKILL.md');
  const seeDo = await text('docs/design/see-do-grammar-trace-connections.md');
  const externalManifest = JSON.parse(await text('manifests/commands/aos-external-commands.json'));
  const maintained = `${architecture}\n${aosApi}\n${browserSkill}\n${seeDo}`;

  assert.match(architecture, /Public target semantics distinguish an ephemeral Observation Ref `\(state_id, ref\)` from a Locator/);
  assert.match(architecture, /ref-bearing dry-run\/effect requests validate the original pair and return `TARGET_ACTION_UNSUPPORTED` before backend dispatch/);
  assert.match(aosApi, /Session-only browser actions remain available/);
  assert.match(aosApi, /Saved and direct requests validate\s+the stored pair but do not dispatch/);
  assert.match(browserSkill, /Observation Ref `\(state_id, ref\)` — ephemeral and stale-rejecting/);
  assert.match(browserSkill, /Locator — canvas\/native only; re-resolves current state and rejects zero or multiple action-compatible matches/);
  assert.match(browserSkill, /V1 has no browser Locator grammar/);
  assert.doesNotMatch(browserSkill, /Locator — re-resolves current browser state/);
  assert.match(browserSkill, /`ref:<snapshot-id>:<ref>` — current saved-workspace handle, not a Locator/);
  assert.match(browserSkill, /Direct browser refs and saved browser handles are Observation Refs/);
  assert.match(browserSkill, /every ref-bearing dry-run\/effect request returns\s+`TARGET_ACTION_UNSUPPORTED` before backend dispatch/);
  assert.match(browserSkill, /session-only browser `scroll`, `type`, `key`, and `navigate` remain/);
  assert.match(seeDo, /public CLI now documents browser targets through `docs\/api\/aos\.md`/);
  assert.match(seeDo, /current ref-bearing actions are intentionally nonactionable/);
  assert.match(seeDo, /external command manifest conditionally dispatches direct browser forms for\nclick, hover, drag, scroll, type, and key/);
  assert.match(seeDo, /saved-ref `fill`, `type`, and\s+`key` validate the original pair and stop with `TARGET_ACTION_UNSUPPORTED`/);
  assert.match(seeDo, /should not assume typed SDK parity with CLI browser\s+refs/);
  assert.match(browserSkill, /docs\/archive\/superpowers\/specs\/2026-04-24-playwright-browser-adapter-design\.md/);
  for (const action of ['type', 'key']) {
    assert.ok(
      externalManifest.commands.some((command) =>
        command.path?.join(' ') === `do ${action}`
        && command.argv_prefix?.join(' ') === `node scripts/aos-do-browser.mjs ${action}`
        && command.when?.prefix === 'browser:'),
      `missing direct browser external route for do ${action}`,
    );
  }
  assert.doesNotMatch(maintained, /refs come from `aos see capture browser:<session> --xray`/i);
  assert.doesNotMatch(seeDo, /`docs\/api\/aos\.md` does not document browser target usage/);
  assert.doesNotMatch(seeDo, /target discovery\/examples do not show `browser:<session>`/);
  assert.doesNotMatch(seeDo, /browser\s+forms of existing verbs .* are not clear/);
  assert.doesNotMatch(browserSkill, /Saved-ref `type` and `key` are not supported/);
  assert.doesNotMatch(browserSkill, /docs\/superpowers\/specs\/2026-04-24-playwright-browser-adapter-design\.md/);
});

test('context glossary distinguishes public target types from current saved handles', async () => {
  const context = await text('CONTEXT.md');
  const aosApi = await text('docs/api/aos.md');
  const workspaceSchema = await text('shared/schemas/aos-agent-workspace-v0.md');

  assert.match(context, /\*\*Saved Ref\*\*:/);
  assert.match(context, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(context, /\*\*Observation Ref\*\*:/);
  assert.match(context, /ephemeral public handle `\(state_id, ref\)`/);
  assert.match(context, /\*\*Locator\*\*:/);
  assert.match(context, /re-resolves against current state for every\s+operation/);
  assert.match(context, /workspace snapshot record/);
  assert.match(context, /storage indirection, not a third live target type/);
  assert.match(context, /It is not\s+a live Observation Ref or Locator/);
  assert.match(context, /Bare\s+`ref:<ref-id>` and automatic reacquisition are invalid V1 behavior/);
  assert.match(aosApi, /snapshot-qualified saved addresses/);
  assert.match(workspaceSchema, /Saved refs are scoped to a snapshot/);
  assert.match(workspaceSchema, /originating capture source and mode/);
  assert.doesNotMatch(workspaceSchema, /originating saved target/);
  assert.doesNotMatch(context, /Saved Ref[\s\S]{0,500}is the live wire form/);
});

test('public API docs define Observation Refs and Locators while inventorying current forms', async () => {
  const aosApi = await text('docs/api/aos.md');
  const section = aosApi.split('## Target And Handle Contract', 2)[1].split('## Core Usage Patterns', 1)[0];

  assert.match(section, /Observation Ref/);
  assert.match(section, /ephemeral `\(state_id, ref\)`/);
  assert.match(section, /Locator/);
  assert.match(section, /Zero\s+matches return missing; more than one returns ambiguous/);
  assert.match(section, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(section, /Bare `ref:<ref-id>`\s+and automatic saved-handle reacquisition are invalid V1 behavior/);
  assert.match(section, /browser Observation Ref strings \(`browser:<session>\/<ref>` plus the original\s+`--state-id`\)/);
  assert.match(section, /canvas Locator strings \(`canvas:<canvas-id>\/<ref>`\)/);
  assert.match(section, /Raw coordinate actions\s+remain available but reject `--state-id` with `TARGET_STATE_UNSUPPORTED`/);
  assert.match(section, /AX Locator\s+flags such as `--pid`, `--role`, and filters/);
  assert.match(section, /no current public `ax:` CLI target grammar/);
  assert.match(section, /Semantic Targets are structured perception records/);
  assert.match(section, /not a separate address grammar/);
  assert.match(section, /Window, channel, browser, and\s+canvas ids remain resource ids or role-flag values/);
  assert.doesNotMatch(section, /`screen:/);
  assert.doesNotMatch(section, /`ax:</);
});

test('README gives the public target types and inventories current grammar', async () => {
  const readme = await text('README.md');
  const section = readme.split('## Target Handles', 2)[1].split('## Track-2 consumers', 1)[0];

  assert.match(section, /ephemeral Observation Ref\s+`\(state_id, ref\)`/);
  assert.match(section, /Locator, which re-resolves at\s+action time and rejects zero or multiple matches/);
  assert.match(section, /saved-workspace address/);
  assert.match(section, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(section, /Direct browser Observation Refs use\s+`browser:<session>\/<ref>` plus their original `--state-id`/);
  assert.match(section, /canvas Locators use\s+`canvas:<canvas-id>\/<ref>`/);
  assert.match(section, /Coordinate fallback remains raw `x,y` and rejects\s+`--state-id`/);
  assert.match(section, /selector\s+flags such as `--pid` and `--role`/);
  assert.match(section, /not a public `ax:`\s+target grammar/);
  assert.match(section, /Semantic\s+Targets are perception records/);
  assert.match(section, /not another address\s+system/);
  assert.doesNotMatch(section, /`screen:/);
  assert.doesNotMatch(section, /`ax:<`/);
});

test('retired grand unification lineage routes readers to current authority', async () => {
  const plan = await text('docs/design/aos-grand-unification-plan.md');
  const projection = JSON.parse(await text('docs/wiki/repo-docs-projection-v0.json'));

  assert.match(plan, /retired May 2026 implementation lineage; not the current roadmap/);
  assert.match(plan, /former phase plan remains available in Git history/);
  assert.match(plan, /`docs\/adr\/README\.md`/);
  assert.match(plan, /`docs\/api\/aos\.md` and `docs\/api\/aos-capabilities\.md`/);
  assert.match(plan, /Source command manifests and their generated artifacts own exact callable/);
  assert.doesNotMatch(plan, /^## Implementation Phases$/m);
  assert.doesNotMatch(plan, /^### Phase \d/m);
  assert.equal(
    projection.entries.some((entry) => entry.source_path === 'docs/design/aos-grand-unification-plan.md'),
    false,
  );
});

test('design target examples and subject audit preserve current boundaries', async () => {
  const piLessons = await text('docs/design/pi-computer-use-lessons-for-aos-see-do.md');
  const workRecords = await text('docs/design/aos-work-records-and-self-healing-recipes.md');
  const compatibilityAudit = await text('docs/design/aos-subject-model-compatibility-audit.md');

  for (const doc of [piLessons, workRecords]) {
    assert.match(doc, /browser:<session>\/<ref>/);
    assert.match(doc, /canvas:<canvas-id>\/<[^>]+>/);
    assert.match(doc, /ref:<snapshot-id>:<ref-id>/);
    assert.match(doc, /screen coordinate fallback: raw x,y with --state-id rejected \(current CLI\); screen:<state-id>\/<x,y> is target-model\/replay shorthand/);
    assert.match(doc, /native AX: selector flags such as --pid and --role \(current CLI\); ax:<\.\.\.> is reserved target-model vocabulary/);
    assert.doesNotMatch(doc, /^ax:<pid>\/<ref>$/m);
    assert.doesNotMatch(doc, /^screen:<state-id>\/<x,y>$/m);
  }

  assert.match(compatibilityAudit, /Product-specific domain projections belong in the external product repository/);
  assert.match(compatibilityAudit, /AOS toolkit owns only generic Subject, Facet, Host, reference, and workbench\s+builders/);
  assert.doesNotMatch(compatibilityAudit, /apps\/sigil|sigil\.agent|sigil\.radial/i);
});

test('work record action evidence docs preserve selected action target vocabulary', async () => {
  const schemaDoc = await text('shared/schemas/aos-work-record-v0.md');
  const workbenchApi = await text('docs/api/toolkit/workbench.md');

  for (const doc of [schemaDoc, workbenchApi]) {
    assert.match(doc, /target dialect, selected action target, State IDs/);
    assert.match(doc, /Direct browser\/canvas evidence may (?:store|use)\s+a\s+Target-with-Ref/);
    assert.match(doc, /saved-ref evidence should preserve the Saved Ref plus\s+resolved\s+underlying target/);
    assert.match(doc, /native AX evidence should preserve its selector\s+bridge\s+descriptor/);
    assert.doesNotMatch(doc, /target dialect, Target-with-Ref, State IDs/);
  }

  assert.match(schemaDoc, /selected action target for what actually happened during the run/);
  assert.match(schemaDoc, /may be a direct Target-with-Ref, a Saved Ref with resolved\s+underlying target metadata, or a native bridge descriptor/);
  assert.doesNotMatch(schemaDoc, /selected Target-with-Ref/);
});

test('show anchors stay placement roles instead of target dialects', async () => {
  const context = await text('CONTEXT.md');
  const architecture = await text('ARCHITECTURE.md');
  const aosApi = await text('docs/api/aos.md');
  const manifest = JSON.parse(await text('manifests/commands/aos-commands.json'));
  const showCommand = manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(['show'])
  ));
  const showCreateForm = showCommand?.forms?.find((form) => form.id === 'show-create');
  const showUpdateForm = showCommand?.forms?.find((form) => form.id === 'show-update');
  const showSection = aosApi.split('## `aos show`', 2)[1].split('## `aos recipe`', 1)[0];
  const anchorConflict = ['anchor-window', 'anchor-channel', 'anchor-browser'];

  assert.match(context, /\*\*Anchor \(role\)\*\*:/);
  assert.match(context, /A role played by a Target-with-Ref when `aos show` uses it as a placement reference/);
  assert.match(context, /not a parallel target\s+dialect/);
  assert.match(context, /\*\*Anchor Binding\*\*:/);
  assert.match(context, /resolved, stored representation of an Anchor inside the display subsystem/);
  assert.match(context, /re-resolve an Anchor Binding without changing the original Target-with-Ref string/);
  assert.match(architecture, /Overlays anchored to browser elements still take direct Target-with-Ref input/);
  assert.match(architecture, /not page scroll/);
  assert.match(architecture, /re-issue `aos show update --anchor-browser/);
  assert.match(showSection, /Anchor flags are placement roles, not separate target dialects/);
  assert.match(showSection, /`--anchor-browser` consumes a browser Target-with-Ref/);
  assert.match(showSection, /`--anchor-window`\s+and `--anchor-channel` consume resource ids/);
  assert.match(showSection, /resolves the\s+input into an Anchor Binding for placement/);
  assert.ok(showCreateForm?.args?.some((arg) => arg.id === 'anchor-browser' && /browser target/.test(arg.summary)));
  assert.ok(showUpdateForm?.args?.some((arg) => arg.id === 'anchor-browser' && /anchor browser target/.test(arg.summary)));
  assert.ok(showCreateForm?.constraints?.conflicts?.some((group) => (
    JSON.stringify(group) === JSON.stringify(anchorConflict)
  )));
  assert.ok(showUpdateForm?.constraints?.conflicts?.some((group) => (
    JSON.stringify(group) === JSON.stringify(anchorConflict)
  )));
  assert.doesNotMatch(`${context}\n${showSection}`, /Anchor flags are separate target dialects/);
  assert.doesNotMatch(`${context}\n${showSection}`, /anchor:<|browser-anchor:/);
});

test('show surface loop uses canvas targets and saved refs instead of private locators', async () => {
  const aosApi = await text('docs/api/aos.md');
  const manifest = JSON.parse(await text('manifests/commands/aos-commands.json'));
  const commandByPath = (segments) => manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(segments)
  ));
  const showCommand = commandByPath(['show']);
  const showCreateForm = showCommand?.forms?.find((form) => form.id === 'show-create');
  const showUpdateForm = showCommand?.forms?.find((form) => form.id === 'show-update');
  const showRemoveForm = showCommand?.forms?.find((form) => form.id === 'show-remove');
  const showRenderForm = showCommand?.forms?.find((form) => form.id === 'show-render');
  const showEvalForm = showCommand?.forms?.find((form) => form.id === 'show-eval');
  const seeCommand = commandByPath(['see']);
  const seeCaptureForm = seeCommand?.forms?.find((form) => (
    form.id === 'see-capture-save' && /--canvas <id>/.test(form.usage ?? '')
  ));
  const doCommand = commandByPath(['do']);
  const doDragCommand = commandByPath(['do', 'drag']);
  const doClickForm = doCommand?.forms?.find((form) => form.id === 'do-click');
  const doSetValueForm = doCommand?.forms?.find((form) => form.id === 'do-set-value');
  const doDragCanvasForm = doDragCommand?.forms?.find((form) => form.id === 'do-drag-canvas')
    ?? doCommand?.forms?.find((form) => form.id === 'do-drag-canvas');
  const showSection = aosApi.split('## `aos show`', 2)[1].split('## `aos recipe`', 1)[0];

  assert.match(showSection, /### Show\/See\/Do Surface Loop/);
  assert.match(showSection, /`aos show create`, `aos show update`, and `aos show remove`/);
  assert.match(showSection, /`aos show render` for one-shot image rendering/);
  assert.match(showSection, /aos see capture --canvas <id> --xray --save --workspace <workspace>/);
  assert.match(showSection, /aos do click canvas:<canvas-id>\/<ref>\n/);
  assert.doesNotMatch(showSection, /canvas:<canvas-id>\/<ref> --state-id/);
  assert.match(showSection, /aos do set-value canvas:<canvas-id>\/<ref> --value <value>/);
  assert.match(showSection, /aos do drag canvas:<canvas-id>\/<ref> --by <dx>,<dy>/);
  assert.match(showSection, /`semantic_targets\[\]\.provenance\.do_target` is the direct current-host action\s+handle/);
  assert.match(showSection, /`ref:<snapshot-id>:<ref-id> --workspace <workspace>`/);
  assert.match(showSection, /there is no separate `show:`,\s+`surface:`, or `anchor:` action grammar/);
  assert.match(showSection, /Verify through a fresh `aos see capture --canvas <id> --xray --save\s+--workspace <workspace>`/);
  assert.match(showSection, /`aos show\s+eval --id <id> --js \.\.\.` is a developer diagnostic bridge/);
  assert.match(showSection, /show eval is not a target dialect/);
  assert.match(showSection, /Surface Inspector and annotation support surfaces/);
  assert.match(showSection, /`annotation-snapshot\.json`/);
  assert.match(showSection, /instead of inventing private surface addresses/);

  assert.match(showCreateForm?.usage ?? '', /aos show create --id <name>/);
  assert.match(showUpdateForm?.usage ?? '', /aos show update --id <name>/);
  assert.match(showRemoveForm?.usage ?? '', /aos show remove --id <name>/);
  assert.match(showRenderForm?.usage ?? '', /aos show render/);
  assert.match(showEvalForm?.usage ?? '', /aos show eval --id <name> --js <javascript>/);
  assert.match(seeCaptureForm?.usage ?? '', /--canvas <id>/);
  assert.match(seeCaptureForm?.usage ?? '', /--save/);
  assert.match(doClickForm?.usage ?? '', /canvas:<canvas-id>\/<ref>/);
  assert.match(doSetValueForm?.usage ?? '', /canvas:<canvas-id>\/<ref>/);
  assert.match(doDragCanvasForm?.usage ?? '', /canvas:<canvas-id>\/<ref>/);
  assert.doesNotMatch(showSection, /(?:show|surface|anchor):<canvas-id>/);
  assert.doesNotMatch(showSection, /private surface locator/i);
});

test('canvas host docs keep lifecycle, current targets, and saved refs distinct', async () => {
  const aosApi = await text('docs/api/aos.md');
  const toolkitRuntime = await text('docs/api/toolkit/runtime.md');
  const context = await text('CONTEXT.md');
  const manifest = JSON.parse(await text('manifests/commands/aos-commands.json'));
  const showCommand = manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(['show'])
  ));
  const showCreateForm = showCommand?.forms?.find((form) => form.id === 'show-create');
  const seeCommand = manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(['see'])
  ));
  const seeCaptureForm = seeCommand?.forms?.find((form) => form.id === 'see-capture');
  const doDragCommand = manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(['do', 'drag'])
  ));
  const doCommand = manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(['do'])
  ));
  const doDragCanvasForm = doDragCommand?.forms?.find((form) => form.id === 'do-drag-canvas')
    ?? doCommand?.forms?.find((form) => form.id === 'do-drag-canvas');
  const doClickForm = doCommand?.forms?.find((form) => form.id === 'do-click');
  const doSetValueForm = doCommand?.forms?.find((form) => form.id === 'do-set-value');
  const targetLadder = aosApi.split('## Target And Handle Contract', 2)[1].split('## Core Usage Patterns', 1)[0];

  assert.ok(showCreateForm?.args?.some((arg) => arg.id === 'id' && /Canvas identifier/.test(arg.summary)));
  assert.ok(seeCaptureForm?.args?.some((arg) => arg.token === '--canvas' && /Capture a canvas by id/.test(arg.summary)));
  assert.match(doClickForm?.usage ?? '', /canvas:<canvas-id>\/<ref>/);
  assert.match(doSetValueForm?.usage ?? '', /canvas:<canvas-id>\/<ref>/);
  assert.match(doDragCanvasForm?.usage ?? '', /canvas:<canvas-id>\/<ref>/);
  assert.match(doDragCanvasForm?.usage ?? '', /--by <dx,dy>\|--to-value <value>/);
  assert.match(context, /Canvas Host[\s\S]*?addressed as `canvas:<canvas-id>\/<ref>`/);
  assert.match(targetLadder, /Window, channel, browser, and\s+canvas ids remain resource ids or role-flag values/);
  assert.match(toolkitRuntime, /`aos show --id <canvas-id>` owns canvas resource lifecycle/);
  assert.match(toolkitRuntime, /`aos see capture\s+--canvas <canvas-id>` scopes perception to the current canvas host/);
  assert.match(toolkitRuntime, /`canvas:<canvas-id>\/<ref>` is the direct current Target-with-Ref/);
  assert.match(toolkitRuntime, /Saved\s+workspace refs such as `ref:<snapshot-id>:<ref-id>` remain current\s+implementation handles during migration, not durable public target identity/);
  assert.match(toolkitRuntime, /canvas id as a resource id, not as durable object\s+identity/);
  assert.doesNotMatch(`${targetLadder}\n${toolkitRuntime}`, /canvas id is durable object identity/i);
  assert.doesNotMatch(`${targetLadder}\n${toolkitRuntime}`, /canvas:<canvas-id> is the saved ref/i);
});

test('voice and communication guidance keep say, voice, tell, and listen roles distinct', async () => {
  const architecture = await text('ARCHITECTURE.md');
  const aosApi = await text('docs/api/aos.md');
  const readme = await text('README.md');
  const manifest = JSON.parse(await text('manifests/commands/aos-commands.json'));
  const maintained = `${architecture}\n${aosApi}\n${readme}`;
  const commandByPath = (segments) => manifest.commands.find((command) => (
    JSON.stringify(command.path) === JSON.stringify(segments)
  ));
  const sayCommand = commandByPath(['say']);
  const tellCommand = commandByPath(['tell']);
  const listenCommand = commandByPath(['listen']);
  const doCommand = commandByPath(['do']);
  const tellMessageForm = tellCommand?.forms?.find((form) => form.id === 'tell-message');
  const listenReadForm = listenCommand?.forms?.find((form) => form.id === 'listen-read');
  const listenFollowForm = listenCommand?.forms?.find((form) => form.id === 'listen-follow');
  const listenHotkeyForm = listenCommand?.forms?.find((form) => form.id === 'listen-hotkey');
  const listenMicrophoneForm = listenCommand?.forms?.find((form) => form.id === 'listen-microphone');
  const listenMicrophoneSegmentedForm = listenCommand?.forms?.find((form) => form.id === 'listen-microphone-segmented');
  const sayFollowForm = sayCommand?.forms?.find((form) => form.id === 'say-follow');
  const doTellForm = doCommand?.forms?.find((form) => form.id === 'do-tell');

  assert.match(architecture, /`aos say` direct TTS convenience/);
  assert.match(architecture, /`aos voice` registry\/catalog\/assignments\/providers\/final-response speech ingress/);
  assert.match(architecture, /\| `listen` \| Receive communication \| Channels, direct sessions, exact hotkeys, and bounded microphone capture \|/);
  assert.match(architecture, /AOS does not transcribe\s+the WAV or decide whether captured text is sent/);
  assert.match(aosApi, /`aos say` is a direct TTS convenience path/);
  assert.match(aosApi, /`aos tell human \.\.\.` is daemon-routed communication/);
  assert.match(aosApi, /`aos tell` is daemon-routed communication, not an app-control synonym for\s+`aos do tell`/);
  assert.match(aosApi, /Messages flow through the daemon coordination bus into named\s+channels or direct canonical-session channels/);
  assert.match(aosApi, /Session presence is daemon state\s+mirrored into `~\/\.config\/aos\/\{mode\}\/coordination\/sessions\.json`/);
  assert.match(aosApi, /channel\s+messages remain daemon-owned bounded queues instead of model-context history/);
  assert.match(aosApi, /Direct routing should prefer canonical session ids/);
  assert.match(aosApi, /This keeps `aos tell --who`, `aos voice assignments`, and role-session\s+status\s+aligned around the same role session identity/);
  assert.match(aosApi, /`--channels` lists the daemon-known channel\s+names/);
  assert.match(aosApi, /not a workspace\s+or transcript index/);
  assert.match(aosApi, /AOS does not transcribe the\s+WAV; local STT and dictation policy are consumer responsibilities/);
  assert.match(aosApi, /Stdin,\s+webhook, and file-watch listen sources remain unimplemented/);
  assert.match(readme, /\| `aos listen` \| Primitive \| Inbound communication: channel\/direct-session reads, exact global hotkeys, and bounded microphone capture \|/);
  assert.match(sayCommand?.summary ?? '', /direct TTS convenience aligned with tell human/);
  assert.match(tellCommand?.summary ?? '', /send to human, channel, or session/);
  assert.match(listenCommand?.summary ?? '', /receive channels or direct sessions/);
  assert.match(tellMessageForm?.usage ?? '', /aos tell <audience>\|--session-id <id>/);
  assert.deepEqual(
    tellMessageForm?.constraints?.required_groups?.[0]?.one_of,
    [['audience'], ['session-id']],
  );
  for (const form of [listenReadForm, listenFollowForm]) {
    assert.match(form?.usage ?? '', /aos listen <channel>\|--session-id <id>/);
    assert.deepEqual(
      form?.constraints?.required_groups?.[0]?.one_of,
      [['channel'], ['session-id']],
    );
  }
  assert.match(listenHotkeyForm?.usage ?? '', /aos listen --source hotkey/);
  assert.match(listenMicrophoneForm?.usage ?? '', /aos listen --source microphone --output <absolute\.wav>/);
  assert.match(listenMicrophoneSegmentedForm?.usage ?? '', /aos listen --source microphone --segments <absolute-directory>/);
  assert.match(sayFollowForm?.usage ?? '', /aos say --follow/);
  assert.match(doTellForm?.usage ?? '', /aos do tell <app> <script>/);
  assert.match(JSON.stringify(doTellForm?.args ?? []), /AppleScript body/);
  assert.doesNotMatch(JSON.stringify(listenCommand?.forms ?? []), /STT|transcription|webhook|file watch/i);
  assert.doesNotMatch(maintained, /\| `listen` \| Receive communication \| Aggregates STT/);
  assert.doesNotMatch(maintained, /`aos listen` or similar/);
  assert.doesNotMatch(maintained, /say.*sugar for tell human/i);
  assert.doesNotMatch(maintained, /session names are canonical/i);
  assert.doesNotMatch(maintained, /channels are workspace transcripts/i);
});

test('Skills and Plugins are packaging activation concepts outside the execution ladder', async () => {
  const context = await text('CONTEXT.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');
  const skillGuide = await text('wiki-seed/plugins/customize-with-agent/references/skill-writing-guide.md');

  assert.match(context, /A Skill may guide, wrap, or activate execution, but it is not itself a\nRecipe, Workflow, Run, or Work Record/);
  assert.match(context, /Plugin.*packaging and activation vocabulary, not an execution ladder rung/s);
  assert.match(adr, /Packaging and activation concepts sit outside the execution ladder/);
  assert.match(skillGuide, /plugin\nand its Skill are packaging\/activation concepts rather than execution-model\nrungs/);
});

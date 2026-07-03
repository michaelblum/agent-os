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

test('current execution model surfaces keep Recipe executable-only', async () => {
  const guides = await text('docs/guides/README.md');
  const context = await text('CONTEXT.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(guides, /not\s+executable Recipes/);
  assert.match(context, /Markdown procedures under\n`docs\/guides\/` are Guides\/SOPs, not executable Recipes/);
  assert.match(adr, /Markdown Guides\/SOPs\nlive under `docs\/guides\/`/);
  assert.doesNotMatch(`${guides}\n${context}\n${adr}`, /documentation-only Recipe|Markdown Recipe/);
});

test('aos ops remains compatibility vocabulary, not the canonical public surface', async () => {
  const aosApi = await text('docs/api/aos.md');
  const architecture = await text('ARCHITECTURE.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(aosApi, /`aos ops` remains a compatibility alias/);
  assert.match(architecture, /`aos ops` is a compatibility alias/);
  assert.match(adr, /`aos recipe` is the canonical public command surface/);
  assert.doesNotMatch(`${aosApi}\n${architecture}\n${adr}`, /`aos ops` is the canonical/);
  assert.doesNotMatch(`${aosApi}\n${architecture}\n${adr}`, /canonical public command surface[^\n.]*`aos ops`/);
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

test('grand unification plan keeps Work Records and verifier reports as harness obligations', async () => {
  const plan = await text('docs/design/aos-grand-unification-plan.md');
  const context = await text('CONTEXT.md');
  const workRecords = await text('docs/design/aos-work-records-and-self-healing-recipes.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(plan, /### Phase 6: Browser Step Evidence And Workflow-Gated Runs/);
  assert.match(plan, /not Playbook-authored execution/);
  assert.match(plan, /Work Records and verifier reports are harness obligations around the run/);
  assert.match(plan, /First candidate Workflow-gated browser run/);
  assert.match(plan, /emit a Work Record through the harness/);
  assert.match(plan, /run the report-only verifier profile/);
  assert.match(plan, /`claim_results\[\]`/);
  assert.match(plan, /derived indexes: `verified`, `failed`, `unverified`/);
  assert.match(context, /now treats browser runs as\s+Workflow-gated step evidence/);
  assert.match(context, /use\s+`claim_results\[\]` as the source of truth/);
  assert.match(workRecords, /Workflow-gated step\/evidence\s+bridge/);
  assert.match(workRecords, /Work Records and verifier reports\s+are harness obligations around the run/);
  assert.match(workRecords, /Playbooks remain method guidance rather than the execution substrate/);
  assert.match(adr, /neutral V0 sketch for one Workflow-gated step\/evidence bridge/);
  assert.doesNotMatch(plan, /### Phase 6: Browser Playbooks/);
  assert.doesNotMatch(plan, /A playbook step is/);
  assert.doesNotMatch(plan, /save a work record/);
  assert.doesNotMatch(plan, /run verifier report/);
  assert.doesNotMatch(workRecords, /Playbook-step substrate/);
  assert.doesNotMatch(workRecords, /future Playbook harness/);
  assert.doesNotMatch(context, /Pending: plan revision/);
});

test('browser capture remains a projection, not a taxonomy source', async () => {
  const browser = await text('docs/design/browser-capture-ladder-projection.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(browser, /not a taxonomy root/);
  assert.match(browser, /target\/app surface\n-> control primitive\n-> observation\/capture\/evidence block\n-> reusable capture recipe\n-> workflow orchestration with gates\/retries\n-> run\n-> work record with evidence\/trace/);
  assert.match(adr, /downstream projections, not the source of truth/);
});

test('browser target guidance prefers saved refs and keeps direct refs volatile', async () => {
  const architecture = await text('ARCHITECTURE.md');
  const aosApi = await text('docs/api/aos.md');
  const browserSkill = await text('skills/browser-adapter/SKILL.md');
  const seeDo = await text('docs/design/see-do-grammar-trace-connections.md');
  const externalManifest = JSON.parse(await text('manifests/commands/aos-external-commands.json'));
  const maintained = `${architecture}\n${aosApi}\n${browserSkill}\n${seeDo}`;

  assert.match(architecture, /For normal observe-act loops, agents capture `aos see capture browser:<session> --save --mode som --workspace <id>`/);
  assert.match(architecture, /saved-ref dispatch validates the current browser target/);
  assert.match(aosApi, /Direct browser `type` and `key` are current-host routes/);
  assert.match(aosApi, /Saved-ref `type` and `key` attempts[\s\S]*fail\s+closed through the saved-ref resolver/);
  assert.match(browserSkill, /`ref:<snapshot-id>:<ref>` — the preferred observe-act target for normal browser work/);
  assert.match(browserSkill, /Direct browser refs are volatile/);
  assert.match(browserSkill, /Direct browser `type` and `key` are current-host routes/);
  assert.match(seeDo, /public CLI now documents browser targets through `docs\/api\/aos\.md`/);
  assert.match(seeDo, /Collection workers should prefer saved refs for normal loops/);
  assert.match(seeDo, /direct\s+`browser:<session>\/<ref>` targets as current\s+diagnostic\/provenance handles/);
  assert.match(seeDo, /external command manifest conditionally dispatches direct browser forms for\nclick, hover, drag, scroll, type, and key/);
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
  assert.doesNotMatch(browserSkill, /docs\/superpowers\/specs\/2026-04-24-playwright-browser-adapter-design\.md/);
});

test('context glossary distinguishes saved refs from live target refs', async () => {
  const context = await text('CONTEXT.md');
  const aosApi = await text('docs/api/aos.md');
  const workspaceSchema = await text('shared/schemas/aos-agent-workspace-v0.md');

  assert.match(context, /\*\*Saved Ref\*\*:/);
  assert.match(context, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(context, /primary model-facing handle/);
  assert.match(context, /workspace snapshot record/);
  assert.match(context, /revalidate or reacquire the current target before mutation/);
  assert.match(context, /not a live\s+Target-with-Ref/);
  assert.match(context, /Bare\s+`ref:<ref-id>` is permitted only when unambiguous inside the workspace/);
  assert.match(context, /separate from direct Target-with-Ref address grammar/);
  assert.match(context, /snapshot\/workspace\/conformance\/action-matrix data/);
  assert.match(aosApi, /Saved refs use `ref:<snapshot-id>:<ref-id>`/);
  assert.match(workspaceSchema, /Saved refs are scoped to a snapshot/);
  assert.match(workspaceSchema, /originating capture source and mode/);
  assert.doesNotMatch(workspaceSchema, /originating saved target/);
  assert.doesNotMatch(context, /Saved Ref[\s\S]{0,500}is the live wire form/);
});

test('public API docs preserve the current target and handle ladder', async () => {
  const aosApi = await text('docs/api/aos.md');
  const section = aosApi.split('## Target And Handle Ladder', 2)[1].split('## Core Usage Patterns', 1)[0];

  assert.match(section, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(section, /bare `ref:<ref-id>` only when the\s+workspace can resolve it unambiguously/);
  assert.match(section, /`browser:<session>\/<ref>` and `canvas:<canvas-id>\/<ref>`/);
  assert.match(section, /raw `x,y` plus `--state-id <id>`/);
  assert.match(section, /selector flags such as `--pid`, `--role`, and\s+filters/);
  assert.match(section, /no current public `ax:` CLI target grammar/);
  assert.match(section, /Semantic Targets are structured perception records/);
  assert.match(section, /not a separate address grammar/);
  assert.match(section, /Window, channel, browser, and\s+canvas ids remain resource ids or role-flag values/);
  assert.doesNotMatch(section, /`screen:/);
  assert.doesNotMatch(section, /`ax:</);
});

test('README gives the simplified target handle ladder without new grammar', async () => {
  const readme = await text('README.md');
  const section = readme.split('## Target Handles', 2)[1].split('## Track-2 consumers', 1)[0];

  assert.match(section, /saved refs from `aos see capture --save`/);
  assert.match(section, /`ref:<snapshot-id>:<ref-id>`/);
  assert.match(section, /`browser:<session>\/<ref>` and `canvas:<canvas-id>\/<ref>`/);
  assert.match(section, /raw `x,y` plus `--state-id <id>`/);
  assert.match(section, /selector flags such as `--pid` and `--role`/);
  assert.match(section, /not a public `ax:`\s+target grammar/);
  assert.match(section, /Semantic Targets are perception records/);
  assert.match(section, /not another address system/);
  assert.doesNotMatch(section, /`screen:/);
  assert.doesNotMatch(section, /`ax:<`/);
});

test('grand unification plan qualifies screen and AX target-model vocabulary', async () => {
  const plan = await text('docs/design/aos-grand-unification-plan.md');

  assert.match(plan, /`browser:<session>\/<ref>`: Playwright-backed DOM\/ARIA targets/);
  assert.match(plan, /`canvas:<canvas-id>\/<ref>`: AOS canvas semantic targets/);
  assert.match(plan, /Screen coordinate fallback: current CLI actions use raw `x,y` plus optional\s+`--state-id`/);
  assert.match(plan, /`screen:<state-id>\/<x,y>` remains target-model\/replay\s+vocabulary, not a current CLI target string/);
  assert.match(plan, /Native AX: current CLI actions select elements through flags such as\s+`--pid` and `--role`/);
  assert.match(plan, /`ax:<\.\.\.>` remains future first-class target-model\s+vocabulary, not a current CLI target string/);
  assert.doesNotMatch(plan, /`screen:<state-id>\/<x,y>`: coordinate fallback with state guard/);
  assert.doesNotMatch(plan, /`ax:<\.\.\.>`: future first-class macOS AX refs/);
});

test('design target examples keep screen and AX as bridge or model vocabulary', async () => {
  const piLessons = await text('docs/design/pi-computer-use-lessons-for-aos-see-do.md');
  const workRecords = await text('docs/design/aos-work-records-and-self-healing-recipes.md');
  const compatibilityAudit = await text('docs/design/aos-subject-model-compatibility-audit.md');

  for (const doc of [piLessons, workRecords]) {
    assert.match(doc, /browser:<session>\/<ref>/);
    assert.match(doc, /canvas:<canvas-id>\/<[^>]+>/);
    assert.match(doc, /ref:<snapshot-id>:<ref-id>/);
    assert.match(doc, /screen coordinate fallback: raw x,y plus --state-id \(current CLI\); screen:<state-id>\/<x,y> is target-model\/replay shorthand/);
    assert.match(doc, /native AX: selector flags such as --pid and --role \(current CLI\); ax:<\.\.\.> is reserved target-model vocabulary/);
    assert.doesNotMatch(doc, /^ax:<pid>\/<ref>$/m);
    assert.doesNotMatch(doc, /^screen:<state-id>\/<x,y>$/m);
  }

  assert.match(compatibilityAudit, /current coordinate fallback as raw `x,y` plus optional\s+`--state-id`/);
  assert.match(compatibilityAudit, /`screen:<state-id>\/<x,y>` remains target-model\/replay shorthand,\s+not a current CLI target string/);
  assert.match(compatibilityAudit, /screen coordinate bridge wording/);
  assert.doesNotMatch(compatibilityAudit, /update docs to `screen:<state-id>\/<x,y>`/);
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
  assert.match(context, /not a parallel target dialect/);
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
  assert.match(showSection, /aos do click canvas:<canvas-id>\/<ref> --state-id <id>/);
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
  const targetLadder = aosApi.split('## Target And Handle Ladder', 2)[1].split('## Core Usage Patterns', 1)[0];

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
  assert.match(toolkitRuntime, /Saved workspace refs remain the model-facing durable\s+handle/);
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
  const doTellForm = doCommand?.forms?.find((form) => form.id === 'do-tell');

  assert.match(architecture, /`aos say` direct TTS convenience/);
  assert.match(architecture, /`aos voice` registry\/catalog\/assignments\/providers\/final-response speech ingress/);
  assert.match(architecture, /STT audio capture is a planned `aos listen` source, not a separate public primitive/);
  assert.match(architecture, /\| `listen` \| Receive communication \| Channels and direct sessions today; STT, stdin, and aggregated sources planned \|/);
  assert.match(aosApi, /`aos say` is a direct TTS convenience path/);
  assert.match(aosApi, /`aos tell human \.\.\.` is daemon-routed communication/);
  assert.match(aosApi, /`aos tell` is daemon-routed communication, not an app-control synonym for\s+`aos do tell`/);
  assert.match(aosApi, /Messages flow through the daemon coordination bus into named\s+channels or direct canonical-session channels/);
  assert.match(aosApi, /Session presence is daemon state\s+mirrored into `~\/\.config\/aos\/\{mode\}\/coordination\/sessions\.json`/);
  assert.match(aosApi, /channel\s+messages remain daemon-owned bounded queues instead of model-context history/);
  assert.match(aosApi, /Direct routing should prefer canonical session ids/);
  assert.match(aosApi, /This keeps `aos tell --who`, `aos voice assignments`, and docked\s+session status aligned around the same role session identity/);
  assert.match(aosApi, /`--channels` lists the daemon-known channel\s+names/);
  assert.match(aosApi, /not a workspace\s+or transcript index/);
  assert.match(aosApi, /STT\/dictation is planned as a future `aos listen` source/);
  assert.match(aosApi, /Stdin ingestion is also planned as a future `aos listen` source/);
  assert.match(readme, /\| `aos listen` \| Primitive \| Inbound communication: channel\/direct-session reads and follow today; STT and broader sources planned \|/);
  assert.match(sayCommand?.summary ?? '', /direct TTS convenience aligned with tell human/);
  assert.match(tellCommand?.summary ?? '', /send to human, channel, or session/);
  assert.match(listenCommand?.summary ?? '', /receive from channels or direct sessions/);
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
  assert.match(doTellForm?.usage ?? '', /aos do tell <app> <script>/);
  assert.match(JSON.stringify(doTellForm?.args ?? []), /AppleScript body/);
  assert.doesNotMatch(JSON.stringify(listenCommand?.forms ?? []), /STT|dictation|stdin|webhook|file watch/i);
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

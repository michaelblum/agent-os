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

test('browser capture remains a projection, not a taxonomy source', async () => {
  const browser = await text('docs/design/browser-capture-ladder-projection.md');
  const adr = await text('docs/adr/0013-aos-execution-model-v0.md');

  assert.match(browser, /not a taxonomy root/);
  assert.match(browser, /target\/app surface\n-> control primitive\n-> observation\/capture\/evidence block\n-> reusable capture recipe\n-> workflow orchestration with gates\/retries\n-> run\n-> work record with evidence\/trace/);
  assert.match(adr, /downstream projections, not the source of truth/);
});

test('browser target guidance prefers saved refs and keeps direct refs volatile', async () => {
  const architecture = await text('ARCHITECTURE.md');
  const browserSkill = await text('skills/browser-adapter/SKILL.md');
  const maintained = `${architecture}\n${browserSkill}`;

  assert.match(architecture, /For normal observe-act loops, agents capture `aos see capture browser:<session> --save --mode som --workspace <id>`/);
  assert.match(architecture, /saved-ref dispatch validates the current browser target/);
  assert.match(browserSkill, /`ref:<snapshot-id>:<ref>` — the preferred observe-act target for normal browser work/);
  assert.match(browserSkill, /Direct browser refs are volatile/);
  assert.match(browserSkill, /docs\/archive\/superpowers\/specs\/2026-04-24-playwright-browser-adapter-design\.md/);
  assert.doesNotMatch(maintained, /refs come from `aos see capture browser:<session> --xray`/);
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
  assert.match(workspaceSchema, /originating capture target and mode/);
  assert.doesNotMatch(workspaceSchema, /originating saved target/);
  assert.doesNotMatch(context, /Saved Ref[\s\S]{0,500}is the live wire form/);
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

test('voice and communication guidance keep say, voice, tell, and listen roles distinct', async () => {
  const architecture = await text('ARCHITECTURE.md');
  const aosApi = await text('docs/api/aos.md');
  const readme = await text('README.md');
  const maintained = `${architecture}\n${aosApi}\n${readme}`;

  assert.match(architecture, /`aos say` direct TTS convenience/);
  assert.match(architecture, /`aos voice` registry\/catalog\/assignments\/providers\/final-response speech ingress/);
  assert.match(architecture, /STT audio capture is a planned `aos listen` source, not a separate public primitive/);
  assert.match(aosApi, /`aos say` is a direct TTS convenience path/);
  assert.match(aosApi, /`aos tell human \.\.\.` is daemon-routed communication/);
  assert.match(readme, /\| `aos listen` \| Primitive \| Inbound communication: channel\/direct-session reads and follow today; STT and broader sources planned \|/);
  assert.doesNotMatch(maintained, /`aos listen` or similar/);
  assert.doesNotMatch(maintained, /say.*sugar for tell human/i);
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

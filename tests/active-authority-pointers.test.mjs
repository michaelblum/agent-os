import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);

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

async function filesBelow(relativeRoot) {
  const files = [];
  async function walk(relativePath) {
    const entries = await readdir(path.join(repoRoot, relativePath), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(relativeRoot);
  return files.sort();
}

async function activeAuthorityPaths() {
  const frozenHistoricalContracts = new Set([
    'shared/schemas/aos-agent-workspace-v0.md',
    'shared/schemas/aos-step-descriptor-v0.md',
    'shared/schemas/aos-work-record-v0.md',
  ]);
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((relativePath) => existsSync(path.join(repoRoot, relativePath)))
    .filter((relativePath) => (
      ['README.md', 'AGENTS.md'].includes(relativePath)
      || relativePath.endsWith('/README.md')
      || relativePath.endsWith('/AGENTS.md')
      || relativePath.startsWith('scripts/')
      || relativePath.startsWith('skills/')
      || relativePath.startsWith('docs/api/')
      || relativePath.startsWith('docs/agents/')
      || relativePath.startsWith('docs/guides/')
      || relativePath.startsWith('docs/design/work-cards/')
      || relativePath === 'docs/adr/0025-native-annotation-selection-and-shortcut-execution.md'
      || relativePath === 'docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md'
      || relativePath === 'docs/dev/README.md'
      || relativePath === 'docs/dev/command-surface.md'
      || (relativePath.startsWith('shared/schemas/') && relativePath.endsWith('.md'))
    ))
    .filter((relativePath) => !relativePath.startsWith('docs/archive/'))
    .filter((relativePath) => !relativePath.startsWith('docs/dev/reports/'))
    .filter((relativePath) => !frozenHistoricalContracts.has(relativePath))
    .sort();
}

async function embeddedProductAuthorityPaths() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((relativePath) => existsSync(path.join(repoRoot, relativePath)))
    .filter((relativePath) => (
      ['.fallowrc.jsonc', 'AGENTS.md', 'ARCHITECTURE.md', 'CLAUDE.md', 'CONTEXT.md', 'CONTEXT-MAP.md', 'README.md'].includes(relativePath)
      || relativePath.endsWith('/AGENTS.md')
      || relativePath.endsWith('/CLAUDE.md')
      || relativePath.endsWith('/README.md')
      || relativePath.startsWith('docs/api/')
      || relativePath.startsWith('docs/guides/')
      || relativePath.startsWith('docs/design/')
      || relativePath.startsWith('memory/scratchpad/')
      || (relativePath.startsWith('shared/schemas/') && relativePath.endsWith('.md'))
      || relativePath.startsWith('packages/gateway/src/')
      || relativePath.startsWith('wiki-seed/')
      || relativePath.startsWith('manifests/commands/source/')
      || relativePath === 'manifests/commands/aos-commands.json'
      || relativePath.startsWith('recipes/')
      || relativePath === 'package.sh'
      || relativePath === 'scripts/package-aos-runtime'
    ))
    .filter((relativePath) => !relativePath.startsWith('tests/fixtures/legacy-sigil/product/'))
    .filter((relativePath) => !relativePath.startsWith('docs/archive/'))
    .filter((relativePath) => !relativePath.startsWith('docs/dev/reports/'))
    .filter((relativePath) => !relativePath.startsWith('docs/design/fixtures/'))
    .filter((relativePath) => !/^docs\/design\/2026-/.test(relativePath))
    .filter((relativePath) => !/-report\.md$|-ledger-\d{4}-\d{2}-\d{2}\.md$/.test(relativePath))
    .filter((relativePath) => relativePath !== 'docs/design/visual-object-doc-index.md')
    .sort();
}

test('active authority map points to existing runtime primitive contract owners', async () => {
  const requiredPointers = [
    ['CONTEXT-MAP.md', 'CONTEXT.md'],
    ['CONTEXT-MAP.md', 'ARCHITECTURE.md'],
    ['CONTEXT-MAP.md', 'AGENTS.md'],
    ['CONTEXT-MAP.md', 'docs/adr/README.md'],
    ['CONTEXT-MAP.md', 'docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md'],
    ['CONTEXT-MAP.md', 'docs/api/README.md'],
    ['CONTEXT-MAP.md', 'docs/api/aos.md'],
    ['CONTEXT-MAP.md', 'docs/api/aos-capabilities.md'],
    ['CONTEXT-MAP.md', 'shared/schemas/'],
    ['CONTEXT-MAP.md', 'shared/schemas/CONTRACT-GOVERNANCE.md'],
    ['CONTEXT-MAP.md', 'shared/schemas/aos-work-record-v1.schema.json'],
    ['CONTEXT-MAP.md', 'shared/schemas/aos-step-descriptor-v1.schema.json'],
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
    ['skills/aos-saved-workspace/SKILL.md', 'docs/api/aos.md'],
    ['skills/aos-saved-workspace/SKILL.md', 'shared/schemas/aos-agent-workspace-v1.md'],
    ['skills/aos-saved-workspace/SKILL.md', 'shared/schemas/aos-target-handle-v1.md'],
    ['skills/aos-saved-workspace/SKILL.md', 'tests/agent-workspace-v1.test.mjs'],
  ];

  const targetPaths = [...new Set(requiredPointers.map(([, target]) => target))];

  await Promise.all(targetPaths.map(assertPathExists));
  await Promise.all(requiredPointers.map(([source, target]) => assertMentions(source, target)));
});

test('ambient authority sources reject mandatory policy while preserving optional mechanics', async () => {
  const adr = await text('docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md');
  const adrIndex = await text('docs/adr/README.md');
  const superseded = await text('docs/adr/0006-state-id-guards-coordinates-strictly-refs-loosely.md');
  const api = await text('docs/api/aos.md');
  const workRecordSchema = await text('shared/schemas/aos-work-record-v0.md');
  const workRecordManifest = await text('manifests/commands/source/aos/35-work-record.json');
  const workRecordFinalizationManifest = await text('manifests/commands/source/aos/37-work-record-finalization.json');
  const semanticTargets = await text('shared/schemas/aos-semantic-targets.md');
  const pendingAnnotation = await text('shared/schemas/aos-pending-annotation-v0.md');
  const nativeAnnotationAdr = await text('docs/adr/0025-native-annotation-selection-and-shortcut-execution.md');
  const accessibilityGuide = await text('docs/guides/aos-app-accessibility-surfaces.md');
  const semanticTargetProbe = await text('src/perceive/semantic-targets.swift');
  const perceiveModels = await text('src/perceive/models.swift');
  const stepDescriptor = await text('shared/schemas/aos-step-descriptor-v0.md');
  const supervisedRun = await text('shared/schemas/aos-supervised-run-v0.md');
  const sceneAuthoring = await text('docs/api/toolkit/scene-authoring.md');
  const sceneRuntime = await text('docs/api/toolkit/scene-runtime.md');
  const subjectCapabilities = await text('shared/schemas/aos-subject-capabilities.md');
  const sceneExtensions = await text('docs/api/toolkit/scene-extensions.md');
  const sceneDevtools = await text('docs/api/toolkit/scene-devtools.md');
  const toolkitWorkbench = await text('docs/api/toolkit/workbench.md');
  const daemonIpc = await text('shared/schemas/daemon-ipc.md');
  const sceneEventSchema = await text('shared/schemas/scene-event-v1.md');
  const shortcutRuntime = await text('scripts/lib/aos-shortcut-run.mjs');
  const scriptsDox = await text('scripts/AGENTS.md');
  const daemonDox = await text('src/daemon/AGENTS.md');
  const sceneDox = await text('packages/toolkit/scene/AGENTS.md');
  const externalWorkRecordManifest = await text('manifests/commands/source/external/45-work-record.json');
  const targetDescriptorFixtureManifest = await text('docs/design/fixtures/aos-target-descriptor-v0/manifest.json');
  const recordingFrameFixtureManifest = await text('docs/design/fixtures/aos-work-recording-frame-v0/manifest.json');
  const interactionGrammarFixtureManifest = await text('docs/design/fixtures/aos-interaction-grammar-v0/manifest.json');
  const targetDescriptorFixtureTest = await text('tests/toolkit/aos-target-descriptor-contract.test.mjs');
  const recordingFrameFixtureTest = await text('tests/toolkit/aos-work-recording-frame-contract.test.mjs');
  const proofRegistry = await text('docs/dev/test-proof-registry.d/substrate-reclassification.json');
  const interactionGrammarNote = await text('docs/design/aos-interaction-grammar-v0.md');
  const recordingFrameNote = await text('docs/design/aos-work-recording-frame-contract-v0.md');
  const desktopWorldAuthoringSkill = await text('skills/aos-desktop-world-authoring/SKILL.md');
  const desktopFrameTextureAdr = await text('docs/adr/0030-desktop-frame-texture-leases.md');
  const desktopPixelBrokerAdr = await text('docs/adr/0031-desktop-pixel-broker-and-warm-snapshots.md');
  const stepDescriptorJsonSchema = await text('shared/schemas/aos-step-descriptor-v0.schema.json');
  const desktopWorldDevtoolsJsonSchema = await text('shared/schemas/desktop-world-devtools-stage-v2.schema.json');
  const agentWorkspaceDox = await text('scripts/lib/agent-workspace/AGENTS.md');
  const rootDox = await text('AGENTS.md');
  const apiCapabilities = await text('docs/api/aos-capabilities.md');
  const sharedDox = await text('shared/AGENTS.md');
  const coreOrientationSkill = await text('skills/aos-core-orientation/SKILL.md');

  assert.match(adr, /user -> agent host \+ macOS TCC -> AOS observe\/act/);
  assert.match(adr, /Observation Ref/);
  assert.match(adr, /Locator/);
  assert.match(adr, /Work Records are optional evidence\/history/);
  assert.match(adr, /Status-item dry-run remains non-consuming/);
  assert.match(adrIndex, /\[0006\].*Superseded/);
  assert.match(adrIndex, /\[0040\].*Accepted/);
  assert.match(superseded, /\*\*Status:\*\* Superseded by ADR 0040/);
  assert.match(pendingAnnotation, /## ADR 0040 Transition Boundary/);
  assert.match(nativeAnnotationAdr, /\*\*Status:\*\* Accepted; amended by ADR 0040/);
  assert.match(desktopFrameTextureAdr, /Status: Accepted; amended by ADR 0040/);
  assert.match(desktopFrameTextureAdr, /## ADR 0040 Transition Boundary/);
  assert.match(desktopFrameTextureAdr, /current legacy implementation\s+behavior\s+and ADR 0040 migration gaps/);
  assert.match(desktopFrameTextureAdr, /does not widen the trusted projection\s+realm/);
  assert.match(desktopPixelBrokerAdr, /Status: Accepted; amended by ADR 0040/);
  assert.match(desktopPixelBrokerAdr, /## ADR 0040 Transition Boundary/);
  assert.match(desktopPixelBrokerAdr, /current legacy implementation\s+behavior\s+and ADR 0040 migration gaps/);
  assert.match(desktopPixelBrokerAdr, /does not\s+widen the trusted projection realm/);
  assert.match(adrIndex, /\[0030\].*Accepted, amended.*ADR 0040 owns ambient-authority and raw-observation semantics/);
  assert.match(adrIndex, /\[0031\].*Accepted, amended.*ADR 0040 owns ambient-authority and raw-observation semantics/);
  assert.match(stepDescriptorJsonSchema, /Current legacy V0 design-schema sketch/);
  assert.match(stepDescriptorJsonSchema, /Gate is not AOS permission/);
  assert.match(desktopWorldDevtoolsJsonSchema, /Bounded engine snapshot shared by CLI, SDK, and host-neutral DevTools views/);
  assert.match(desktopWorldDevtoolsJsonSchema, /private desktop-frame content remain outside it/);
  assert.match(agentWorkspaceDox, /storage indirection to exactly one required discriminated\s+handle/i);
  assert.match(agentWorkspaceDox, /must never capture, search, reacquire, or\s+substitute state/i);
  assert.match(agentWorkspaceDox, /Locators re-resolve at action time/i);
  assert.match(agentWorkspaceDox, /V0 files remain unchanged historical bytes/i);

  for (const gap of [
    'Gate persistence still',
    'redacts prompt/answer content and continuation source',
    'native annotation completion still replaces admitted target',
    'semantic-target public decoder still drops the admitted app-local',
    'Guided User Signal record builder still defaults prompt/answer projection',
    'legacy Supervised Run V0 schema still projects',
    'complete public generic-wait, event-cursor subscription, and semantic-codegen',
    'not a complete public `run-code` surface',
  ]) {
    assert.ok(api.includes(gap), `docs/api/aos.md missing explicit implementation gap: ${gap}`);
  }

  const doctrineSurfaces = [...new Set([
    ...await activeAuthorityPaths(),
    'ARCHITECTURE.md',
    'CONTEXT.md',
    'docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md',
    'manifests/commands/source/aos/35-work-record.json',
    'manifests/commands/source/aos/37-work-record-finalization.json',
    'manifests/commands/source/aos/03-see-01-capture.json',
    'manifests/commands/source/aos/07-do-03-controls.json',
    'manifests/commands/source/aos/39-scene.json',
    'manifests/commands/source/external/45-work-record.json',
    'docs/dev/test-proof-registry.d/substrate-reclassification.json',
    'docs/design/fixtures/aos-target-descriptor-v0/manifest.json',
    'docs/design/fixtures/aos-work-recording-frame-v0/manifest.json',
    'docs/design/fixtures/aos-interaction-grammar-v0/manifest.json',
    'docs/design/aos-interaction-grammar-v0.md',
    'docs/design/aos-work-recording-frame-contract-v0.md',
    'docs/design/aos-grand-unification-plan.md',
    'docs/design/browser-capture-ladder-projection.md',
    'docs/design/aos-input-signal-subscription-proposal.md',
    'docs/design/see-do-grammar-trace-connections.md',
    'docs/design/user-signal-surface.md',
    'docs/design/aos-shared-gesture-spine-v0.md',
    'docs/design/aos-desktop-playwright-cli-map.md',
    'docs/design/surface-annotation-intent-convergence-tracker.md',
    'docs/adr/0018-installable-aos-skills.md',
    'tests/toolkit/aos-target-descriptor-contract.test.mjs',
    'tests/toolkit/aos-work-recording-frame-contract.test.mjs',
    'tests/fixtures/aos-skills/cold-agent-forward-proof-v0.json',
    'tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json',
  ])];
  const mandatoryPatterns = [
    /dry-run before (?:any|the|a|every|live|mutating)/i,
    /act once only when the dry-run/i,
    /then dry-run before run/i,
    /after dry-run validation before dispatch/i,
    /approval-gated design only/i,
    /Stop when a Work Record is corrupt, superseded, missing authorization/i,
    /coordinate fallback is diagnostic unless/i,
    /Remove `--dry-run` only after/i,
    /Stable AOS semantic refs/i,
    /exposes\s+stable refs/i,
    /data-semantic-target-id` is the local durable/i,
    /Reacquisition should use the descriptor's/i,
    /Saved refs are preferred\./i,
    /Durable machine identity lives in `target\.target_id`/i,
    /data-semantic-target-id` contributes `target\.target_id`/i,
    /check `semantic_targets` for state-scoped refs,\s+`target\.target_id`/i,
    /need explicit Workflow gates where they/i,
    /A run must\s+provide both a gate ref/i,
    /Consumers must check origin, preconditions, gates/i,
    /Prompt bodies and answer payloads are\s+redacted by default/i,
    /Plan workflow-gated Work Record repair/i,
    /now treats browser runs as\s+Workflow-gated step evidence/i,
    /Replay and repair remain gated by explicit workflow policy fields/i,
    /any replay\/repair loop needs an explicit\s+workflow gate/i,
    /requires the caller to pass an explicit workflow gate/i,
    /Any future live execution, replay, or repair must be a separate\s+Workflow-gated path/i,
    /confirms replay and repair remain\s+workflow-gated/i,
    /Replay and repair remain gated by `execution_map\.replay_policy`/i,
    /required workflow gates/i,
    /proposed read-only or\s+approval-gated steps/i,
    /request for one required Workflow gate/i,
    /repair the execution map under an\s+explicit workflow\/repair gate/i,
    /authorizes that behavior through the required\s+workflow gates/i,
    /Accessible names and labels are now hints only; durable identity is/i,
    /Answer payloads and prompt bodies are redacted by default/i,
    /\| Locator \| Saved ref, native AX ref, canvas ref, browser ref, or coordinate fallback \|/i,
    /Require explicit approval before any destructive, live-capture, or external side-effect step/i,
    /durable AOS browser refs/i,
    /remains `fallback_only` until a consumer resolves\s+a durable saved ref/i,
    /recorder should redact or summarize sensitive data by default/i,
    /Permanent\s+recording of raw screen\/video\/text is out of scope until privacy boundaries are\s+designed/i,
  ];

  for (const relativePath of doctrineSurfaces) {
    const content = await text(relativePath);
    for (const pattern of mandatoryPatterns) {
      assert.doesNotMatch(content, pattern, `${relativePath} reintroduced mandatory AOS policy`);
    }
  }

  for (const relativePath of [
    'manifests/commands/source/aos/07-do-03-controls.json',
    'manifests/commands/source/aos/40-status-item.json',
  ]) {
    const fragment = JSON.parse(await text(relativePath));
    const dryRunArgs = fragment.commands
      .flatMap((command) => command.forms ?? [])
      .flatMap((form) => form.args ?? [])
      .filter((arg) => arg.id === 'dry-run');
    assert.ok(dryRunArgs.length > 0, `${relativePath} must retain optional dry-run mechanics`);
    assert.ok(dryRunArgs.every((arg) => arg.required === false), `${relativePath} made dry-run mandatory`);
  }

  const statusItemSource = await text('manifests/commands/source/aos/40-status-item.json');
  assert.match(statusItemSource, /without consuming admission or emitting an event/);
  assert.match(workRecordSchema, /Workflow Gate Authorization V0 \(Legacy Implementation Gap\)/);
  assert.match(workRecordSchema, /All Workflow Gate Authorization, operation-allowlist/);
  assert.match(workRecordSchema, /do not grant permission to observe or act/);
  assert.match(workRecordSchema, /Current legacy v0 schema\/harness\s+behavior routes a drifted ref/);
  assert.match(workRecordSchema, /That\s+coupling is ADR 0040 migration debt and does not authorize action/);
  assert.match(workRecordManifest, /plan neutral recovery artifacts/);
  assert.doesNotMatch(workRecordManifest, /work-record-gate-(?:request|check)|work-record-repair-execute/);
  assert.match(workRecordFinalizationManifest, /finalize exact replacements/);
  assert.doesNotMatch(workRecordFinalizationManifest, /work-record-gate-(?:request|check)|work-record-repair-execute/);
  assert.match(semanticTargets, /capture response carries\s+`state_id` at top level/);
  assert.match(semanticTargets, /required V1 Locator `handle`/);
  assert.match(semanticTargets, /Singular `data-aos-action` does not populate this list/);
  assert.match(semanticTargets, /`extension\.action_id` is produced by the fixed probe/);
  assert.match(semanticTargets, /not a primitive `aos do` capability, action authority, or\s+durable target identity/);
  assert.match(semanticTargets, /current\s+public decoder does not preserve\s+that field/);
  assert.match(api, /required canvas Locator `handle`/);
  assert.match(api, /Browser xray `elements` instead carry Observation Ref handles/);
  assert.match(api, /direct selection remains `fallback_only` unless a\s+saved-capture projection supplies exactly one typed V1 handle/);
  assert.match(accessibilityGuide, /required canvas Locator `handle`/);
  assert.match(stepDescriptor, /## ADR 0040 Transition Boundary/);
  assert.match(stepDescriptor, /legacy schema\/harness coupling awaiting runtime migration/);
  assert.match(supervisedRun, /## ADR 0040 Transition Boundary/);
  assert.match(supervisedRun, /This schema and its harness contain no Gate field/);
  assert.match(supervisedRun, /`work_record_projection\.target_schema`[\s\S]*fixed to the frozen\s+`2026-05-work-record-v0` contract/);
  assert.match(sceneAuthoring, /Labels remain outside the bounded product-neutral gesture envelope/);
  assert.match(sceneRuntime, /Parameter values, metadata content, and arbitrary callback\s+errors remain outside/);
  assert.match(subjectCapabilities, /A Work Record execution map, repair hint, or Step Descriptor is neutral evidence\/descriptive input/);
  assert.match(subjectCapabilities, /does not by itself make a Subject replayable/);
  assert.match(sceneExtensions, /these contract exclusions are not ADR 0040 raw-output gaps/);
  assert.match(sceneExtensions, /Pixels and private frame\s+handles\s+remain inside the trusted projection realm/);
  assert.match(sceneDevtools, /Product text,\s+prompts, audio, arbitrary extension state, undeclared engine parameters, and\s+desktop pixels remain outside/);
  assert.match(toolkitWorkbench, /convenience default is an ADR\s+0040 migration gap/);
  assert.match(daemonIpc, /outside the\s+bounded lifecycle event envelope; their exclusion is not an ADR 0040 raw-output\s+gap/);
  assert.match(daemonDox, /This does not widen bounded public contracts or the\s+trusted projection realm/);
  assert.match(daemonDox, /arbitrary extension or product state, private source\s+objects, native handles, and desktop pixels remain outside public scene and\s+DevTools payloads/);
  assert.match(daemonDox, /Per-segment predicate results and pixels remain\s+private extension-evaluation facts/);
  assert.match(daemonDox, /Voice\s+events are bounded lifecycle observations/);
  assert.match(scriptsDox, /This does not widen bounded lifecycle events or operation receipts/);
  assert.match(scriptsDox, /speech text and capture paths stay on their owning\s+speech, transcription, or capture channels/);
  assert.match(nativeAnnotationAdr, /replacement of admitted target\s+`title` and `label` values with `null`/);
  assert.match(nativeAnnotationAdr, /captured process streams remain outside it/);
  assert.match(pendingAnnotation, /replaces its admitted target `title` and\s+`label` fields with `null`/);
  assert.match(pendingAnnotation, /Entered text stays\s+in the durable pending record/);
  const workRecordDesign = await text('docs/design/aos-work-records-and-self-healing-recipes.md');
  assert.match(workRecordDesign, /Redaction, summarization, retention, and persistence are explicit caller-owned\s+transforms/);
  assert.match(workRecordDesign, /AOS does not assign default sensitivity\s+policy/);
  for (const [relativePath, content] of [
    ['AGENTS.md', rootDox],
    ['docs/api/aos.md', api],
    ['docs/api/aos-capabilities.md', apiCapabilities],
    ['shared/AGENTS.md', sharedDox],
    ['skills/aos-core-orientation/SKILL.md', coreOrientationSkill],
  ]) {
    assert.match(content, /admitted (?:by|to) (?:each )?(?:bounded |a )?public\s+(?:adapter\s+)?observation/i, `${relativePath} must scope fidelity to admitted public facts`);
  }
  for (const [relativePath, content] of [
    ['scripts/AGENTS.md', scriptsDox],
    ['src/daemon/AGENTS.md', daemonDox],
    ['packages/toolkit/scene/AGENTS.md', sceneDox],
  ]) {
    assert.match(content, /ADR 0040 (?:transition|target) boundary/i, `${relativePath} must state the applicable ADR 0040 boundary`);
    assert.match(content, /admitted (?:by|to) (?:each )?(?:bounded |a )?public\s+(?:adapter\s+)?observation/i, `${relativePath} must scope fidelity to admitted public facts`);
  }
  assert.match(externalWorkRecordManifest, /non-executing mechanical Work Record Repair Plan/);
  assert.doesNotMatch(externalWorkRecordManifest, /work-record-gate-(?:request|check)|work-record-repair-execute/);
  assert.match(targetDescriptorFixtureManifest, /legacy_mixed_handle_gap/);
  assert.match(recordingFrameFixtureManifest, /legacy_mixed_handle_and_gate_gap/);
  assert.match(interactionGrammarFixtureManifest, /legacy_mixed_handle_gap/);
  assert.match(targetDescriptorFixtureTest, /not authority for the public target-handle model/);
  assert.match(recordingFrameFixtureTest, /current pre-ADR-0040 mixed target and Gate-coupled/);
  assert.match(recordingFrameFixtureTest, /Gate an AOS permission or combine Observation Refs and Locators by contract/);
  assert.match(proofRegistry, /not the public target-handle contract/);
  assert.match(interactionGrammarNote, /## ADR 0040 Transition Boundary/);
  assert.match(interactionGrammarNote, /not the public\s+target-handle contract/);
  assert.match(recordingFrameNote, /## ADR 0040 Transition Boundary/);
  assert.match(recordingFrameNote, /Gate is not AOS permission/);
  assert.match(desktopWorldAuthoringSkill, /aggregate is the complete bounded public proof result/);
  assert.match(desktopWorldAuthoringSkill, /per-segment results and pixel reads stay outside it, not as ADR 0040 gaps/);
  assert.match(desktopWorldAuthoringSkill, /bounded snapshot carries its declared engine facts/);
  assert.match(desktopWorldAuthoringSkill, /label supports native accessibility and\s+inspection while the product-neutral gesture event carries the item ID/);
  assert.match(toolkitWorkbench, /does not ask for or retain Gate data/);
  assert.match(toolkitWorkbench, /Frozen V0 bytes are identified\s+as historical and unsupported/);
  assert.match(sceneDox, /This does\s+not widen the parent trust boundary/);
  assert.match(sceneDox, /desktop pixels remain private to the trusted projection realm/);
  assert.match(sceneDox, /That is the trusted-realm capability boundary, not an ADR 0040 raw-observation\s+gap/);
  assert.match(sceneDox, /all-segment barrier returns the complete bounded public aggregate/);
  assert.match(toolkitWorkbench, /exposes surface-local\s+inspection selectors/);
  assert.match(toolkitWorkbench, /not Observation Refs or Locators/);

  const grandUnificationPlan = await text('docs/design/aos-grand-unification-plan.md');
  const browserProjection = await text('docs/design/browser-capture-ladder-projection.md');
  const inputSignalProposal = await text('docs/design/aos-input-signal-subscription-proposal.md');
  const historicalSeeDoNote = await text('docs/design/see-do-grammar-trace-connections.md');
  const userSignalSurface = await text('docs/design/user-signal-surface.md');
  const gestureSpineNote = await text('docs/design/aos-shared-gesture-spine-v0.md');
  const desktopPlaywrightMap = await text('docs/design/aos-desktop-playwright-cli-map.md');
  const annotationConvergenceTracker = await text('docs/design/surface-annotation-intent-convergence-tracker.md');
  const installableSkillsAdr = await text('docs/adr/0018-installable-aos-skills.md');
  const sceneManifest = await text('manifests/commands/source/aos/39-scene.json');
  const sceneOverview = await text('docs/api/toolkit/scene.md');
  assert.match(grandUnificationPlan, /retired May 2026 implementation lineage; not the current roadmap/);
  assert.match(grandUnificationPlan, /former phase plan remains available in Git history/);
  assert.match(grandUnificationPlan, /Do not restore the retired phase plan/);
  assert.match(browserProjection, /## ADR 0040 Boundary/);
  assert.match(browserProjection, /Neither accepts Gate data, grants\s+permission, classifies risk, requires approval/);
  assert.match(inputSignalProposal, /Gate fields; those fields are ADR 0040\s+migration debt, not AOS permission/);
  assert.match(historicalSeeDoNote, /ADR 0040 transition update/);
  assert.match(historicalSeeDoNote, /legacy fixture\s+material, not durable Observation Ref identity/);
  assert.match(userSignalSurface, /current legacy persistence path redacts answer payloads and prompt bodies by default/);
  assert.match(userSignalSurface, /ADR 0040 migration gap, not the target policy/);
  assert.match(gestureSpineNote, /## ADR 0040 Transition Boundary/);
  assert.match(gestureSpineNote, /mixed descriptor is\s+migration evidence, not a durable Observation Ref/);
  assert.match(desktopPlaywrightMap, /## ADR 0040 Target Boundary/);
  assert.match(desktopPlaywrightMap, /Target\s+Handle Runtime V1 implements ADR 0040's split/);
  assert.match(desktopPlaywrightMap, /saved\s+addresses are storage indirection to one of those handles/);
  assert.doesNotMatch(desktopPlaywrightMap, /awaiting the ADR 0040 split/);
  assert.match(annotationConvergenceTracker, /ADR 0040 boundary/);
  assert.match(annotationConvergenceTracker, /it is not AOS\s+permission and is not a prerequisite for ordinary live capture or side effects/);
  assert.match(installableSkillsAdr, /current AOS browser observation handles\/proof/);
  assert.match(sceneManifest, /Emit the bounded execution result/);
  assert.match(sceneManifest, /Emit the bounded replay result/);
  assert.match(sceneOverview, /Product, arbitrary extension, undeclared engine, and private desktop-frame\s+content remain outside it/);
  assert.match(daemonIpc, /outside the\s+bounded lifecycle event envelope; their exclusion is not an ADR 0040 raw-output\s+gap/);
  assert.match(sceneEventSchema, /## ADR 0040 Transition Boundary/);
  assert.match(sceneEventSchema, /remain outside the product-neutral gesture contract/);
  assert.match(sceneEventSchema, /their exclusion is not\s+an ADR 0040 raw-output gap/);

  const actionsForSource = semanticTargetProbe.match(/const actionsFor = \(el\) => \{[\s\S]*?\n      \};/)?.[0] ?? '';
  assert.match(actionsForSource, /data-aos-actions/);
  assert.match(actionsForSource, /data-aos-primitive-actions/);
  assert.doesNotMatch(actionsForSource, /\baosAction\b/);
  assert.doesNotMatch(actionsForSource, /data-aos-action(?!s)/);
  assert.match(semanticTargetProbe, /const action = data\(el, 'aosAction'\) \|\| attr\(el, 'data-aos-action'\) \|\| ''/);
  assert.match(semanticTargetProbe, /action_id: action \|\| null/);

  const extensionModel = perceiveModels.match(/struct AOSSemanticTargetExtensionJSON:[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(extensionModel, /let dom_id: String\?/);
  assert.doesNotMatch(extensionModel, /action_id/);

  const shortcutReceipt = shortcutRuntime.match(/return \{\s+status: 'ok',[\s\S]*?\n    \};/)?.[0] ?? '';
  assert.match(shortcutReceipt, /stdout_bytes: stdoutBytes/);
  assert.match(shortcutReceipt, /stderr_bytes: stderrBytes/);
  assert.doesNotMatch(shortcutReceipt, /\bstdout:/);
  assert.doesNotMatch(shortcutReceipt, /\bstderr:/);
});

test('active Work Record and Step Descriptor sources contain no authority bridge or public executor', async () => {
  const workbenchFiles = (await filesBelow('packages/toolkit/workbench'))
    .filter((relativePath) => /\/(?:work-record[^/]*|(?:browser-)?step-descriptor[^/]*)\.js$/.test(relativePath));
  const activePaths = [...new Set([
    'shared/schemas/aos-work-record-v1.schema.json',
    'shared/schemas/aos-work-record-v1.md',
    'shared/schemas/aos-work-record-repair-plan-v1.schema.json',
    'shared/schemas/aos-work-record-repair-attempt-plan-v1.schema.json',
    'shared/schemas/aos-work-record-repair-attempt-artifact-v1.schema.json',
    'shared/schemas/aos-work-record-repair-v1.md',
    'shared/schemas/aos-step-descriptor-v1.schema.json',
    'shared/schemas/aos-step-descriptor-v1.md',
    ...await filesBelow('shared/schemas/fixtures/aos-work-record-v1'),
    ...await filesBelow('shared/schemas/fixtures/aos-step-descriptor-v1'),
    ...workbenchFiles,
    ...await filesBelow('packages/toolkit/components/work-record-workbench'),
    ...await filesBelow('packages/toolkit/components/step-descriptor-workbench'),
    'scripts/aos-work-record.mjs',
    'scripts/lib/work-record-command-families.mjs',
    'manifests/commands/source/aos/35-work-record.json',
    'manifests/commands/source/aos/36-work-record-supersession.json',
    'manifests/commands/source/aos/37-work-record-finalization.json',
    'manifests/commands/source/external/45-work-record.json',
    'skills/aos-work-records/SKILL.md',
  ])].sort();
  const forbidden = [
    /["']workflow_gates?["']\s*:/,
    /["']workflow_gate_authorizations?["']\s*:/,
    /["']gate_ref["']\s*:/,
    /["']authorizes_future_attempt["']\s*:/,
    /["']blocked_authorization(?:_[a-z_]+)?["']/,
    /["'](?:allowed_operations|operation_allowlist|allowlisted_operation_id)["']\s*:/,
    /controlled_repair_executor/,
    /controlled_fixture\.[a-z_]+/,
    /["']automatic_replay_allowed["']\s*:/,
    /work-record-gate-(?:request|check)/,
    /work-record-repair-execute/,
    /--(?:authorization|gate-record|resume-event)\b/,
    /workflow-gated/i,
  ];
  for (const relativePath of activePaths) {
    const content = await text(relativePath);
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${relativePath} retains active authority coupling`);
    }
  }

  const historicalWorkRecord = await text('shared/schemas/aos-work-record-v0.md');
  const historicalStepDescriptor = await text('shared/schemas/aos-step-descriptor-v0.md');
  assert.match(historicalWorkRecord, /workflow_gate_authorization/);
  assert.match(historicalStepDescriptor, /workflow_gates/);
  assert.match(await text('manifests/commands/source/aos/10-gate.json'), /--continuation-id/);

  for (const removedPath of [
    'packages/toolkit/workbench/work-record-workflow-gate.js',
    'packages/toolkit/workbench/work-record-controlled-repair-executor.js',
    'packages/toolkit/workbench/work-record-controlled-repair-fixtures.js',
    'scripts/work-record-fixture-operation.mjs',
  ]) {
    assert.equal(existsSync(path.join(repoRoot, removedPath)), false, `${removedPath} must remain deleted`);
  }

  for (const relativePath of [
    'manifests/commands/aos-commands.json',
    'manifests/commands/aos-external-commands.json',
  ]) {
    const generated = await text(relativePath);
    assert.doesNotMatch(generated, /work-record-gate-(?:request|check)|work-record-repair-execute/);
  }
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

test('retired project-agent dispatch files stay absent', () => {
  const retiredPaths = [
    'docs/design/aos-grand-unification-next-session-goal.md',
    'docs/design/notes/codex-goal-rebuild-pause-guard-plan-2026-05-24.md',
    'docs/design/workbench-subject-vnext-cutover-foreman-note.md',
  ];
  for (const relativePath of retiredPaths) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), false, `${relativePath} must stay retired`);
  }
});

test('active authority contains no retired Foreman or GDI role vocabulary', async () => {
  const patterns = [
    /\bforeman\b/i,
    /\bgdi\b/i,
  ];
  const violations = [];
  for (const relativePath of await activeAuthorityPaths()) {
    const content = await text(relativePath);
    for (const pattern of patterns) {
      if (pattern.test(content)) violations.push(`${relativePath}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], 'retired project-agent authority returned to an active source');
});

test('embedded Sigil cannot return as active AOS product authority', async () => {
  const retiredPaths = [
    'BROKE.md',
    'apps/sigil',
    'apps/sigil/aos-app.json',
    'experiences/sigil/aos-experience.json',
    'packages/host/src/sigil-bridge.ts',
    'packages/toolkit/workbench/sigil-subject.js',
    'recipes/sigil',
  ];
  for (const relativePath of retiredPaths) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), false, `${relativePath} must stay retired`);
  }

  const forbidden = [
    /aos:\/\/sigil(?:\/|\b)/i,
    /\baos\s+launch\s+sigil\b/i,
    /\baos\s+experience\b[^\n]*\bsigil\b/i,
    /\baos\s+recipe\b[^\n]*\bsigil\//i,
    /\bsigil\/start(?:-agent-terminal)?\b/i,
    /experiences\/sigil\/aos-experience\.json/i,
    /packages\/host\/src\/sigil-bridge\.ts/i,
    /packages\/toolkit\/workbench\/sigil-subject\.js/i,
    /recipes\/sigil\//i,
    /apps\/sigil\/(?:agent-terminal|avatar-controls|avatar-editor|chat|codex-terminal|diagnostics|radial-item-editor|radial-item-workbench|renderer|scripts|seed|tests|theme|workbench|world)\//i,
    /\bSigil (?:renderer|avatar|radial|status item|workbench)\b/i,
    /\bsigil\.(?:avatar|radial|agent)\b/i,
  ];
  const violations = [];
  const authorityPaths = await embeddedProductAuthorityPaths();
  assert.ok(
    authorityPaths.every(
      (relativePath) => !relativePath.startsWith('tests/fixtures/legacy-sigil/product/'),
    ),
    'frozen test payload must not be scanned as active product authority',
  );
  assert.ok(authorityPaths.includes('docs/design/notes/pre-release-canonical-naming-policy-2026-05-23.md'));
  assert.ok(authorityPaths.includes('memory/scratchpad/gateway-hardening-followups.md'));
  for (const relativePath of authorityPaths) {
    const content = await text(relativePath);
    for (const pattern of forbidden) {
      if (pattern.test(content)) violations.push(`${relativePath}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], 'embedded Sigil route returned to active docs, help, recipes, or packaging');

  const fallow = await text('.fallowrc.jsonc');
  assert.doesNotMatch(fallow, /apps\/sigil/i, 'frozen fixture must not be an active fallow entry or workspace');

  const toolkitGuidance = `${await text('packages/toolkit/AGENTS.md')}\n${await text('packages/toolkit/CLAUDE.md')}`;
  assert.match(toolkitGuidance, /external product consumers/i);
  assert.doesNotMatch(toolkitGuidance, /apps\/ \(Layer 3\)|between daemon primitives and apps/i);

  const nativeGuidance = `${await text('src/AGENTS.md')}\n${await text('src/daemon/AGENTS.md')}`;
  assert.match(nativeGuidance, /owning external product repository/i);
  assert.doesNotMatch(nativeGuidance, /Existing Sigil-specific input ownership logic|packages\/toolkit\/` or `apps\//i);
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const adrPath = 'docs/adr/0045-complete-ax-observation-notification-and-coordinate-contract.md';
const ledgerPath = 'docs/dev/aos-privileged-capability-ledger-v1.json';
const authorityPath = 'docs/dev/aos-sovereign-capability-authority-v1.json';

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function json(relativePath) {
  return JSON.parse(await read(relativePath));
}

function assertOrdered(body, markers) {
  let offset = -1;
  for (const marker of markers) {
    const next = body.indexOf(marker, offset + 1);
    assert.ok(next > offset, `missing or out-of-order marker: ${marker}`);
    offset = next;
  }
}

function assertNoContradictoryAuthorityClaims(body) {
  const forbidden = [
    /\bAOS display(?:-|\s)composite (?:is|acts as|becomes) an? (?:Apple )?AX platform root\b/iu,
    /\bScreenCaptureKit (?:exposes|provides|publishes) an? (?:public )?(?:stable )?(?:source |filter )?generation(?: token)?\b/iu,
    /\bM4 (?:owns|publishes|completes|provides|includes) (?:maintained )?(?:TypeScript(?: and|\/) Python )?SDK parity\b/iu,
    /\bObservation Ref (?:silently )?(?:re-resolves|reacquires) (?:the )?(?:target|current machine state)\b/iu,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(body, pattern);
}

test('ADR 0045 freezes the exact root and immutable snapshot/page taxonomy', async () => {
  const adr = await read(adrPath);
  assert.match(adr, /^# ADR 0045: Complete AX Observation, Notification, And Coordinate Contract$/mu);
  assert.match(adr, /^\*\*Status:\*\* Accepted$/mu);
  assertOrdered(adr, [
    '**Native system-wide root**',
    '**Native application root**',
    '**Exact window root**',
    '**Arbitrary native element root**',
    '**AOS display-composite root**',
  ]);
  assert.match(adr, /The AOS display composite is not an Apple AX platform root/u);
  assert.match(adr, /fresh immutable snapshot with a fresh\s+`state_id`/u);
  assert.match(adr, /Refs never cross a `state_id`/u);
  assert.match(adr, /Traversal bounds and response page size are separate facts/u);
  assert.match(adr, /opaque page token is a snapshot-bound cursor over already retained results/u);
  assert.match(adr, /cannot cross a snapshot, change filters or projection, expand the\s+traversal, or re-observe/u);
  assert.match(adr, /`complete`, `truncated`,\s+`unsupported`, or `unavailable`/u);
  for (const fact of ['visited nodes', 'matched nodes', 'emitted nodes', 'cycle edges', 'duplicate edges']) {
    assert.match(adr, new RegExp(fact, 'u'));
  }
});

test('raw values, filters, refs, and locators remain mechanically distinct', async () => {
  const adr = await read(adrPath);
  assert.match(adr, /Filtering does not prune traversal/u);
  assert.match(adr, /Visited, matched, emitted, and frontier\s+counts therefore remain independent/u);
  for (const outcome of [
    'value', 'no_value', 'unsupported', 'platform_error', 'deadline_exceeded',
    'recursion_bound', 'array_bound', 'unrepresentable_type',
  ]) assert.match(adr, new RegExp('`' + outcome + '`', 'u'));
  for (const value of [
    'signed_integer', 'unsigned_integer', 'floating_point', 'element_ref', 'array', 'dictionary',
  ]) assert.match(adr, new RegExp('`' + value + '`', 'u'));
  assert.match(adr, /Strings and other admitted content are never normalized or\s+silently truncated/u);
  assert.match(adr, /Parameterized-attribute names, ordinary attribute names, per-attribute\s+settable facts, and supported action names are four distinct projections/u);
  assert.match(adr, /Observation Ref.*exactly `\(state_id, ref\)`/su);
  assert.match(adr, /It is never silently\s+reacquired/u);
  assert.match(adr, /Locator.*re-resolves\s+at action time and must produce exactly one action-compatible target/su);
  assert.match(adr, /Zero and\s+multiple matches return typed missing and ambiguous outcomes/u);
});

test('focused authority guard rejects contradictory platform, SDK, and target claims', async () => {
  const adr = await read(adrPath);
  assertNoContradictoryAuthorityClaims(adr);
  for (const contradiction of [
    'The AOS display composite is an Apple AX platform root.',
    'ScreenCaptureKit exposes a public stable source generation token.',
    'M4 owns maintained TypeScript and Python SDK parity.',
    'An Observation Ref silently re-resolves the target.',
  ]) {
    assert.throws(() => assertNoContradictoryAuthorityClaims(`${adr}\n${contradiction}`));
  }
});

test('actions and per-PID subscriptions own operation-plane lifecycle and honest time', async () => {
  const adr = await read(adrPath);
  assert.match(adr, /accept exactly one target type: a current native AX\s+Observation Ref or a native AX Locator/u);
  assert.match(adr, /raw `perform_action` and\s+`set_attribute` mechanics/u);
  assert.match(adr, /Every admitted mutation enters ADR 0044's operation plane before native\s+authority/u);
  assert.match(adr, /Existing convenience actions may later delegate to this owner/u);
  assert.match(adr, /exact PID process generation/u);
  assert.match(adr, /monotonically increasing AOS callback sequence/u);
  assert.match(adr, /AOS monotonic callback-receipt timestamp/u);
  assert.match(adr, /`AXObserver` exposes no source-event timestamp/u);
  assert.match(adr, /never replays absent events, silently resurrects\s+an observer, or claims continuity/u);
  assert.match(adr, /zero-residual observer, run-loop-source, registration, queue, and claim\s+cleanup/u);
});

test('coordinate contract names exact spaces without fictional SCK identity or circular AX prerequisite', async () => {
  const [adr, ledger] = await Promise.all([read(adrPath), json(ledgerPath)]);
  for (const space of [
    'ax_global_points', 'target_local_points', 'display_backing_pixels',
    'composite_output_pixels', 'encoder_output_pixels',
  ]) assert.match(adr, new RegExp('`' + space + '`', 'u'));
  assert.match(adr, /ScreenCaptureKit exposes no public generation token or stable platform identity/u);
  assert.match(adr, /internal object-lifetime\s+custody identity/u);
  assert.match(adr, /must not publish a\s+fictional SCK generation or platform identity/u);
  assert.match(adr, /landed M3 recording-geometry core carried\s+through M3 closeout `53bcbd67`/u);
  assert.match(adr, /It is not complete AX re-observation/u);
  const m4 = ledger.program_milestones.find(({ id }) => id === 'M4');
  assert.deepEqual(
    m4.exit_gates.find(({ id }) => id === 'coordinate_identity_bound').prerequisite_gate_refs,
    ['M3.geometry_reobserved_and_bound'],
  );
  assert.match(
    m4.exit_gates.find(({ id }) => id === 'coordinate_identity_bound').criterion,
    /no fictional SCK generation or platform identity/iu,
  );
});

test('M4 ledger has actual owner families and requires production-attached behavioral proof', async () => {
  const [adr, ledger] = await Promise.all([read(adrPath), json(ledgerPath)]);
  const m4 = ledger.program_milestones.find(({ id }) => id === 'M4');
  assert.deepEqual(m4.deliverables.map(({ id }) => id), [
    'authority_contract',
    'observation_engine',
    'public_observation',
    'coordinate_binding',
    'ax_subscription_lifecycle',
    'raw_ax_actions',
    'integrated_closeout',
  ]);
  const ownerKinds = new Map(m4.path_refs.map(({ path: ownerPath, kind }) => [ownerPath, kind]));
  assert.equal(ownerKinds.get(adrPath), 'current');
  assert.equal(ownerKinds.get('src/perceive/'), 'current');
  assert.equal(ownerKinds.get('src/act/'), 'current');
  assert.equal(ownerKinds.get('manifests/commands/source/aos/43-ax-complete.json'), 'proposed');
  assert.equal(ownerKinds.get('manifests/commands/source/external/51-ax-complete.json'), 'proposed');
  assert.equal(ownerKinds.get('manifests/commands/aos-commands.json'), 'generated');
  assert.equal(ownerKinds.get('manifests/commands/aos-external-commands.json'), 'generated');
  for (const ownerPath of [
    'src/perceive/ax.swift',
    'src/perceive/capture-pipeline.swift',
    'src/perceive/daemon.swift',
    'src/act/actions.swift',
    'src/act/targeting.swift',
    'src/act/session.swift',
    'src/perceive/display-topology.swift',
    'src/perceive/spatial.swift',
    'src/perceive/models.swift',
  ]) {
    assert.match(adr, new RegExp(ownerPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    const stat = await fs.stat(path.join(repoRoot, ownerPath));
    assert.ok(stat.isFile(), ownerPath);
  }
  assert.deepEqual(m4.proof_paths.map(({ kind, execution_class: executionClass }) => [kind, executionClass]), [
    ['current', 'static'],
    ['proposed', 'fake'],
  ]);
  assert.ok(m4.exit_gates.filter(({ id }) => id !== 'authority_contract_frozen')
    .every(({ proof_ref_ids: refs }) => refs.includes('M4.proof.tests_ax_complete_surface_test_mjs')));
  assert.match(adr, /Behavioral acceptance must execute production owners or a production-attached\s+injected abstraction/u);
  assert.match(adr, /Static text\/schema proof alone cannot prove traversal/u);
});

test('authority map, milestone boundaries, and non-AX assignment agree with ADR 0045', async () => {
  const [authority, ledger, index, remodel] = await Promise.all([
    json(authorityPath),
    json(ledgerPath),
    read('docs/adr/README.md'),
    read('docs/dev/aos-sovereign-capability-remodel-ledger.md'),
  ]);
  assert.deepEqual(authority.authority.aos_adr_amendments, [
    'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
    adrPath,
  ]);
  const targetScope = authority.authority_scopes.find(({ id }) => id === 'target-authority');
  const activeScope = authority.authority_scopes.find(({ id }) => id === 'active-authority-default');
  assert.ok(targetScope.path_patterns.includes(adrPath));
  assert.ok(activeScope.exclude_patterns.includes(adrPath));
  const domain = authority.domains.find(({ id }) => id === 'complete-ax-surface');
  assert.ok(domain);
  assert.ok(domain.target_owners.includes(adrPath));
  for (const ownerPath of ['src/perceive/ax.swift', 'src/act/actions.swift', 'src/perceive/display-topology.swift']) {
    assert.ok(domain.current_owners.includes(ownerPath), ownerPath);
  }
  assert.match(index, /\[0045\].+Accepted.+native AX roots.+SCK identity limits/u);
  assert.match(remodel, /M4 completes native AX CLI\/IPC observation, raw actions, per-PID observer/u);
  assert.doesNotMatch(remodel, /M4 completes AX and input surfaces/u);
  const targets = new Map(ledger.capabilities.map(({ id, target }) => [id, target]));
  for (const id of ['ax-element-observation', 'ax-element-actions', 'axobserver-per-pid-notifications']) {
    assert.equal(targets.get(id).milestone, 'M4', id);
    assert.match(targets.get(id).exit_gate, /M5|M6/u, id);
  }
  assert.equal(targets.get('display-topology-observation').milestone, 'M4');
  for (const id of ['app-lifecycle-control', 'window-menu-lifecycle-control', 'coregraphics-input-posting']) {
    assert.equal(targets.get(id).milestone, 'M6', id);
  }
  const dependencies = ledger.program_milestones.find(({ id }) => id === 'M4').later_dependencies.join('\n');
  assert.match(dependencies, /M6 owns maintained TypeScript\/Python SDK parity/u);
  assert.match(dependencies, /M10 owns live native, TCC, packaging, and release acceptance/u);
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const schemaPath = path.join(
  repoRoot,
  'shared/schemas/aos-sovereign-capability-authority-v1.schema.json',
);
const mapPath = path.join(
  repoRoot,
  'docs/dev/aos-sovereign-capability-authority-v1.json',
);
const programId = 'aos-sovereign-capability-substrate-v1';
const bootstrapPaths = new Set([
  'docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md',
  'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
  'docs/dev/aos-sovereign-capability-authority-v1.json',
  'docs/dev/aos-sovereign-capability-remodel-ledger.md',
  'docs/dev/aos-privileged-capability-ledger-v1.json',
  'docs/design/aos-sovereign-first-vertical-slice-contract.md',
  'docs/dev/test-proof-registry.d/privileged-capability-ledger.json',
  'shared/schemas/aos-privileged-capability-ledger-v1.schema.json',
  'tests/schemas/aos-privileged-capability-ledger-v1.test.mjs',
  'docs/dev/test-proof-registry.d/sovereign-capability-authority.json',
  'shared/schemas/aos-sovereign-capability-authority-v1.schema.json',
  'tests/sovereign-capability-active-authority.test.mjs',
]);
const textExtensions = new Set([
  '', '.c', '.h', '.js', '.json', '.md', '.mjs', '.sh', '.swift', '.toml',
  '.ts', '.tsx', '.yaml', '.yml', '.zsh',
]);

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function json(relativePath) {
  return JSON.parse(await read(relativePath));
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
}

function gitBlobAt(revision, relativePath) {
  const result = spawnSync('git', ['show', `${revision}:${relativePath}`], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout?.toString() || ''}${result.stderr?.toString() || ''}`);
  return result.stdout;
}

const immutableBaselinePaths = [
  'docs/adr/0015-aos-tcc-capability-broker-boundary.md',
  'docs/adr/0018-installable-aos-skills.md',
  'docs/adr/0030-desktop-frame-texture-leases.md',
  'docs/adr/0031-desktop-pixel-broker-and-warm-snapshots.md',
  'docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md',
  'docs/adr/0041-managed-playwright-companion-runtime.md',
  'docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md',
  'shared/schemas/aos-external-command-manifest-v0.schema.json',
];

async function validateImmutableBaselineBodies(authority, bodyOverrides = new Map()) {
  const errors = [];
  for (const relativePath of immutableBaselinePaths) {
    const declaration = authority.historical_preservation.find(({ pattern }) => pattern === relativePath);
    const baseline = gitBlobAt(authority.baseline_revision, relativePath);
    const baselineDigest = crypto.createHash('sha256').update(baseline).digest('hex');
    const current = bodyOverrides.get(relativePath)
      || await fs.readFile(path.join(repoRoot, relativePath));
    if (!declaration || declaration.sha256 !== baselineDigest) {
      errors.push(`IMMUTABLE_DECLARED_HASH_BASELINE_MISMATCH:${relativePath}`);
    }
    if (!Buffer.from(current).equals(baseline)) {
      errors.push(`IMMUTABLE_BODY_BASELINE_MISMATCH:${relativePath}`);
    }
  }
  return errors;
}

function gitPathSet(args) {
  return new Set(runGit(['ls-files', '-z', ...args]).split('\0').filter(Boolean));
}

function schemaValidation() {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:20]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      mapPath,
    ],
    { encoding: 'utf8' },
  );
}

function assertUnique(items, key, label) {
  const values = items.map((item) => item[key]);
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function globRegExp(pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[\\^$.[\]{}()+|]/gu, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`, 'u');
}

function matchesPattern(relativePath, pattern) {
  return globRegExp(pattern).test(relativePath);
}

function matchingScopes(relativePath, scopes) {
  return scopes.filter((scope) => (
    scope.path_patterns.some((pattern) => matchesPattern(relativePath, pattern))
    && !scope.exclude_patterns.some((pattern) => matchesPattern(relativePath, pattern))
  ));
}

function normalized(value) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

async function assertMarkerEvidence(entry, scopes, baselineRevision) {
  const seen = new Set();
  for (const evidence of entry.evidence) {
    assert.equal(seen.has(evidence.path), false, `${entry.id} repeats ${evidence.path}`);
    seen.add(evidence.path);
    const evidenceScopes = matchingScopes(evidence.path, scopes);
    assert.equal(evidenceScopes.length, 1, `${evidence.path} must have one authority scope`);
    assert.equal(
      evidenceScopes[0].scan_for_stale_claims,
      true,
      `${entry.id} evidence is excluded from active/generated scan: ${evidence.path}`,
    );
    const baselinePath = evidence.baseline_path || evidence.path;
    const baselineScopes = matchingScopes(baselinePath, scopes);
    assert.equal(baselineScopes.length, 1, `${baselinePath} must have one authority scope`);
    assert.equal(
      baselineScopes[0].scan_for_stale_claims,
      true,
      `${entry.id} baseline evidence is excluded from active/generated scan: ${baselinePath}`,
    );
    const body = normalized(await read(evidence.path));
    const baselineBody = normalized(runGit(['show', `${baselineRevision}:${baselinePath}`]));
    for (const marker of evidence.required_markers) {
      assert.ok(
        body.includes(normalized(marker)),
        `${entry.id} path-specific marker drift at ${evidence.path}: ${marker}`,
      );
      assert.ok(
        baselineBody.includes(normalized(marker)),
        `${entry.id} marker is not baseline-revision evidence and may be a transition banner at ${evidence.path}: ${marker}`,
      );
    }
  }
}

function isTextPath(relativePath) {
  return textExtensions.has(path.extname(relativePath));
}

function pathCovered(paths, relativePath) {
  const prefix = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
  return paths.has(relativePath) || [...paths].some((candidate) => candidate.startsWith(prefix));
}

function patternCovered(paths, pattern) {
  const matcher = globRegExp(pattern);
  return [...paths].some((candidate) => matcher.test(candidate));
}

function collectLocalReferences(authority) {
  const references = new Set([
    authority.authority.aos_adr,
    ...authority.authority.aos_adr_amendments,
    authority.authority.aos_adr_index,
    authority.authority.authority_map,
    authority.authority.human_ledger,
    authority.verification.static_test,
    authority.verification.proof_registry,
    authority.verification.workflow_rules,
  ]);
  for (const item of authority.precedence) {
    for (const owner of item.owners) references.add(owner);
  }
  for (const domain of authority.domains) {
    for (const owner of [...domain.target_owners, ...domain.current_owners]) references.add(owner);
  }
  for (const generated of authority.generated_artifacts) {
    for (const owned of [
      ...generated.sources,
      ...generated.outputs,
      generated.generator,
      generated.drift_test,
    ]) references.add(owned);
  }
  for (const claim of authority.stale_claim_baseline) {
    for (const evidence of claim.evidence) {
      references.add(evidence.path);
      if (evidence.baseline_path) references.add(evidence.baseline_path);
    }
  }
  return references;
}

function currentOnlyProjection(
  ledger,
  excludedCapabilityIDs = new Set(),
  excludedSourceDispositionIDs = new Set(),
) {
  const sourceDispositionByCapability = Object.fromEntries(
    Object.entries(ledger.coverage.source_disposition_by_capability)
      .filter(([id]) => !excludedSourceDispositionIDs.has(id)),
  );
  return {
    m1_bootstrap_paths: ledger.m1_bootstrap_paths,
    platform_evidence_sources: ledger.platform_evidence_sources,
    coverage: {
      ...ledger.coverage,
      source_disposition_by_capability: sourceDispositionByCapability,
    },
    capabilities: ledger.capabilities
      .filter(({ id }) => !excludedCapabilityIDs.has(id))
      .map(({ id, current }) => ({ id, current })),
  };
}

test('authority topology is schema-valid, unique, local, and publication-honest', async () => {
  const result = schemaValidation();
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

  const authority = await json('docs/dev/aos-sovereign-capability-authority-v1.json');
  assert.equal(authority.program_id, programId);
  assert.equal(authority.status, 'milestone_2_executable_candidate_authority_and_current_truth');
  assert.equal(authority.baseline_revision, '7aada1cb4d7a046a2b99b1b24470115eefc82224');
  assert.equal(
    authority.authority.aos_adr,
    'docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md',
  );
  assert.deepEqual(authority.authority.aos_adr_amendments, [
    'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
  ]);
  assert.deepEqual(authority.authority.paired_sigil_authority, {
    repository: 'https://github.com/Ch-osctrl/sigil',
    path: 'docs/adr/0021-sigil-sovereign-workflow-composition.md',
    publication_state: 'landed',
    revision: '227382c1bcbdab56f551a85a69b0609eebbdfa0c',
  });
  assert.equal(authority.authority.cross_repo_activation, 'landed');
  assert.deepEqual(authority.verification.current_only_projection, {
    baseline_revision: '7aada1cb4d7a046a2b99b1b24470115eefc82224',
    source: 'docs/dev/aos-privileged-capability-ledger-v1.json',
    selectors: [
      'inventory_revision',
      'm1_bootstrap_paths',
      'platform_evidence_sources',
      'coverage',
      'capabilities[].id',
      'capabilities[].current',
    ],
    allowed_wording_exceptions: [],
    expected_inventory_revision: '59074238c2c4c43051c7461a6e36487e8914f4a6',
    allowed_capability_current_changes: [
      'global-input-event-observation',
      'microphone-capture-adapter',
      'native-status-item',
      'canvas-wkwebview',
    ],
  });
  const currentLedger = await json(authority.verification.current_only_projection.source);
  const baselineLedger = JSON.parse(runGit([
    'show',
    `${authority.verification.current_only_projection.baseline_revision}:${authority.verification.current_only_projection.source}`,
  ]));
  const changedCapabilityIDs = new Set(
    authority.verification.current_only_projection.allowed_capability_current_changes,
  );
  const m3aCapabilityCurrentChanges = new Set([
    'screencapturekit-screen-video',
    'avassetwriter-custom-multitrack',
  ]);
  const currentProjectionExceptions = new Set([
    ...changedCapabilityIDs,
    ...m3aCapabilityCurrentChanges,
  ]);
  assert.equal(
    currentLedger.inventory_revision,
    authority.verification.current_only_projection.expected_inventory_revision,
  );
  assert.deepEqual(
    currentOnlyProjection(currentLedger, currentProjectionExceptions, m3aCapabilityCurrentChanges),
    currentOnlyProjection(baselineLedger, currentProjectionExceptions, m3aCapabilityCurrentChanges),
    'M2 plus the explicit M3A overlay must preserve all other current capability truth',
  );
  const currentRows = new Map(currentLedger.capabilities.map((row) => [row.id, row.current]));
  const baselineRows = new Map(baselineLedger.capabilities.map((row) => [row.id, row.current]));
  for (const id of changedCapabilityIDs) {
    assert.notDeepEqual(currentRows.get(id), baselineRows.get(id), `${id} must carry executable M2 truth`);
  }
  for (const id of m3aCapabilityCurrentChanges) {
    assert.notDeepEqual(currentRows.get(id), baselineRows.get(id), `${id} must carry executable M3A truth`);
  }
  const screenVideo = currentRows.get('screencapturekit-screen-video');
  assert.equal(screenVideo.implementation.state, 'partial');
  assert.equal(screenVideo.exposure.cli.state, 'complete');
  assert.match(screenVideo.implementation.summary, /video producer.+H\.264 in QuickTime/iu);
  assert.match(screenVideo.observation.frontier, /system audio and microphone output are explicitly absent/iu);
  const assetWriter = currentRows.get('avassetwriter-custom-multitrack');
  assert.equal(assetWriter.implementation.state, 'partial');
  assert.deepEqual(assetWriter.observation.targets, ['one H.264 QuickTime video track']);
  assert.match(assetWriter.observation.breadth, /no audio input/iu);
  const writerDisposition = currentLedger.coverage
    .source_disposition_by_capability['avassetwriter-custom-multitrack'];
  assert.equal(writerDisposition.disposition, 'positive');
  assert.match(writerDisposition.boundary_claim, /video input is current; multitrack and audio inputs remain absent/iu);
  const inputEvent = currentRows.get('global-input-event-observation');
  const baselineInputEvent = baselineRows.get('global-input-event-observation');
  const inputListenBinding = inputEvent.exposure.cli.bindings.find(({ form_id: id }) => id === 'listen-hotkey');
  const baselineInputListenBinding = baselineInputEvent.exposure.cli.bindings
    .find(({ form_id: id }) => id === 'listen-hotkey');
  assert.deepEqual(inputListenBinding.route_selectors[0].argv_prefix, ['node', '--input-type=module', '-', 'listen']);
  assert.deepEqual(baselineInputListenBinding.route_selectors[0].argv_prefix, ['node', 'scripts/aos-tell-listen.mjs', 'listen']);
  const normalizedInputEvent = structuredClone(inputEvent);
  const normalizedBaselineInputEvent = structuredClone(baselineInputEvent);
  normalizedInputEvent.exposure.cli.bindings.find(({ form_id: id }) => id === 'listen-hotkey')
    .route_selectors[0].argv_prefix = ['registered-listen-route'];
  normalizedBaselineInputEvent.exposure.cli.bindings.find(({ form_id: id }) => id === 'listen-hotkey')
    .route_selectors[0].argv_prefix = ['registered-listen-route'];
  assert.deepEqual(
    normalizedInputEvent,
    normalizedBaselineInputEvent,
    'global-input-event-observation may change only the exact registered-listen route tuple',
  );
  const microphone = currentRows.get('microphone-capture-adapter');
  assert.match(microphone.implementation.summary, /shared operation registry/u);
  assert.equal(microphone.control.list.state, 'complete');
  assert.equal(microphone.control.bulk_owner_kill.state, 'complete');
  assert.equal(microphone.control.host_stop_all.state, 'complete');
  const statusItem = currentRows.get('native-status-item');
  assert.ok(statusItem.implementation.primitive_paths.includes('src/daemon/operation-status-item-projection.swift'));
  assert.equal(statusItem.control.host_stop_all.state, 'complete');
  const canvas = currentRows.get('canvas-wkwebview');
  assert.ok(canvas.implementation.primitive_paths.includes('src/daemon/operation-canvas-projection.swift'));
  assert.match(canvas.observation.completeness, /content-free M2\s+registered-operation projection/u);

  assertUnique(authority.precedence, 'scope', 'precedence scopes');
  assertUnique(authority.authority_scopes, 'id', 'authority-scope ids');
  assertUnique(authority.authority_scopes, 'classification', 'authority-scope classifications');
  assertUnique(authority.domains, 'id', 'domain ids');
  assertUnique(authority.generated_artifacts, 'id', 'generated-artifact ids');
  assertUnique(authority.stale_claim_baseline, 'id', 'stale-claim ids');
  assert.deepEqual(
    new Set(authority.authority_scopes.map(({ classification }) => classification)),
    new Set(['active', 'target', 'generated', 'preserved', 'historical', 'frozen']),
  );

  const domains = new Map(authority.domains.map((domain) => [domain.id, domain]));
  for (const claim of authority.stale_claim_baseline) {
    assert.ok(domains.has(claim.domain), `${claim.id} has an unknown domain FK`);
    assert.equal(
      claim.disposition,
      domains.get(claim.domain).disposition,
      `${claim.id} disposition must match its domain`,
    );
  }
  const operationControl = domains.get('operation-control-plane');
  assert.ok(operationControl);
  assert.equal(operationControl.implementation_state, 'partial');
  assert.match(operationControl.exit_gate, /executable M2 candidate/u);
  assert.match(operationControl.exit_gate, /immediate socket peer audit token\/PID generation/u);
  assert.match(operationControl.exit_gate, /double-sampled proc-generation ancestry/u);
  assert.match(operationControl.exit_gate, /same-UID host barrier/u);
  assert.match(operationControl.exit_gate, /split claim-set\/resource\/broker lifecycles/u);
  assert.match(operationControl.exit_gate, /token parent-only/u);
  assert.match(operationControl.exit_gate, /trusted Node\.js Foundation signed image/u);
  assert.match(operationControl.exit_gate, /in-memory module bundle after admission/u);
  assert.match(operationControl.exit_gate, /finalizes tokenlessly/u);
  assert.match(operationControl.exit_gate, /terminalizes abandoned, expired, boot-recovered, or failed prepared claims/u);
  assert.match(operationControl.exit_gate, /asserted lineage continues only to narrow/u);
  assert.match(operationControl.exit_gate, /public SDK projections.*later milestones/u);
  assert.ok(operationControl.current_owners.includes('docs/api/aos-capabilities.md'));
  assert.ok(operationControl.current_owners.includes('tests/native-operation-control-contract.sh'));

  const tracked = gitPathSet([]);
  const repositoryCandidates = new Set([
    ...tracked,
    ...gitPathSet(['--others', '--exclude-standard']),
  ]);
  for (const relativePath of collectLocalReferences(authority)) {
    assert.equal(path.isAbsolute(relativePath), false, relativePath);
    assert.equal(relativePath.split('/').includes('..'), false, relativePath);
    assert.ok(
      pathCovered(tracked, relativePath)
        || (bootstrapPaths.has(relativePath) && pathCovered(repositoryCandidates, relativePath)),
      `local owner/source/output/generator/proof is neither tracked nor an exact authority-packet bootstrap path: ${relativePath}`,
    );
  }
  for (const scope of authority.authority_scopes) {
    for (const pattern of scope.path_patterns) {
      assert.ok(
        patternCovered(repositoryCandidates, pattern),
        `authority scope pattern resolves no repository path: ${pattern}`,
      );
    }
  }
  const scanContract = authority.verification.forbidden_authority_field_scan;
  assert.deepEqual(scanContract.token_components, ['human', 'initiated']);
  const forbiddenIntentAuthority = scanContract.token_components.join('_');
  const rejectionEvidence = new Map(
    scanContract.allowed_rejection_evidence.map((entry) => [entry.path, entry.required_marker]),
  );
  const scanPaths = new Set();
  for (const relativePath of tracked) {
    const scopes = matchingScopes(relativePath, authority.authority_scopes);
    assert.equal(scopes.length, 1, `${relativePath} must resolve exactly one authority scope`);
    if (scanContract.classifications.includes(scopes[0].classification)) scanPaths.add(relativePath);
  }
  for (const relativePath of scanPaths) {
    const entry = await fs.lstat(path.join(repoRoot, relativePath));
    if (!entry.isFile() || !isTextPath(relativePath)) continue;
    const body = normalized(await read(relativePath));
    if (!body.includes(forbiddenIntentAuthority)) continue;
    const requiredMarker = rejectionEvidence.get(relativePath);
    assert.ok(requiredMarker, `unclassified human-intent authority field at ${relativePath}`);
    assert.ok(
      body.includes(normalized(requiredMarker)),
      `human-intent field is not mechanically bound to rejection evidence at ${relativePath}`,
    );
    rejectionEvidence.delete(relativePath);
  }
  assert.deepEqual([...rejectionEvidence.keys()], [], 'declared rejection evidence must contain the forbidden field');
});

test('ADR status and target semantics cover capture history, raw upstream grammar, and accepted M2 control mechanics', async () => {
  const index = await read('docs/adr/README.md');
  for (const number of ['0030', '0031', '0041']) {
    assert.match(index, new RegExp(`\\[${number}\\].*Accepted, partially superseded`, 'u'));
  }
  assert.match(index, /\[0030\].*ADR 0043 supersedes its AOS-local process-lifetime direct-capture consent\/prime gate/u);
  assert.match(index, /\[0031\].*ADR 0043 supersedes its explicit direct-capture consent\/prime clauses/u);
  assert.match(index, /\[0041\].*ADR 0043 supersedes its fixed public-operation allowlist/u);
  assert.match(index, /\[0043\].*Accepted, amended.*sovereign capability substrate target/u);
  assert.match(index, /\[0044\].*Accepted.*immediate socket-peer audit identity.*proc-generation-verified non-AOS ancestry.*registered-set host receipts.*bounded retained replay.*split claim-set\/resource\/broker mechanics/u);

  const adr = await read(
    'docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md',
  );
  assert.match(adr, /\*\*Partially supersedes:\*\* ADR 0030.*ADR 0031.*ADR 0041/su);
  assert.match(adr, /passes raw\s+argv, stdin, stdout, stderr, and artifact transport/u);
  assert.match(adr, /no\s+semantic command allowlist or per-upstream-operation manifest or schema wrapper/u);
  for (const inherited of [
    'snapshots', 'boxes', 'evaluation', 'tracing', 'video', 'network', 'storage',
    'PDF', 'tabs', 'input', 'navigation', 'lifecycle',
  ]) assert.ok(adr.includes(inherited), `ADR 0043 missing inherited grammar family: ${inherited}`);

  for (const control of [
    'list, inspect, status, and recent content-free history',
    'cancel or kill one exact operation',
    'emergency stop-all',
    'terminal outcome, blame, and cleanup',
    'reveal, remove, release, or explicitly retain',
    'optional explicit data tap',
    'one-shot terminal history',
  ]) assert.ok(adr.includes(control), `ADR 0043 missing control-plane contract: ${control}`);
  assert.match(adr, /caller-asserted Sigil lineage.*are attribution, not ownership facts/su);
  assert.match(adr, /never\s+authorization or kill-scope authority/u);
  assert.match(adr, /controllable set established by\s+the mechanically authenticated peer or owner/u);
  assert.match(adr, /caller-asserted client, agent, task, project, and capability values may only\s+filter within that mechanically established set/u);
  assert.match(adr, /never add operations or expand control/u);
  assert.match(adr, /mechanically\s+bound scope may establish the stronger owner boundary/u);
  assert.match(adr, /host-wide emergency stop-all is a separate mechanically authenticated\s+host-operator control/u);
  assert.match(adr, /ordinary peer ownership/u);
  assert.match(adr, /AOS owns the neutral active-operation and recording projection through the\s+status item/u);
  assert.match(adr, /Sigil owns product labels and action policy/u);
  assert.match(
    adr,
    /does not claim that the Sigil ADR or cross-repo\s+activation has already landed/u,
    'the preserved ADR body records its decision-time publication boundary; the authority map owns current landing state',
  );

  const amendment = await read(
    'docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md',
  );
  assert.match(amendment, /LOCAL_PEERTOKEN.+audit token.+PID generation/isu);
  assert.match(amendment, /Audit\s+tokens are available for that immediate socket peer only/iu);
  assert.match(amendment, /double-sampled `proc_bsdinfo` start time/iu);
  assert.match(amendment, /does not require or fabricate an ancestor audit token/iu);
  assert.match(amendment, /nearest mechanically verified non-AOS\s+ancestor/iu);
  assert.match(amendment, /selects the conservative\s+immediate mechanical boundary or rejects.+never skips uncertainty/isu);
  assert.match(amendment, /AOS_EXTERNAL_DISPATCH_PARENT_PID.+remains forbidden as authority/isu);
  assert.match(amendment, /Dynamic validity.+platform CDHash.+device, and inode.+admission fails closed/isu);
  assert.match(amendment, /normalized repo-\s*relative authored identity remains transient resolver input only/isu);
  assert.match(amendment, /Caller-asserted client, agent,\s+project, task, run, skill,\s+target, or capability labels are attribution/isu);
  assert.match(amendment, /public same-effective-UID local scope.+predicate is re-evaluated per\s+request/isu);
  assert.match(amendment, /M2 host operations cover the complete registered operation-plane set.+exact adapter-registry revision/isu);
  assert.match(amendment, /M2 registers the microphone adapter.+does not claim control.+unadapted legacy/isu);
  assert.match(amendment, /Expected daemon\s+generation, connection epoch, caller origin, and caller evidence are attached\s+by the server/isu);
  assert.match(amendment, /4,096 terminal\s+receipts or 86,400 seconds/iu);
  assert.match(amendment, /canonical replay guarantee ends when a receipt is pruned/iu);
  assert.match(amendment, /evicted id is a\s+new request.+expected barrier generation/isu);
  assert.doesNotMatch(amendment, /replay_expired/u);
  assert.match(amendment, /status-opened Canvas.+stop-all only/isu);
  assert.match(amendment, /currently live captured peer.+display-only/isu);
  assert.match(amendment, /CLI and direct daemon IPC actions always authenticate the current live transport\s+peer/iu);
  assert.doesNotMatch(amendment, /CLI and ordinary Canvas.+captured peer/isu);
  assert.match(amendment, /canonical resource key.+reserves\s+all claims.+Conflict.+retains none/isu);
  assert.match(amendment, /no implicit queue, priority, fairness, stealing,\s+last-writer-wins, or preemption/iu);
  assert.match(amendment, /same mechanically derived owner does not bypass exclusivity/iu);
  assert.match(amendment, /claim-set transaction.+per-operation\/per-resource claim.+multiplex broker/isu);
  assert.match(amendment, /rollback_pending.+commit_pending_handoff/isu);
  assert.match(amendment, /Verified rollback terminates `rejected`.+verified complete\s+commit handoff terminates `succeeded`/isu);
  assert.match(amendment, /Release or retention can never be\s+collapsed into removal/iu);
  assert.match(amendment, /registers only `microphone-capture-adapter`.+legacy reservation sentinels/isu);
  assert.match(amendment, /outputToCancel\?\.cancel\(reason: "barge_in"\).+retired/isu);
  assert.match(amendment, /stale cleanup cannot mutate a\s+successor/isu);
  assert.match(amendment, /Operation, stream, tap, artifact, claim-set transaction, per-resource claim,\s+multiplex broker, host barrier, and recovery expose explicit prior-generation/isu);
  assert.match(amendment, /operation kill-owner/iu);
  assert.match(amendment, /operation tap/iu);
  assert.match(amendment, /metadata-or-data channel, rate, sampling stride, queue size,\s+item count, byte count, idle timeout, duration/iu);
  assert.match(amendment, /operation artifact reveal\|remove\|release\|retain/iu);
  assert.match(amendment, /stop-all --barrier-generation <n>/u);
  assert.match(amendment, /docs\/api\/aos-capabilities\.md/u);
  assert.match(amendment, /41-operation\.json/u);
  assert.match(amendment, /49-operation\.json/u);
});

test('path-specific current-only evidence cannot be satisfied by transition banners', async () => {
  const authority = await json('docs/dev/aos-sovereign-capability-authority-v1.json');
  const baseline = new Map(
    authority.stale_claim_baseline.map((entry) => [entry.id, entry]),
  );
  assert.deepEqual(
    [...baseline.keys()].sort(),
    [
      'browser-fixed-grammar',
      'narrow-status-item-without-operation-control',
      'native-capture-local-consent-gate',
    ],
  );

  for (const entry of baseline.values()) {
    await assertMarkerEvidence(entry, authority.authority_scopes, authority.baseline_revision);
  }

  const browserPaths = new Set(baseline.get('browser-fixed-grammar').evidence.map(({ path: value }) => value));
  for (const required of [
    'shared/schemas/aos-semantic-targets.md',
    'docs/design/aos-desktop-playwright-cli-map.md',
    'tests/browser/managed-session-lifecycle.test.mjs',
    'tests/browser/managed-session-consumers.test.mjs',
    'docs/dev/test-proof-registry.d/browser-companion.json',
  ]) assert.ok(browserPaths.has(required), `browser baseline missing ${required}`);

  const maintainedDesignScopes = matchingScopes(
    'docs/design/aos-desktop-playwright-cli-map.md',
    authority.authority_scopes,
  );
  assert.equal(maintainedDesignScopes.length, 1);
  const [maintainedDesignScope] = maintainedDesignScopes;
  assert.equal(maintainedDesignScope.classification, 'active');
  assert.equal(maintainedDesignScope.scan_for_stale_claims, true);

  const consentPaths = new Set(baseline.get('native-capture-local-consent-gate').evidence.map(({ path: value }) => value));
  for (const required of [
    'tests/desktop-frame-texture-native.test.mjs',
    'tests/toolkit/desktop-frame-texture-source.test.mjs',
    'tests/aos-permissions-microphone-authority.test.mjs',
    'docs/dev/test-proof-registry.d/native-capture.json',
  ]) assert.ok(consentPaths.has(required), `native-consent baseline missing ${required}`);
  for (const preservedAdr of [
    'docs/adr/0030-desktop-frame-texture-leases.md',
    'docs/adr/0031-desktop-pixel-broker-and-warm-snapshots.md',
  ]) {
    assert.equal(consentPaths.has(preservedAdr), false, `${preservedAdr} must not be active stale evidence`);
  }
});

test('git-tracked active and generated authority has no unclassified doctrine match', async () => {
  const authority = await json('docs/dev/aos-sovereign-capability-authority-v1.json');
  const tracked = gitPathSet([]);
  const scanned = [];
  for (const relativePath of tracked) {
    const scopes = matchingScopes(relativePath, authority.authority_scopes);
    assert.equal(scopes.length, 1, `${relativePath} must resolve exactly one authority scope`);
    const entry = await fs.lstat(path.join(repoRoot, relativePath));
    if (
      entry.isFile()
      && scopes[0].scan_for_stale_claims
      && isTextPath(relativePath)
    ) scanned.push(relativePath);
  }

  for (const claim of authority.stale_claim_baseline) {
    const classified = new Set(claim.evidence.map(({ path: value }) => value));
    const markers = claim.doctrine_markers.map(normalized);
    for (const relativePath of scanned) {
      const body = normalized(await read(relativePath));
      const matched = markers.filter((marker) => body.includes(marker));
      assert.ok(
        matched.length === 0 || classified.has(relativePath),
        `${claim.id} doctrine escaped its path-specific baseline at ${relativePath}: ${matched.join(', ')}`,
      );
    }
  }
});

test('generated ownership, proof wording, routing, and preservation remain exact', async () => {
  const authority = await json('docs/dev/aos-sovereign-capability-authority-v1.json');
  const generated = authority.generated_artifacts.find(
    ({ id }) => id === 'command-manifests-and-help',
  );
  assert.ok(generated);
  assert.deepEqual(generated.outputs, [
    'manifests/commands/aos-commands.json',
    'manifests/commands/aos-external-commands.json',
  ]);
  assert.equal(generated.generator, 'scripts/generate-command-manifests.mjs');
  assert.equal(generated.drift_test, 'tests/command-manifest-generation.sh');
  assert.equal(generated.milestone_0_mutation, false);

  const proof = await json('docs/dev/test-proof-registry.d/sovereign-capability-authority.json');
  const proofEntry = proof.entries.find(({ id }) => id === 'sovereign-capability-active-authority-proof');
  assert.ok(proofEntry);
  assert.match(proofEntry.contract, /path-specific required markers/u);
  assert.match(proofEntry.contract, /git-tracked active and generated authority/u);
  assert.match(proofEntry.contract, /including maintained design docs/u);
  assert.match(proofEntry.contract, /immediate socket-peer audit-token\/PID-generation evidence/u);
  assert.match(proofEntry.contract, /nearest mechanically verified non-AOS ancestry using proc-generation, UID, stable-edge, and code-identity evidence/u);
  assert.match(
    proofEntry.contract,
    /parent-only intent, dynamic trusted signed-Node child admission.+tokenless peer finalization/isu,
  );
  assert.match(proofEntry.contract, /live per-request same-effective-UID host control over the exact registered operation-plane set/u);
  assert.match(proofEntry.contract, /daemon\/status-host break-glass/u);
  assert.match(proofEntry.contract, /M2 daemon IPC, CLI, internal status, and internal Canvas projections with public SDKs deferred to M6/u);
  assert.match(proofEntry.contract, /split all-or-nothing claim-set admission/u);
  assert.match(proofEntry.contract, /generation-independent retained receipt replay/u);
  assert.match(proofEntry.contract, /expected-barrier CAS/u);
  assert.match(proofEntry.contract, /actual bytes and declared hashes for ADRs.+and 0043/isu);
  assert.match(proofEntry.contract, /frozen external-command manifest v0 schema/u);
  assert.match(proofEntry.contract, /explicit prior-generation recovery across nine target machines/u);
  assert.match(
    proofEntry.contract,
    /exact baseline equality for every unaffected capability-current row.+global-input-event-observation listen-route, microphone, native-status-item, and Canvas Milestone 2 burn-down/isu,
  );
  assert.match(proofEntry.contract, /preserved, historical, and frozen exclusions/u);

  const registry = await json('docs/dev/test-proof-registry.json');
  assert.ok(registry.fragments.includes('test-proof-registry.d/sovereign-capability-authority.json'));
  const workflow = await json('docs/dev/workflow-rules.json');
  const route = workflow.rules.find(({ id }) => id === 'sovereign-capability-authority');
  assert.ok(route);
  assert.deepEqual(route.commands.map(({ command }) => command), [
    'node --test tests/sovereign-capability-active-authority.test.mjs',
  ]);
  assert.match(route.commands[0].reason, /path-specific current evidence with explicit baseline path for migrated proofs/u);
  assert.match(route.commands[0].reason, /git-tracked active-authority stale scan/u);
  assert.match(route.commands[0].reason, /rejection of a human-intent host-control class/u);
  assert.equal(route.tcc_identity_sensitive, false);

  for (const item of authority.historical_preservation.filter(({ sha256 }) => sha256 !== null)) {
    const digest = crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, item.pattern))).digest('hex');
    assert.equal(digest, item.sha256, `${item.pattern} preserved bytes changed`);
  }
  assert.deepEqual(await validateImmutableBaselineBodies(authority), []);
  for (const preservedPath of immutableBaselinePaths) {
    assert.ok(
      authority.historical_preservation.some((item) => (
        item.pattern === preservedPath
        && ['preserved', 'frozen'].includes(item.classification)
        && typeof item.sha256 === 'string'
      )),
      `missing exact baseline-byte preservation: ${preservedPath}`,
    );
  }
  for (const driftPath of [
    'docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md',
    'shared/schemas/aos-external-command-manifest-v0.schema.json',
  ]) {
    const coordinatedDrift = structuredClone(authority);
    const driftBody = Buffer.concat([
      gitBlobAt(authority.baseline_revision, driftPath),
      Buffer.from('\ncoordinated-body-and-hash-drift\n'),
    ]);
    coordinatedDrift.historical_preservation.find(({ pattern }) => pattern === driftPath).sha256 = crypto
      .createHash('sha256')
      .update(driftBody)
      .digest('hex');
    const coordinatedErrors = await validateImmutableBaselineBodies(
      coordinatedDrift,
      new Map([[driftPath, driftBody]]),
    );
    assert.ok(coordinatedErrors.includes(`IMMUTABLE_DECLARED_HASH_BASELINE_MISMATCH:${driftPath}`));
    assert.ok(coordinatedErrors.includes(`IMMUTABLE_BODY_BASELINE_MISMATCH:${driftPath}`));
  }
  for (const pattern of [
    'docs/archive/**',
    'docs/dev/reports/**',
    'docs/design/2026-05-07-architecture-deepening-audit-triage.md',
    'docs/design/2026-05-17-platform-debt-map.md',
    'docs/design/agent-relay-readiness-narrative-ledger-2026-06-04.md',
    'docs/design/aos-grand-unification-plan.md',
    'docs/design/aos-surface-stack-v0-checkpoint-hygiene-report.md',
    'docs/design/see-do-grammar-trace-connections.md',
    'docs/design/fixtures/**',
    'docs/proposals/**',
    'shared/schemas/fixtures/**',
    'tests/fixtures/**',
  ]) {
    assert.ok(
      authority.historical_preservation.some((item) => item.pattern === pattern),
      `missing excluded preservation scope: ${pattern}`,
    );
  }
  assert.equal(
    authority.historical_preservation.some((item) => item.pattern === 'docs/design/**'),
    false,
    'maintained design authority must not have a blanket historical exclusion',
  );
  for (const historicalDesignPath of [
    'docs/design/2026-05-07-architecture-deepening-audit-triage.md',
    'docs/design/2026-05-17-platform-debt-map.md',
    'docs/design/agent-relay-readiness-narrative-ledger-2026-06-04.md',
    'docs/design/aos-grand-unification-plan.md',
    'docs/design/aos-surface-stack-v0-checkpoint-hygiene-report.md',
    'docs/design/see-do-grammar-trace-connections.md',
  ]) {
    const scopes = matchingScopes(historicalDesignPath, authority.authority_scopes);
    assert.equal(scopes.length, 1, `${historicalDesignPath} must have one scope`);
    assert.equal(scopes[0].classification, 'historical');
    assert.equal(scopes[0].scan_for_stale_claims, false);
  }
  const fixtureScopes = matchingScopes(
    'docs/design/fixtures/aos-interaction-grammar-v0/manifest.json',
    authority.authority_scopes,
  );
  assert.equal(fixtureScopes.length, 1);
  assert.equal(fixtureScopes[0].classification, 'frozen');
  assert.equal(fixtureScopes[0].scan_for_stale_claims, false);
});

test('completed AOS-first paired publication is distinct from runtime implementation', async () => {
  const ledger = await read('docs/dev/aos-sovereign-capability-remodel-ledger.md');
  assert.match(ledger, /AOS authority-only packet landed first/u);
  assert.match(ledger, /exact landed AOS SHA/u);
  assert.match(ledger, /verifiedRef.*sourceRevision/su);
  assert.match(ledger, /advanced\s+atomically.*before\s+Sigil\s+authority\s+publication/su);
  assert.match(ledger, /227382c1bcbdab56f551a85a69b0609eebbdfa0c/u);
  assert.match(
    ledger,
    /Current source,\s+command-source manifests, generated help, schemas, API docs, tests, and runtime\s+readback are the executable contract/u,
  );

  const contextMap = await read('CONTEXT-MAP.md');
  assert.match(contextMap, /publication_state.*landed/su);
  assert.match(contextMap, /AOS\s+authority-only\s+packet\s+landed\s+first/u);
  assert.match(contextMap, /exact landed AOS SHA/u);
  assert.match(contextMap, /227382c1bcbdab56f551a85a69b0609eebbdfa0c/u);
});

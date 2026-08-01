import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const commandSource = read('src/commands/desktop-pixel-native-baseline.swift');
const captureSource = read('src/commands/desktop-pixel-native-baseline-capture.swift');
const hostSource = read('src/commands/desktop-pixel-native-baseline-host.swift');
const metalSource = read('src/commands/desktop-pixel-native-baseline-metal.swift');
const projectionLifecycleSource = read('src/display/desktop-world-native-projection-lifecycle.swift');
const projectionSource = read('src/display/desktop-world-native-projection.swift');
const effectRendererSource = read('src/display/desktop-world-native-effect-renderer.swift');
const geometrySource = read('src/display/desktop-world-native-sheet-geometry.swift');
const leaseSource = read('src/display/desktop-world-native-sheet-lease.swift');
const sheetSource = read('src/display/desktop-world-native-sheet.swift');
const displayGeometrySource = read('src/shared/desktop-world-display-geometry.swift');
const identitySource = read('src/shared/desktop-world-resource-identity.swift');
const sampleAdmissionSource = read('src/shared/desktop-pixel-sample-admission.swift');
const nativeOperationSource = read('src/daemon/desktop-pixel-native-operation.swift');
const streamLifecycleSource = read('src/daemon/desktop-pixel-stream-lifecycle.swift');
const surfaceSource = read('src/display/desktop-world-surface.swift');
const nativeSources = [
  commandSource,
  captureSource,
  hostSource,
  metalSource,
  projectionLifecycleSource,
  projectionSource,
  geometrySource,
  leaseSource,
  sheetSource,
  displayGeometrySource,
  identitySource,
].join('\n');

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('condition did not converge before timeout');
}

test('native baseline is an explicit foreground AOS primitive', () => {
  const main = read('src/main.swift');
  assert.match(main, /case "__desktop-pixel-native-baseline":\s+runDesktopPixelNativeBaselineCommand/);
  assert.match(commandSource, /CGPreflightScreenCaptureAccess\(\)/);
  assert.doesNotMatch(nativeSources, /CGRequestScreenCaptureAccess|requestAccess|SCScreenshotManager/);
  assert.match(commandSource, /daemonUsed = false/);
  assert.match(commandSource, /brokerUsed = false/);
  assert.match(commandSource, /sceneProtocolUsed = false/);
  assert.match(commandSource, /environment\["AOS_ENABLE_DEVELOPMENT_PROBES"\] == "1"/);
  assert.match(commandSource, /"DEVELOPMENT_PROBE_DISABLED"/);
});

test('native baseline retains the proven warm ScreenCaptureKit shape', () => {
  assert.match(captureSource, /SCShareableContent\.excludingDesktopWindows\(\s*false,\s*onScreenWindowsOnly: false/);
  assert.match(captureSource, /configuration\.queueDepth = Self\.queueDepth/);
  assert.match(captureSource, /static let queueDepth = 3/);
  assert.match(captureSource, /configuration\.capturesAudio = false/);
  assert.match(captureSource, /configuration\.minimumFrameInterval = CMTime\(value: 1, timescale: 30\)/);
  assert.match(captureSource, /aosDesktopPixelSampleAdmission\(/);
  assert.match(captureSource, /frameAdvancement\.observe\(presentationTime: presentationTime\)/);
  assert.match(captureSource, /frameAdvancement\.isReady/);
  assert.match(sampleAdmissionSource, /requiredDistinctFrames: UInt64 = 2/);
  assert.match(captureSource, /aosStartDesktopPixelStreams\(/);
  assert.match(captureSource, /lateFailure: \{ error in failureState\.record\(error\) \}/);
  assert.match(captureSource, /aosRecordDesktopPixelNativeBaselineStartSettlement\(\s*result,\s*failureState: failureState/);
  assert.match(captureSource, /func runtimeFailure\(\) -> AOSDesktopPixelNativeBaselineFailure\?/);
  assert.match(commandSource, /let captureFailure = capture\.runtimeFailure\(\)/);
  assert.match(commandSource, /if var success, cleanupComplete, captureFailure == nil/);
  assert.match(captureSource, /entry\.stream\.startCapture\(completionHandler: \$0\)/);
  assert.match(captureSource, /entry\.stream\.stopCapture\(completionHandler: \$0\)/);
  assert.match(captureSource, /aosDesktopPixelCaptureFilter\(/);
  assert.match(captureSource, /try entry\.stream\.removeStreamOutput\(entry\.output, type: \.screen\)/);
  assert.match(captureSource, /entry\.sampleQueue\.sync \{\}/);
  assert.match(nativeOperationSource, /final class AOSDesktopPixelRetainedNativeOperation/);
  assert.doesNotMatch(nativeSources, /AOSDesktopPixelBroker|AOSDesktopFrameCaptureConsent|AOSDesktopFrameWarmPool/);
});

test('native baseline presents in-memory pixel buffers directly through Metal', () => {
  assert.match(metalSource, /CVMetalTextureCacheCreateTextureFromImage/);
  assert.match(metalSource, /retainedPixelBuffer = frame\.pixelBuffer/);
  assert.match(metalSource, /window\.ignoresMouseEvents = true/);
  assert.match(metalSource, /window\.collectionBehavior = behavior/);
  assert.match(hostSource, /let screens = NSScreen\.screens/);
  assert.match(hostSource, /return try AOSDesktopPixelNativeBaselineStandaloneHost/);
  assert.match(hostSource, /return try AOSDesktopPixelNativeBaselineDesktopWorldHost/);
  assert.doesNotMatch(nativeSources, /green|mirror|encoded|base64/i);
});

test('DesktopWorld host reuses the canonical segmented surface and existing windows', () => {
  const desktopHost = hostSource.slice(
    hostSource.indexOf('final class AOSDesktopPixelNativeBaselineDesktopWorldHost'),
    hostSource.indexOf('func makeAOSDesktopPixelNativeBaselineHost'),
  );
  assert.match(hostSource, /let canvas = DesktopWorldSurfaceCanvas\(/);
  assert.match(hostSource, /coordinator\.issueGeneration\(for: canvas\)/);
  assert.match(hostSource, /canvas\.prepareNativeProjectionHosts\(device: device\)/);
  assert.match(hostSource, /canvas\.installNativeSheet\(device: device\)/);
  assert.match(sheetSource, /segment\.preparedNativeProjectionHost\(device: device\)/);
  assert.match(hostSource, /canvas\.show\(\)/);
  assert.doesNotMatch(desktopHost, /NSScreen\.screens|NSWindow\(/);
  assert.match(surfaceSource, /let nativeProjectionHostSlot =\s*DesktopWorldNativeProjectionHostSlot<DesktopWorldNativeProjectionHost>\(\)/);
  assert.match(surfaceSource, /var nativeProjectionHost: DesktopWorldNativeProjectionHost\? \{\s*nativeProjectionHostSlot\.host/);
  assert.match(surfaceSource, /existing\.nativeProjectionHost\?\.resize\(\)/);
  assert.match(surfaceSource, /if topologyWillChange \{[^}]*discardNativeSheetImmediately\(\)/);
  assert.doesNotMatch(surfaceSource, /reconcileNativeSheetForCurrentTopology/);
  assert.match(projectionSource, /addSubview\(view, positioned: \.below, relativeTo: webView\)/);
  assert.match(projectionSource, /view\.isHidden = true/);
  assert.match(surfaceSource, /collectionBehavior\.insert\(\.canJoinAllApplications\)/);
  assert.match(surfaceSource, /func displayLayout\(\) -> AOSDesktopWorldDisplayLayout\?/);
  assert.match(displayGeometrySource, /struct AOSDesktopWorldDisplayLayout/);
  assert.match(displayGeometrySource, /func backingPixelPoint\(fromDesktopWorld point: CGPoint\)/);
  assert.match(displayGeometrySource, /func desktopWorldPoint\(fromBackingPixel point: CGPoint\)/);
  assert.match(displayGeometrySource, /func matches\([\s\S]*indexedDisplays:/);
});

test('DesktopWorld native sheet is AOS-owned and addressable through the existing resource scope', () => {
  assert.match(identitySource, /static let stageID = "desktop-world\/main"/);
  assert.match(identitySource, /let ownerID: String/);
  assert.match(identitySource, /let resourceID: String/);
  assert.match(identitySource, /"\\\(ownerID\)::\\\(resourceID\)"/);
  assert.match(sheetSource, /static let ownerID = "io\.agent-os"/);
  assert.match(sheetSource, /static let resourceID = "native-sheet\/main"/);
  assert.match(sheetSource, /let displayLayout: AOSDesktopWorldDisplayLayout/);
  assert.match(surfaceSource, /private var installedNativeSheet: DesktopWorldNativeSheet\?/);
  assert.match(surfaceSource, /DesktopWorldNativeSheetProcessLease\.shared\.claim/);
  assert.match(leaseSource, /static let shared = DesktopWorldNativeSheetProcessLease\(\)/);
  assert.match(leaseSource, /guard active == nil else \{ throw LeaseError\.occupied \}/);
  assert.match(leaseSource, /nextSerial &\+= 1/);
  assert.match(leaseSource, /guard active == token else \{ return \}/);
  assert.match(surfaceSource, /guard installedNativeSheet == nil else \{ throw NativeSheetError\.occupied \}/);
  assert.match(hostSource, /sheet = try canvas\.installNativeSheet\(device: device\)/);
  assert.match(hostSource, /let addressed = try canvas\.nativeSheet\(for: sheet\.identity\)/);
  assert.match(hostSource, /guard addressed === sheet/);
  assert.match(hostSource, /canvas\.removeNativeSheet\(sheet\.identity\)/);
  assert.doesNotMatch(sheetSource, /class DesktopWorldNativeSheetRegistry/);
  assert.doesNotMatch(sheetSource, /segment\.ensureNativeProjectionHost/);
  assert.doesNotMatch(sheetSource, /removeNativeProjectionHost/);
  assert.match(commandSource, /sheetAddressed: host\.sheetIdentity != nil/);
  assert.match(commandSource, /cleanup\.retainedSheets == 0/);
  assert.doesNotMatch(sheetSource, /ScreenCaptureKit|CVPixelBuffer|texture2d|fragment /);
});

test('DesktopWorld projection hosts belong to segments and remain dormant between effects', () => {
  assert.match(surfaceSource, /func prepareNativeProjectionHosts\(device: MTLDevice\) throws/);
  assert.match(surfaceSource, /DesktopWorldNativeProjectionHostBatch\.prepare\(/);
  assert.match(surfaceSource, /slot: \{ \$0\.nativeProjectionHostSlot \}/);
  assert.match(projectionLifecycleSource, /final class DesktopWorldNativeProjectionHostSlot/);
  assert.match(projectionLifecycleSource, /if result\.created \{\s*created\.append\(\(owner, result\.host\)\)/);
  assert.match(projectionLifecycleSource, /for \(owner, host\) in created\.reversed\(\) \{\s*owner\.remove\(host\)/);
  assert.match(surfaceSource, /func preparedNativeProjectionHost/);
  assert.match(projectionSource, /var isDormant: Bool/);
  assert.match(projectionSource, /view\.isPaused = true\s*view\.enableSetNeedsDisplay = true\s*view\.delegate = nil/);
  assert.match(surfaceSource, /func finalizeRetirement\(\)[\s\S]*nativeProjectionHostSlot\.finalize\(\)/);
  assert.match(
    surfaceSource,
    /func finalizeNativeProjectionHosts\(\) \{[\s\S]{0,180}discardNativeSheetImmediately\(\)[\s\S]{0,180}segment\.nativeProjectionHostSlot\.finalize\(\)/,
  );
  assert.match(surfaceSource, /existing\.nativeProjectionHost\?\.resize\(\)/);
  assert.doesNotMatch(sheetSource, /removeNativeProjectionHost/);
});

test('native sheet uses bounded fixed and effect-local geometry across display segments', () => {
  assert.match(geometrySource, /standard = DesktopWorldNativeSheetGeometryDescriptor\(columns: 64, rows: 64\)/);
  assert.match(geometrySource, /maximumColumns = 512/);
  assert.match(geometrySource, /maximumRows = 512/);
  assert.match(geometrySource, /maximumSegments = 8/);
  assert.match(geometrySource, /maximumGeometryBytes = 16 \* 1024 \* 1024/);
  assert.match(geometrySource, /case adaptive\(cellSize: CGFloat, regions: \[CGRect\]\?\)/);
  assert.match(geometrySource, /intersection = region\.intersection\(segmentBounds\)/);
  assert.match(geometrySource, /let renderBounds: CGRect/);
  assert.match(geometrySource, /func localProjectionFrame\(containerBounds: CGRect\) throws/);
  assert.match(sheetSource, /try host\.configure\(plan: plan\)/);
  assert.match(projectionSource, /projectionFrame = try plan\.localProjectionFrame/);
  assert.match(geometrySource, /worldAndUV: SIMD4<Float>\(worldX, worldY, segmentU, segmentV\)/);
  assert.match(geometrySource, /device\.makeBuffer\(/);
  assert.match(metalSource, /final class AOSDesktopPixelNativeBaselineGPUContext/);
  assert.match(hostSource, /context: context/);
  assert.match(metalSource, /encoder\.drawIndexedPrimitives\(/);
  assert.match(effectRendererSource, /NATIVE_EFFECT_CAPTURE_RESOLUTION_MISMATCH|captureResolutionMismatch/);
  assert.match(effectRendererSource, /sheet\.displayLayout\.geometry/);
  assert.doesNotMatch(effectRendererSource, /dwBounds\.(?:width|height) \* .*scaleFactor/);
  assert.doesNotMatch(metalSource, /drawPrimitives\(type: \.triangle, vertexStart: 0, vertexCount: 3\)/);
  assert.match(commandSource, /sheetGeometryBytes: host\.geometryMetrics\.geometryBytes/);
  assert.match(commandSource, /cleanup\.retainedGeometryBuffers == 0/);
  assert.match(commandSource, /cleanup\.retainedGPUResources == 0/);
  assert.match(sheetSource, /let topologyGeneration: UInt64/);
  assert.match(surfaceSource, /if topologyWillChange \{[^}]*discardNativeSheetImmediately\(\)/);
  assert.match(commandSource, /NSApplication\.didChangeScreenParametersNotification/);
  assert.match(commandSource, /cancelProof\(code: "DESKTOP_PIXEL_BASELINE_TOPOLOGY_CHANGED"\)/);
  assert.doesNotMatch(sheetSource, /func reconcile\(/);
});

test('native baseline is bounded and disposes every retained resource', () => {
  assert.match(captureSource, /maximumDisplays = 8/);
  assert.match(captureSource, /maximumPixelsPerDisplay = 33_554_432/);
  assert.match(captureSource, /maximumAggregatePixels = 67_108_864/);
  assert.match(commandSource, /\(50\.\.\.5_000\)\.contains\(value\)/);
  assert.match(commandSource, /barrier\.wait\(timeoutMilliseconds: 2_000\)/);
  assert.match(metalSource, /renderer\.dispose\(\)/);
  assert.match(metalSource, /mesh\.dispose\(\)/);
  assert.match(hostSource, /context\.dispose\(\)/);
  assert.match(metalSource, /view\.delegate = nil/);
  assert.match(metalSource, /view\.removeFromSuperview\(\)/);
  assert.match(metalSource, /window\.contentView = nil/);
  assert.match(metalSource, /window\.close\(\)/);
  assert.match(captureSource, /stopping\.forEach \{ \$0\.output\.quiesce\(\) \}/);
  assert.match(captureSource, /startupOwner\.retire\(timeout: Self\.stopTimeoutSeconds\)/);
  assert.match(captureSource, /retained\.append\(entry\)/);
  assert.match(captureSource, /retainedFrames: retained\.reduce/);
  assert.match(commandSource, /captureCleanup\.unsettledStreams == 0/);
  assert.match(commandSource, /if !cleanupComplete \{/);
  assert.match(commandSource, /code: "DESKTOP_PIXEL_BASELINE_CLEANUP_INCOMPLETE",\s*nativeCode: captureCleanup\.nativeCode/);
  assert.match(commandSource, /proofTask\.cancel\(\)/);
  assert.match(commandSource, /guard !finishing else \{ return \}\s*finishing = true\s*let teardown = Task\.detached/);
  assert.match(commandSource, /Task\.detached \{ @MainActor \[weak self\] in/);
  assert.doesNotMatch(commandSource, /source\.setEventHandler[\s\S]{0,160}await self\?\.finish/);
  assert.match(commandSource, /let cleanup = await activeHost\?\.dispose\(\)/);
  assert.match(commandSource, /cleanup\.retainedViews == 0/);
  assert.match(commandSource, /cleanup\.pendingRetirements == 0/);
  assert.match(hostSource, /coordinator\.retainUntilNextRunLoop\(canvas, generation: generation\)/);
  assert.match(hostSource, /coordinator\.pendingFinalizationCount > 0/);
  assert.match(commandSource, /cleanup\.retainedSheets == 0/);
  assert.match(commandSource, /DESKTOP_PIXEL_BASELINE_CLEANUP_INCOMPLETE/);
  assert.match(commandSource, /NSApp\.stop\(nil\)/);
  assert.match(commandSource, /NSApp\.postEvent\(wakeEvent, atStart: false\)/);
  assert.doesNotMatch(commandSource, /NSApp\.terminate/);
});

test('native baseline never persists or publicly exposes captured pixels', () => {
  assert.doesNotMatch(nativeSources, /FileManager\.default|createFile|write\(to:|Data\(contentsOf:/);
  assert.match(commandSource, /capturedPixelsPersisted = false/);
  assert.match(commandSource, /publicPixelsExposed = false/);
  for (const forbidden of ['pixelBuffer:', 'texture:', 'display_id', 'window_number']) {
    assert.equal(commandSource.includes(`"${forbidden}"`), false, forbidden);
  }
});

test('runtime proof command routes directly back into the current AOS executable', () => {
  const registry = JSON.parse(read('manifests/commands/source/aos/21-runtime.json'));
  const external = JSON.parse(read('manifests/commands/source/external/10-runtime.json'));
  const pathKey = 'runtime probe desktop-pixels';
  const command = registry.commands.find((item) => item.path.join(' ') === pathKey);
  const route = external.commands.find((item) => item.path.join(' ') === pathKey);
  assert.equal(command.forms[0].id, 'runtime-probe-desktop-pixels');
  assert.equal(command.forms[0].execution.auto_starts_daemon, false);
  assert.equal(command.forms[0].execution.requires_permissions, true);
  assert.deepEqual(
    command.forms[0].args.find((argument) => argument.id === 'host').value_type.enum.map((item) => item.value),
    ['standalone', 'desktop-world'],
  );
  assert.equal(route.executable, '/usr/bin/env');
  assert.deepEqual(route.argv_prefix, ['node', 'scripts/aos-runtime-desktop-pixel-baseline.mjs']);
  assert.equal(route.env.AOS_PATH, '$AOS_PATH');

  const adapter = read('scripts/aos-runtime-desktop-pixel-baseline.mjs');
  assert.match(adapter, /spawn\(aosPath\(\), \['__desktop-pixel-native-baseline'/);
  assert.match(adapter, /detached: true/);
  assert.match(adapter, /process\.kill\(-child\.pid, signal\)/);
  assert.match(adapter, /AOS_ENABLE_DEVELOPMENT_PROBES/);
  assert.match(adapter, /TERMINATION_GRACE_MS = 8_000/);
  assert.doesNotMatch(adapter, /ScreenCaptureKit|Metal|daemon|broker/i);
});

test('runtime proof adapter validates and forwards only bounded arguments', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pixel-baseline-'));
  const fakeAOS = path.join(temporary, 'aos');
  fs.writeFileSync(fakeAOS, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
  fs.chmodSync(fakeAOS, 0o700);
  try {
    const disabled = spawnSync(process.execPath, [
      path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'), '--json',
    ], {
      cwd: root,
      env: { ...process.env, AOS_PATH: fakeAOS, AOS_ENABLE_DEVELOPMENT_PROBES: '' },
      encoding: 'utf8',
    });
    assert.equal(disabled.status, 1);
    assert.equal(JSON.parse(disabled.stderr).code, 'DEVELOPMENT_PROBE_DISABLED');

    const accepted = spawnSync(process.execPath, [
      path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'),
      '--host', 'desktop-world', '--presentation', 'inverted', '--hold-ms', '250', '--json',
    ], {
      cwd: root,
      env: { ...process.env, AOS_PATH: fakeAOS, AOS_ENABLE_DEVELOPMENT_PROBES: '1' },
      encoding: 'utf8',
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(JSON.parse(accepted.stdout), [
      '__desktop-pixel-native-baseline',
      '--host', 'desktop-world', '--presentation', 'inverted', '--hold-ms', '250', '--json',
    ]);

    const rejected = spawnSync(process.execPath, [
      path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'),
      '--hold-ms', '5001', '--json',
    ], {
      cwd: root,
      env: { ...process.env, AOS_PATH: fakeAOS, AOS_ENABLE_DEVELOPMENT_PROBES: '1' },
      encoding: 'utf8',
    });
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stderr).code, 'INVALID_ARG');

    const duplicate = spawnSync(process.execPath, [
      path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'),
      '--hold-ms', '100', '--hold-ms', '200', '--json',
    ], {
      cwd: root,
      env: { ...process.env, AOS_PATH: fakeAOS, AOS_ENABLE_DEVELOPMENT_PROBES: '1' },
      encoding: 'utf8',
    });
    assert.equal(duplicate.status, 1);
    assert.equal(JSON.parse(duplicate.stderr).code, 'DUPLICATE_FLAG');

  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('runtime proof adapter retires the exact native child on cancellation', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pixel-baseline-cancel-'));
  const fakeAOS = path.join(temporary, 'aos');
  const pidFile = path.join(temporary, 'child.pid');
  const cleanupFile = path.join(temporary, 'cleanup-complete');
  fs.writeFileSync(fakeAOS, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.BASELINE_CHILD_PID_FILE, String(process.pid));
process.on('SIGTERM', () => setTimeout(() => {
  fs.writeFileSync(process.env.BASELINE_CHILD_CLEANUP_FILE, 'complete');
  process.exit(0);
}, 1500));
setInterval(() => {}, 1000);
`);
  fs.chmodSync(fakeAOS, 0o700);
  const wrapper = spawn(process.execPath, [
    path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'), '--json',
  ], {
    cwd: root,
    env: {
      ...process.env,
      AOS_PATH: fakeAOS,
      AOS_ENABLE_DEVELOPMENT_PROBES: '1',
      BASELINE_CHILD_CLEANUP_FILE: cleanupFile,
      BASELINE_CHILD_PID_FILE: pidFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitFor(() => fs.existsSync(pidFile));
    const childPID = Number(fs.readFileSync(pidFile, 'utf8'));
    wrapper.kill('SIGTERM');
    const result = await new Promise((resolve) => {
      wrapper.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 143, signal: null });
    assert.equal(fs.readFileSync(cleanupFile, 'utf8'), 'complete');
    await waitFor(() => {
      try {
        process.kill(childPID, 0);
        return false;
      } catch (error) {
        return error?.code === 'ESRCH';
      }
    });
  } finally {
    if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

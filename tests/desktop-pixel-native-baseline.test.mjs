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
const projectionSource = read('src/display/desktop-world-native-projection.swift');
const geometrySource = read('src/display/desktop-world-native-sheet-geometry.swift');
const leaseSource = read('src/display/desktop-world-native-sheet-lease.swift');
const sheetSource = read('src/display/desktop-world-native-sheet.swift');
const identitySource = read('src/shared/desktop-world-resource-identity.swift');
const surfaceSource = read('src/display/desktop-world-surface.swift');
const nativeSources = [
  commandSource,
  captureSource,
  hostSource,
  metalSource,
  projectionSource,
  geometrySource,
  leaseSource,
  sheetSource,
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
});

test('native baseline retains the proven warm ScreenCaptureKit shape', () => {
  assert.match(captureSource, /SCShareableContent\.excludingDesktopWindows\(\s*false,\s*onScreenWindowsOnly: false/);
  assert.match(captureSource, /configuration\.queueDepth = Self\.queueDepth/);
  assert.match(captureSource, /static let queueDepth = 3/);
  assert.match(captureSource, /configuration\.capturesAudio = false/);
  assert.match(captureSource, /configuration\.minimumFrameInterval = CMTime\(value: 1, timescale: 30\)/);
  assert.match(captureSource, /try await entry\.stream\.startCapture\(\)/);
  assert.match(captureSource, /entry\.stream\.stopCapture\(completionHandler: completion\)/);
  assert.match(captureSource, /try entry\.stream\.removeStreamOutput\(entry\.output, type: \.screen\)/);
  assert.match(captureSource, /entry\.sampleQueue\.sync \{\}/);
  assert.doesNotMatch(captureSource, /try\? await entry\.stream\.stopCapture/);
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
  assert.match(hostSource, /canvas\.installNativeSheet\(device: device\)/);
  assert.match(sheetSource, /segment\.ensureNativeProjectionHost\(device: device\)/);
  assert.match(hostSource, /canvas\.show\(\)/);
  assert.doesNotMatch(desktopHost, /NSScreen\.screens|NSWindow\(/);
  assert.match(surfaceSource, /private\(set\) var nativeProjectionHost: DesktopWorldNativeProjectionHost\?/);
  assert.match(surfaceSource, /existing\.nativeProjectionHost\?\.resize\(\)/);
  assert.match(surfaceSource, /if topologyWillChange \{[^}]*discardNativeSheetImmediately\(\)/);
  assert.doesNotMatch(surfaceSource, /reconcileNativeSheetForCurrentTopology/);
  assert.match(projectionSource, /addSubview\(view, positioned: \.below, relativeTo: webView\)/);
  assert.match(projectionSource, /view\.isHidden = true/);
  assert.match(surfaceSource, /collectionBehavior\.insert\(\.canJoinAllApplications\)/);
});

test('DesktopWorld native sheet is AOS-owned and addressable through the existing resource scope', () => {
  assert.match(identitySource, /static let stageID = "desktop-world\/main"/);
  assert.match(identitySource, /let ownerID: String/);
  assert.match(identitySource, /let resourceID: String/);
  assert.match(identitySource, /"\\\(ownerID\)::\\\(resourceID\)"/);
  assert.match(sheetSource, /static let ownerID = "io\.agent-os"/);
  assert.match(sheetSource, /static let resourceID = "native-sheet\/main"/);
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
  assert.match(sheetSource, /guard segment\.nativeProjectionHost == nil else/);
  assert.match(sheetSource, /DesktopWorldNativeSheetFailure\.projectionOccupied/);
  assert.match(commandSource, /sheetAddressed: host\.sheetIdentity != nil/);
  assert.match(commandSource, /cleanup\.retainedSheets == 0/);
  assert.doesNotMatch(sheetSource, /ScreenCaptureKit|CVPixelBuffer|texture2d|fragment /);
});

test('native sheet uses one bounded tessellated geometry model across display segments', () => {
  assert.match(geometrySource, /standard = DesktopWorldNativeSheetGeometryDescriptor\(columns: 64, rows: 64\)/);
  assert.match(geometrySource, /maximumColumns = 128/);
  assert.match(geometrySource, /maximumRows = 128/);
  assert.match(geometrySource, /maximumSegments = 8/);
  assert.match(geometrySource, /maximumGeometryBytes = 16 \* 1024 \* 1024/);
  assert.match(geometrySource, /worldAndUV: SIMD4<Float>\(worldX, worldY, horizontal, vertical\)/);
  assert.match(geometrySource, /device\.makeBuffer\(/);
  assert.match(metalSource, /final class AOSDesktopPixelNativeBaselineGPUContext/);
  assert.match(hostSource, /context: context/);
  assert.match(metalSource, /encoder\.drawIndexedPrimitives\(/);
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
  assert.match(captureSource, /unsettled\.append\(entry\)/);
  assert.match(captureSource, /retainedFramesAfterStop = unsettled\.reduce/);
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
  assert.doesNotMatch(adapter, /ScreenCaptureKit|Metal|daemon|broker/i);
});

test('runtime proof adapter validates and forwards only bounded arguments', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pixel-baseline-'));
  const fakeAOS = path.join(temporary, 'aos');
  fs.writeFileSync(fakeAOS, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
  fs.chmodSync(fakeAOS, 0o700);
  try {
    const accepted = spawnSync(process.execPath, [
      path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'),
      '--host', 'desktop-world', '--presentation', 'inverted', '--hold-ms', '250', '--json',
    ], {
      cwd: root,
      env: { ...process.env, AOS_PATH: fakeAOS },
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
      env: { ...process.env, AOS_PATH: fakeAOS },
      encoding: 'utf8',
    });
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stderr).code, 'INVALID_ARG');

    const duplicate = spawnSync(process.execPath, [
      path.join(root, 'scripts/aos-runtime-desktop-pixel-baseline.mjs'),
      '--hold-ms', '100', '--hold-ms', '200', '--json',
    ], {
      cwd: root,
      env: { ...process.env, AOS_PATH: fakeAOS },
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
  fs.writeFileSync(fakeAOS, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.BASELINE_CHILD_PID_FILE, String(process.pid));
process.on('SIGTERM', () => {});
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

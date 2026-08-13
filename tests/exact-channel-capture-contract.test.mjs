import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const selectionSource = path.join(root, 'src/perceive/exact-window-capture.swift')

test('exact channel capture planning binds one current owner and display', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-exact-channel-capture-'))
  try {
    const main = path.join(temp, 'main.swift')
    const executable = path.join(temp, 'proof')
    await writeFile(main, String.raw`
import CoreGraphics
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs(message + "\n", stderr)
        exit(1)
    }
}

func rejected(
    _ expected: AOSExactChannelCapturePlanError,
    _ operation: () throws -> AOSExactChannelCapturePlan?
) {
    do {
        _ = try operation()
        require(false, "expected \(expected)")
    } catch let error as AOSExactChannelCapturePlanError {
        require(error == expected, "expected \(expected), got \(error)")
    } catch {
        require(false, "unexpected error \(error)")
    }
}

let surface = AOSExactChannelCaptureSurface(
    kind: "channel",
    windowID: 778,
    ownerPID: 40229
)
let window = AOSExactChannelCaptureWindow(
    windowID: 778,
    ownerPID: 40229,
    layer: 0,
    frame: CGRect(x: 276.2, y: 106.1, width: 959.6, height: 659.7)
)
let display = AOSExactChannelCaptureDisplay(
    displayID: 42,
    bounds: CGRect(x: 0, y: 0, width: 1512, height: 982),
    scaleFactor: 2,
    mirrored: false
)
let plan = try aosExactChannelCapturePlan(
    surface: surface,
    windows: [window],
    displays: [display]
)
require(plan?.displayID == 42, "display identity drifted")
require(plan?.windowID == 778, "window identity drifted")
require(plan?.ownerPID == 40229, "owner identity drifted")
require(plan?.globalBounds == window.frame.integral, "current window bounds were not authoritative")
require(plan?.captureScaleFactor == 2, "capture scale drifted")
guard let admitted = plan else {
    preconditionFailure("exact channel plan was not admitted")
}

let sameIntegralWindow = AOSExactChannelCaptureWindow(
    windowID: 778,
    ownerPID: 40229,
    layer: 0,
    frame: CGRect(x: 276.25, y: 106.15, width: 959.5, height: 659.6)
)
require(
    aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [sameIntegralWindow],
        displays: [display]
    ),
    "equivalent integral window observation was rejected"
)
require(
    !aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [],
        displays: [display]
    ),
    "missing window was admitted"
)
require(
    !aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [AOSExactChannelCaptureWindow(
            windowID: 779,
            ownerPID: 40229,
            layer: 0,
            frame: window.frame
        )],
        displays: [display]
    ),
    "window ID drift was admitted"
)
require(
    !aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [AOSExactChannelCaptureWindow(
            windowID: 778,
            ownerPID: 40230,
            layer: 0,
            frame: window.frame
        )],
        displays: [display]
    ),
    "owner PID drift was admitted"
)
require(
    !aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [AOSExactChannelCaptureWindow(
            windowID: 778,
            ownerPID: 40229,
            layer: 0,
            frame: window.frame.offsetBy(dx: 1, dy: 0)
        )],
        displays: [display]
    ),
    "integral bounds drift was admitted"
)
require(
    !aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [window],
        displays: [AOSExactChannelCaptureDisplay(
            displayID: 43,
            bounds: display.bounds,
            scaleFactor: 2,
            mirrored: false
        )]
    ),
    "display ID drift was admitted"
)
require(
    !aosExactChannelCaptureIsStable(
        admitted: admitted,
        windows: [window],
        displays: [AOSExactChannelCaptureDisplay(
            displayID: 42,
            bounds: display.bounds,
            scaleFactor: 1,
            mirrored: false
        )]
    ),
    "display scale drift was admitted"
)

let canvas = AOSExactChannelCaptureSurface(
    kind: "canvas",
    windowID: 778,
    ownerPID: 40229
)
let canvasPlan = try aosExactChannelCapturePlan(
    surface: canvas,
    windows: [window],
    displays: [display]
)
require(canvasPlan == nil, "non-channel surface requested exact window capture")

rejected(.missingIdentity) {
    try aosExactChannelCapturePlan(
        surface: AOSExactChannelCaptureSurface(kind: "channel", windowID: nil, ownerPID: 40229),
        windows: [window], displays: [display]
    )
}
rejected(.windowNotFound) {
    try aosExactChannelCapturePlan(surface: surface, windows: [], displays: [display])
}
rejected(.ambiguousWindow) {
    try aosExactChannelCapturePlan(surface: surface, windows: [window, window], displays: [display])
}
rejected(.ownerMismatch) {
    try aosExactChannelCapturePlan(
        surface: surface,
        windows: [AOSExactChannelCaptureWindow(windowID: 778, ownerPID: 9, layer: 0, frame: window.frame)],
        displays: [display]
    )
}
rejected(.invalidWindowBounds) {
    try aosExactChannelCapturePlan(
        surface: surface,
        windows: [AOSExactChannelCaptureWindow(
            windowID: 778, ownerPID: 40229, layer: 1, frame: window.frame
        )],
        displays: [display]
    )
}
rejected(.invalidWindowBounds) {
    try aosExactChannelCapturePlan(
        surface: surface,
        windows: [AOSExactChannelCaptureWindow(
            windowID: 778, ownerPID: 40229, layer: 0,
            frame: CGRect(x: 0, y: 0, width: 0, height: 100)
        )],
        displays: [display]
    )
}
rejected(.displayNotFound) {
    try aosExactChannelCapturePlan(
        surface: surface,
        windows: [AOSExactChannelCaptureWindow(
            windowID: 778, ownerPID: 40229, layer: 0,
            frame: CGRect(x: 1400, y: 100, width: 200, height: 200)
        )],
        displays: [display]
    )
}
rejected(.displayNotFound) {
    try aosExactChannelCapturePlan(
        surface: surface, windows: [window],
        displays: [AOSExactChannelCaptureDisplay(
            displayID: 42,
            bounds: display.bounds,
            scaleFactor: 2,
            mirrored: true
        )]
    )
}
rejected(.displayNotFound) {
    try aosExactChannelCapturePlan(
        surface: surface, windows: [window],
        displays: [AOSExactChannelCaptureDisplay(
            displayID: 43,
            bounds: CGRect(x: 2000, y: 0, width: 1000, height: 1000),
            scaleFactor: 2,
            mirrored: false
        )]
    )
}
rejected(.ambiguousDisplay) {
    try aosExactChannelCapturePlan(
        surface: surface, windows: [window], displays: [display, display]
    )
}
rejected(.invalidDisplayScale) {
    try aosExactChannelCapturePlan(
        surface: surface, windows: [window],
        displays: [AOSExactChannelCaptureDisplay(
            displayID: 42,
            bounds: display.bounds,
            scaleFactor: 0,
            mirrored: false
        )]
    )
}
`)

    const compile = spawnSync(
      'xcrun',
      ['swiftc', '-O', selectionSource, main, '-o', executable],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('channel integration uses exact window pixels and an exact AX window root', async () => {
  const [pipeline, ax, spatial, native, controller, broker] = await Promise.all([
    readFile(path.join(root, 'src/perceive/capture-pipeline.swift'), 'utf8'),
    readFile(path.join(root, 'src/perceive/ax.swift'), 'utf8'),
    readFile(path.join(root, 'src/perceive/spatial.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/desktop-pixel-native.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/public-capture-controller.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/desktop-pixel-broker.swift'), 'utf8'),
  ])

  assert.match(pipeline, /aosExactChannelCapturePlan\(/)
  assert.match(
    pipeline,
    /selectedCaptureDisplayIDs = \(exactChannelCapture\.map \{ \[\$0\.display\.cgID\] \}/,
  )
  assert.match(
    pipeline,
    /capturedWindowsByDisplay\[exactChannelCapture\.display\.cgID\] = exactChannelCapture\.window/,
  )
  assert.match(
    pipeline,
    /nativeCapture\.usedDisplayFallback\.contains\(exactChannelCapture\.display\.cgID\)[\s\S]*Exact channel window pixels were unavailable/,
  )
  assert.match(
    pipeline,
    /fallback: exactChannelCapture == nil \? \.display : \.none/,
  )
  assert.match(
    pipeline,
    /kind: "channel"[\s\S]*Stored bounds are recency evidence only[\s\S]*segments: \[\]/,
  )
  assert.match(
    pipeline,
    /"owner_pid": target\.ownerPID[\s\S]*"expected_bounds"[\s\S]*"fallback": target\.fallback\.rawValue/,
  )
  assert.match(
    pipeline,
    /let windowImage = nativeImages\[exactChannelCapture\.display\.cgID\][\s\S]*image = windowImage/,
  )
  assert.match(pipeline, /guard let elements = xrayWindow\(/)
  assert.match(
    pipeline,
    /private func requireExactChannelCaptureStability\([\s\S]*observeCaptureWindowFacts\(\)[\s\S]*observeExactChannelCaptureDisplays\(\)[\s\S]*aosExactChannelCaptureIsStable\(/,
  )
  assert.match(
    pipeline,
    /Exact channel window changed during capture"[\s\S]*code: "CAPTURE_TOPOLOGY_MISMATCH"/,
  )

  const captureCommand = pipeline.slice(pipeline.indexOf('func captureCommand(args: [String]) async'))
  const nativeSettlement = captureCommand.indexOf('let nativeCapture = captureNativeFramesThroughDaemon(')
  const captureLoop = captureCommand.indexOf('// ── Capture loop ──')
  const stabilityCheckpoints = [
    ...captureCommand.matchAll(/requireExactChannelCaptureStability\(exactChannelCapture\.plan\)/g),
  ].map((match) => match.index)
  assert.equal(stabilityCheckpoints.length, 2, 'exact channel capture should have two stability checkpoints')
  assert.ok(nativeSettlement !== -1, 'native screenshot settlement should be present')
  assert.ok(
    stabilityCheckpoints[0] > nativeSettlement && stabilityCheckpoints[0] < captureLoop,
    'the first stability checkpoint should follow native screenshot settlement',
  )

  const surfaceBranch = captureCommand.indexOf('if let surface = explicitSurface {', captureLoop)
  const optionalAX = captureCommand.indexOf('if opts.xray {', surfaceBranch)
  const optionalPerception = captureCommand.indexOf('responsePerceptions.append(', surfaceBranch)
  const resultPublication = captureCommand.indexOf(
    'results.append((image, opts.resolvedOutputPath))',
    surfaceBranch,
  )
  assert.ok(
    stabilityCheckpoints[1] > optionalAX
      && stabilityCheckpoints[1] > optionalPerception
      && stabilityCheckpoints[1] < resultPublication,
    'the final stability checkpoint should follow optional AX/perception projection',
  )

  assert.match(ax, /func nativeAXWindowElement\(appPID: pid_t, windowID: Int\)/)
  assert.match(ax, /let matches = windows\.filter \{ axWindowID\(\$0\) == windowID \}/)
  assert.match(ax, /guard matches\.count == 1 else \{ return nil \}/)
  assert.match(ax, /let observedWindowID = axWindowID\(element\)/)
  assert.match(ax, /observedWindowID != windowScopeID[\s\S]*return/)
  assert.match(ax, /let windowID = observedWindowID \?\? windowScopeID/)
  const xrayTraversalStart = ax.indexOf('func traverseAXElements(')
  const xrayScopeIndex = ax.indexOf('let observedWindowID = axWindowID(element)', xrayTraversalStart)
  const xrayRoleIndex = ax.indexOf('let role = axString(element', xrayTraversalStart)
  assert.ok(xrayScopeIndex !== -1, 'xray traversal should resolve exact window membership')
  assert.ok(xrayScopeIndex < xrayRoleIndex, 'foreign window IDs should be pruned before AX content reads')
  assert.match(ax, /func xrayWindow\([\s\S]*windowScopeID: windowID/)

  assert.match(
    spatial,
    /traverseForChannel\([\s\S]*windowID: state\.windowID/,
  )
  assert.match(
    spatial,
    /guard let window = nativeAXWindowElement\(appPID: pid, windowID: windowID\)/,
  )
  assert.match(spatial, /winInfo\.pid == state\.pid/)
  assert.match(spatial, /let elements = traverseForChannel\(/)
  assert.match(spatial, /!elements\.isEmpty/)
  assert.match(spatial, /aosChannelWindowObservationIsStable\(/)
  assert.match(spatial, /findSubtreeRoot\([\s\S]*root: window,[\s\S]*windowID: windowID/)
  assert.match(spatial, /observedWindowID != windowID[\s\S]*return/)
  assert.match(spatial, /guard matched == nil else \{ return nil \}/)
  assert.match(
    spatial,
    /CGDisplayMirrorsDisplay\(\$0\.id\) == kCGNullDirectDisplay[\s\S]*\$0\.bounds\.contains\(windowBounds\)/,
  )

  assert.match(broker, /struct AOSDesktopPixelWindowTarget[\s\S]*ownerPID: Int[\s\S]*expectedBounds: CGRect[\s\S]*fallback: AOSDesktopPixelWindowFallback/)
  assert.match(native, /windowTarget\.map\(\\\.fallback\) != \.some\(\.none\)[\s\S]*source: \.display/)
  assert.match(native, /SCContentFilter\(desktopIndependentWindow: window\)/)
  assert.match(
    native,
    /pointWidth: windowTarget\.expectedBounds\.width,[\s\S]*pointHeight: windowTarget\.expectedBounds\.height/,
  )
  assert.match(native, /windowTarget\.map\(\\\.fallback\) == \.some\(\.none\)[\s\S]*throw AOSDesktopFrameCaptureFailure\.topologyMismatch/)
  assert.match(controller, /windowTarget\.map\(\\\.fallback\) != \.some\(\.none\)/)
  assert.match(broker, /target\.expectedBounds == target\.expectedBounds\.integral/)
})

test('exact channel permission, depth, authority, and proof owners converge', async () => {
  const [focusRaw, graphRaw, daemonSchemaRaw, srcAuthority, sharedAuthority, proofRaw] = await Promise.all([
    readFile(path.join(root, 'manifests/commands/source/aos/15-focus.json'), 'utf8'),
    readFile(path.join(root, 'manifests/commands/source/aos/16-graph.json'), 'utf8'),
    readFile(path.join(root, 'shared/schemas/daemon-request.schema.json'), 'utf8'),
    readFile(path.join(root, 'src/AGENTS.md'), 'utf8'),
    readFile(path.join(root, 'shared/AGENTS.md'), 'utf8'),
    readFile(path.join(root, 'docs/dev/test-proof-registry.d/native-capture.json'), 'utf8'),
  ])
  const forms = [
    ...JSON.parse(focusRaw).commands.flatMap((command) => command.forms),
    ...JSON.parse(graphRaw).commands.flatMap((command) => command.forms),
  ]
  for (const id of ['focus-create', 'focus-update', 'graph-deepen', 'graph-collapse']) {
    const form = forms.find((candidate) => candidate.id === id)
    assert.equal(form?.execution.requires_permissions, true, id)
    assert.match(form.args.find((arg) => arg.id === 'depth')?.summary ?? '', /0 through 15/)
  }

  const daemonSchema = JSON.parse(daemonSchemaRaw)
  for (const name of ['FocusCreateData', 'FocusUpdateData', 'GraphDeepenData', 'GraphCollapseData']) {
    assert.deepEqual(
      daemonSchema.$defs[name].properties.depth,
      { type: 'integer', minimum: 0, maximum: 15 },
      name,
    )
  }
  assert.match(srcAuthority, /Exact focus-channel capture uses `fallback=none`/)
  assert.match(sharedAuthority, /closed display ID, window ID, owner PID, integral expected-bounds/)

  const proof = JSON.parse(proofRaw).entries.find(
    (entry) => entry.id === 'public-native-capture-single-owner-contract',
  )
  assert.ok(proof.path_patterns.includes('tests/daemon/spatial-refresh-stale-write.test.mjs'))
  assert.match(proof.command, /tests\/daemon\/spatial-refresh-stale-write\.test\.mjs/)
  assert.match(proof.guard, /hermetic temporary compiler\/test artifacts/)
})

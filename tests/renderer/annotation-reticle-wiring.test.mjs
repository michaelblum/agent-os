import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const deletedSelectionModeCursorPattern = new RegExp([
  ['selection', 'Mode', 'Cursor', 'Model'].join(''),
  ['read', 'Selection', 'Mode', 'Cursor', 'Model', 'Snapshot'].join(''),
  ['refresh', 'Selection', 'Mode', 'Cursor', 'Model', 'Snapshot'].join(''),
].join('|'))

test('annotation reticle imports neutral annotation candidate helpers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/annotation-reticle.js'), 'utf8')

  assert.match(source, /workbench\/annotation-candidates\.js/)
  assert.doesNotMatch(source, /workbench\/surface-inspector-annotations\.js/)
  assert.match(source, /chooseAnnotationCandidateForScope/)
  assert.match(source, /normalizeAnnotationCandidate/)
})

test('Sigil main imports native reticle candidate builders from neutral workbench module', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')

  assert.match(source, /workbench\/annotation-candidates\.js/)
  assert.doesNotMatch(source, /buildNative(Window|AxElement)SurfaceInspectorCandidate/)
  assert.doesNotMatch(source, /workbench\/surface-inspector-annotations\.js/)
  assert.match(source, /buildNativeWindowAnnotationCandidate/)
  assert.match(source, /buildNativeAxElementAnnotationCandidate/)
})

test('Sigil clears stale semantic reticle candidates before replacement or empty payloads', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const semanticStart = source.indexOf('function annotationReticleHandleSemanticTargets')
  const nativeStart = source.indexOf('function annotationReticleHandleNativeWindow', semanticStart)
  const semanticBlock = source.slice(semanticStart, nativeStart)
  const removeStart = source.indexOf('function annotationReticleRemoveCandidate')
  const listStart = source.indexOf('function annotationReticleCandidateList', removeStart)
  const removeBlock = source.slice(removeStart, listStart)

  assert.match(removeBlock, /clearAnnotationReticleSemanticCandidatesForCanvas\(liveJs\.annotationReticleTargetEvidence, id\)/)
  assert.match(semanticBlock, /clearAnnotationReticleSemanticCandidatesForCanvas\(liveJs\.annotationReticleTargetEvidence, canvasId\)[\s\S]*if \(!targets\.length\) return/)
  assert.match(semanticBlock, /recordAnnotationReticleSemanticCandidateIds\(liveJs\.annotationReticleTargetEvidence, canvasId, candidateIds\)/)
})

test('Sigil reticle candidates are projected through canonical DesktopWorld helpers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')

  assert.match(source, /nativeToDesktopWorldRect/)
  assert.match(source, /normalizeCanvasFrameToDesktopWorld/)
  assert.match(source, /canvasLocalRectToDesktopWorld/)
  assert.match(source, /function annotationReticleCandidateInDesktopWorld/)
  assert.match(source, /function annotationReticleSemanticTargetForDesktopWorld/)
  assert.match(source, /normalizeCanvasFrameToDesktopWorld\(canvas, liveJs\.displays\)/)
  assert.match(source, /canvasLocalRectToDesktopWorld\(/)
  assert.match(source, /coordinate_space: 'desktop_world'/)
  assert.match(source, /source_coordinate_space: frame\?\.source_coordinate_space/)
  assert.match(source, /const targetCanvasId = String\(target\.provenance\?\.canvas_id \|\| canvasId\)\.trim\(\)/)
  assert.match(source, /annotationReticleSemanticTargetForDesktopWorld\(targetCanvasId, target\)/)
})

test('Sigil reticle preserves browser DOM element target adapter identity', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const semanticStart = source.indexOf('function annotationReticleHandleSemanticTargets')
  const nativeStart = source.indexOf('function annotationReticleHandleNativeWindow', semanticStart)
  const semanticBlock = source.slice(semanticStart, nativeStart)

  assert.match(source, /workbench\/browser-dom-element-picker\.js/)
  assert.match(source, /buildBrowserDomElementAnnotationCandidate/)
  assert.match(source, /BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID/)
  assert.match(semanticBlock, /annotationReticleIsBrowserDomElementTarget\(target\)/)
  assert.match(semanticBlock, /content_rect: annotationReticleBrowserContentRect\(canvasId, payload, target\)/)
  assert.match(semanticBlock, /browser_attachment: target\.browser_attachment \|\| payload\.browser_attachment \|\| 'explicit_local_page'/)
})

test('Sigil reticle requests live browser DOM target for scoped local browser windows', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const debugSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/debug-api.js'), 'utf8')

  assert.match(source, /function annotationReticleBrowserDomBridgeEvidence\(pointer = null, anchorCandidate = null\)/)
  assert.match(source, /function annotationReticleBrowserContentRectFromAxElement\(payload = \{\}, windowPayload = \{\}\)/)
  assert.match(source, /annotationReticleBrowserContentRectFromAxElement\(axElementEvent, scopedWindowEvent\)/)
  assert.match(source, /annotationReticleBrowserContentRectFromAxElement\(axElementEvent, \{ \.\.\.scopedWindowEvent, bounds: anchorRect \}\)/)
  assert.match(source, /annotationReticleBrowserDomBridge: null/)
  assert.match(debugSource, /annotationReticleBrowserDomBridge: deps\.liveJs\.annotationReticleBrowserDomBridge/)
  assert.match(source, /function recordAnnotationReticleBrowserDomBridge\(stage, evidence = \{\}\)/)
  assert.match(source, /annotationReticleBrowserSessionFromWindow\(scopedWindowEvent\)/)
  assert.match(source, /annotationReticleBrowserContentRectFromWindow\(scopedWindowEvent\)/)
  assert.match(source, /blocker_reason: 'browser_content_inset_unresolved'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_blocked'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_stale_response'/)
  assert.match(source, /blocker_reason: 'browser_dom_request_scope_mismatch'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_no_target'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_candidate_rejected'/)
  assert.match(source, /blocker_reason: 'browser_dom_request_failed'/)
  assert.match(source, /host\.request\('browser_dom\.element_target'/)
  assert.match(source, /browser_session_id: evidence\.session_id/)
  assert.match(source, /browser_window_id: evidence\.browser_window_id/)
  assert.match(source, /buildBrowserDomElementAnnotationCandidate\(\{[\s\S]*browser_session_id: evidence\.session_id[\s\S]*browser_window_id: evidence\.browser_window_id/)
  assert.match(source, /annotationReticleRequestBrowserDomTarget\(pointer, 'preview', liveJs\.annotationReticle\?\.preview_target \|\| null\)/)
  assert.match(source, /annotationReticleRequestBrowserDomTarget\(\{ x, y, valid: true \}, 'release', liveJs\.annotationReticle\?\.preview_target \|\| null\)/)
  assert.match(source, /function annotationReticleNativeBrowserWindowAnchor\(candidate = null, activeScope = null\)/)
  assert.match(source, /anchor_source: evidence\.anchor_source \|\| ''/)
  assert.match(source, /anchor_candidate_id: evidence\.anchor_candidate_id \|\| ''/)
  assert.match(source, /anchor_window_id: evidence\.anchor_window_id \|\| ''/)
  assert.match(source, /annotationReticleBrowserDomBridgeEvidence\(pointer, anchorCandidate\)/)
  assert.match(source, /annotationReticleWindowEventMatchesAnchor\(windowEvent, anchor\)/)
  assert.match(source, /browser_window_id: windowId/)
  assert.match(source, /anchor_source: anchor\.source/)
  assert.match(source, /annotationReticle\.updatePreview\(pointer\)[\s\S]*annotationReticleRequestBrowserDomTarget\(pointer, 'preview', liveJs\.annotationReticle\?\.preview_target \|\| null\)/)
  assert.match(source, /annotationReticle\.updatePreview\(\{ x, y, valid: true \}\)[\s\S]*annotationReticleRequestBrowserDomTarget\(\{ x, y, valid: true \}, 'release', liveJs\.annotationReticle\?\.preview_target \|\| null\)[\s\S]*const event = annotationReticle\.commitRelease/)
})

test('Sigil reticle accepts nested native window preview target as browser anchor', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const helpersStart = source.indexOf('function annotationReticleRectFromObject')
  const helpersEnd = source.indexOf('function annotationReticleCanvasDesktopWorldRect', helpersStart)
  assert.notEqual(helpersStart, -1)
  assert.notEqual(helpersEnd, -1)

  const helperSource = source.slice(helpersStart, helpersEnd)
  const displayRootScope = {
    address: 'sigil:display:1:root',
    adapter_id: 'aos-display-root',
    root_kind: 'display',
    subject_kind: 'display_root',
  }
  const annotationReticle = {
    snapshot: () => ({
      active_scope: displayRootScope,
    }),
  }
  const liveJs = {
    annotationReticleTargetEvidence: {
      latestNativeWindowEvent: {},
      latestNativeAxElementEvent: {},
    },
    displays: [],
  }
  const {
    annotationReticleNativeBrowserWindowAnchor,
    annotationReticleBrowserDomBridgeEvidence,
  } = new Function('annotationReticle', 'liveJs', `${helperSource}; return { annotationReticleNativeBrowserWindowAnchor, annotationReticleBrowserDomBridgeEvidence };`)(annotationReticle, liveJs)
  const previewTarget = {
    id: 'native-window:195:Comet',
    subject_id: '',
    adapter_id: 'macos-ax',
    role: 'native_window',
    root: {
      id: 'native-window:195:Comet',
      kind: 'native_window',
      label: 'Comet',
    },
    subject: {
      id: 'native-window:195:Comet',
      kind: 'native_window',
      path: ['native_window', 'native-window:195:Comet'],
    },
    source_metadata: {
      window_id: '195',
      pid: 732,
      bundle_id: 'ai.perplexity.comet',
      bounds: { x: 0, y: 158, w: 1512, h: 824 },
    },
  }

  const anchor = annotationReticleNativeBrowserWindowAnchor(previewTarget, displayRootScope)
  assert.equal(anchor.source, 'selected_native_window')
  assert.equal(anchor.candidate_id, 'native-window:195:Comet')
  assert.equal(anchor.window_id, '195')
  assert.equal(anchor.pid, 732)

  const evidence = annotationReticleBrowserDomBridgeEvidence({ x: 100, y: 200, valid: true }, previewTarget)
  assert.equal(evidence.blocker_reason, 'browser_content_inset_unresolved')
  assert.notEqual(evidence.blocker_reason, 'browser_native_window_scope_required')
  assert.equal(evidence.browser_window_id, '195')
  assert.equal(evidence.anchor_source, 'selected_native_window')
  assert.equal(evidence.anchor_candidate_id, 'native-window:195:Comet')
  assert.equal(evidence.anchor_window_id, '195')
})

test('Sigil reticle maps browser DOM daemon errors to precise bridge blockers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const mapperStart = source.indexOf('function annotationReticleBrowserDomBridgeBlockerFromError')
  const evidenceStart = source.indexOf('function annotationReticleBrowserDomBridgeEvidence', mapperStart)
  const mapperBlock = source.slice(mapperStart, evidenceStart)
  const requestStart = source.indexOf('function annotationReticleRequestBrowserDomTarget')
  const nativeStart = source.indexOf('function annotationReticleHandleNativeWindow', requestStart)
  const requestBlock = source.slice(requestStart, nativeStart)

  assert.match(mapperBlock, /BROWSER_SESSION_NOT_LOCAL'[\s\S]*browser_session_not_local/)
  assert.match(mapperBlock, /BROWSER_SESSION_UNRESOLVED'[\s\S]*browser_session_unresolved/)
  assert.match(mapperBlock, /BROWSER_DOM_POINT_UNRESOLVED'[\s\S]*browser_dom_point_unresolved/)
  assert.match(mapperBlock, /BROWSER_CONTENT_INSET_UNRESOLVED'[\s\S]*browser_content_inset_unresolved/)
  assert.match(mapperBlock, /NATIVE_AX_ROOT_MISMATCH'[\s\S]*native_ax_root_mismatch/)
  assert.match(mapperBlock, /BROWSER_DOM_TARGET_INVALID_JSON'[\s\S]*browser_dom_target_invalid_json/)
  assert.match(mapperBlock, /BROWSER_DOM_TARGET_FAILED'[\s\S]*browser_dom_target_failed/)
  assert.match(mapperBlock, /default:[\s\S]*browser_dom_request_failed/)
  assert.match(mapperBlock, /message\.match\(\/\^\(\[A-Z0-9_\]\+\):\//)
  assert.match(requestBlock, /const blocker = annotationReticleBrowserDomBridgeBlockerFromError\(error\)/)
  assert.match(requestBlock, /blocker_reason: blocker\.blocker_reason/)
  assert.match(requestBlock, /code: blocker\.code/)
  assert.match(requestBlock, /status: error\?\.status \|\| ''/)
})

test('daemon exposes bounded browser DOM element target request for Sigil reticle', () => {
  const source = readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')

  assert.match(source, /case "browser_dom\.element_target":/)
  assert.match(source, /handleBrowserDomElementTarget\(callerID: canvasID, payload: inner \?\? \[:\]\)/)
  assert.match(source, /BROWSER_CONTENT_INSET_UNRESOLVED/)
  assert.match(source, /findRegistryRecord\(id: sessionID\)/)
  assert.match(source, /NATIVE_AX_ROOT_MISMATCH/)
  assert.match(source, /seeCaptureBrowserDomElementTarget\(/)
  assert.match(source, /BrowserDomHitTestPoint\(x: x, y: y\)/)
  assert.match(source, /contentRect: contentRect/)
})

test('Sigil applies annotation item-click lifecycle guard to avatar and target-surface releases', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const targetSurfaceSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/target-surface-events.js'), 'utf8')
  const uses = [source, targetSurfaceSource]
    .flatMap((candidate) => candidate.match(/annotationReticleReleaseDisposition\(result\)/g) || [])

  assert.equal(uses.length, 3)
  assert.match(targetSurfaceSource, /function handleRadialTargetSurfaceEvent[\s\S]*deps\.annotationReticleReleaseDisposition\(result\)[\s\S]*deps\.exitAnnotationReticle\(annotationDisposition\.reason\)/)
  assert.match(source, /case 'RADIAL': \{[\s\S]*annotationReticleReleaseDisposition\(result\)[\s\S]*exitAnnotationReticle\(annotationDisposition\.reason\)/)
})

test('Sigil routes the radial reticle item to Selection Mode instead of drag-through reticle entry', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const dispatchSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/radial-item-action-dispatch.js'), 'utf8')
  const enterStart = source.indexOf('function enterAnnotationReticle')
  const updateStart = source.indexOf('function updateAnnotationReticlePreview', enterStart)
  const enterBlock = source.slice(enterStart, updateStart)

  assert.doesNotMatch(source, /drag-through-reticle/)
  assert.doesNotMatch(source, /createAnnotationReticleAcquisitionState/)
  assert.match(dispatchSource, /enterSelectionMode\(pointer, 'radial-reticle'\)/)
  assert.match(dispatchSource, /post\('sigil\.selection_mode\.enter'/)
  assert.match(source, /requestAnimationFrame\(flushAnnotationReticlePreview\)/)
  assert.doesNotMatch(enterBlock, /ensureUtilityCanvasVisible/)
  assert.doesNotMatch(enterBlock, /requestCanvasInspectorAnnotationToggle/)
})

test('Sigil records and recovers delayed radial camera target-surface clicks', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const dispatchSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/radial-item-action-dispatch.js'), 'utf8')
  const targetSurfaceSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/target-surface-events.js'), 'utf8')

  assert.match(source, /type: event\.type/)
  assert.match(source, /radialTargetSurfaceReceiptEvidence/)
  assert.match(source, /applyRadialTargetSurfaceDragPayload/)
  assert.match(targetSurfaceSource, /payload\.kind === 'radial_item_pointer_move' \|\| payload\.kind === 'radial_surface_pointer_move'/)
  assert.match(targetSurfaceSource, /deps\.handleLeftMouseUp\(receipt\.worldPoint\.x, receipt\.worldPoint\.y\)/)
  assert.match(targetSurfaceSource, /payload\.itemId === deps\.annotationCameraItemId \|\| payload\.itemAction === 'annotationSnapshot'/)
  assert.match(targetSurfaceSource, /reason: 'radial-camera-target-surface-recovery'/)
  assert.match(dispatchSource, /requestAnnotationSnapshot\(reason\)/)
  assert.match(dispatchSource, /context\.reason === 'radial-camera-target-surface-recovery'/)
  assert.match(source, /host\.post\('canvas_inspector\.capture_bundle', \{[\s\S]*trigger: 'sigil_radial_camera'/)
  assert.match(targetSurfaceSource, /reason: 'camera-click-after-radial-cleanup'/)
  assert.match(source, /radialTargetSurfaceActive: radialTargetSurface\.snapshot\(\)\.interactive/)
  assert.match(source, /pointerInsideRadialTargetSurface: pointInRadialTargetSurface/)
})

test('Sigil radial camera bundle request carries canonical context session and keyframe', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const requestStart = source.indexOf('function requestAnnotationSnapshot')
  const requestEnd = source.indexOf('function requestCanvasInspectorAnnotationToggle', requestStart)
  const requestBlock = source.slice(requestStart, requestEnd)

  const contextRecordingRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/context-recording-runtime.js'), 'utf8')

  assert.match(contextRecordingRuntimeSource, /export const RETICLE_CONTEXT_ASSET_REFS/)
  assert.match(contextRecordingRuntimeSource, /function resolveReticleBundleContext/)
  assert.match(contextRecordingRuntimeSource, /function resolveReticleBundleContext\(\{[\s\S]*contextSession: reticleContextSession/)
  assert.match(contextRecordingRuntimeSource, /activeContext\.context_keyframe \|\| createContextKeyframeForSession/)
  assert.match(requestBlock, /host\.post\('canvas_inspector\.capture_bundle', \{[\s\S]*trigger: 'sigil_radial_camera'/)
  assert.match(requestBlock, /context_session: contextSession/)
  assert.match(requestBlock, /context_keyframe: contextKeyframe/)
  assert.match(requestBlock, /context_unavailable: contextUnavailable/)
  assert.match(contextRecordingRuntimeSource, /surface_inspector_annotation_snapshot: 'annotation-snapshot\.json'/)
})

test('Sigil wires live Selection Mode state, capture, overlay, and recording hooks', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const selectionRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/selection-mode-runtime.js'), 'utf8')
  const contextRecordingRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/context-recording-runtime.js'), 'utf8')
  const commandRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/ux-tree-command-registry.js'), 'utf8')
  const debugSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/debug-api.js'), 'utf8')

  assert.match(selectionRuntimeSource, /createSelectionModeContextSession/)
  assert.match(selectionRuntimeSource, /function enter\(pointer = null, reason = 'selection-mode-enter'\)/)
  assert.match(selectionRuntimeSource, /function acquire\(point = null\)/)
  assert.match(selectionRuntimeSource, /function handleInput\(msg = \{\}\)/)
  assert.match(selectionRuntimeSource, /setActiveContextProvider\(\{[\s\S]*source: 'selection_mode_debug'/)
  assert.match(contextRecordingRuntimeSource, /createContextRecording/)
  assert.match(source, /selectionMode: createDefaultSelectionModeState\(\)/)
  assert.match(source, /activeContext: createDefaultActiveContextState\(\)/)
  assert.match(source, /contextRecording: createDefaultContextRecordingState\(\)/)
  assert.match(source, /function enterSelectionMode\(pointer = null, reason = 'selection-mode-enter'\)/)
  assert.match(source, /function acquireSelectionModeCandidates\(point = null\)/)
  assert.match(source, /function handleSelectionModeInput\(msg = \{\}\)/)
  assert.match(source, /if \(handleSelectionModeInput\(msg\)\) return/)
  assert.doesNotMatch(source, /sigilUxCommandRuntime\.executeSelectionModeEnter/)
  assert.match(commandRuntimeSource, /enterSelectionMode\(pointer, payload\.context\?\.reason \|\| 'radial-reticle'\)/)
  assert.match(source, /selectionModeIsActive: \(\) => liveJs\.selectionMode\?\.active === true/)
  assert.match(source, /selectionModeOverlay: liveJs\.selectionModeOverlay \|\| buildProjectedSelectionModeOverlay/)
  assert.match(source, /function createSelectionModeContextFromDebugInput\(input = \{\}\)/)
  assert.doesNotMatch(source, deletedSelectionModeCursorPattern)
  assert.match(source, /window\.__sigilDebug = createSigilDebugApi\(/)
  assert.match(debugSource, /selectionMode: deps\.liveJs\.selectionMode/)
  assert.doesNotMatch(debugSource, deletedSelectionModeCursorPattern)
  assert.match(debugSource, /activeContext: deps\.liveJs\.activeContext/)
  assert.match(debugSource, /contextRecording: deps\.liveJs\.contextRecording/)
  assert.match(debugSource, /createSelectionModeContext\(input = \{\}\) \{[\s\S]*deps\.createSelectionModeContextFromDebugInput\(input\)/)
  assert.match(debugSource, /appendActiveContextKeyframe\(options = \{\}\) \{[\s\S]*deps\.appendContextRecordingKeyframe/)
  assert.match(debugSource, /exportContextRecording\(\) \{[\s\S]*deps\.contextRecordingRuntime\.exportContextRecording\(\)/)
})

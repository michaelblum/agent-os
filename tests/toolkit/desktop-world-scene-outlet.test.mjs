import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const outletURL = new URL('../../packages/toolkit/components/desktop-world-stage/scene-outlet.js', import.meta.url)
const stageURL = new URL('../../packages/toolkit/components/desktop-world-stage/index.js', import.meta.url)
const threeURL = new URL('../../packages/toolkit/vendor/three/three.module.min.js', import.meta.url)
const threeCoreURL = new URL('../../packages/toolkit/vendor/three/three.core.min.js', import.meta.url)

test('DesktopWorld scene outlet is local, bounded, and shares one renderer loop', async () => {
  const [outlet, stage, three, threeCore] = await Promise.all([
    readFile(outletURL, 'utf8'),
    readFile(stageURL, 'utf8'),
    stat(threeURL),
    stat(threeCoreURL),
  ])
  assert.match(outlet, /new THREE\.WebGLRenderer/u)
  assert.equal((outlet.match(/new THREE\.WebGLRenderer/gu) ?? []).length, 1)
  assert.match(outlet, /renderer\.setClearColor\(0x000000, 0\)/u)
  assert.match(outlet, /renderer\.setSize\(metrics\.cssWidth, metrics\.cssHeight, false\)[\s\S]*renderer\.clear\(true, true, true\)/u)
  assert.match(outlet, /new THREE\.OrthographicCamera/u)
  assert.doesNotMatch(outlet, /new THREE\.PerspectiveCamera/u)
  assert.match(outlet, /deriveOrthoCamera\(nextSegment\)/u)
  assert.match(outlet, /projection: 'desktop-world-orthographic'/u)
  assert.match(outlet, /createSceneAnimationController\(document/u)
  assert.match(outlet, /createSceneSignalController\(document/u)
  assert.match(outlet, /mounted\.animations\.tick\(elapsed\)/u)
  assert.match(outlet, /mounted\.interactionVisuals\?\.tick\(at\)/u)
  assert.match(outlet, /createDesktopWorldSceneInteractionThree/u)
  assert.match(outlet, /ensureInteractionVisuals/u)
  assert.match(outlet, /interactionVisuals: null/u)
  const aimBranch = outlet.slice(outlet.indexOf("if (response.kind === 'aim_commit')"), outlet.indexOf("if (response.kind === 'translate')"))
  assert.ok(aimBranch.indexOf('const revision = commitObjectPosition') < aimBranch.indexOf('const visual = interactionVisuals.apply'))
  assert.match(aimBranch, /revision === null[\s\S]*interactionVisuals\.cancel\(\)/u)
  assert.match(outlet, /mounted\.signals\.publish\(operation\.signalId/u)
  assert.doesNotMatch(outlet, /elapsed % duration/u)
  assert.match(outlet, /MAX_RESOURCES = 32/u)
  assert.match(outlet, /MAX_SIGNALS_PER_SECOND = 30/u)
  assert.match(outlet, /resolveThreeRenderMetrics/u)
  assert.match(outlet, /effectiveDevicePixelRatio/u)
  assert.match(outlet, /backingPixels/u)
  assert.match(outlet, /webglcontextlost/u)
  assert.match(outlet, /forceContextLoss/u)
  assert.doesNotMatch(outlet, /https?:\/\//u)
  assert.match(stage, /desktop_world_stage\.scene\.operation/u)
  assert.match(stage, /if \(surface\.isPrimary\)/u)
  assert.equal((stage.match(/emit\('desktop_world_stage\.scene\.result'/gu) ?? []).length, 2)
  assert.match(stage, /sceneOutlet\.updateSegment\(segment\)/u)
  assert.match(stage, /\.then\(\(\) => \{[\s\S]*emitReady\(\)/u)
  assert.doesNotMatch(stage, /\ninstallVisualObjectLiveProof\(\)\nemitReady\(\)\s*$/u)
  assert.ok(three.size > 100_000 && three.size < 1_000_000)
  assert.ok(threeCore.size > 100_000 && threeCore.size < 1_000_000)
})

test('vendored Three module carries its MIT license', async () => {
  const [license, provenance] = await Promise.all([
    readFile(new URL('../../packages/toolkit/vendor/three/LICENSE', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/toolkit/vendor/three/README.md', import.meta.url), 'utf8'),
  ])
  assert.match(license, /MIT License/u)
  assert.match(license, /three\.js authors/u)
  assert.match(provenance, /three@0\.183\.2/u)
  assert.match(provenance, /three\.core\.min\.js/u)
})

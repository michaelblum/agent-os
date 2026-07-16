import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const outletURL = new URL('../../packages/toolkit/components/desktop-world-stage/scene-outlet.js', import.meta.url)
const stageURL = new URL('../../packages/toolkit/components/desktop-world-stage/index.js', import.meta.url)
const threeURL = new URL('../../packages/toolkit/vendor/three/three.module.min.js', import.meta.url)

test('DesktopWorld scene outlet is local, bounded, and shares one renderer loop', async () => {
  const [outlet, stage, three] = await Promise.all([
    readFile(outletURL, 'utf8'),
    readFile(stageURL, 'utf8'),
    stat(threeURL),
  ])
  assert.match(outlet, /new THREE\.WebGLRenderer/u)
  assert.equal((outlet.match(/new THREE\.WebGLRenderer/gu) ?? []).length, 1)
  assert.match(outlet, /new THREE\.OrthographicCamera/u)
  assert.doesNotMatch(outlet, /new THREE\.PerspectiveCamera/u)
  assert.match(outlet, /deriveOrthoCamera\(nextSegment\)/u)
  assert.match(outlet, /projection: 'desktop-world-orthographic'/u)
  assert.match(outlet, /createSceneAnimationController\(document/u)
  assert.match(outlet, /createSceneSignalController\(document/u)
  assert.match(outlet, /mounted\.animations\.tick\(elapsed\)/u)
  assert.match(outlet, /mounted\.signals\.publish\(operation\.signalId/u)
  assert.doesNotMatch(outlet, /elapsed % duration/u)
  assert.match(outlet, /MAX_RESOURCES = 32/u)
  assert.match(outlet, /MAX_SIGNALS_PER_SECOND = 30/u)
  assert.match(outlet, /Math\.min\(2,/u)
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
})

test('vendored Three module carries its MIT license', async () => {
  const license = await readFile(new URL('../../packages/toolkit/vendor/three/LICENSE', import.meta.url), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /three\.js authors/u)
})

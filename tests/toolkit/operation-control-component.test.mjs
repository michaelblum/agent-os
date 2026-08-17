import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const componentRoot = path.join(repoRoot, 'packages/toolkit/components/operation-control')

test('operation Canvas component uses the internal typed bridge and content-free projection', async () => {
  const [html, script, model, styles] = await Promise.all([
    readFile(path.join(componentRoot, 'index.html'), 'utf8'),
    readFile(path.join(componentRoot, 'index.js'), 'utf8'),
    readFile(path.join(componentRoot, 'model.js'), 'utf8'),
    readFile(path.join(componentRoot, 'styles.css'), 'utf8'),
  ])

  assert.match(html, /data-operation-control/u)
  assert.match(script, /requestOperationSnapshot/u)
  assert.match(script, /requestHostStopAll\(model\.barrier\.generation\)/u)
  assert.match(script, /esc\(operation\.owner_root_id\)/u)
  assert.match(script, /esc\(operation\.outcome/u)
  assert.match(script, /esc\(operation\.blame/u)
  assert.match(script, /esc\(operation\.cleanup_result\)/u)
  assert.match(script, /renderResourceClaims\(operation\)/u)
  assert.match(script, /esc\(claim\.resource_key\)/u)
  assert.match(script, /renderArtifacts\(operation\)/u)
  assert.match(script, /esc\(artifact\.custody_digest\)/u)
  assert.match(model, /resource_claims: Object\.freeze\(resourceClaims\)/u)
  assert.match(model, /artifacts: Object\.freeze\(artifacts\)/u)
  assert.match(model, /RECORDING_INDICATOR_RED_STATES = new Set\(\['active'\]\)/u)
  assert.doesNotMatch(script, /human_initiated|caller_origin|owner_root\s*:/u)
  assert.match(styles, /button \{/u)
  assert.match(styles, /#ff6868/u)
})

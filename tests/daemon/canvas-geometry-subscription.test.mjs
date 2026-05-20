import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const unifiedSource = readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')

function functionBody(name) {
  const start = unifiedSource.indexOf(`func ${name}`)
  assert.ok(start >= 0, `missing function ${name}`)
  const open = unifiedSource.indexOf('{', start)
  assert.ok(open >= 0, `missing function body for ${name}`)
  let depth = 0
  for (let i = open; i < unifiedSource.length; i += 1) {
    const char = unifiedSource[i]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return unifiedSource.slice(open + 1, i)
  }
  throw new Error(`unterminated function ${name}`)
}

test('daemon wires canvas_geometry at startup, not from generic subscriber broadcast', () => {
  const broadcastBody = functionBody('broadcastEvent')
  assert.doesNotMatch(broadcastBody, /onCanvasGeometry/)

  const lifecycleIndex = unifiedSource.indexOf('canvasManager.onCanvasLifecycle =')
  const geometryIndex = unifiedSource.indexOf('canvasManager.onCanvasGeometry =')
  const surfaceIndex = unifiedSource.indexOf('canvasManager.onCanvasSurfaceEvent =')

  assert.ok(lifecycleIndex >= 0, 'missing lifecycle callback wiring')
  assert.ok(geometryIndex > lifecycleIndex, 'geometry callback should be beside CanvasManager startup callbacks')
  assert.ok(surfaceIndex > geometryIndex, 'geometry callback should be wired before later CanvasManager callbacks')
})

test('canvas_geometry fans out to canvas event subscribers independently of display subscribers', () => {
  const publishBody = functionBody('publishCanvasGeometry')

  assert.match(publishBody, /broadcastEvent\(service:\s*"display",\s*event:\s*"canvas_geometry"/)
  assert.match(publishBody, /forwardSubscribedEventToCanvases\(type:\s*"canvas_geometry",\s*data:\s*data\)/)
  assert.doesNotMatch(publishBody, /fanOutCanvasLifecycle/)
})

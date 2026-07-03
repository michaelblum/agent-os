import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const canvasPath = new URL('../../src/display/canvas.swift', import.meta.url)

function classBody(source, className) {
  const signature = `class ${className}`
  const signatureIndex = source.indexOf(signature)
  assert.notEqual(signatureIndex, -1, `${signature} should exist`)
  const openBraceIndex = source.indexOf('{', signatureIndex)
  assert.notEqual(openBraceIndex, -1, `${signature} should have a body`)

  let depth = 0
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBraceIndex + 1, index)
    }
  }
  assert.fail(`${signature} body should close`)
}

function swiftFunctionBody(source, signature) {
  const signatureIndex = source.indexOf(signature)
  assert.notEqual(signatureIndex, -1, `${signature} should exist`)
  const openBraceIndex = source.indexOf('{', signatureIndex)
  assert.notEqual(openBraceIndex, -1, `${signature} should have a body`)

  let depth = 0
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBraceIndex + 1, index)
    }
  }
  assert.fail(`${signature} body should close`)
}

test('AosSchemeHandler fails fast without blocking the main thread when content port is unavailable', () => {
  const source = fs.readFileSync(canvasPath, 'utf8')
  const handlerBody = classBody(source, 'AosSchemeHandler')
  const startBody = swiftFunctionBody(handlerBody, 'func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask)')

  assert.doesNotMatch(handlerBody, /waitForPort/)
  assert.doesNotMatch(handlerBody, /Thread\.sleep/)
  assert.doesNotMatch(handlerBody, /while\s+[^{}]*port/)
  assert.match(handlerBody, /private func currentContentPort\(\) -> UInt16[\s\S]*return portProvider\(\)/)
  assert.match(startBody, /let port = currentContentPort\(\)/)
  assert.match(startBody, /guard port > 0 else/)
  assert.match(startBody, /content server unavailable for/)
  assert.match(startBody, /aos:\/\/ content server unavailable/)
  assert.match(startBody, /urlSchemeTask\.didReceive\(response\)[\s\S]*urlSchemeTask\.didReceive\(data\)[\s\S]*urlSchemeTask\.didFinish\(\)/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const canvasPath = new URL('../../src/display/canvas.swift', import.meta.url)
const responsePath = new URL('../../src/display/aos-scheme-response.swift', import.meta.url)

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

test('AosSchemeHandler keeps aos identity and bypasses stale local cache', () => {
  const source = fs.readFileSync(canvasPath, 'utf8')
  const responseSource = fs.readFileSync(responsePath, 'utf8')
  const handlerBody = classBody(source, 'AosSchemeHandler')
  const responseBody = swiftFunctionBody(responseSource, 'func aosSchemeOriginalURLResponse')
  const startBody = swiftFunctionBody(handlerBody, 'func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask)')

  assert.match(responseBody, /HTTPURLResponse\([\s\S]*url: requestURL/u)
  assert.match(responseBody, /headers\["Cache-Control"\] = "no-store"/u)
  assert.match(responseBody, /headers\["Pragma"\] = "no-cache"/u)
  assert.match(startBody, /request\.cachePolicy = \.reloadIgnoringLocalCacheData/u)
  assert.match(startBody, /aosSchemeOriginalURLResponse\(response, requestURL: url\)/u)
})

test('scheme response normalization preserves request identity and replaces cache policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-scheme-response-'))
  try {
    const main = path.join(root, 'main.swift')
    const executable = path.join(root, 'scheme-response-test')
    fs.writeFileSync(main, `
import Foundation

let upstream = HTTPURLResponse(
    url: URL(string: "http://127.0.0.1:1234/toolkit/module.js")!,
    statusCode: 200,
    httpVersion: nil,
    headerFields: [
        "Content-Type": "text/javascript",
        "cache-control": "max-age=3600",
        "pragma": "cache"
    ]
)!
let original = URL(string: "aos://toolkit/module.js")!
let normalized = aosSchemeOriginalURLResponse(upstream, requestURL: original)
precondition(normalized.url == original)
let http = normalized as! HTTPURLResponse
precondition(http.statusCode == 200)
precondition(http.value(forHTTPHeaderField: "Cache-Control") == "no-store")
precondition(http.value(forHTTPHeaderField: "Pragma") == "no-cache")
precondition(http.mimeType == "text/javascript")
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      fileURLToPath(responsePath),
      main,
      '-o', executable,
    ], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

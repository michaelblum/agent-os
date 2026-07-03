import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function functionBody(swiftSource, signature) {
  const start = swiftSource.indexOf(signature);
  return functionBodyAfter(swiftSource, signature, start);
}

function functionBodyAfter(swiftSource, signature, startAt) {
  const start = swiftSource.indexOf(signature, startAt);
  assert.notEqual(start, -1, `${signature} not found`);
  const brace = swiftSource.indexOf('{', start);
  assert.notEqual(brace, -1, `${signature} body not found`);
  let depth = 0;
  for (let i = brace; i < swiftSource.length; i += 1) {
    if (swiftSource[i] === '{') depth += 1;
    else if (swiftSource[i] === '}') {
      depth -= 1;
      if (depth === 0) return swiftSource.slice(brace + 1, i);
    }
  }
  throw new Error(`${signature} body did not close`);
}

test('single Canvas close clears retained callbacks before closing WebKit window', () => {
  const body = functionBody(source('src/display/canvas.swift'), 'func close()');
  const onMessage = body.indexOf('onMessage = nil');
  const onTTLExpired = body.indexOf('onTTLExpired = nil');
  const removeHandler = body.indexOf('removeScriptMessageHandler(forName: "headsup")');
  const closeWindow = body.indexOf('window.close()');

  assert.ok(onMessage >= 0, 'Canvas.close should clear the message callback');
  assert.ok(onTTLExpired >= 0, 'Canvas.close should clear the TTL callback');
  assert.ok(removeHandler > onMessage, 'Canvas.close should clear callbacks before removing WebKit handler');
  assert.ok(closeWindow > removeHandler, 'Canvas.close should remove WebKit handler before closing window');
});

test('DesktopWorldSurfaceCanvas close clears retained callbacks and segment handlers', () => {
  const swiftSource = source('src/display/desktop-world-surface.swift');
  const classStart = swiftSource.indexOf('final class DesktopWorldSurfaceCanvas');
  assert.notEqual(classStart, -1, 'DesktopWorldSurfaceCanvas class not found');
  const body = functionBodyAfter(swiftSource, 'func close()', classStart);
  const onMessage = body.indexOf('onMessage = nil');
  const onTTLExpired = body.indexOf('onTTLExpired = nil');
  const segmentHandler = body.indexOf('segment.messageHandler.onMessage = nil');
  const segmentsCleared = body.indexOf('segments = []');

  assert.ok(onMessage >= 0, 'DesktopWorldSurfaceCanvas.close should clear the retained message callback');
  assert.ok(onTTLExpired >= 0, 'DesktopWorldSurfaceCanvas.close should clear the TTL callback');
  assert.ok(segmentHandler > onMessage, 'DesktopWorldSurfaceCanvas.close should clear segment handlers after clearing root callback');
  assert.ok(segmentsCleared > segmentHandler, 'DesktopWorldSurfaceCanvas.close should clear segments after handler teardown');
});

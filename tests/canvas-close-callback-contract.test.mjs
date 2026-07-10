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

test('single Canvas retirement quiesces callbacks before finalizing WebKit', () => {
  const swiftSource = source('src/display/canvas.swift');
  const classStart = swiftSource.indexOf('class Canvas {');
  assert.notEqual(classStart, -1, 'Canvas class not found');
  const quiesce = functionBodyAfter(swiftSource, 'func quiesceForRetirement()', classStart);
  const finalize = functionBodyAfter(swiftSource, 'func finalizeRetirement()', classStart);
  const onMessage = quiesce.indexOf('onMessage = nil');
  const onTTLExpired = quiesce.indexOf('onTTLExpired = nil');
  const orderOut = quiesce.indexOf('window.orderOut(nil)');
  const callQuiesce = finalize.indexOf('quiesceForRetirement()');
  const removeHandler = finalize.indexOf('removeScriptMessageHandler(forName: "headsup")');
  const closeWindow = finalize.indexOf('window.close()');

  assert.ok(onMessage >= 0, 'Canvas quiesce should clear the message callback');
  assert.ok(onTTLExpired >= 0, 'Canvas quiesce should clear the TTL callback');
  assert.ok(orderOut > onMessage, 'Canvas quiesce should clear callbacks before hiding the window');
  assert.ok(callQuiesce >= 0, 'Canvas finalization should be idempotently quiesced');
  assert.ok(removeHandler > callQuiesce, 'Canvas finalization should quiesce before removing WebKit handler');
  assert.ok(closeWindow > removeHandler, 'Canvas finalization should remove WebKit handler before closing');
});

test('DesktopWorldSurfaceCanvas retirement delegates every segment to the shared primitive', () => {
  const swiftSource = source('src/display/desktop-world-surface.swift');
  const classStart = swiftSource.indexOf('final class DesktopWorldSurfaceCanvas');
  assert.notEqual(classStart, -1, 'DesktopWorldSurfaceCanvas class not found');
  const surfaceMethodsStart = swiftSource.indexOf('var remainingTTL:', classStart);
  assert.notEqual(surfaceMethodsStart, -1, 'DesktopWorldSurfaceCanvas methods not found');
  const quiesce = functionBodyAfter(swiftSource, 'func quiesceForRetirement()', surfaceMethodsStart);
  const finalize = functionBodyAfter(swiftSource, 'func finalizeRetirement()', surfaceMethodsStart);
  const onMessage = quiesce.indexOf('onMessage = nil');
  const onTTLExpired = quiesce.indexOf('onTTLExpired = nil');
  const segmentQuiesce = quiesce.indexOf('segment.quiesceForRetirement()');
  const segmentFinalize = finalize.indexOf('segment.finalizeRetirement()');
  const segmentsCleared = finalize.indexOf('segments = []');

  assert.ok(onMessage >= 0, 'surface quiesce should clear the retained message callback');
  assert.ok(onTTLExpired >= 0, 'surface quiesce should clear the TTL callback');
  assert.ok(segmentQuiesce > onMessage, 'surface quiesce should delegate segment native resources');
  assert.ok(segmentFinalize >= 0, 'surface finalization should delegate segment native resources');
  assert.ok(segmentsCleared > segmentFinalize, 'surface finalization should clear segments after teardown');
});

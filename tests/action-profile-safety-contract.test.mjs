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

test('profile-driven motion step counts sanitize speed before integer conversion', () => {
  const helpers = source('src/act/act-helpers.swift');
  const helperBody = functionBody(helpers, 'func safeMotionStepCount(');
  assert.match(helperBody, /safePositiveDouble\(pixelsPerSecond,\s*fallback:\s*1200\.0\)/);
  assert.match(helperBody, /safePositiveDouble\(stepInterval,\s*fallback:\s*0\.008\)/);
  assert.match(helperBody, /safeNonNegativeDouble\(distance\)/);
  assert.match(helperBody, /guard rawSteps\.isFinite && rawSteps > 0 else \{ return 1 \}/);
  assert.match(helperBody, /Int\(min\(rawSteps,\s*50_000\.0\)\)/);

  const actions = source('src/act/actions.swift');
  const moveBody = functionBody(actions, 'func handleMove(');
  const dragBody = functionBody(actions, 'func handleDrag(');

  assert.match(moveBody, /safeMotionStepCount\(\s*distance:\s*dist,\s*pixelsPerSecond:\s*profile\.mouse\.pixels_per_second,/s);
  assert.match(dragBody, /safeMotionStepCount\(\s*distance:\s*dist,\s*pixelsPerSecond:\s*profile\.mouse\.pixels_per_second,/s);
  assert.doesNotMatch(moveBody, /Int\(duration \/ stepInterval\)/);
  assert.doesNotMatch(dragBody, /Int\(duration \/ stepInterval\)/);
});

test('delay sampling clamps negative and reversed profile ranges before UInt32 conversion', () => {
  const body = functionBody(source('src/act/act-helpers.swift'), 'func sampleDelay(');
  const delayCap = body.indexOf('let maxDelayMs = Int(UInt32.max / 1000)');
  const lowerClamp = body.indexOf('let lowerMs = min(max(0, range.min), maxDelayMs)');
  const upperClamp = body.indexOf('let upperMs = min(max(0, range.max), maxDelayMs)');
  const loNormalize = body.indexOf('let lo = Double(min(lowerMs, upperMs))');
  const hiNormalize = body.indexOf('let hi = Double(max(lowerMs, upperMs))');
  const uintConversion = body.indexOf('UInt32(lo) * 1000');
  const randomRange = body.indexOf('Double.random(in: lo...hi)');

  assert.ok(delayCap >= 0, 'sampleDelay should cap values before UInt32 conversion');
  assert.ok(lowerClamp > delayCap, 'sampleDelay should clamp negative min values');
  assert.ok(upperClamp > lowerClamp, 'sampleDelay should clamp negative max values');
  assert.ok(loNormalize > upperClamp, 'sampleDelay should normalize the lower bound');
  assert.ok(hiNormalize > loNormalize, 'sampleDelay should normalize the upper bound');
  assert.ok(uintConversion > hiNormalize, 'UInt32 conversion should only see clamped values');
  assert.ok(randomRange > hiNormalize, 'random range should only see normalized bounds');
});

test('typing cadence sanitizes WPM and variance before random jitter', () => {
  const body = functionBody(source('src/act/actions.swift'), 'func handleType(');
  const wpmClamp = body.indexOf('let wpm = max(1, cadence.wpm)');
  const varianceClamp = body.indexOf('let variance = safeUnitInterval(cadence.variance)');
  const baseInterval = body.indexOf('let baseIntervalMs = max(1.0, 1000.0 / charsPerSecond)');
  const randomJitter = body.indexOf('Double.random(in: -variance...variance)');

  assert.ok(wpmClamp >= 0, 'typing cadence should clamp non-positive WPM');
  assert.ok(varianceClamp > wpmClamp, 'typing cadence should clamp variance');
  assert.ok(baseInterval > varianceClamp, 'base interval should be bounded');
  assert.ok(randomJitter > baseInterval, 'jitter range should use sanitized variance');
});

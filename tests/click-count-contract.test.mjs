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

test('handleClick rejects non-positive counts before posting click events', () => {
  const body = functionBody(source('src/act/actions.swift'), 'func handleClick(');
  const clickCount = body.indexOf('let clickCount = req.count ?? 1');
  const invalidCount = body.indexOf('guard clickCount > 0 else');
  const invalidCode = body.indexOf('code: "INVALID_COUNT"');
  const eventOwner = body.indexOf('let owner = state.eventPostingOwner');
  const clickRange = body.indexOf('for i in 1...clickCount');

  assert.ok(clickCount >= 0, 'handleClick should normalize missing count to one');
  assert.ok(invalidCount > clickCount, 'handleClick should validate the normalized count');
  assert.ok(invalidCode > invalidCount, 'invalid click counts should return a structured error');
  assert.ok(eventOwner > invalidCode, 'invalid count should be rejected before the event owner is used');
  assert.ok(clickRange > invalidCode, 'invalid count should be rejected before the trapping range loop');
});

test('CGEvent actions await terminal receipts without fixed completion sleeps', () => {
  const models = source('src/act/act-models.swift');
  const actions = source('src/act/actions.swift');
  const posting = source('src/act/event-posting.swift');
  const deliveryState = source('src/act/input-delivery-state.swift');
  const receiptTap = source('src/act/input-receipt-tap.swift');
  const session = source('src/act/session.swift');

  assert.match(models, /let eventPostingOwner:\s*AOSCGEventPostingOwner/);
  assert.match(models, /var terminal_event_receipt:\s*String\?/);
  assert.doesNotMatch(actions, /CGEventSource\(stateID:\s*\.hidSystemState\)/);
  assert.match(posting, /guard receiptTapOwner\.start\(\) else \{ return nil \}/);
  assert.match(posting, /guard let receipt,\s*receiptTapOwner\.isActive else \{ return false \}/);
  assert.match(posting, /defer \{ tracker\.clearAll\(\) \}/);
  assert.match(receiptTap, /nextWorker\.name\s*=\s*"aos-input-receipt-tap"/);
  assert.match(receiptTap, /CFRunLoopAddSource\(runLoop,\s*source,\s*\.commonModes\)/);
  assert.match(receiptTap, /CFRunLoopRun\(\)/);
  assert.match(receiptTap, /type == \.tapDisabledByTimeout \|\| type == \.tapDisabledByUserInput/);
  assert.match(receiptTap, /CGEvent\.tapEnable\(tap:\s*tap,\s*enable:\s*true\)/);
  assert.match(posting, /tracker\.begin\(marker:\s*receipt\.marker,\s*eventType:\s*event\.type\.rawValue\)/);
  assert.match(actions, /func handleMove[\s\S]*?owner\.post\(event\)[\s\S]*?func handleClick/);
  assert.match(actions, /owner\.post\(up,\s*receipt:\s*receipt,\s*awaitReceipt:\s*true\)/);
  assert.match(actions, /func handleDrag[\s\S]*?owner\.post\(down,\s*receipt:\s*receipt,\s*awaitReceipt:\s*true\)/);
  assert.match(actions, /func handleDrag[\s\S]*?postBestEffortPointerRelease\(owner:\s*owner,\s*point:\s*origin,\s*flags:\s*flags,\s*receipt:\s*receipt\)/);
  assert.match(actions, /CGEVENT_DELIVERY_UNCONFIRMED/);
  assert.match(posting, /event\.setIntegerValueField\(\.eventSourceUserData,\s*value:\s*receipt\.marker\)/);
  assert.match(posting, /tracker\.waitAndConsume\([\s\S]*?marker:\s*receipt\.marker,[\s\S]*?eventType:\s*event\.type\.rawValue,[\s\S]*?timeout:\s*timeout/);
  assert.match(receiptTap, /tracker\.observe\(marker:\s*marker,\s*eventType:\s*type\.rawValue\)/);
  assert.match(posting, /tracker\.clearAll\(\)/);
  assert.match(deliveryState, /private var pending:\s*Expectation\?/);
  assert.match(deliveryState, /var uncertainState:\s*Set<String>\s*\{\s*before\.union\(after\)\s*\}/);
  assert.doesNotMatch(posting, /private var observed:\s*Set/);
  assert.doesNotMatch(posting, /CFRunLoopRunInMode/);
  assert.doesNotMatch(posting, /Thread\.sleep/);
  assert.match(posting, /receiptTapOwner\.stop\(\)/);
  assert.match(session, /keyboardEventSource:\s*state\.eventPostingOwner\.source/);
  assert.doesNotMatch(actions, /usleep\(50_000\)/);
});

test('modifier receipt timeouts remain owned by session cleanup', () => {
  const actions = source('src/act/actions.swift');
  const keyDown = functionBody(actions, 'func handleKeyDown(');
  const keyUp = functionBody(actions, 'func handleKeyUp(');

  assert.match(keyDown, /AOSModifierDeliveryTransition\(before:\s*before,\s*after:\s*after\)/);
  assert.match(keyDown, /state\.modifiers\s*=\s*transition\.uncertainState/);
  assert.doesNotMatch(keyDown, /state\.modifiers\.remove\(modifier\)/);
  assert.match(keyUp, /AOSModifierDeliveryTransition\(before:\s*before,\s*after:\s*after\)/);
  assert.match(keyUp, /state\.modifiers\s*=\s*transition\.uncertainState/);
});

test('drag owns mouse release until terminal up is acknowledged', () => {
  const actions = source('src/act/actions.swift');
  const body = functionBody(actions, 'func handleDrag(');
  const release = functionBody(actions, 'private func postBestEffortPointerRelease(');
  const downAcknowledged = body.indexOf('owner.post(down, receipt: receipt, awaitReceipt: true)');
  const obligation = body.indexOf('var releaseObligation = AOSPointerReleaseObligation(point: origin)');
  const deferredRelease = body.indexOf('if releaseObligation.isPending');
  const terminalAcknowledged = body.lastIndexOf('owner.post(up, receipt: receipt, awaitReceipt: true)');
  const fulfilled = body.indexOf('releaseObligation.fulfill()');

  assert.ok(downAcknowledged >= 0, 'drag should acknowledge down before taking release ownership');
  assert.ok(obligation > downAcknowledged, 'release obligation should begin only after acknowledged down');
  assert.ok(deferredRelease > obligation, 'drag should install a deferred best-effort release');
  assert.match(body, /postBestEffortPointerRelease\([\s\S]*?point:\s*releaseObligation\.point/);
  assert.match(release, /mouseType:\s*\.leftMouseUp/);
  assert.match(release, /owner\.post\(release,\s*receipt:\s*receipt\)/);
  assert.ok(terminalAcknowledged > deferredRelease, 'terminal up should run under the release obligation');
  assert.ok(fulfilled > terminalAcknowledged, 'only acknowledged terminal up should fulfill release ownership');
});

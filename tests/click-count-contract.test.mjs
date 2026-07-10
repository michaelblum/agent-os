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
  const session = source('src/act/session.swift');

  assert.match(models, /let eventPostingOwner:\s*AOSCGEventPostingOwner/);
  assert.match(models, /var terminal_event_receipt:\s*String\?/);
  assert.doesNotMatch(actions, /CGEventSource\(stateID:\s*\.hidSystemState\)/);
  assert.match(posting, /guard ensureReceiptTap\(\) else \{ return nil \}/);
  assert.match(posting, /defer \{ teardownReceiptTap\(\) \}/);
  assert.match(posting, /CGEvent\.tapIsEnabled\(tap:\s*receiptTap\)/);
  assert.match(posting, /type == \.tapDisabledByTimeout \|\| type == \.tapDisabledByUserInput/);
  assert.match(posting, /CGEvent\.tapEnable\(tap:\s*tap,\s*enable:\s*true\)/);
  assert.match(actions, /func handleMove[\s\S]*?owner\.post\(event\)[\s\S]*?func handleClick/);
  assert.match(actions, /owner\.post\(up,\s*receipt:\s*receipt,\s*awaitReceipt:\s*true\)/);
  assert.match(actions, /CGEVENT_DELIVERY_UNCONFIRMED/);
  assert.match(posting, /event\.setIntegerValueField\(\.eventSourceUserData,\s*value:\s*receipt\.marker\)/);
  assert.match(posting, /tracker\.consume\(receipt\.marker,\s*eventType:\s*event\.type\)/);
  assert.match(session, /keyboardEventSource:\s*state\.eventPostingOwner\.source/);
  assert.doesNotMatch(actions, /usleep\(50_000\)/);
});

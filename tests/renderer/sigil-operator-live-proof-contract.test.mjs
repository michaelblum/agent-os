import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operatorCardUrl = new URL(
  '../../docs/design/work-cards/operator-input-event-v2-live-proof-v0.md',
  import.meta.url
);

test('Operator live proof shows Sigil and waits for an interactive hit target before probe reset', async () => {
  const card = await readFile(operatorCardUrl, 'utf8');

  const refreshIndex = card.indexOf('./aos show update --id avatar-main');
  const showIndex = card.indexOf('window.__sigilDebug?.dispatch?.({ type: "status_item.show"', refreshIndex);
  const visibleWaitIndex = card.indexOf('avatar-main-visible-hit-target-wait.json', showIndex);
  const probeEnableIndex = card.indexOf('sigil-probe-enable.json');

  assert.notEqual(refreshIndex, -1, 'card should preserve the stale-renderer URL refresh step');
  assert.notEqual(showIndex, -1, 'card should explicitly show Sigil after freshness/refresh handling');
  assert.notEqual(visibleWaitIndex, -1, 'card should save the visible/interactable wait artifact');
  assert.notEqual(probeEnableIndex, -1, 'card should enable the probe after visible state is proven');
  assert.ok(refreshIndex < showIndex, 'Sigil show must happen after the stale-renderer refresh path');
  assert.ok(showIndex < visibleWaitIndex, 'visible wait must happen after status_item.show');
  assert.ok(visibleWaitIndex < probeEnableIndex, 'probe must not reset before visible hit target proof');

  const visibleWaitBlock = card.slice(showIndex, probeEnableIndex);
  assert.match(visibleWaitBlock, /window\.__sigilDebug\?\.dispatch\?\.\(\{ type: "status_item\.show"/);
  assert.match(visibleWaitBlock, /avatarVisible === true/);
  assert.match(visibleWaitBlock, /hitTargetInteractive === true/);
  assert.match(visibleWaitBlock, /sigil-visible-hit-target-before-probe\.json/);
});

test('Operator child hit proof rejects scroll-only and controls-closed canvas-origin samples', async () => {
  const card = await readFile(operatorCardUrl, 'utf8');
  const childProofIndex = card.indexOf('For Sigil child hit-surface proof');
  const passIndex = card.indexOf('Pass:', childProofIndex);
  const childProofBlock = card.slice(childProofIndex, passIndex);

  assert.match(childProofBlock, /Real right-click on the avatar to open avatar controls/);
  assert.match(childProofBlock, /Real left pointer interaction inside the opened controls/);
  assert.match(childProofBlock, /controls-closed/);
  assert.match(childProofBlock, /not handled child hit-surface proof/i);
});

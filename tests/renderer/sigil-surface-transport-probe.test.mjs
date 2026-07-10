import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createSurfaceTransportProbe } from '../../apps/sigil/renderer/live-modules/surface-transport-probe.js';

test('surface transport probe is inert until enabled', () => {
  const windowObject = { location: { search: '' } };
  const probe = createSurfaceTransportProbe({ windowObject, label: 'unit' });

  probe.recordPanelMessage('sent', 'sigil.avatar_panel.control_change');
  probe.recordRenderFrame({ structural: true, overlay: true, publishState: true });

  let snapshot = probe.snapshot();
  assert.equal(snapshot.enabled, false);
  assert.deepEqual(snapshot.panel_messages.sent, {});
  assert.equal(snapshot.render.frames, 0);

  assert.equal(probe.setEnabled(true), true);
  probe.recordPanelMessage('sent', 'sigil.avatar_panel.control_change');
  probe.recordPanelMessage('sent', 'sigil.avatar_panel.snapshot');
  probe.recordPanelMessage('received', 'sigil.avatar_panel.update');
  probe.recordRenderFrame({ structural: true, overlay: true, publishState: true });
  probe.recordRenderEmit('overlay.draw');
  probe.recordRenderEmit('desktopWorldSurface.publishState');
  probe.recordRenderEmit('hitTarget.sync', false);
  probe.recordRenderEmit('input_region.sync', true);
  probe.recordInputEvent({ type: 'mouse_moved', canvas_id: 'avatar-main' });

  snapshot = probe.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(windowObject.__aosSurfaceTransportProbeEnabled, true);
  assert.deepEqual(snapshot.panel_messages.sent, {
    control_change: 1,
    snapshot: 1,
  });
  assert.deepEqual(snapshot.panel_messages.received, {
    update: 1,
  });
  assert.equal(snapshot.render.frames, 1);
  assert.equal(snapshot.render.work.structural, 1);
  assert.equal(snapshot.render.overlay_draws, 1);
  assert.equal(snapshot.render.desktop_world_publish_state_calls, 1);
  assert.equal(snapshot.render.hit_target_sync_calls, 1);
  assert.equal(snapshot.render.hit_target_sync_changes, 0);
  assert.equal(snapshot.render.input_region_sync_calls, 1);
  assert.equal(snapshot.render.input_region_sync_changes, 1);
  assert.equal(snapshot.recent_input_events.total, 1);
  assert.equal(snapshot.recent_input_events.by_canvas['avatar-main'], 1);
});

test('surface transport probe can be enabled by URL flag and reset', () => {
  const windowObject = { location: { search: '?aos-surface-transport-probe=1' } };
  const probe = createSurfaceTransportProbe({ windowObject });

  probe.recordPanelMessage('sent', 'sigil.avatar_panel.projection_action');
  assert.equal(probe.snapshot().panel_messages.sent.projection_action, 1);
  assert.equal(probe.snapshot().panel_messages.sent.other_avatar_panel, 1);

  probe.reset();
  assert.deepEqual(probe.snapshot().panel_messages.sent, {});
});

test('surface transport probe samples canonical input identity fields for handled paths', () => {
  const probe = createSurfaceTransportProbe({ windowObject: { location: { search: '' } } });
  probe.setEnabled(true);

  probe.recordInputEvent({
    type: 'left_mouse_down',
    envelope_type: null,
    canvas_id: 'avatar-main',
    input_schema_version: 2,
    event_kind: 'pointer',
    sequence: { source: 'daemon', value: 42 },
    coordinate_authority: 'daemon',
    source_origin: 'daemon',
  });
  probe.recordInputEvent({
    type: 'left_mouse_dragged',
    envelope_type: 'input_region.event',
    canvas_id: 'avatar-main',
    routedInput: {
      routed_schema_version: 1,
      event_kind: 'pointer',
      sequence: { source: 'daemon', value: 'drag-1' },
      coordinate_authority: 'daemon',
      source_origin: 'daemon',
      owner_canvas_id: 'avatar-main',
      region_id: 'sigil-avatar-controls-input-region',
    },
  });
  probe.recordInputEvent({
    type: 'left_mouse_up',
    envelope_type: 'aos_routed_input',
    canvas_id: 'avatar-main',
    routed_schema_version: 1,
    event_kind: 'pointer',
    sequence: { source: 'toolkit', value: 'sigil-hit-avatar-main:avatar-main:mouse:left' },
    coordinate_authority: 'toolkit',
    source_origin: 'canvas',
    source_canvas_id: 'sigil-hit-avatar-main',
    owner_canvas_id: 'avatar-main',
    region_id: 'sigil-hit-avatar-main',
  });

  const snapshot = probe.snapshot();
  assert.equal(snapshot.input_events.length, 3);
  assert.deepEqual(snapshot.input_events.map((event) => event.envelope_type), [
    null,
    'input_region.event',
    'aos_routed_input',
  ]);
  assert.equal(snapshot.input_events[0].input_schema_version, 2);
  assert.equal(snapshot.input_events[0].sequence.value, 42);
  assert.equal(snapshot.input_events[1].routed_schema_version, 1);
  assert.equal(snapshot.input_events[1].region_id, 'sigil-avatar-controls-input-region');
  assert.equal(snapshot.input_events[2].source_origin, 'canvas');
  assert.equal(snapshot.input_events[2].source_canvas_id, 'sigil-hit-avatar-main');
  assert.equal(snapshot.recent_input_events.total, 3);
  assert.equal(snapshot.recent_input_events.by_kind.left_mouse_down, 1);
  assert.equal(snapshot.recent_input_events.by_kind.left_mouse_dragged, 1);
  assert.equal(snapshot.recent_input_events.by_kind.left_mouse_up, 1);
});

test('Sigil renderer records probe input at the handled input boundary', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8');
  const handleInputEvent = source.match(/function handleInputEvent\(msg\) \{[\s\S]*?\n\}/)?.[0] || '';
  const handleHostMessage = source.match(/function handleHostMessage\(rawMsg\) \{[\s\S]*?if \(!shouldProcessGlobalDaemonEvent\(msg\)\) return;/)?.[0] || '';

  assert.match(handleInputEvent, /recordHandledInputProbeEvent\(msg\);/);
  assert.doesNotMatch(handleHostMessage, /surfaceTransportProbe\.recordInputEvent/);
});

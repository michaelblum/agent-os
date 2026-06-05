import assert from 'node:assert/strict';
import test from 'node:test';

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

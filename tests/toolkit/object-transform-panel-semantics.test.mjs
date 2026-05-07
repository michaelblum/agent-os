import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  descriptorInputAttrs,
  objectRowAttrs,
  tripletInputAttrs,
  visibilityToggleAttrs,
} from '../../packages/toolkit/components/object-transform-panel/semantics.js';

const entry = Object.freeze({
  key: 'avatar-main:radial.wiki-brain.tree',
  canvas_id: 'avatar-main',
  object_id: 'radial.wiki-brain.tree',
  name: 'Tree',
  visible: true,
});

test('object row attrs preserve stable semantic refs', () => {
  assert.equal(
    objectRowAttrs(entry, true),
    'aria-label="Select Tree" data-aos-ref="object-transform-panel:object:avatar-main:radial.wiki-brain.tree" data-aos-surface="object-transform-panel" data-semantic-target-id="object-avatar-main:radial.wiki-brain.tree" data-aos-action="select_object" aria-selected="true"',
  );
});

test('visibility attrs preserve mixed checkbox semantics', () => {
  assert.equal(
    visibilityToggleAttrs(entry, { checked: false, mixed: true }),
    'aria-label="Show Tree" data-aos-ref="object-transform-panel:visibility:avatar-main:radial.wiki-brain.tree" data-aos-surface="object-transform-panel" data-semantic-target-id="visibility-avatar-main:radial.wiki-brain.tree" data-aos-action="toggle_visibility" aria-checked="mixed"',
  );
});

test('transform and descriptor input attrs preserve values and refs', () => {
  assert.equal(
    tripletInputAttrs(entry, 'rotation_degrees', 'x', '-11.5'),
    'aria-label="rotation x for Tree" data-aos-ref="object-transform-panel:input:avatar-main:radial.wiki-brain.tree:rotation_degrees:x" data-aos-surface="object-transform-panel" data-semantic-target-id="rotation_degrees-x-avatar-main:radial.wiki-brain.tree" data-aos-action="edit_transform" aria-valuetext="-11.5"',
  );
  assert.equal(
    descriptorInputAttrs(entry, 'animation_effects', 'Pulse "fast" & glow'),
    'aria-label="animation effects descriptor for Tree" data-aos-ref="object-transform-panel:descriptor:avatar-main:radial.wiki-brain.tree:animation_effects" data-aos-surface="object-transform-panel" data-semantic-target-id="descriptor-animation_effects-avatar-main:radial.wiki-brain.tree" data-aos-action="edit_descriptor" aria-valuetext="Pulse &quot;fast&quot; &amp; glow"',
  );
});

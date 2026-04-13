// Birthplace position resolver for Sigil agents.
//
// Maps an agent's `instance.birthplace` descriptor + the current display
// geometry to an absolute global-canvas (x, y) point. Consulted at first
// spawn only; subsequent spawns use the daemon-side lastPosition map.
//
// Inputs:
//   birthplace: one of
//     - { anchor: 'coords', coords: { x, y } }                   // absolute point
//     - { anchor: 'nonant', nonant: <cell>, display: <uuid|'main'> }
//   displays: AOS display_geometry array; each entry has
//             { uuid, is_main, visible_bounds: { x, y, w, h }, ... }
//
// Nonant grid: 3x3 cells on the visible-bounds rect; cell centers at
// (1/6, 3/6, 5/6) along each axis.
//
// Fallbacks (robust by design — never throws for bad input):
//   - unknown display UUID           → main display
//   - unknown nonant cell            → 'bottom-right'
//   - no displays / empty array      → { x: 0, y: 0 }

const NONANT_CELLS = {
  'top-left':      [1/6, 1/6],
  'top-center':    [3/6, 1/6],
  'top-right':     [5/6, 1/6],
  'middle-left':   [1/6, 3/6],
  'middle-center': [3/6, 3/6],
  'middle-right':  [5/6, 3/6],
  'bottom-left':   [1/6, 5/6],
  'bottom-center': [3/6, 5/6],
  'bottom-right':  [5/6, 5/6],
};

export function resolveBirthplace(birthplace, displays) {
  const mainDisplay = displays.find(d => d.is_main) ?? displays[0];
  if (!mainDisplay) return { x: 0, y: 0 };

  if (birthplace.anchor === 'coords' && birthplace.coords) {
    return { x: birthplace.coords.x, y: birthplace.coords.y };
  }

  // Anchor to display — resolve by UUID or 'main'
  const target = birthplace.display === 'main'
    ? mainDisplay
    : (displays.find(d => d.uuid === birthplace.display) ?? mainDisplay);

  const vb = target.visible_bounds;
  const cell = NONANT_CELLS[birthplace.nonant ?? 'bottom-right'] ?? NONANT_CELLS['bottom-right'];
  return { x: vb.x + vb.w * cell[0], y: vb.y + vb.h * cell[1] };
}

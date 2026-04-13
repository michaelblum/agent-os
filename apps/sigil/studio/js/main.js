// main.js — Studio bootstrap.
// Studio is a control surface. The live renderer on the desktop is the preview.
// We do not init a Three.js scene here; we only wire the UI.

import { setupUI, setupEditableLabels } from './ui.js';
import { setupChip } from './chip.js';
import { setupRoster } from './roster.js';
import { setupReroll } from './reroll.js';

function init() {
  setupUI();
  setupEditableLabels();
  setupChip();
  setupRoster();
  setupReroll();
}

window.addEventListener('DOMContentLoaded', init);

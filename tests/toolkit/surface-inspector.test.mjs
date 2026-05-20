import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildAnnotationActionControlCanvasRecords,
  buildAnnotationHitLayerFrame,
  buildAnnotationNativeHitRegions,
  buildAnnotationOverlayEvalScript,
  buildAnnotationScopedHitRegions,
  buildSurfaceInspectorAnnotationTreeViewItems,
  buildRevealPayloadForSurfaceInspectorPin,
  buildSemanticTargetsRequestMessages,
  buildSurfaceInspectorTargetNodeForAnnotation,
  computeMinimapLayout,
  findSurfaceInspectorSurfaceTreeRoot,
  normalizeDisplays,
  projectAnnotationRectToMinimap,
  planAnnotationActionControlCanvasSync,
  retainedTreeExpandedIds,
  projectPointToMinimap,
  resolveCanvasFrames,
} from '../../packages/toolkit/components/surface-inspector/index.js';
import { createAosZagTreeView } from '../../packages/toolkit/adapters/zag/tree-view.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';
import { BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID } from '../../packages/toolkit/workbench/browser-dom-element-picker.js';
import {
  addSurfaceInspectorComment,
  buildSurfaceInspectorAnnotationTreeRows,
  createSurfaceInspectorAnnotationState,
  pinSurfaceInspectorFrame,
  setSurfaceInspectorAnnotationMode,
} from '../../packages/toolkit/workbench/surface-inspector-annotations.js';
import {
  CONTROLLED_BROWSER_DOM_FIXTURE_PATH,
  createControlledBrowserDomSurfacePublisher,
} from '../../packages/toolkit/workbench/controlled-browser-dom-surface.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inspectorSource = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');

const annotationNode = (id, subjectPath = ['main', id], extra = {}) => ({
  id,
  subject_id: id,
  subject_path: subjectPath,
  root_id: extra.root_id || 'main',
  root_label: extra.root_label || 'main',
  adapter_id: extra.adapter_id || 'aos-canvas-window',
  ...extra,
  projection: extra.projection || {
    status: 'projectable',
    projectable: true,
    visible_display_rect: { x: 10, y: 20, w: 100, h: 80 },
    coordinate_space: 'native_display',
    current_render_status: 'live',
    can_reveal: true,
  },
});

class RevealFixtureElement {
  constructor(tagName, attrs = {}, rect = { x: 0, y: 0, width: 1, height: 1 }, text = '') {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.rect = rect;
    this.textContent = text;
    this.innerText = text;
    this.children = [];
    this.parentElement = null;
    this.previousElementSibling = null;
    this.ownerDocument = null;
    this.classList = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
  }

  append(child) {
    child.parentElement = this;
    child.previousElementSibling = this.children.at(-1) || null;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  get id() {
    return this.getAttribute('id');
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getRootNode() {
    return this.ownerDocument;
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === 'section[data-testid="hero-card"]') return this.tagName === 'SECTION' && this.getAttribute('data-testid') === 'hero-card';
    if (selector === '[data-testid="hero-card"]') return this.getAttribute('data-testid') === 'hero-card';
    if (selector === '[data-qa="campaign-hero"]') return this.getAttribute('data-qa') === 'campaign-hero';
    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

function createRevealFixtureDocument() {
  const doc = {
    nodeType: 9,
    location: { href: `file:///repo/${CONTROLLED_BROWSER_DOM_FIXTURE_PATH}` },
    defaultView: {
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    documentElement: { scrollLeft: 0, scrollTop: 0 },
    all: [],
    getElementById: (id) => doc.all.find((item) => item.id === id) || null,
    querySelector: (selector) => doc.all.find((item) => item.matches(selector)) || null,
    querySelectorAll: (selector) => doc.all.filter((item) => item.matches(selector)),
    elementsFromPoint: () => [],
  };
  const body = new RevealFixtureElement('body', {}, { x: 0, y: 0, width: 800, height: 1800 }, '');
  const main = new RevealFixtureElement('main', { class: 'hero', 'data-qa': 'campaign-hero', 'aria-label': 'Campaign hero' }, { x: 32, y: 32, width: 570, height: 154 }, 'Build a candidate story');
  const hero = new RevealFixtureElement('section', { class: 'hero-card', 'data-testid': 'hero-card', 'aria-label': 'Employer brand hero' }, { x: 56, y: 56, width: 522, height: 106 }, 'Build a candidate story');
  const offscreen = new RevealFixtureElement('button', { id: 'offscreen-target', 'aria-label': 'Offscreen action' }, { x: 32, y: 1240, width: 220, height: 54 }, 'Offscreen action');
  offscreen.scrollIntoView = () => {
    doc.defaultView.scrollY = 940;
    doc.documentElement.scrollTop = 940;
    offscreen.rect = { x: 32, y: 300, width: 220, height: 54 };
  };
  for (const element of [body, main, hero, offscreen]) {
    element.ownerDocument = doc;
    doc.all.push(element);
  }
  doc.body = body;
  body.append(main);
  main.append(hero);
  body.append(offscreen);
  return { doc, hero, offscreen };
}

class OverlayFixtureElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attrs = new Map();
    this.style = { cssText: '' };
    this.parentElement = null;
    this.textContent = '';
    this.title = '';
    this.id = '';
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

function createOverlayFixtureDocument() {
  const body = new OverlayFixtureElement('body');
  const doc = {
    body,
    documentElement: body,
    createElement: (tagName) => new OverlayFixtureElement(tagName),
    getElementById: (id) => {
      const visit = (node) => {
        if (node.id === id) return node;
        for (const child of node.children) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(body);
    },
  };
  return doc;
}

const displays = [
  {
    id: 2,
    cgID: 3,
    width: 1920,
    height: 1080,
    is_main: false,
    bounds: { x: -207, y: 982, w: 1920, h: 1080 },
  },
  {
    id: 1,
    cgID: 1,
    width: 1512,
    height: 982,
    is_main: true,
    bounds: { x: 0, y: 0, w: 1512, h: 982 },
  },
];

test('Surface Inspector exposes surface resource subscriptions and debug counts', () => {
  assert.match(inspectorSource, /requires: \[[^\]]*'canvas_object\.registry'[^\]]*'input_region'/s);
  assert.match(inspectorSource, /subscribe\(\['canvas_object\.registry', 'input_region'\], \{ snapshot: true \}\)/);
  assert.match(inspectorSource, /surfaceResourceCounts/);
  assert.match(inspectorSource, /window\.__canvasInspectorState/);
});

test('computeMinimapLayout preserves a visible inset for displays at the union edge', () => {
  const layout = computeMinimapLayout(displays, [], 300);
  assert.ok(layout);
  assert.equal(layout.mapW, 300);
  assert.equal(layout.mapH, 322);

  const lowerDisplay = layout.displays.find((entry) => !entry.display.is_main);
  assert.ok(lowerDisplay);
  assert.deepEqual(
    { x: lowerDisplay.x, y: lowerDisplay.y, w: lowerDisplay.w, h: lowerDisplay.h },
    { x: 2, y: 152, w: 294, h: 165 }
  );
  assert.ok(lowerDisplay.x > 0);
  assert.ok(lowerDisplay.y > 0);
  assert.ok(lowerDisplay.x + lowerDisplay.w < layout.mapW);
  assert.ok(lowerDisplay.y + lowerDisplay.h < layout.mapH);
});

test('computeMinimapLayout keeps self canvases marked and scaled into the same box', () => {
  const canvases = [
    { id: 'surface-inspector', at: [1172, 442, 320, 480] },
    { id: 'other-canvas', at: [-207, 982, 1920, 1080] },
  ];
  const layout = computeMinimapLayout(displays, canvases, 300);
  assert.ok(layout);
  assert.equal(layout.canvases.length, 2);

  const self = layout.canvases.find((entry) => entry.canvas.id === 'surface-inspector');
  const other = layout.canvases.find((entry) => entry.canvas.id === 'other-canvas');
  assert.ok(self);
  assert.ok(other);
  assert.equal(self.isSelf, true);
  assert.equal(other.isSelf, false);
  assert.ok(self.x >= 2 && self.y >= 2);
  assert.ok(self.x + self.w < layout.mapW);
  assert.ok(self.y + self.h < layout.mapH);
  assert.deepEqual(
    { x: other.x, y: other.y, w: other.w, h: other.h },
    { x: 2, y: 152, w: 294, h: 165 }
  );
});

test('computeMinimapLayout fits desktop world by width and height with a lower bound', () => {
  const unconstrained = computeMinimapLayout(displays, [], 300);
  const constrained = computeMinimapLayout(displays, [], 300, { maxH: 180, minW: 120, minH: 96 });
  assert.ok(unconstrained);
  assert.ok(constrained);
  assert.equal(unconstrained.mapH, 322);
  assert.ok(constrained.mapH <= 180);
  assert.equal(constrained.mapH, 180);
  assert.equal(constrained.mapW, 168);
  assert.ok(Math.abs((constrained.displays[0].w / constrained.displays[0].h) - (constrained.displays[0].display.bounds.w / constrained.displays[0].display.bounds.h)) < 0.02);
  for (const display of constrained.displays) {
    assert.ok(display.y >= 0);
    assert.ok(display.y + display.h <= constrained.mapH);
  }

  const tiny = computeMinimapLayout(displays, [], 60, { maxH: 50, minW: 120, minH: 96 });
  assert.equal(tiny.mapW, 120);
  assert.equal(tiny.mapH, 96);
});

test('projectPointToMinimap maps the cursor into minimap coordinates', () => {
  const canvases = [
    { id: 'avatar-main', at: [-207, 0, 1920, 2062] },
    { id: 'sigil-hit', parent: 'avatar-main', at: [1093, 240, 80, 80] },
    { id: 'surface-inspector', at: [1172, 442, 320, 480] },
  ];
  const layout = computeMinimapLayout(displays, canvases, 300);
  assert.ok(layout);

  const cursor = projectPointToMinimap(layout, { x: 1340, y: 280 });
  assert.ok(cursor);
  assert.ok(cursor.x >= 0 && cursor.x <= layout.mapW);
  assert.ok(cursor.y >= 0 && cursor.y <= layout.mapH);

  const avatarHit = layout.canvases.find((entry) => entry.canvas.id === 'sigil-hit');
  assert.ok(avatarHit);
  assert.ok(cursor.x >= avatarHit.x);
  assert.ok(cursor.x <= avatarHit.x + avatarHit.w);
  assert.ok(cursor.y >= avatarHit.y);
  assert.ok(cursor.y <= avatarHit.y + avatarHit.h);
});

test('resolveCanvasFrames keeps daemon global child canvas rects intact', () => {
  const resolved = resolveCanvasFrames([
    { id: 'avatar-main', at: [-96, -540, 3520, 2068] },
    { id: 'sigil-hit', parent: 'avatar-main', at: [974, -286, 80, 80] },
  ]);
  assert.deepEqual(
    resolved.map(({ id, atResolved }) => ({ id, atResolved })),
    [
      { id: 'avatar-main', atResolved: [-96, -540, 3520, 2068] },
      { id: 'sigil-hit', atResolved: [974, -286, 80, 80] },
    ]
  );
});

test('computeMinimapLayout aligns global native child canvas frames with DesktopWorld marks', () => {
  const liveDisplays = [
    {
      id: 3,
      width: 1920,
      height: 1080,
      is_main: false,
      bounds: { x: -185, y: 982, w: 1920, h: 1080 },
    },
    {
      id: 1,
      width: 1512,
      height: 982,
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
    },
  ];
  const layout = computeMinimapLayout(liveDisplays, [
    { id: 'avatar-main', at: [-185, 0, 1920, 2062] },
    { id: 'sigil-hit', parent: 'avatar-main', at: [895, 1460, 80, 80] },
  ], 300);
  assert.ok(layout);

  const avatarMark = projectPointToMinimap(layout, { x: 1120, y: 1500 });
  const avatarHit = layout.canvases.find((entry) => entry.canvas.id === 'sigil-hit');
  assert.ok(avatarMark);
  assert.ok(avatarHit);
  assert.ok(avatarMark.x >= avatarHit.x);
  assert.ok(avatarMark.x <= avatarHit.x + avatarHit.w);
  assert.ok(avatarMark.y >= avatarHit.y);
  assert.ok(avatarMark.y <= avatarHit.y + avatarHit.h);
});

test('computeMinimapLayout keeps daemon DesktopWorld display bounds authoritative', () => {
  const liveDisplays = [
    {
      id: 'extended',
      is_main: false,
      native_bounds: { x: -185, y: 982, w: 1920, h: 1080 },
      native_visible_bounds: { x: -185, y: 982, w: 1920, h: 1040 },
      desktop_world_bounds: { x: -185, y: 982, w: 1920, h: 1080 },
      visible_desktop_world_bounds: { x: -185, y: 982, w: 1920, h: 1040 },
    },
    {
      id: 'main',
      is_main: true,
      native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
      native_visible_bounds: { x: 0, y: 38, w: 1512, h: 944 },
      desktop_world_bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_desktop_world_bounds: { x: 0, y: 38, w: 1512, h: 944 },
    },
  ];
  const layout = computeMinimapLayout(liveDisplays, [
    { id: 'main-window', at: [0, 38, 300, 200] },
    { id: 'extended-window', at: [-100, 1200, 240, 160] },
  ], 300);
  assert.ok(layout);

  const mainDisplay = layout.displays.find((entry) => entry.display.id === 'main');
  const extendedDisplay = layout.displays.find((entry) => entry.display.id === 'extended');
  assert.ok(mainDisplay);
  assert.ok(extendedDisplay);
  assert.ok(extendedDisplay.x < mainDisplay.x);

  const mainCanvas = layout.canvases.find((entry) => entry.canvas.id === 'main-window');
  const mainPoint = projectPointToMinimap(layout, { x: 0, y: 38 });
  assert.ok(mainCanvas);
  assert.deepEqual({ x: mainCanvas.x, y: mainCanvas.y }, mainPoint);
});

test('annotation minimap projection resolves display rects through desktop-world basis', () => {
  const layout = computeMinimapLayout(displays, [
    { id: 'main-window', at: [0, 0, 300, 200] },
  ], 300);
  assert.ok(layout);

  const canvasMark = layout.canvases.find((entry) => entry.canvas.id === 'main-window');
  assert.ok(canvasMark);

  const annotationFrame = projectAnnotationRectToMinimap(
    layout,
    { x: 0, y: 0, w: 300, h: 200 },
    { displays, coordinateSpace: 'native_display' },
  );
  assert.deepEqual(annotationFrame, {
    x: canvasMark.x,
    y: canvasMark.y,
    w: canvasMark.w,
    h: canvasMark.h,
  });

  const alreadyDesktopWorld = projectAnnotationRectToMinimap(
    layout,
    { x: 207, y: 0, w: 300, h: 200 },
    { displays, coordinateSpace: 'desktop_world' },
  );
  assert.deepEqual(alreadyDesktopWorld, annotationFrame);
});

test('projectPointToMinimap rejects invalid cursor payloads', () => {
  const layout = computeMinimapLayout(displays, [], 300);
  assert.equal(projectPointToMinimap(layout, null), null);
  assert.equal(projectPointToMinimap(layout, { x: Number.NaN, y: 0 }), null);
  assert.equal(projectPointToMinimap(layout, { x: 0, y: Infinity }), null);
});

test('computeMinimapLayout honors daemon-provided desktop_world_bounds verbatim', () => {
  // Daemon payload carries both native_bounds and desktop_world_bounds. If the
  // daemon claims a DesktopWorld origin that differs from a naive re-anchor,
  // the inspector must honor the daemon value (we trust the producer).
  const payload = [
    {
      id: 1, cgID: 1, is_main: true, width: 1512, height: 982,
      bounds: { x: -200, y: 0, w: 1512, h: 982 },
      native_bounds: { x: -200, y: 0, w: 1512, h: 982 },
      desktop_world_bounds: { x: 100, y: 0, w: 1512, h: 982 },
      visible_desktop_world_bounds: { x: 100, y: 25, w: 1512, h: 919 },
    },
  ];
  const layout = computeMinimapLayout(payload, [], 300);
  assert.ok(layout);
  // Union derived from daemon-provided rect, not re-anchored to x=0.
  assert.equal(layout.minX, 100);
});

test('normalizeDisplays accepts display_geometry payloads', () => {
  const normalized = normalizeDisplays([
    {
      display_id: 3,
      is_main: false,
      bounds: { x: -207, y: 982, w: 1920, h: 1080 },
      scale_factor: 1,
    },
    {
      display_id: 1,
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      scale_factor: 2,
    },
  ]);

  assert.deepEqual(normalized, [
    {
      display_id: 3,
      id: 3,
      is_main: false,
      bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      nativeBounds: { x: -207, y: 982, w: 1920, h: 1080 },
      nativeVisibleBounds: { x: -207, y: 982, w: 1920, h: 1080 },
      desktopWorldBounds: null,
      visibleDesktopWorldBounds: null,
      native_bounds: { x: -207, y: 982, w: 1920, h: 1080 },
      native_visible_bounds: { x: -207, y: 982, w: 1920, h: 1080 },
      visible_bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      desktop_world_bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      visible_desktop_world_bounds: { x: 0, y: 982, w: 1920, h: 1080 },
      scale_factor: 1,
      visibleBounds: { x: 0, y: 982, w: 1920, h: 1080 },
      width: 1920,
      height: 1080,
    },
    {
      display_id: 1,
      id: 1,
      is_main: true,
      bounds: { x: 207, y: 0, w: 1512, h: 982 },
      nativeBounds: { x: 0, y: 0, w: 1512, h: 982 },
      nativeVisibleBounds: { x: 0, y: 0, w: 1512, h: 982 },
      desktopWorldBounds: null,
      visibleDesktopWorldBounds: null,
      native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
      native_visible_bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 207, y: 0, w: 1512, h: 982 },
      desktop_world_bounds: { x: 207, y: 0, w: 1512, h: 982 },
      visible_desktop_world_bounds: { x: 207, y: 0, w: 1512, h: 982 },
      scale_factor: 2,
      visibleBounds: { x: 207, y: 0, w: 1512, h: 982 },
      width: 1512,
      height: 982,
    },
  ]);
});

test('Surface Inspector consumes toolkit panel chrome and split-pane footer primitives', () => {
  const html = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.html'), 'utf8');
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const styles = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/styles.css'), 'utf8');

  assert.match(html, /panel\/defaults\.css/);
  assert.match(html, /mountPanel\(\{\s*title: 'Surface Inspector'/);
  assert.match(html, /maximize:\s*true/);
  assert.match(html, /resizable:\s*true/);
  assert.match(html, /minWidth:\s*300/);
  assert.match(source, /defaultSize:\s*\{\s*w:\s*360,\s*h:\s*520\s*\}/);
  assert.match(source, /createFixedSidebarPane/);
  assert.match(source, /resizeFrameFromTopLeft/);
  assert.match(source, /mutateSelf\(\{ frame: nextFrame \}\)/);
  assert.match(source, /orientation: 'vertical'/);
  assert.match(source, /side: 'end'/);
  assert.match(source, /openSize: LIST_PANE_OPEN_HEIGHT/);
  assert.match(source, /closedSize: LIST_PANE_CLOSED_HEIGHT/);
  assert.match(source, /maxMain: MINIMAP_PANE_MAX_HEIGHT/);
  assert.match(source, /maxSidebar: Infinity/);
  assert.match(source, /let listCollapsed = false/);
  assert.doesNotMatch(source, /request_resize/);
  assert.doesNotMatch(source, /MIN_EXPANDED_LIST_HEIGHT/);
  assert.match(styles, /\.surface-inspector-split/);
  assert.match(styles, /\.surface-inspector-list-pane/);
  assert.match(source, /surface-inspector-list-pane aos-sidebar-rail/);
  assert.match(source, /status-bar aos-sidebar-rail-top/);
  assert.match(source, /canvas-list-region aos-sidebar-rail-content/);
  assert.match(styles, /overflow-x:\s*hidden/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
});

test('Surface Inspector launch defaults leave room for minimap and first controls', () => {
  const launch = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/launch.sh'), 'utf8');
  const harness = readFileSync(path.join(repoRoot, 'tests/lib/visual-harness.sh'), 'utf8');

  assert.match(launch, /AOS_SURFACE_INSPECTOR_W:-\$\{AOS_CANVAS_INSPECTOR_W:-360\}/);
  assert.match(launch, /AOS_SURFACE_INSPECTOR_H:-\$\{AOS_CANVAS_INSPECTOR_H:-520\}/);
  assert.match(launch, /--timeout 10s/);
  assert.match(harness, /AOS_SURFACE_INSPECTOR_W:-\$\{AOS_CANVAS_INSPECTOR_W:-360\}/);
  assert.match(harness, /AOS_SURFACE_INSPECTOR_H:-\$\{AOS_CANVAS_INSPECTOR_H:-520\}/);
  assert.match(harness, /--timeout 10s/);
});

test('Surface Inspector exposes Annotation Mode controls and snapshot state', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const styles = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/styles.css'), 'utf8');

  assert.match(source, /title: 'Surface Inspector'/);
  assert.match(source, /renderAnnotationModeToggleRowHTML/);
  assert.match(source, /Turn Annotation Mode off/);
  assert.match(source, /Turn Annotation Mode on/);
  assert.doesNotMatch(source, /Annotation Mode: \$\{enabled \? 'on' : 'off'\}/);
  assert.match(source, /canvas_inspector\.annotation_toggle/);
  assert.match(source, /canvas_inspector\.annotation_open/);
  assert.match(source, /if \(!annotationState\.annotation_mode\.active\) setAnnotationMode\(true, \{ reason: msg\.reason \|\| 'external_open' \}\)/);
  assert.match(source, /listPaneView = 'annotate'/);
  assert.match(source, /else \{\s*listPaneView = 'annotate'\s*emitAnnotationModeState\(msg\.reason \|\| 'external_open'\)\s*rerender\(\)\s*\}/);
  assert.match(source, /syncInputSubscription\(\{ snapshot: false \}\)/);
  assert.match(source, /const wantsInput = cursorTrackingEnabled \|\| mouseEventsEnabled \|\| annotationState\.annotation_mode\.active/);
  assert.match(source, /const inputEvents = annotationState\.annotation_mode\.active/);
  assert.match(source, /\['input_event', 'window_entered', 'element_focused'\]/);
  assert.match(source, /const inputEventsChanged = obsoleteEvents\.length > 0 \|\| inputEvents\.some/);
  assert.match(source, /if \(!snapshot && !inputEventsChanged\)/);
  assert.match(source, /subscribe\(inputEvents, \{ snapshot \}\)/);
  assert.match(source, /buildSurfaceInspectorSnapshotPayload\(annotationState\)/);
  assert.doesNotMatch(source, /annotation-hover-add/);
  assert.doesNotMatch(source, /annotation-hover-pin/);
  assert.doesNotMatch(styles, /\.annotation-hover-add/);
  assert.doesNotMatch(styles, /\.annotation-hover-pin/);
  assert.doesNotMatch(styles, /\.minimap-annotation-hover/);
  assert.match(source, /canvas_inspector\.annotation_display_action/);
  assert.match(source, /Add comment to frame candidate/);
  assert.match(source, /Create frame anchor/);
  assert.doesNotMatch(source, /annotationActionControlHelperState/);
  assert.match(source, /annotationActionControlCanvases/);
  assert.match(source, /annotationOverlayTargetCanvasIds/);
  assert.match(source, /annotationOverlayEvalCounts/);
  assert.match(source, /annotationPendingProjectionSettle/);
  assert.match(source, /annotationProjectionRefresh/);
  assert.match(source, /buildAnnotationActionControlCanvasRecords/);
  assert.match(source, /spawnChild/);
  assert.match(source, /canvas\.update/);
  assert.match(source, /canvas\.remove/);
  assert.match(source, /target_canvas_removed/);
  assert.match(source, /annotation-action-control\/index\.html/);
  assert.match(source, /annotation-hit-layer\/index\.html/);
  assert.match(source, /annotationHitLayerCanvasId/);
  assert.match(source, /buildAnnotationScopedHitRegions/);
  assert.doesNotMatch(source, /data:text\/html/);
  assert.doesNotMatch(source, /annotationActionCanvasURL/);
  assert.match(source, /annotationActionControlCanvasIds/);
  assert.match(source, /nativeCursor/);
  assert.match(source, /const hitPoint = nativeCursor\?\.valid \? nativeCursor : cursor/);
  assert.match(source, /pinned: true/);
  assert.match(source, /createAosZagTreeView/);
  assert.match(source, /data-annotation-tree-view data-aos-tree-view-root/);
  assert.match(source, /aria-label="Saved annotations"/);
  assert.match(source, /No annotations yet\./);
  assert.match(source, /Reveal Target/);
  assert.match(source, /annotation-pin-reveal/);
  assert.match(source, /annotation-pin-label/);
  assert.match(source, /annotation-pin-copy/);
  assert.match(source, /annotation-pin-expand/);
  assert.match(source, /annotation-pin-remove/);
  assert.match(source, /annotation-comment-text/);
  assert.match(source, /annotation-comment-delete/);
  assert.match(source, /buildRevealTargetEvalScript/);
  assert.match(source, /applySurfaceInspectorRevealResult/);
  assert.match(source, /canvas_inspector\.semantic_targets/);
  assert.match(source, /canvas_inspector\.semantic_targets\.request/);
  assert.match(source, /requestSemanticTargetsForLiveCanvases/);
  assert.match(source, /buildSemanticTargetProjectionAdapterResult/);
  assert.match(source, /markSurfaceInspectorAnnotationProjectionsStale/);
  assert.match(source, /refreshSurfaceInspectorAnnotationProjectionsFromEvidence/);
  assert.match(source, /invalidateAnnotationProjections\('display_geometry_changed'/);
  assert.match(source, /invalidateAnnotationProjections\('canvas_lifecycle_changed'/);
  assert.match(source, /accepts: \['bootstrap', 'canvas_lifecycle', 'canvas_geometry'/);
  assert.match(source, /requires: \['canvas_lifecycle', 'canvas_geometry'/);
  assert.match(source, /if \(msg\.type === 'canvas_geometry'\)/);
  assert.match(source, /syncMinimapGeometryLayer\(\)/);
  assert.match(source, /invalidateAnnotationProjections\('canvas_geometry_settled'/);
  assert.match(source, /else \{\s*requestSemanticTargetsForLiveCanvases\('surface_inspector_lifecycle'\)\s*\}/);
  assert.match(source, /annotationCanvasLifecycleAffectsProjection/);
  assert.match(source, /return ids\.some\(\(id\) => !isAnnotationInternalCanvasId\(id\)\)/);
  assert.match(source, /invalidateAnnotationProjections\('native_window_moved_or_changed'/);
  assert.match(source, /invalidateAnnotationProjections\('native_ax_stale_or_absent'/);
  assert.match(source, /refreshSettledAnnotationProjections\('semantic_targets_refreshed'\)/);
  assert.match(source, /requestSemanticTargetsForLiveCanvases\(options\.request_semantic_targets/);
  assert.match(source, /currentAnnotationProjectionEvidence/);
  assert.doesNotMatch(source, /annotation-semantic-pin/);
  assert.doesNotMatch(source, /annotation-selected-add/);
  assert.match(source, /Frame address/);
  assert.match(source, /Copy full frame address/);
  assert.match(source, /Expand frame address/);
  assert.match(source, /renderAnnotationSupportRows/);
  assert.match(source, /surfaceInspectorAnnotationStateToSession\(annotationState\)/);
  assert.match(source, /hover preview/);
  assert.match(source, /frame anchor/);
  assert.match(source, /comment anchor/);
  assert.match(source, /projected markers, passive/);
  assert.doesNotMatch(source, /waiting for display anchor evidence/);
  assert.match(source, /const snapshotState = bundleCapture\?\.status === 'pending'/);
  assert.doesNotMatch(source, /`\$\{annotationState\.snapshot_version\} snapshots`/);
  assert.match(source, /if \(!annotationState\.annotation_mode\.active\) \{\s*\/\/ Object marks/s);
  assert.match(source, /if \(annotationState\.annotation_mode\.active\) return ''/);
  assert.match(source, /chip\.textContent/);
  assert.match(source, /buildAnnotationOverlayEvalScript/);
  assert.match(source, /syncControlledAnnotationDisplayOverlays/);
  assert.match(source, /annotationOverlaySignature/);
  assert.match(source, /annotationOverlaySignatures\.get\(canvas\.id\) === signature/);
  assert.match(source, /surfaceInspectorAnnotationStateToSession/);
  assert.match(source, /buildAnnotationOverlayRenderPlan/);
  assert.match(source, /active-edge/);
  assert.doesNotMatch(source, /textContent = icon/);
  assert.doesNotMatch(source, /makeButton/);
  assert.doesNotMatch(source, /background:rgba\(244,197,66,0\.08\)/);
  assert.doesNotMatch(source, /hover target buttons/);
  assert.match(source, /renderTextFieldHtml/);
  assert.match(source, /placeholder: 'Leave a comment'/);
  assert.match(source, /emit\('canvas_inspector\.annotation_state'/);
  assert.match(source, /surface_inspector_suspended/);
  assert.match(styles, /\.minimap-annotation-frame/);
  assert.match(styles, /\.minimap-annotation-comment/);
  assert.match(styles, /\.annotation-projection-state/);
  assert.match(styles, /\.annotation-support-row\.state-absent/);
  assert.match(styles, /\.annotation-row\.state-absent/);
  assert.match(styles, /\.annotation-support-label/);
  assert.doesNotMatch(source, /semantic-target-row/);
});

test('Annotate pane exposes workflow rows and moves raw support state to Diagnostics', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const styles = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/styles.css'), 'utf8');
  const annotateStart = source.indexOf('function renderAnnotationSupportRows(depth)');
  const debugStart = source.indexOf('function renderAnnotationDebugRows(depth)');
  const supportRowStart = source.indexOf('function renderAnnotationSupportRow', debugStart);
  const modeToggleStart = source.indexOf('export function renderAnnotationModeToggleRowHTML');
  const modeToggleEnd = source.indexOf('export function buildSemanticTargetsRequestMessages', modeToggleStart);
  assert.ok(annotateStart >= 0);
  assert.ok(debugStart > annotateStart);
  assert.ok(supportRowStart > debugStart);
  assert.ok(modeToggleStart >= 0);
  assert.ok(modeToggleEnd > modeToggleStart);
  const annotateBlock = source.slice(annotateStart, debugStart);
  const debugBlock = source.slice(debugStart, supportRowStart);
  const modeToggleBlock = source.slice(modeToggleStart, modeToggleEnd);

  assert.match(annotateBlock, /renderAnnotationSupportRow\('scope'/);
  assert.match(annotateBlock, /renderAnnotationSupportRow\('anchors'/);
  assert.match(annotateBlock, /renderAnnotationSupportRow\('snapshot'/);
  assert.match(annotateBlock, /renderAnnotationSupportRow\('blocker'/);
  assert.match(annotateBlock, /renderAnnotationSupportRow\('next action'/);
  assert.match(annotateBlock, /Hover a frame, then pin or add a comment\./);
  assert.doesNotMatch(annotateBlock, /renderAnnotationSupportRow\('mode'/);
  assert.doesNotMatch(annotateBlock, /renderAnnotationSupportRow\('root'/);
  assert.doesNotMatch(annotateBlock, /renderAnnotationSupportRow\('minimap'/);
  assert.doesNotMatch(annotateBlock, /hover preview/);
  assert.doesNotMatch(annotateBlock, /frame anchor/);
  assert.doesNotMatch(annotateBlock, /comment anchor/);
  assert.match(debugBlock, /renderAnnotationSupportRow\('mode'/);
  assert.match(debugBlock, /renderAnnotationSupportRow\('root'/);
  assert.match(debugBlock, /renderAnnotationSupportRow\('minimap'/);
  assert.match(debugBlock, /hover preview/);
  assert.match(debugBlock, /frame anchor/);
  assert.match(debugBlock, /comment anchor/);
  assert.match(modeToggleBlock, /<span class="cursor-toggle-label">controls<\/span>/);
  assert.doesNotMatch(modeToggleBlock, /<span class="cursor-toggle-label">annotation mode<\/span>/);
  assert.doesNotMatch(modeToggleBlock, /<span class="cursor-toggle-state">\$\{enabled \? 'active' : 'off'\}<\/span>/);
  assert.match(styles, /\.tree-row\.surface \.canvas-flags\s*\{\s*opacity: 0\.2/s);
  assert.match(styles, /\.tree-row\.surface:hover \.canvas-flags/);
  assert.match(styles, /\.tree-row\.surface \.btn\.active/);
});

test('active Annotation Mode keeps saved annotation management controls separate from support summary', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const renderStart = source.indexOf('function renderAnnotationTree(depth)');
  const semanticStart = source.indexOf('function renderSemanticTargetRows');
  const bindStart = source.indexOf('function bindListEvents()');
  const bindEnd = source.indexOf("contentEl.addEventListener('input'", bindStart);
  assert.ok(renderStart >= 0);
  assert.ok(semanticStart > renderStart);
  assert.ok(bindStart >= 0);
  assert.ok(bindEnd > bindStart);
  const renderBlock = source.slice(renderStart, semanticStart);
  const bindBlock = source.slice(bindStart, bindEnd);

  assert.match(renderBlock, /renderAnnotationManagementRows\(depth \+ 1\)/);
  assert.match(renderBlock, /buildSurfaceInspectorAnnotationTreeRows\(annotationState\)/);
  assert.doesNotMatch(renderBlock, /renderAnnotationSupportRows\(depth \+ 1\)/);
  assert.match(renderBlock, /data-annotation-tree-view data-aos-tree-view-root/);
  assert.match(renderBlock, /aria-label="Saved annotations"/);
  assert.match(renderBlock, /data-aos-tree-view-item/);
  assert.match(renderBlock, /annotation-pin-label/);
  assert.match(renderBlock, /annotation-pin-reveal/);
  assert.match(renderBlock, /annotation-pin-expand/);
  assert.match(renderBlock, /annotation-pin-copy/);
  assert.match(renderBlock, /annotation-pin-remove/);
  assert.match(renderBlock, /annotation-comment-text/);
  assert.match(renderBlock, /annotation-comment-delete/);
  assert.match(bindBlock, /selectSurfaceInspectorAnnotationFrame\(annotationState, btn\.dataset\.pinId/);
  assert.match(bindBlock, /navigator\.clipboard\?\.writeText/);
  assert.match(bindBlock, /unpinSurfaceInspectorFrame\(annotationState, btn\.dataset\.pinId\)/);
  assert.match(bindBlock, /deleteSurfaceInspectorComment\(annotationState, btn\.dataset\.commentId\)/);
  assert.match(bindBlock, /mode: 'edit'/);
  assert.match(source, /function bindAnnotationTreeView\(\)/);
  assert.match(source, /createAosZagTreeView\(\{/);
  assert.match(source, /buildAnnotationTreeViewItems\(\)/);
});

test('annotation tree view items preserve helper hierarchy contract from fixture state', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true);
  state = pinSurfaceInspectorFrame(state, annotationNode('frame-a', ['main', 'frame-a']), { id: 'pin-a' });
  state = addSurfaceInspectorComment(state, 'pin-a', 'A note', { id: 'comment-a' });
  state = pinSurfaceInspectorFrame(state, annotationNode('frame-b', ['main', 'frame-a', 'frame-b']), {
    id: 'pin-b',
    parent_pin_id: 'pin-a',
  });

  const rows = buildSurfaceInspectorAnnotationTreeRows(state);
  const items = buildSurfaceInspectorAnnotationTreeViewItems(rows);

  assert.deepEqual(items.map((item) => item.id), ['pin-a', 'comment-a', 'pin-b']);
  assert.equal(items[0].hasChildren, true);
  assert.equal(items[0].label, 'main / frame-a');
  assert.equal(items[1].parentId, 'pin-a');
  assert.equal(items[1].data.type, 'comment');
  assert.equal(items[2].parentId, 'pin-a');
  assert.equal(items[2].depth, 1);
});

test('retained tree expansion state survives rerender inputs without defaulting open', () => {
  const items = [
    { id: 'root', hasChildren: true },
    { id: 'child', parentId: 'root', hasChildren: true },
    { id: 'leaf', parentId: 'child', hasChildren: false },
  ];

  assert.deepEqual(retainedTreeExpandedIds(null, items), ['root', 'child']);
  assert.deepEqual(retainedTreeExpandedIds(['root'], items), ['root']);
  assert.deepEqual(retainedTreeExpandedIds(['missing', 'child'], items), ['child']);
});

test('Surface Inspector surfaces and diagnostics panes adopt Zag tree semantics', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const surfacesStart = source.indexOf('function renderTree(options = {})');
  const statusStart = source.indexOf('function renderStatusBar()');
  assert.ok(surfacesStart >= 0);
  assert.ok(statusStart > surfacesStart);
  const treeBlock = source.slice(surfacesStart, statusStart);

  assert.match(source, /let surfaceTreeView = null/);
  assert.match(source, /function bindSurfaceTreeView\(\)/);
  assert.match(source, /buildSurfaceTreeViewItems\(\{/);
  assert.match(source, /data-surface-tree-view="\$\{context\}" data-aos-tree-view-root/);
  assert.match(source, /surfaceTreeView = createAosZagTreeView\(\{/);
  assert.match(treeBlock, /data-aos-tree-view-item/);
  assert.match(treeBlock, /surfaceTreeNodeId\(node\)/);
  assert.match(treeBlock, /renderCanvasRow\(node\.canvas, depth, \{ selfId: SELF_ID, tintedIds, statsIds, treeItemId: surfaceTreeNodeId\(node\) \}\)/);
  assert.match(source, /data-resource-type="surface-affordance"/);
  assert.match(source, /data-item-id="\$\{esc\(`affordance:\$\{affordance\.id\}`\)\}"/);
  assert.match(source, /data-item-id="\$\{esc\(`stage:\$\{layer\.id\}`\)\}"/);
  assert.match(source, /data-item-id="\$\{esc\(`input:\$\{region\.id\}`\)\}"/);
});

test('Surface Inspector binds Zag tree semantics to the active diagnostics tree', () => {
  const document = createDocument();
  const listPane = patchSpreadSupport(document.createElement('div'));
  const surfacesPanel = patchSpreadSupport(document.createElement('section'));
  const diagnosticsPanel = patchSpreadSupport(document.createElement('section'));
  const surfacesRoot = patchSpreadSupport(document.createElement('div'));
  const diagnosticsRoot = patchSpreadSupport(document.createElement('div'));

  surfacesPanel.setAttribute('data-aos-tabs-content', '');
  surfacesPanel.setAttribute('data-value', 'surfaces');
  surfacesPanel.setAttribute('hidden', '');
  diagnosticsPanel.setAttribute('data-aos-tabs-content', '');
  diagnosticsPanel.setAttribute('data-value', 'diagnostics');
  surfacesRoot.setAttribute('data-surface-tree-view', 'surfaces');
  surfacesRoot.setAttribute('data-aos-tree-view-root', '');
  diagnosticsRoot.setAttribute('data-surface-tree-view', 'diagnostics');
  diagnosticsRoot.setAttribute('data-aos-tree-view-root', '');

  const addRow = (root, id) => {
    const row = patchSpreadSupport(document.createElement('div'));
    row.setAttribute('data-aos-tree-view-item', '');
    row.setAttribute('data-item-id', id);
    root.appendChild(row);
    return row;
  };
  addRow(surfacesRoot, 'union:union');
  addRow(surfacesRoot, 'display:main');
  const diagnosticsUnion = addRow(diagnosticsRoot, 'union:union');
  const diagnosticsDisplay = addRow(diagnosticsRoot, 'display:main');

  surfacesPanel.appendChild(surfacesRoot);
  diagnosticsPanel.appendChild(diagnosticsRoot);
  listPane.append(surfacesPanel, diagnosticsPanel);
  document.body.appendChild(listPane);

  const activeRoot = findSurfaceInspectorSurfaceTreeRoot(listPane, 'diagnostics');
  assert.equal(activeRoot, diagnosticsRoot);

  const adapter = createAosZagTreeView({
    id: 'surface-inspector-diagnostics-tree',
    getRootNode: () => document,
    items: [
      { id: 'union:union', label: 'union', depth: 0, hasChildren: true },
      { id: 'display:main', label: 'main', parentId: 'union:union', depth: 1 },
    ],
    expandedIds: ['union:union'],
  });
  adapter.bind(activeRoot, { root: activeRoot });

  assert.equal(diagnosticsRoot.getAttribute('role'), 'tree');
  assert.equal(diagnosticsUnion.getAttribute('role'), 'treeitem');
  assert.equal(diagnosticsUnion.getAttribute('aria-expanded'), 'true');
  assert.equal(surfacesRoot.getAttribute('role'), null);

  diagnosticsUnion.dispatchEvent(new document.defaultView.Event('keydown', { key: 'ArrowLeft' }));

  assert.equal(diagnosticsUnion.getAttribute('aria-expanded'), 'false');
  assert.equal(diagnosticsDisplay.getAttribute('hidden'), '');
  assert.equal(diagnosticsDisplay.getAttribute('aria-hidden'), 'true');
  adapter.destroy();
});

test('Surface Inspector lower pane separates annotate, surfaces, and diagnostics views', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const styles = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/styles.css'), 'utf8');

  assert.match(source, /import \{ createAosZagTabs \} from '\.\.\/\.\.\/adapters\/zag\/tabs\.js'/);
  assert.doesNotMatch(source, /from ['"]@zag-js\/tabs['"]/);
  assert.match(source, /const LIST_PANE_VIEWS = \['annotate', 'surfaces', 'diagnostics'\]/);
  assert.match(source, /let listPaneView = 'surfaces'/);
  assert.match(source, /let listPaneViewManual = false/);
  assert.match(source, /annotationState\.annotation_mode\.active \? 'annotate' : 'surfaces'/);
  assert.match(source, /listPaneView = 'annotate'/);
  assert.match(source, /function renderLowerPane\(\)/);
  assert.match(source, /data-lower-pane-tabs data-aos-tabs-root/);
  assert.match(source, /\['annotate', 'Annotate'\]/);
  assert.match(source, /\['surfaces', 'Surfaces'\]/);
  assert.match(source, /\['diagnostics', 'Diagnostics'\]/);
  assert.match(source, /data-aos-tabs-trigger/);
  assert.match(source, /data-aos-tabs-content/);
  assert.match(source, /createAosZagTabs\(\{/);
  assert.match(source, /onValueChange\(details = \{\}\)/);
  assert.match(styles, /\.lower-pane-tab-list/);
  assert.match(styles, /\.lower-pane-panel\[hidden\]/);
});

test('Surface Inspector lower pane keeps required controls reachable in their task sections', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const annotateStart = source.indexOf('function renderAnnotatePane()');
  const surfacesStart = source.indexOf('function renderSurfacesPane()');
  const diagnosticsStart = source.indexOf('function renderDiagnosticsPane()');
  const treeStart = source.indexOf('function renderTree(options = {})');
  assert.ok(annotateStart >= 0);
  assert.ok(surfacesStart > annotateStart);
  assert.ok(diagnosticsStart > surfacesStart);
  assert.ok(treeStart > diagnosticsStart);
  const annotateBlock = source.slice(annotateStart, surfacesStart);
  const surfacesBlock = source.slice(surfacesStart, diagnosticsStart);
  const diagnosticsBlock = source.slice(diagnosticsStart, treeStart);

  assert.match(annotateBlock, /renderAnnotationModeToggleRow\(0\)/);
  assert.match(annotateBlock, /renderAnnotationScopeControls\(0\)/);
  assert.doesNotMatch(annotateBlock, /renderAnnotationSupportRows\(0\)/);
  assert.match(annotateBlock, /renderAnnotationManagementRows\(0\)/);
  assert.doesNotMatch(annotateBlock, /lower-pane-summary/);
  assert.doesNotMatch(annotateBlock, /anchors\.length/);
  assert.doesNotMatch(annotateBlock, /comments\.length/);
  assert.match(surfacesBlock, /renderTree\(\{ includeDiagnostics: false \}\)/);
  assert.match(diagnosticsBlock, /renderCursorToggleRow\(0\)/);
  assert.match(diagnosticsBlock, /renderMouseEventsToggleRow\(0\)/);
  assert.match(diagnosticsBlock, /renderAnnotationSupportRows\(0\)/);
  assert.match(diagnosticsBlock, /renderDiagnosticsRows\(\)/);
  assert.match(diagnosticsBlock, /renderTree\(\{ diagnosticsOnly: true \}\)/);
  assert.match(source, /if \(!options\.diagnosticsOnly\) return ''/);
  assert.match(source, /if \(options\.diagnosticsOnly\) \{/);
  assert.match(source, /renderCanvasActionButtons\(canvasId/);
  assert.match(source, /classList\.contains\('tint-btn'\)/);
  assert.match(source, /classList\.contains\('stats-btn'\)/);
  assert.match(source, /classList\.contains\('remove-btn'\)/);
});

test('display add-comment action opens editor for an existing frame anchor without re-pinning', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const pinStart = source.indexOf('function pinHoverCandidate({ openEditor = false } = {})');
  const backStart = source.indexOf('function backAnnotationScope()', pinStart);
  const displayActionStart = source.indexOf("if (msg.type === 'canvas_inspector.annotation_display_action')");
  const displayActionEnd = source.indexOf("if (msg.type === 'canvas_inspector.see_bundle_status')", displayActionStart);
  assert.ok(pinStart >= 0);
  assert.ok(backStart > pinStart);
  assert.ok(displayActionStart >= 0);
  assert.ok(displayActionEnd > displayActionStart);
  const pinBlock = source.slice(pinStart, backStart);
  const displayActionBlock = source.slice(displayActionStart, displayActionEnd);

  assert.match(displayActionBlock, /if \(msg\.action === 'add_comment'\) handleAnnotationActionForCanvas\(msg\.canvas_id, \{ openEditor: true \}\)/);
  assert.match(pinBlock, /const existing = findPinForCandidateId\(candidate\.subject_id \|\| candidate\.id\)/);
  assert.match(pinBlock, /if \(existing && openEditor\)/);
  assert.match(pinBlock, /selectSurfaceInspectorAnnotationFrame\(annotationState, existing\.id\)/);
  assert.match(pinBlock, /pin_id: existing\.id/);
  assert.match(pinBlock, /return existing\.id/);
  assert.match(pinBlock, /if \(existing && !openEditor\)/);
  assert.ok(pinBlock.indexOf('if (existing && openEditor)') < pinBlock.indexOf('annotationState = pinSurfaceInspectorFrame(annotationState, candidate)'));
});

test('annotation scope breadcrumbs remain actionable buttons for root and ancestor jumps', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const scopeStart = source.indexOf('function renderAnnotationScopeControls(depth)');
  const supportStart = source.indexOf('function renderAnnotationSupportRows(depth)');
  const bindStart = source.indexOf('function bindListEvents()');
  const bindEnd = source.indexOf("if (btn.classList.contains('annotation-pin-label'))", bindStart);
  assert.ok(scopeStart >= 0);
  assert.ok(supportStart > scopeStart);
  assert.ok(bindStart >= 0);
  assert.ok(bindEnd > bindStart);
  const scopeBlock = source.slice(scopeStart, supportStart);
  const bindBlock = source.slice(bindStart, bindEnd);

  assert.match(scopeBlock, /renderInspectorButton/);
  assert.match(scopeBlock, /className: `annotation-scope-crumb \$\{rootActive \? 'active' : ''\}`/);
  assert.match(scopeBlock, /dataset: \{ pinId: '' \}/);
  assert.match(scopeBlock, /dataset: \{ pinId: frame\.pin_id \}/);
  assert.match(scopeBlock, /inspectorControlAttrs\('annotation-scope-root'/);
  assert.match(scopeBlock, /action: 'select_annotation_scope_root'/);
  assert.match(scopeBlock, /action: 'select_annotation_scope'/);
  assert.match(bindBlock, /btn\.classList\.contains\('annotation-scope-crumb'\)/);
  assert.match(bindBlock, /jumpSurfaceInspectorAnnotationScope\(annotationState, btn\.dataset\.pinId \|\| ''\)/);
});

test('annotation overlay eval script places only live rect-backed frames in canvas-local coordinates', () => {
  const doc = createOverlayFixtureDocument();
  const script = buildAnnotationOverlayEvalScript({
    overlay_frame: { x: 100, y: 200, width: 300, height: 180 },
    committed_frames: [
      {
        layer: 'committed',
        status: 'live',
        rect: { x: 112, y: 224, width: 80, height: 44 },
        opacity: 0.75,
        projection: { coordinate_space: 'native_display' },
      },
      {
        layer: 'committed',
        status: 'stale',
        rect: null,
        evidence_rect: { x: 10, y: 20, width: 30, height: 40 },
        reason: 'projection_outdated',
      },
    ],
    preview_frames: [],
    hover_candidate: null,
    comment_chips: [],
  });

  const result = Function('document', 'innerWidth', 'innerHeight', `return ${script}`)(doc, 300, 180);
  assert.equal(result, true);
  assert.equal(doc.body.children.length, 1);
  const overlay = doc.body.children[0];
  assert.equal(overlay.children.length, 1);
  const frameStyle = overlay.children[0].style.cssText;
  assert.match(frameStyle, /left:12px/);
  assert.match(frameStyle, /top:24px/);
  assert.match(frameStyle, /width:80px/);
  assert.match(frameStyle, /height:44px/);
  assert.doesNotMatch(frameStyle, /inset:0/);
});

test('Surface Inspector annotation clear removes only annotation runtime canvases', () => {
  const source = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/index.js'), 'utf8');
  const confirmStart = source.indexOf('function confirmAnnotationClear()');
  const cancelStart = source.indexOf('function cancelAnnotationClear()');
  assert.ok(confirmStart >= 0);
  assert.ok(cancelStart > confirmStart);
  const confirmBody = source.slice(confirmStart, cancelStart);

  assert.match(source, /function removeAnnotationRuntimeCanvases\(\)/);
  assert.match(confirmBody, /removeAnnotationRuntimeCanvases\(\)/);
  assert.match(confirmBody, /setSurfaceInspectorAnnotationMode\(annotationState, false, \{ confirmed: true, reason \}\)/);
  assert.doesNotMatch(confirmBody, /emit\('canvas\.remove', \{ id: SELF_ID \}\)/);
});

test('Surface Inspector models hover annotation actions as real overlay canvases', () => {
  const actionHtml = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/annotation-action-control/index.html'), 'utf8');
  const actionSource = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/annotation-action-control/index.js'), 'utf8');
  const actionStyles = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/annotation-action-control/styles.css'), 'utf8');
  const hitLayerHtml = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/annotation-hit-layer/index.html'), 'utf8');
  const hitLayerStyles = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-inspector/annotation-hit-layer/styles.css'), 'utf8');
  const records = buildAnnotationActionControlCanvasRecords({
    id: 'target-canvas',
    has_children: true,
    projection: {
      can_project_display_overlay: true,
      visible_display_rect: { x: 100, y: 200, w: 180, h: 100 },
    },
  }, { selfId: 'surface-inspector' });

  assert.deepEqual(records.map((record) => record.action), ['add_comment', 'pin_frame']);
  assert.deepEqual(records.map((record) => record.icon), ['plus', 'frame_anchor']);
  assert.deepEqual(records.map((record) => record.canvas_id), ['target-canvas', 'target-canvas']);
  assert.equal(records[0].id, 'surface-inspector-annotation-action-target-canvas-add_comment');
  assert.equal(records[1].id, 'surface-inspector-annotation-action-target-canvas-pin_frame');
  assert.deepEqual(records[0].frame, [240, 215, 32, 32]);
  assert.deepEqual(records[1].frame, [240, 253, 32, 32]);
  assert.equal(records[0].interactive, true);
  assert.equal(records[1].window_level, 'screen_saver');

  const leafRecords = buildAnnotationActionControlCanvasRecords({
    id: 'leaf-canvas',
    has_children: false,
    projection: {
      can_project_display_overlay: true,
      visible_display_rect: { x: 0, y: 0, w: 64, h: 64 },
    },
  });
  assert.deepEqual(leafRecords.map((record) => record.action), ['add_comment', 'pin_frame']);
  const semanticRectRecords = buildAnnotationActionControlCanvasRecords({
    id: 'semantic-target',
    projection: {
      can_project_display_overlay: true,
      display_space_rect: { x: 10, y: 12, width: 90, height: 40 },
    },
  });
  assert.deepEqual(semanticRectRecords.map((record) => record.action), ['add_comment', 'pin_frame']);
  assert.deepEqual(semanticRectRecords[0].frame, [60, -3, 32, 32]);
  assert.equal(semanticRectRecords.flatMap((record) => record.frame).every(Number.isFinite), true);
  assert.deepEqual(buildAnnotationActionControlCanvasRecords({ id: 'missing' }), []);

  const layout = computeMinimapLayout(displays, [
    { id: 'target-canvas', at: [100, 200, 180, 100] },
    ...records.map((record) => ({ id: record.id, parent: 'surface-inspector', at: record.frame, interactive: record.interactive })),
  ], 300);
  assert.ok(layout.canvases.find((entry) => entry.canvas.id === records[0].id));
  assert.ok(layout.canvases.find((entry) => entry.canvas.id === records[1].id));
  assert.match(actionHtml, /annotation-action-control/);
  assert.match(actionSource, /canvas_inspector\.annotation_display_action/);
  assert.match(actionSource, /canvas_id: canvasId/);
  assert.match(actionSource, /data-aos-ref', 'surface-inspector:annotation-action'/);
  assert.match(actionSource, /data-aos-action', action/);
  assert.match(actionSource, /aria-pressed/);
  assert.doesNotMatch(actionSource, /pin-icon/);
  assert.match(actionSource, /frame-anchor-icon/);
  assert.match(actionStyles, /box-shadow:\s*0 12px 28px/);
  assert.match(actionStyles, /is-pressed/);
  assert.match(actionStyles, /background:\s*#168cff/);
  assert.match(actionStyles, /background:\s*#f4c542/);
  assert.doesNotMatch(actionStyles, /pin-icon/);
  assert.match(actionStyles, /frame-anchor-icon/);
  assert.match(hitLayerHtml, /annotation-hit-layer/);
  assert.match(hitLayerStyles, /background:\s*transparent/);
});

test('Surface Inspector annotation hit layer skips empty or non-finite regions', () => {
  assert.equal(buildAnnotationHitLayerFrame([]), null);
  assert.equal(buildAnnotationHitLayerFrame([{ id: 'bad-array-fallback', rect: [10, 20, 100, 80] }]), null);
  assert.equal(buildAnnotationHitLayerFrame([{ id: 'bad-nan', rect: { x: NaN, y: 20, w: 100, h: 80 } }]), null);

  assert.deepEqual(buildAnnotationHitLayerFrame([
    { id: 'one', rect: { x: 10.2, y: 20.6, w: 90.1, h: 40.2 } },
    { id: 'two', rect: { left: 80, top: 10, width: 50, height: 90 } },
  ]), [10, 10, 120, 90]);
});

test('Surface Inspector action-control sync is idempotent for unchanged hover candidates', () => {
  const controls = buildAnnotationActionControlCanvasRecords({
    id: 'target-canvas',
    projection: {
      can_project_display_overlay: true,
      visible_display_rect: { x: 100, y: 200, w: 180, h: 100 },
    },
  }, { selfId: 'surface-inspector' });
  const first = planAnnotationActionControlCanvasSync({
    controls,
    existingIds: new Set(),
    managedIds: new Set(),
    frameKeys: new Map(),
  });

  assert.equal(first.creates.length, 2);
  assert.equal(first.updates.length, 0);
  assert.equal(first.removes.length, 0);

  const pendingRepeat = planAnnotationActionControlCanvasSync({
    controls,
    existingIds: new Set(),
    managedIds: first.nextIds,
    frameKeys: first.nextFrameKeys,
  });
  assert.equal(pendingRepeat.creates.length, 0);
  assert.equal(pendingRepeat.updates.length, 0);
  assert.equal(pendingRepeat.removes.length, 0);

  const existingRepeat = planAnnotationActionControlCanvasSync({
    controls,
    existingIds: first.nextIds,
    managedIds: first.nextIds,
    frameKeys: first.nextFrameKeys,
  });
  assert.equal(existingRepeat.creates.length, 0);
  assert.equal(existingRepeat.updates.length, 0);
  assert.equal(existingRepeat.removes.length, 0);
});

test('Surface Inspector scoped hit regions expose root and nested immediate children only', () => {
  const canvases = [
    { id: 'avatar-main', at: [0, 0, 1000, 800] },
    { id: 'aos-desktop-world-stage', parent: '__log__', at: [0, 0, 1000, 800] },
    { id: 'window-a', parent: 'avatar-main', at: [20, 30, 400, 300] },
    { id: 'window-b', parent: 'avatar-main', at: [450, 30, 400, 300] },
    { id: 'panel-a', parent: 'window-a', at: [40, 60, 160, 120] },
    { id: 'surface-inspector', at: [700, 400, 300, 300] },
    { id: 'surface-inspector-annotation-action-window-a-pin_frame', parent: 'surface-inspector', at: [360, 80, 32, 32] },
  ];

  const rootRegions = buildAnnotationScopedHitRegions({ canvases, selfId: 'surface-inspector' });
  assert.deepEqual(rootRegions.map((region) => region.id).sort(), ['window-a', 'window-b']);
  assert.deepEqual(rootRegions.map((region) => region.candidate.subject_path).sort(), [['canvas', 'window-a'], ['canvas', 'window-b']]);
  assert.equal(rootRegions.every((region) => region.candidate.adapter_id === 'aos-canvas-window'), true);
  assert.equal(rootRegions.every((region) => region.candidate.projection.can_project_display_overlay), true);

  const nestedRegions = buildAnnotationScopedHitRegions({
    canvases,
    selfId: 'surface-inspector',
    scopeStack: [{ subject_id: 'window-a', subject_path: ['main', 'window-a'], root_id: 'main', root_label: 'main' }],
    semanticTargetsByCanvas: new Map([['window-a', [
      { id: 'cta', rect: { x: 80, y: 100, w: 60, h: 24 } },
    ]]]),
  });

  assert.deepEqual(nestedRegions.map((region) => region.id).sort(), ['cta', 'panel-a']);
});

test('Surface Inspector native hit regions expose native window roots and scoped AX elements only', () => {
  const nativeWindowCandidate = {
    id: 'native-window:918:System-Settings',
    adapter_id: 'macos-ax',
    root_kind: 'native_window',
    subject_id: 'native-window:918:System-Settings',
    projection: {
      can_project_display_overlay: true,
      visible_display_rect: { x: 40, y: 80, w: 900, h: 680 },
    },
  };
  const nativeAxCandidate = {
    id: 'ax-element:allow',
    adapter_id: 'macos-ax',
    root_kind: 'native_window',
    subject_id: 'ax-element:allow',
    projection: {
      can_project_display_overlay: true,
      visible_display_rect: { x: 620, y: 700, w: 92, h: 32 },
    },
  };

  assert.deepEqual(
    buildAnnotationNativeHitRegions({ nativeWindowCandidate, nativeAxCandidate }).map((region) => region.id),
    ['native-window:918:System-Settings'],
  );
  assert.deepEqual(
    buildAnnotationNativeHitRegions({
      nativeWindowCandidate,
      nativeAxCandidate,
      scopeStack: [{ adapter_id: 'macos-ax', root_kind: 'native_window', subject_id: 'native-window:918:System-Settings' }],
    }).map((region) => region.id),
    ['ax-element:allow'],
  );
  assert.deepEqual(
    buildAnnotationNativeHitRegions({
      nativeWindowCandidate,
      nativeAxCandidate,
      scopeStack: [{ adapter_id: 'aos-canvas-window', subject_id: 'canvas-a' }],
    }),
    [],
  );
});

test('Surface Inspector treats browser DOM element targets as first-class annotation candidates', () => {
  const target = {
    id: 'element-target-hero',
    kind: 'element_target',
    surface_id: 'controlled-browser-page',
    surface_type: 'browser_page',
    source_path: 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html',
    preferred_selector: 'section[data-testid="hero-card"]',
    selector_candidates: ['section[data-testid="hero-card"]', '[data-testid="hero-card"]'],
    tag_name: 'section',
    role: 'region',
    label: 'Employer brand hero',
    viewport_bounds: { x: 56, y: 56, width: 522, height: 106 },
    page_bounds: { x: 56, y: 56, width: 522, height: 106 },
    metadata: { visibility: { state: 'visible', can_reveal: true, reveal_action: 'scrollIntoView' } },
  };
  const node = buildSurfaceInspectorTargetNodeForAnnotation('controlled-browser-page', target);
  assert.equal(node.adapter_id, BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID);
  assert.equal(node.projection.current_render_status, 'visible');
  assert.equal(node.projection.can_project_display_overlay, true);
  assert.equal(node.projection.can_reveal, true);
  assert.equal(node.source_tree_node_metadata.surface_type, 'browser_page');
  assert.equal(node.source_tree_node_metadata.precision, 'browser_dom_element');

  const offscreen = buildSurfaceInspectorTargetNodeForAnnotation('controlled-browser-page', {
    ...target,
    id: 'element-target-offscreen',
    preferred_selector: '#offscreen-target',
    selector_candidates: ['#offscreen-target'],
    viewport_bounds: { x: 32, y: 1240, width: 220, height: 54 },
    page_bounds: { x: 32, y: 1240, width: 220, height: 54 },
    metadata: { visibility: { state: 'unsupported', can_reveal: true, reveal_action: 'scrollIntoView', blocker_reason: 'target_not_visible_or_zero_area' } },
  });
  assert.equal(offscreen.projection.current_render_status, 'offscreen_scrollable');
  assert.equal(offscreen.projection.can_project_display_overlay, false);
  assert.equal(offscreen.projection.can_reveal, true);
});

test('Surface Inspector unwraps pinned browser DOM targets before reveal dispatch', () => {
  const rawTarget = {
    id: 'element-target-offscreen',
    kind: 'element_target',
    surface_id: 'controlled-browser-page',
    surface_type: 'browser_page',
    source_path: CONTROLLED_BROWSER_DOM_FIXTURE_PATH,
    source_url: `file:///repo/${CONTROLLED_BROWSER_DOM_FIXTURE_PATH}`,
    preferred_selector: '#offscreen-target',
    selector_candidates: ['#offscreen-target'],
    xpath: '/body[1]/button[1]',
    tag_name: 'button',
    label: 'Offscreen action',
    viewport_bounds: { x: 32, y: 1240, width: 220, height: 54 },
    page_bounds: { x: 32, y: 1240, width: 220, height: 54 },
    metadata: {
      visibility: {
        state: 'unsupported',
        can_reveal: true,
        reveal_action: 'scrollIntoView',
        blocker_reason: 'target_not_visible_or_zero_area',
      },
    },
  };
  const node = buildSurfaceInspectorTargetNodeForAnnotation('controlled-browser-page', rawTarget, {
    refreshed_at: '2026-05-10T00:00:00.000Z',
  });
  const pin = {
    id: 'pin:controlled-browser-page:offscreen',
    adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
    root_id: 'controlled-browser-page',
    subject_id: node.subject_id,
    source_tree_node_metadata: node,
    projection: node.projection,
  };
  const revealPayload = buildRevealPayloadForSurfaceInspectorPin(pin);

  assert.equal(revealPayload.kind, 'element_target');
  assert.equal(revealPayload.surface_type, 'browser_page');
  assert.equal(revealPayload.surface_id, 'controlled-browser-page');
  assert.equal(revealPayload.preferred_selector, '#offscreen-target');
  assert.deepEqual(revealPayload.selector_candidates, ['#offscreen-target']);
  assert.equal(revealPayload.xpath, '/body[1]/button[1]');
  assert.equal(revealPayload.source_path, CONTROLLED_BROWSER_DOM_FIXTURE_PATH);
  assert.equal(revealPayload.projection_precision, 'browser_dom_element');
  assert.equal(revealPayload.source_tree_node_metadata.raw_target.preferred_selector, '#offscreen-target');

  const { doc } = createRevealFixtureDocument();
  const publisher = createControlledBrowserDomSurfacePublisher(doc, {
    surface_id: 'controlled-browser-page',
    source_path: CONTROLLED_BROWSER_DOM_FIXTURE_PATH,
    source_url: `file:///repo/${CONTROLLED_BROWSER_DOM_FIXTURE_PATH}`,
    viewport: { width: 800, height: 600 },
    now: '2026-05-10T00:00:00.000Z',
  });
  const result = publisher.revealTarget(revealPayload);
  assert.equal(result.status, 'revealed');
  assert.equal(result.projection.current_render_status, 'visible');

  const stale = buildRevealPayloadForSurfaceInspectorPin({
    ...pin,
    source_tree_node_metadata: {
      ...node,
      source_tree_node_metadata: {
        ...node.source_tree_node_metadata,
        preferred_selector: '',
        selector_candidates: [],
        raw_target: {
          ...rawTarget,
          preferred_selector: '',
          selector_candidates: [],
        },
      },
    },
  });
  assert.equal(stale.preferred_selector, '');
  assert.deepEqual(stale.selector_candidates, []);
  assert.equal(publisher.revealTarget(stale).status, 'target_absent');
});

test('Surface Inspector carries AOS semantic target identity and prior projection into reveal dispatch', () => {
  const target = {
    target_id: 'suggested-verification',
    data_aos_ref: 'html-workbench-expression:suggested-verification',
    aos_ref: 'html-workbench-expression:suggested-verification',
    selector: '[data-semantic-target-id="suggested-verification"]',
    selector_candidates: ['[data-semantic-target-id="suggested-verification"]'],
    source_path: 'docs/design/work-cards/sample.md',
    source_line_start: 42,
    reveal_eligible: true,
    current_render_status: 'offscreen_scrollable',
    can_reveal: true,
    local_space_rect: { x: 24, y: 980, width: 360, height: 70 },
  };
  const node = buildSurfaceInspectorTargetNodeForAnnotation('html-workbench-expression', target, {
    refreshed_at: '2026-05-10T00:00:00.000Z',
  });
  const pin = {
    id: 'pin:html-workbench-expression:suggested-verification',
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'html-workbench-expression',
    subject_id: node.subject_id,
    subject_path: node.subject_path,
    source_tree_node_metadata: node.source_tree_node_metadata,
    projection: node.projection,
  };

  const revealPayload = buildRevealPayloadForSurfaceInspectorPin(pin);

  assert.equal(revealPayload.adapter_id, 'aos-toolkit-semantic-target');
  assert.equal(revealPayload.subject_id, 'suggested-verification');
  assert.equal(revealPayload.owner_canvas_id, 'html-workbench-expression');
  assert.equal(revealPayload.canvas_id, 'html-workbench-expression');
  assert.equal(revealPayload.target_id, 'suggested-verification');
  assert.equal(revealPayload.data_aos_ref, 'html-workbench-expression:suggested-verification');
  assert.deepEqual(revealPayload.selector_candidates, ['[data-semantic-target-id="suggested-verification"]']);
  assert.equal(revealPayload.source_tree_node_metadata.source_path, 'docs/design/work-cards/sample.md');
  assert.equal(revealPayload.prior_projection.current_render_status, 'offscreen_scrollable');
  assert.equal(revealPayload.prior_projection.can_project_display_overlay, false);
});

test('Surface Inspector semantic target refresh requests existing live canvases without polling', () => {
  const requestedAtByCanvas = new Map();
  const first = buildSemanticTargetsRequestMessages([
    { id: 'surface-inspector' },
    { id: 'html-workbench-expression' },
    { id: 'other-surface', suspended: true },
  ], {
    selfId: 'surface-inspector',
    reason: 'surface_inspector_bootstrap',
    now: Date.parse('2026-05-10T00:00:00.000Z'),
    requestedAtByCanvas,
  });

  assert.deepEqual(first, [{
    target: 'html-workbench-expression',
    message: {
      type: 'canvas_inspector.semantic_targets.request',
      requester_canvas_id: 'surface-inspector',
      reply_to: 'surface-inspector',
      reason: 'surface_inspector_bootstrap',
      requested_at: '2026-05-10T00:00:00.000Z',
    },
  }]);
  assert.deepEqual(
    buildSemanticTargetsRequestMessages([{ id: 'html-workbench-expression' }], {
      selfId: 'surface-inspector',
      now: Date.parse('2026-05-10T00:00:00.200Z'),
      requestedAtByCanvas,
    }),
    [],
  );
  assert.equal(
    buildSemanticTargetsRequestMessages([{ id: 'html-workbench-expression' }], {
      selfId: 'surface-inspector',
      now: Date.parse('2026-05-10T00:00:00.200Z'),
      requestedAtByCanvas,
      force: true,
    }).length,
    1,
  );
});

test('Surface Inspector menu and shortcut hooks expose Annotation Mode entry points', () => {
  const statusItem = readFileSync(path.join(repoRoot, 'src/display/status-item.swift'), 'utf8');
  const daemonBundle = readFileSync(path.join(repoRoot, 'src/daemon/surface-inspector-bundle.swift'), 'utf8');
  const unified = readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8');

  assert.match(statusItem, /NSMenuItem\(title: "Surface Inspector"/);
  assert.match(statusItem, /NSMenuItem\(title: "Annotation Mode"/);
  assert.match(statusItem, /menuCanvasInspectorAnnotateMode/);
  assert.match(statusItem, /isCanvasInspectorAnnotationModeVisibleAndActive/);
  assert.doesNotMatch(statusItem, /annotateItem\.state = isUtilityCanvasVisible\(id: canvasInspectorId\) \? \.on : \.off/);
  assert.match(statusItem, /canvas_inspector\.annotation_toggle/);
  assert.match(statusItem, /setCanvasInspectorAnnotationModeActive/);
  assert.match(unified, /canvas_inspector\.annotation_state/);
  assert.match(unified, /canvasInspectorAnnotationModeHandler/);
  assert.match(daemonBundle, /maybeHandleCanvasInspectorAnnotationHotkey/);
  assert.match(daemonBundle, /hotkeyDataMatches\(data, combo: "ctrl\+opt\+a"\)/);
  assert.match(daemonBundle, /openCanvasInspectorForAnnotationMode/);
  assert.match(unified, /maybeHandleCanvasInspectorAnnotationHotkey/);
});

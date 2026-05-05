// panel/index.js — public surface.
//
// Content contract (JSDoc typedef for editor support):
//
// @typedef {Object} Manifest
// @property {string} name                              Required. Unique per canvas.
// @property {string[]} [accepts]                       Inbound message types this content handles.
// @property {string[]} [emits]                         Outbound message types this content sends.
// @property {string} [title]                           Human-readable label (used as tab title).
// @property {{w:number,h:number}} [defaultSize]        Used by tear-off / standalone hosts.
// @property {string} [channelPrefix]                   Used by the channel router.
// @property {string} [icon]                            Used by launchers / tab strips.
// @property {string[]} [requires]                      Daemon event streams to auto-subscribe.
//
// @typedef {Object} Content
// @property {Manifest} [manifest]
// @property {(host: ContentHost) => Node|string} render
// @property {(msg: object, host: ContentHost) => void} [onMessage]
// @property {() => unknown} [serialize]
// @property {(state: unknown, host: ContentHost) => void} [restore]

export { mountPanel } from './mount.js'
export {
  computePanelTransfer,
  createPanelTransferController,
  sendDesktopWorldStageLayer,
  wirePanelTransferDisplayGeometry,
} from './drag-transfer.js'
export {
  clampFrameToWorkArea,
  createDragController,
  createMaximizeController,
  createResizeController,
  dragFrameFromPointer,
  frameFromWindow,
  mountChrome,
  normalizeResizeEdge,
  resizeFrame,
  syncMaximizeButton,
  wireResize,
  workAreaFromWindow,
} from './chrome.js'
export { Single } from './layouts/single.js'
export {
  clampSplitPaneState,
  createSplitPane,
  SplitPane,
} from './layouts/split-pane.js'
export { Tabs } from './layouts/tabs.js'

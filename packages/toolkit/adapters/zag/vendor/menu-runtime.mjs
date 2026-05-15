// node_modules/@zag-js/vanilla/dist/chunk-QZ7TP4HQ.mjs
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// node_modules/@zag-js/utils/dist/array.mjs
function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
var first = (v) => v[0];
var last = (v) => v[v.length - 1];
function nextIndex(v, idx, opts = {}) {
  const { step = 1, loop = true } = opts;
  const next2 = idx + step;
  const len = v.length;
  const last2 = len - 1;
  if (idx === -1) return step > 0 ? 0 : last2;
  if (next2 < 0) return loop ? last2 : 0;
  if (next2 >= len) return loop ? 0 : idx > len ? len : idx;
  return next2;
}
function next(v, idx, opts = {}) {
  return v[nextIndex(v, idx, opts)];
}
function prevIndex(v, idx, opts = {}) {
  const { step = 1, loop = true } = opts;
  return nextIndex(v, idx, { step: -step, loop });
}
function prev(v, index, opts = {}) {
  return v[prevIndex(v, index, opts)];
}

// node_modules/@zag-js/utils/dist/equal.mjs
var isArrayLike = (value) => value?.constructor.name === "Array";
var isArrayEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isEqual(a[i], b[i])) return false;
  }
  return true;
};
var isEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (a == null && b != null || a != null && b == null) return false;
  if (typeof a?.isEqual === "function" && typeof b?.isEqual === "function") {
    return a.isEqual(b);
  }
  if (typeof a === "function" && typeof b === "function") {
    return a.toString() === b.toString();
  }
  if (isArrayLike(a) && isArrayLike(b)) {
    return isArrayEqual(Array.from(a), Array.from(b));
  }
  if (!(typeof a === "object") || !(typeof b === "object")) return false;
  const keys = Object.keys(b ?? /* @__PURE__ */ Object.create(null));
  const length = keys.length;
  for (let i = 0; i < length; i++) {
    const hasKey = Reflect.has(a, keys[i]);
    if (!hasKey) return false;
  }
  for (let i = 0; i < length; i++) {
    const key = keys[i];
    if (!isEqual(a[key], b[key])) return false;
  }
  return true;
};

// node_modules/@zag-js/utils/dist/guard.mjs
var isObjectLike = (v) => v != null && typeof v === "object";
var isString = (v) => typeof v === "string";
var isFunction = (v) => typeof v === "function";
var isNull = (v) => v == null;
var hasProp = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
var baseGetTag = (v) => Object.prototype.toString.call(v);
var fnToString = Function.prototype.toString;
var objectCtorString = fnToString.call(Object);
var isPlainObject = (v) => {
  if (!isObjectLike(v) || baseGetTag(v) != "[object Object]" || isFrameworkElement(v)) return false;
  const proto = Object.getPrototypeOf(v);
  if (proto === null) return true;
  const Ctor = hasProp(proto, "constructor") && proto.constructor;
  return typeof Ctor == "function" && Ctor instanceof Ctor && fnToString.call(Ctor) == objectCtorString;
};
var isReactElement = (x) => typeof x === "object" && x !== null && "$$typeof" in x && "props" in x;
var isVueElement = (x) => typeof x === "object" && x !== null && "__v_isVNode" in x;
var isFrameworkElement = (x) => isReactElement(x) || isVueElement(x);

// node_modules/@zag-js/utils/dist/functions.mjs
var runIfFn = (v, ...a) => {
  const res = typeof v === "function" ? v(...a) : v;
  return res ?? void 0;
};
var cast = (v) => v;
var identity = (v) => v();
var noop = () => {
};
var callAll = (...fns) => (...a) => {
  fns.forEach(function(fn) {
    fn?.(...a);
  });
};

// node_modules/@zag-js/utils/dist/object.mjs
function compact(obj) {
  if (!isPlainObject(obj) || obj === void 0) return obj;
  const keys = Reflect.ownKeys(obj).filter((key) => typeof key === "string");
  const filtered = {};
  for (const key of keys) {
    const value = obj[key];
    if (value !== void 0) {
      filtered[key] = compact(value);
    }
  }
  return filtered;
}

// node_modules/@zag-js/utils/dist/warning.mjs
function warn(...a) {
  const m = a.length === 1 ? a[0] : a[1];
  const c = a.length === 2 ? a[0] : true;
  if (c && true) {
    console.warn(m);
  }
}
function invariant(...a) {
  const m = a.length === 1 ? a[0] : a[1];
  const c = a.length === 2 ? a[0] : true;
  if (c && true) {
    throw new Error(m);
  }
}
function ensure(c, m) {
  if (c == null) throw new Error(m());
}

// node_modules/@zag-js/core/dist/merge-props.mjs
var clsx = (...args) => args.map((str) => str?.trim?.()).filter(Boolean).join(" ");
var CSS_REGEX = /((?:--)?(?:\w+-?)+)\s*:\s*([^;]*)/g;
var serialize = (style) => {
  const res = {};
  let match2;
  while (match2 = CSS_REGEX.exec(style)) {
    res[match2[1]] = match2[2];
  }
  return res;
};
var css = (a, b) => {
  if (isString(a)) {
    if (isString(b)) return `${a};${b}`;
    a = serialize(a);
  } else if (isString(b)) {
    b = serialize(b);
  }
  return Object.assign({}, a ?? {}, b ?? {});
};
function mergeProps(...args) {
  let result = {};
  for (let props of args) {
    if (!props) continue;
    for (let key in result) {
      if (key.startsWith("on") && typeof result[key] === "function" && typeof props[key] === "function") {
        result[key] = callAll(props[key], result[key]);
        continue;
      }
      if (key === "className" || key === "class") {
        result[key] = clsx(result[key], props[key]);
        continue;
      }
      if (key === "style") {
        result[key] = css(result[key], props[key]);
        continue;
      }
      result[key] = props[key] !== void 0 ? props[key] : result[key];
    }
    for (let key in props) {
      if (result[key] === void 0) {
        result[key] = props[key];
      }
    }
    const symbols = Object.getOwnPropertySymbols(props);
    for (let symbol of symbols) {
      result[symbol] = props[symbol];
    }
  }
  return result;
}

// node_modules/@zag-js/core/dist/state.mjs
var STATE_DELIMITER = ".";
var ABSOLUTE_PREFIX = "#";
var stateIndexCache = /* @__PURE__ */ new WeakMap();
var stateIdIndexCache = /* @__PURE__ */ new WeakMap();
function joinStatePath(parts2) {
  return parts2.join(STATE_DELIMITER);
}
function isAbsoluteStatePath(value) {
  return value.includes(STATE_DELIMITER);
}
function isExplicitAbsoluteStatePath(value) {
  return value.startsWith(ABSOLUTE_PREFIX);
}
function isChildTarget(value) {
  return value.startsWith(STATE_DELIMITER);
}
function stripAbsolutePrefix(value) {
  return isExplicitAbsoluteStatePath(value) ? value.slice(ABSOLUTE_PREFIX.length) : value;
}
function appendStatePath(base, segment) {
  return base ? `${base}${STATE_DELIMITER}${segment}` : segment;
}
function buildStateIndex(machine2) {
  const index = /* @__PURE__ */ new Map();
  const idIndex = /* @__PURE__ */ new Map();
  const visit = (basePath, state) => {
    index.set(basePath, state);
    const stateId = state.id;
    if (stateId) {
      if (idIndex.has(stateId)) {
        invariant(`[zag-js] Duplicate state id: "${stateId}"`);
      }
      idIndex.set(stateId, basePath);
    }
    const childStates = state.states;
    if (!childStates) return;
    ensure(state.initial, () => `[zag-js] Compound state "${basePath}" has child states but no "initial" property`);
    if (!(state.initial in childStates)) {
      invariant(
        `[zag-js] Compound state "${basePath}" has initial "${String(state.initial)}" which is not a child state`
      );
    }
    for (const [childKey, childState] of Object.entries(childStates)) {
      if (!childState) continue;
      const childPath = appendStatePath(basePath, childKey);
      visit(childPath, childState);
    }
  };
  for (const [topKey, topState] of Object.entries(machine2.states)) {
    if (!topState) continue;
    visit(topKey, topState);
  }
  return { index, idIndex };
}
function ensureStateIndex(machine2) {
  const cached = stateIndexCache.get(machine2);
  if (cached) return cached;
  const { index, idIndex } = buildStateIndex(machine2);
  stateIndexCache.set(machine2, index);
  stateIdIndexCache.set(machine2, idIndex);
  return index;
}
function getStatePathById(machine2, stateId) {
  ensureStateIndex(machine2);
  return stateIdIndexCache.get(machine2)?.get(stateId);
}
function toSegments(value) {
  if (!value) return [];
  return String(value).split(STATE_DELIMITER).filter(Boolean);
}
function getStateChain(machine2, state) {
  if (!state) return [];
  const stateIndex = ensureStateIndex(machine2);
  const segments = toSegments(state);
  const chain = [];
  const statePath = [];
  for (const segment of segments) {
    statePath.push(segment);
    const path = joinStatePath(statePath);
    const current = stateIndex.get(path);
    if (!current) break;
    chain.push({ path, state: current });
  }
  return chain;
}
function resolveAbsoluteStateValue(machine2, value) {
  const stateIndex = ensureStateIndex(machine2);
  const segments = toSegments(value);
  if (!segments.length) return value;
  const resolved = [];
  for (const segment of segments) {
    resolved.push(segment);
    const path = joinStatePath(resolved);
    if (!stateIndex.has(path)) return value;
  }
  let resolvedPath = joinStatePath(resolved);
  let current = stateIndex.get(resolvedPath);
  while (current?.initial) {
    const nextPath = `${resolvedPath}${STATE_DELIMITER}${current.initial}`;
    const nextState = stateIndex.get(nextPath);
    if (!nextState) break;
    resolvedPath = nextPath;
    current = nextState;
  }
  return resolvedPath;
}
function hasStatePath(machine2, value) {
  const stateIndex = ensureStateIndex(machine2);
  return stateIndex.has(value);
}
function resolveStateValue(machine2, value, source) {
  const stateValue = String(value);
  if (isExplicitAbsoluteStatePath(stateValue)) {
    const stateId = stripAbsolutePrefix(stateValue);
    const statePath = getStatePathById(machine2, stateId);
    ensure(statePath, () => `[zag-js] Unknown state id: "${stateId}"`);
    return resolveAbsoluteStateValue(machine2, statePath);
  }
  if (isChildTarget(stateValue) && source) {
    const childPath = appendStatePath(source, stateValue.slice(1));
    return resolveAbsoluteStateValue(machine2, childPath);
  }
  if (!isAbsoluteStatePath(stateValue) && source) {
    const sourceSegments = toSegments(source);
    for (let index = sourceSegments.length - 1; index >= 1; index--) {
      const base = sourceSegments.slice(0, index).join(STATE_DELIMITER);
      const candidate = appendStatePath(base, stateValue);
      if (hasStatePath(machine2, candidate)) return resolveAbsoluteStateValue(machine2, candidate);
    }
    if (hasStatePath(machine2, stateValue)) return resolveAbsoluteStateValue(machine2, stateValue);
  }
  return resolveAbsoluteStateValue(machine2, stateValue);
}
function findTransition(machine2, state, eventType) {
  const chain = getStateChain(machine2, state);
  for (let index = chain.length - 1; index >= 0; index--) {
    const transitionMap = chain[index]?.state.on;
    const transition = transitionMap?.[eventType];
    if (transition) return { transitions: transition, source: chain[index]?.path };
  }
  const rootTransitionMap = machine2.on;
  return { transitions: rootTransitionMap?.[eventType], source: void 0 };
}
function getExitEnterStates(machine2, prevState, nextState, reenter) {
  const prevChain = prevState ? getStateChain(machine2, prevState) : [];
  const nextChain = getStateChain(machine2, nextState);
  let commonIndex = 0;
  while (commonIndex < prevChain.length && commonIndex < nextChain.length && prevChain[commonIndex]?.path === nextChain[commonIndex]?.path) {
    commonIndex += 1;
  }
  let exiting = prevChain.slice(commonIndex).reverse();
  let entering = nextChain.slice(commonIndex);
  const sameLeaf = prevChain.at(-1)?.path === nextChain.at(-1)?.path;
  if (reenter && sameLeaf) {
    exiting = prevChain.slice().reverse();
    entering = nextChain;
  }
  return { exiting, entering };
}
function matchesState(current, value) {
  if (!current) return false;
  return current === value || current.startsWith(`${value}${STATE_DELIMITER}`);
}
function hasTag(machine2, state, tag) {
  return getStateChain(machine2, state).some((item) => item.state.tags?.includes(tag));
}

// node_modules/@zag-js/core/dist/create-machine.mjs
function createGuards() {
  return {
    and: (...guards) => {
      return function andGuard(params) {
        return guards.every((str) => params.guard(str));
      };
    },
    or: (...guards) => {
      return function orGuard(params) {
        return guards.some((str) => params.guard(str));
      };
    },
    not: (guard) => {
      return function notGuard(params) {
        return !params.guard(guard);
      };
    }
  };
}
function createMachine(config) {
  ensureStateIndex(config);
  return config;
}

// node_modules/@zag-js/core/dist/types.mjs
var MachineStatus = /* @__PURE__ */ ((MachineStatus2) => {
  MachineStatus2["NotStarted"] = "Not Started";
  MachineStatus2["Started"] = "Started";
  MachineStatus2["Stopped"] = "Stopped";
  return MachineStatus2;
})(MachineStatus || {});
var INIT_STATE = "__init__";

// node_modules/@zag-js/dom-query/dist/chunk-QZ7TP4HQ.mjs
var __defProp2 = Object.defineProperty;
var __defNormalProp2 = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField2 = (obj, key, value) => __defNormalProp2(obj, typeof key !== "symbol" ? key + "" : key, value);

// node_modules/@zag-js/dom-query/dist/shared.mjs
var wrap = (v, idx) => {
  return v.map((_, index) => v[(Math.max(idx, 0) + index) % v.length]);
};
var noop2 = () => void 0;
var isObject = (v) => typeof v === "object" && v !== null;
var dataAttr = (guard) => guard ? "" : void 0;
var ariaAttr = (guard) => guard ? "true" : void 0;

// node_modules/@zag-js/dom-query/dist/node.mjs
var ELEMENT_NODE = 1;
var DOCUMENT_NODE = 9;
var DOCUMENT_FRAGMENT_NODE = 11;
var isHTMLElement = (el) => isObject(el) && el.nodeType === ELEMENT_NODE && typeof el.nodeName === "string";
var isDocument = (el) => isObject(el) && el.nodeType === DOCUMENT_NODE;
var isWindow = (el) => isObject(el) && el === el.window;
var getNodeName = (node) => {
  if (isHTMLElement(node)) return node.localName || "";
  return "#document";
};
function isRootElement(node) {
  return ["html", "body", "#document"].includes(getNodeName(node));
}
var isNode = (el) => isObject(el) && el.nodeType !== void 0;
var isShadowRoot = (el) => isNode(el) && el.nodeType === DOCUMENT_FRAGMENT_NODE && "host" in el;
var isInputElement = (el) => isHTMLElement(el) && el.localName === "input";
var isAnchorElement = (el) => !!el?.matches("a[href]");
var isElementVisible = (el) => {
  if (!isHTMLElement(el)) return false;
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
};
function isActiveElement(element) {
  if (!element) return false;
  const rootNode = element.getRootNode();
  return getActiveElement(rootNode) === element;
}
var TEXTAREA_SELECT_REGEX = /(textarea|select)/;
function isEditableElement(el) {
  if (el == null || !isHTMLElement(el)) return false;
  try {
    return isInputElement(el) && el.selectionStart != null || TEXTAREA_SELECT_REGEX.test(el.localName) || el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.getAttribute("contenteditable") === "";
  } catch {
    return false;
  }
}
function contains(parent, child) {
  if (!parent || !child) return false;
  if (!isHTMLElement(parent) || !isNode(child)) return false;
  if (isHTMLElement(child) && parent === child) return true;
  if (parent.contains(child)) return true;
  const rootNode = child.getRootNode?.();
  if (rootNode && isShadowRoot(rootNode)) {
    let next2 = child;
    while (next2) {
      if (parent === next2) return true;
      next2 = next2.parentNode || next2.host;
    }
  }
  return false;
}
function getDocument(el) {
  if (isDocument(el)) return el;
  if (isWindow(el)) return el.document;
  return el?.ownerDocument ?? document;
}
function getDocumentElement(el) {
  return getDocument(el).documentElement;
}
function getWindow(el) {
  if (isShadowRoot(el)) return getWindow(el.host);
  if (isDocument(el)) return el.defaultView ?? window;
  if (isHTMLElement(el)) return el.ownerDocument?.defaultView ?? window;
  return window;
}
function getActiveElement(rootNode) {
  let activeElement = rootNode.activeElement;
  while (activeElement?.shadowRoot) {
    const el = activeElement.shadowRoot.activeElement;
    if (!el || el === activeElement) break;
    else activeElement = el;
  }
  return activeElement;
}
function getParentNode(node) {
  if (getNodeName(node) === "html") return node;
  const result = node.assignedSlot || node.parentNode || isShadowRoot(node) && node.host || getDocumentElement(node);
  return isShadowRoot(result) ? result.host : result;
}
function getRootNode(node) {
  let result;
  try {
    result = node.getRootNode({ composed: true });
    if (isDocument(result) || isShadowRoot(result)) return result;
  } catch {
  }
  return node.ownerDocument ?? document;
}

// node_modules/@zag-js/dom-query/dist/computed-style.mjs
var styleCache = /* @__PURE__ */ new WeakMap();
function getComputedStyle2(el) {
  if (!styleCache.has(el)) {
    styleCache.set(el, getWindow(el).getComputedStyle(el));
  }
  return styleCache.get(el);
}

// node_modules/@zag-js/dom-query/dist/controller.mjs
var INTERACTIVE_CONTAINER_ROLE = /* @__PURE__ */ new Set(["menu", "listbox", "dialog", "grid", "tree", "region"]);
var isInteractiveContainerRole = (role) => INTERACTIVE_CONTAINER_ROLE.has(role);
var getAriaControls = (element) => element.getAttribute("aria-controls")?.split(" ") || [];
function isControlledElement(container, element) {
  const visitedIds = /* @__PURE__ */ new Set();
  const rootNode = getRootNode(container);
  const checkElement = (searchRoot) => {
    const controllingElements = searchRoot.querySelectorAll("[aria-controls]");
    for (const controller of controllingElements) {
      if (controller.getAttribute("aria-expanded") !== "true") continue;
      const controlledIds = getAriaControls(controller);
      for (const id of controlledIds) {
        if (!id || visitedIds.has(id)) continue;
        visitedIds.add(id);
        const controlledElement = rootNode.getElementById(id);
        if (controlledElement) {
          const role = controlledElement.getAttribute("role");
          const modal = controlledElement.getAttribute("aria-modal") === "true";
          if (role && isInteractiveContainerRole(role) && !modal) {
            if (controlledElement === element || controlledElement.contains(element)) {
              return true;
            }
            if (checkElement(controlledElement)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };
  return checkElement(container);
}

// node_modules/@zag-js/dom-query/dist/platform.mjs
var isDom = () => typeof document !== "undefined";
function getPlatform() {
  const agent = navigator.userAgentData;
  return agent?.platform ?? navigator.platform;
}
function getUserAgent() {
  const ua2 = navigator.userAgentData;
  if (ua2 && Array.isArray(ua2.brands)) {
    return ua2.brands.map(({ brand, version }) => `${brand}/${version}`).join(" ");
  }
  return navigator.userAgent;
}
var pt = (v) => isDom() && v.test(getPlatform());
var ua = (v) => isDom() && v.test(getUserAgent());
var isTouchDevice = () => isDom() && !!navigator.maxTouchPoints;
var isMac = () => pt(/^Mac/i);
var isFirefox = () => ua(/Firefox/i);
var isAndroid = () => ua(/Android/i);

// node_modules/@zag-js/dom-query/dist/event.mjs
function getComposedPath(event) {
  return event.composedPath?.() ?? event.nativeEvent?.composedPath?.();
}
function getEventTarget(event) {
  const composedPath = getComposedPath(event);
  return composedPath?.[0] ?? event.target;
}
function isOpeningInNewTab(event) {
  const element = event.currentTarget;
  if (!element) return false;
  const validElement = element.matches("a[href], button[type='submit'], input[type='submit']");
  if (!validElement) return false;
  const isMiddleClick = event.button === 1;
  const isModKeyClick = isCtrlOrMetaKey(event);
  return isMiddleClick || isModKeyClick;
}
function isDownloadingEvent(event) {
  const element = event.currentTarget;
  if (!element) return false;
  const localName = element.localName;
  if (!event.altKey) return false;
  if (localName === "a") return true;
  if (localName === "button" && element.type === "submit") return true;
  if (localName === "input" && element.type === "submit") return true;
  return false;
}
function isCtrlOrMetaKey(e) {
  if (isMac()) return e.metaKey;
  return e.ctrlKey;
}
function isPrintableKey(e) {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey;
}
function isVirtualClick(e) {
  if (e.pointerType === "" && e.isTrusted) return true;
  if (isAndroid() && e.pointerType) {
    return e.type === "click" && e.buttons === 1;
  }
  return e.detail === 0 && !e.pointerType;
}
var isContextMenuEvent = (e) => {
  return e.button === 2 || isMac() && e.ctrlKey && e.button === 0;
};
var isModifierKey = (e) => e.ctrlKey || e.altKey || e.metaKey;
var isTouchEvent = (event) => "touches" in event && event.touches.length > 0;
var keyMap = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Esc: "Escape",
  " ": "Space",
  ",": "Comma",
  Left: "ArrowLeft",
  Right: "ArrowRight"
};
var rtlKeyMap = {
  ArrowLeft: "ArrowRight",
  ArrowRight: "ArrowLeft"
};
function getEventKey(event, options = {}) {
  const { dir = "ltr", orientation = "horizontal" } = options;
  let key = event.key;
  key = keyMap[key] ?? key;
  const isRtl = dir === "rtl" && orientation === "horizontal";
  if (isRtl && key in rtlKeyMap) key = rtlKeyMap[key];
  return key;
}
function getEventPoint(event, type = "client") {
  const point = isTouchEvent(event) ? event.touches[0] || event.changedTouches[0] : event;
  return { x: point[`${type}X`], y: point[`${type}Y`] };
}
var addDomEvent = (target, eventName, handler, options) => {
  const node = typeof target === "function" ? target() : target;
  node?.addEventListener(eventName, handler, options);
  return () => {
    node?.removeEventListener(eventName, handler, options);
  };
};

// node_modules/@zag-js/dom-query/dist/tabbable.mjs
var isFrame = (el) => isHTMLElement(el) && el.tagName === "IFRAME";
function parseTabIndex(el) {
  const attr = el.getAttribute("tabindex");
  if (!attr) return NaN;
  return parseInt(attr, 10);
}
var hasNegativeTabIndex = (el) => parseTabIndex(el) < 0;
function isRadioInput(element) {
  return isInputElement(element) && element.type === "radio";
}
function isTabbableRadio(element) {
  if (!isRadioInput(element) || !element.name) return true;
  if (element.checked) return true;
  const selector = `input[type="radio"][name="${CSS.escape(element.name)}"]`;
  const scope = element.form ?? element.ownerDocument;
  const group = Array.from(scope.querySelectorAll(selector)).filter(
    (radio) => radio.form === element.form && isFocusable(radio)
  );
  const checked = group.find((radio) => radio.checked);
  if (checked) return checked === element;
  return group[0] === element;
}
function getShadowRootForNode(element, getShadowRoot) {
  if (!getShadowRoot) return null;
  if (getShadowRoot === true) {
    return element.shadowRoot || null;
  }
  const result = getShadowRoot(element);
  return (result === true ? element.shadowRoot : result) || null;
}
function collectElementsWithShadowDOM(elements, getShadowRoot, filterFn) {
  const allElements = [...elements];
  const toProcess = [...elements];
  const processed = /* @__PURE__ */ new Set();
  const positionMap = /* @__PURE__ */ new Map();
  elements.forEach((el, i) => positionMap.set(el, i));
  let processIndex = 0;
  while (processIndex < toProcess.length) {
    const element = toProcess[processIndex++];
    if (!element || processed.has(element)) continue;
    processed.add(element);
    const shadowRoot = getShadowRootForNode(element, getShadowRoot);
    if (shadowRoot) {
      const shadowElements = Array.from(shadowRoot.querySelectorAll(focusableSelector)).filter(filterFn);
      const hostIndex = positionMap.get(element);
      if (hostIndex !== void 0) {
        const insertPosition = hostIndex + 1;
        allElements.splice(insertPosition, 0, ...shadowElements);
        shadowElements.forEach((el, i) => {
          positionMap.set(el, insertPosition + i);
        });
        for (let i = insertPosition + shadowElements.length; i < allElements.length; i++) {
          positionMap.set(allElements[i], i);
        }
      } else {
        const insertPosition = allElements.length;
        allElements.push(...shadowElements);
        shadowElements.forEach((el, i) => {
          positionMap.set(el, insertPosition + i);
        });
      }
      toProcess.push(...shadowElements);
    }
  }
  return allElements;
}
var focusableSelector = "input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], button:not([disabled]), [tabindex], iframe, object, embed, area[href], audio[controls], video[controls], [contenteditable]:not([contenteditable='false']), details > summary:first-of-type";
function isFocusable(element) {
  if (!isHTMLElement(element) || element.closest("[inert]")) return false;
  return element.matches(focusableSelector) && isElementVisible(element);
}
function getTabbables(container, options = {}) {
  if (!container) return [];
  const { includeContainer, getShadowRoot } = options;
  const elements = Array.from(container.querySelectorAll(focusableSelector));
  if (includeContainer && isTabbable(container)) {
    elements.unshift(container);
  }
  const tabbableElements = [];
  for (const element of elements) {
    if (!isTabbable(element)) continue;
    if (isFrame(element) && element.contentDocument) {
      const frameBody = element.contentDocument.body;
      tabbableElements.push(...getTabbables(frameBody, { getShadowRoot }));
      continue;
    }
    tabbableElements.push(element);
  }
  if (getShadowRoot) {
    const allElements = collectElementsWithShadowDOM(tabbableElements, getShadowRoot, isTabbable);
    if (!allElements.length && includeContainer) {
      return elements;
    }
    return allElements;
  }
  if (!tabbableElements.length && includeContainer) {
    return elements;
  }
  return tabbableElements;
}
function isTabbable(el) {
  if (isHTMLElement(el) && el.tabIndex > 0) return true;
  if (!isFocusable(el) || hasNegativeTabIndex(el)) return false;
  return isTabbableRadio(el);
}
function getTabbableEdges(container, options = {}) {
  const elements = getTabbables(container, options);
  const first2 = elements[0] || null;
  const last2 = elements[elements.length - 1] || null;
  return [first2, last2];
}

// node_modules/@zag-js/dom-query/dist/initial-focus.mjs
function getInitialFocus(options) {
  const { root, getInitialEl, filter, enabled = true } = options;
  if (!enabled) return;
  let node = null;
  node || (node = typeof getInitialEl === "function" ? getInitialEl() : getInitialEl);
  node || (node = root?.querySelector("[data-autofocus],[autofocus]"));
  if (!node) {
    const tabbables = getTabbables(root);
    node = filter ? tabbables.filter(filter)[0] : tabbables[0];
  }
  return node || root || void 0;
}
function isValidTabEvent(event) {
  const container = event.currentTarget;
  if (!container) return false;
  const [firstTabbable, lastTabbable] = getTabbableEdges(container);
  if (isActiveElement(firstTabbable) && event.shiftKey) return false;
  if (isActiveElement(lastTabbable) && !event.shiftKey) return false;
  if (!firstTabbable && !lastTabbable) return false;
  return true;
}

// node_modules/@zag-js/dom-query/dist/raf.mjs
var AnimationFrame = class _AnimationFrame {
  constructor() {
    __publicField2(this, "id", null);
    __publicField2(this, "fn_cleanup");
    __publicField2(this, "cleanup", () => {
      this.cancel();
    });
  }
  static create() {
    return new _AnimationFrame();
  }
  request(fn) {
    this.cancel();
    this.id = globalThis.requestAnimationFrame(() => {
      this.id = null;
      this.fn_cleanup = fn?.();
    });
  }
  cancel() {
    if (this.id !== null) {
      globalThis.cancelAnimationFrame(this.id);
      this.id = null;
    }
    this.fn_cleanup?.();
    this.fn_cleanup = void 0;
  }
  isActive() {
    return this.id !== null;
  }
};
function raf(fn) {
  const frame = AnimationFrame.create();
  frame.request(fn);
  return frame.cleanup;
}
function nextTick(fn) {
  const set = /* @__PURE__ */ new Set();
  function raf2(fn2) {
    const id = globalThis.requestAnimationFrame(fn2);
    set.add(() => globalThis.cancelAnimationFrame(id));
  }
  raf2(() => raf2(fn));
  return function cleanup() {
    set.forEach((fn2) => fn2());
  };
}
function queueBeforeEvent(el, type, cb) {
  const cancelTimer = raf(() => {
    el.removeEventListener(type, exec, true);
    cb();
  });
  const exec = () => {
    cancelTimer();
    cb();
  };
  el.addEventListener(type, exec, { once: true, capture: true });
  return cancelTimer;
}

// node_modules/@zag-js/dom-query/dist/mutation-observer.mjs
function observeAttributesImpl(node, options) {
  if (!node) return;
  const { attributes, callback: fn } = options;
  const win = node.ownerDocument.defaultView || window;
  const obs = new win.MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "attributes" && change.attributeName && attributes.includes(change.attributeName)) {
        fn(change);
      }
    }
  });
  obs.observe(node, { attributes: true, attributeFilter: attributes });
  return () => obs.disconnect();
}
function observeAttributes(nodeOrFn, options) {
  const { defer } = options;
  const func = defer ? raf : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      const node = typeof nodeOrFn === "function" ? nodeOrFn() : nodeOrFn;
      cleanups.push(observeAttributesImpl(node, options));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}

// node_modules/@zag-js/dom-query/dist/navigate.mjs
function clickIfLink(el) {
  const click = () => {
    const win = getWindow(el);
    el.dispatchEvent(new win.MouseEvent("click"));
  };
  if (isFirefox()) {
    queueBeforeEvent(el, "keyup", click);
  } else {
    queueMicrotask(click);
  }
}

// node_modules/@zag-js/dom-query/dist/overflow.mjs
function getNearestOverflowAncestor(el) {
  const parentNode = getParentNode(el);
  if (isRootElement(parentNode)) return getDocument(parentNode).body;
  if (isHTMLElement(parentNode) && isOverflowElement(parentNode)) return parentNode;
  return getNearestOverflowAncestor(parentNode);
}
var OVERFLOW_RE = /auto|scroll|overlay|hidden|clip/;
var nonOverflowValues = /* @__PURE__ */ new Set(["inline", "contents"]);
function isOverflowElement(el) {
  const win = getWindow(el);
  const { overflow, overflowX, overflowY, display } = win.getComputedStyle(el);
  return OVERFLOW_RE.test(overflow + overflowY + overflowX) && !nonOverflowValues.has(display);
}
function isScrollable(el) {
  return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}
function scrollIntoView(el, options) {
  const { rootEl, ...scrollOptions } = options || {};
  if (!el || !rootEl) return;
  if (!isOverflowElement(rootEl) || !isScrollable(rootEl)) return;
  el.scrollIntoView(scrollOptions);
}

// node_modules/@zag-js/dom-query/dist/query.mjs
function queryAll(root, selector) {
  return Array.from(root?.querySelectorAll(selector) ?? []);
}
var defaultItemToId = (v) => v.id;
function itemById(v, id, itemToId = defaultItemToId) {
  return v.find((item) => itemToId(item) === id);
}
function indexOfId(v, id, itemToId = defaultItemToId) {
  const item = itemById(v, id, itemToId);
  return item ? v.indexOf(item) : -1;
}

// node_modules/@zag-js/dom-query/dist/searchable.mjs
var sanitize = (str) => str.split("").map((char) => {
  const code = char.charCodeAt(0);
  if (code > 0 && code < 128) return char;
  if (code >= 128 && code <= 255) return `/x${code.toString(16)}`.replace("/", "\\");
  return "";
}).join("").trim();
var getValueText = (el) => {
  return sanitize(el.dataset?.valuetext ?? el.textContent ?? "");
};
var match = (valueText, query) => {
  return valueText.trim().toLowerCase().startsWith(query.toLowerCase());
};
function getByText(v, text, currentId, itemToId = defaultItemToId) {
  const index = currentId ? indexOfId(v, currentId, itemToId) : -1;
  let items = currentId ? wrap(v, index) : v;
  const isSingleKey = text.length === 1;
  if (isSingleKey) {
    items = items.filter((item) => itemToId(item) !== currentId);
  }
  return items.find((item) => match(getValueText(item), text));
}

// node_modules/@zag-js/dom-query/dist/set.mjs
function setStyle(el, style) {
  if (!el) return noop2;
  const prev2 = Object.keys(style).reduce((acc, key) => {
    acc[key] = el.style.getPropertyValue(key);
    return acc;
  }, {});
  if (isEqual2(prev2, style)) return noop2;
  Object.assign(el.style, style);
  return () => {
    Object.assign(el.style, prev2);
    if (el.style.length === 0) {
      el.removeAttribute("style");
    }
  };
}
function isEqual2(a, b) {
  return Object.keys(a).every((key) => a[key] === b[key]);
}

// node_modules/@zag-js/dom-query/dist/typeahead.mjs
function getByTypeaheadImpl(baseItems, options) {
  const { state, activeId, key, timeout = 350, itemToId } = options;
  const search = state.keysSoFar + key;
  const isRepeated = search.length > 1 && Array.from(search).every((char) => char === search[0]);
  const query = isRepeated ? search[0] : search;
  let items = baseItems.slice();
  const next2 = getByText(items, query, activeId, itemToId);
  function cleanup() {
    clearTimeout(state.timer);
    state.timer = -1;
  }
  function update(value) {
    state.keysSoFar = value;
    cleanup();
    if (value !== "") {
      state.timer = +setTimeout(() => {
        update("");
        cleanup();
      }, timeout);
    }
  }
  update(search);
  return next2;
}
var getByTypeahead = /* @__PURE__ */ Object.assign(getByTypeaheadImpl, {
  defaultOptions: { keysSoFar: "", timer: -1 },
  isValidEvent: isValidTypeaheadEvent
});
function isValidTypeaheadEvent(event) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

// node_modules/@zag-js/dom-query/dist/wait-for.mjs
function waitForPromise(promise, controller, timeout) {
  const { signal } = controller;
  const wrappedPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout of ${timeout}ms exceeded`));
    }, timeout);
    signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(new DOMException("Promise aborted", "AbortError"));
    });
    promise.then((result) => {
      if (!signal.aborted) {
        clearTimeout(timeoutId);
        resolve(result);
      }
    }).catch((error) => {
      if (!signal.aborted) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  });
  const abort = () => controller.abort();
  return [wrappedPromise, abort];
}
function waitForElement(target, options) {
  const { timeout, rootNode } = options;
  const win = getWindow(rootNode);
  const doc = getDocument(rootNode);
  const controller = new win.AbortController();
  return waitForPromise(
    new Promise((resolve) => {
      const el = target();
      if (el) {
        resolve(el);
        return;
      }
      const observer = new win.MutationObserver(() => {
        const el2 = target();
        if (el2 && el2.isConnected) {
          observer.disconnect();
          resolve(el2);
        }
      });
      observer.observe(doc.body, {
        childList: true,
        subtree: true
      });
    }),
    controller,
    timeout
  );
}

// node_modules/@zag-js/core/dist/scope.mjs
function createScope(props) {
  const getRootNode2 = () => props.getRootNode?.() ?? document;
  const getDoc = () => getDocument(getRootNode2());
  const getWin = () => getDoc().defaultView ?? window;
  const getActiveElementFn = () => getActiveElement(getRootNode2());
  const getById = (id) => getRootNode2().getElementById(id);
  return {
    ...props,
    getRootNode: getRootNode2,
    getDoc,
    getWin,
    getActiveElement: getActiveElementFn,
    isActiveElement,
    getById
  };
}

// node_modules/@zag-js/types/dist/prop-types.mjs
function createNormalizer(fn) {
  return new Proxy({}, {
    get(_target, key) {
      if (key === "style")
        return (props) => {
          return fn({ style: props }).style;
        };
      return fn;
    }
  });
}

// node_modules/@zag-js/vanilla/dist/normalize-props.mjs
var propMap = {
  onFocus: "onFocusin",
  onBlur: "onFocusout",
  onChange: "onInput",
  onDoubleClick: "onDblclick",
  htmlFor: "for",
  className: "class",
  defaultValue: "value",
  defaultChecked: "checked"
};
var caseSensitiveSvgAttrs = /* @__PURE__ */ new Set(["viewBox", "preserveAspectRatio"]);
var toStyleString = (style) => {
  let string = "";
  for (let key in style) {
    const value = style[key];
    if (value === null || value === void 0) continue;
    if (!key.startsWith("--")) key = key.replace(/[A-Z]/g, (match2) => `-${match2.toLowerCase()}`);
    string += `${key}:${value};`;
  }
  return string;
};
var normalizeProps = createNormalizer((props) => {
  return Object.entries(props).reduce((acc, [key, value]) => {
    if (value === void 0) return acc;
    if (key in propMap) {
      key = propMap[key];
    }
    if (key === "style" && typeof value === "object") {
      acc.style = toStyleString(value);
      return acc;
    }
    const normalizedKey = caseSensitiveSvgAttrs.has(key) ? key : key.toLowerCase();
    acc[normalizedKey] = value;
    return acc;
  }, {});
});

// node_modules/@zag-js/vanilla/dist/merge-props.mjs
function mergeProps2(...args) {
  const merged = mergeProps(...args);
  if ("style" in merged && typeof merged.style === "object") {
    merged.style = toStyleString(merged.style);
  }
  return merged;
}

// node_modules/@zag-js/vanilla/dist/spread-props.mjs
var prevAttrsMap = /* @__PURE__ */ new WeakMap();
var assignableProps = /* @__PURE__ */ new Set(["value", "checked", "selected"]);
var caseSensitiveSvgAttrs2 = /* @__PURE__ */ new Set([
  "viewBox",
  "preserveAspectRatio",
  "clipPath",
  "clipRule",
  "fillRule",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit"
]);
var isSvgElement = (node) => {
  return node.tagName === "svg" || node.namespaceURI === "http://www.w3.org/2000/svg";
};
var getAttributeName = (node, attrName) => {
  const shouldPreserveCase = isSvgElement(node) && caseSensitiveSvgAttrs2.has(attrName);
  return shouldPreserveCase ? attrName : attrName.toLowerCase();
};
function spreadProps(node, attrs, machineId) {
  const scopeKey = machineId || "default";
  let machineMap = prevAttrsMap.get(node);
  if (!machineMap) {
    machineMap = /* @__PURE__ */ new Map();
    prevAttrsMap.set(node, machineMap);
  }
  const oldAttrs = machineMap.get(scopeKey) || {};
  const attrKeys = Object.keys(attrs);
  const addEvt = (e, f) => {
    node.addEventListener(e.toLowerCase(), f);
  };
  const remEvt = (e, f) => {
    node.removeEventListener(e.toLowerCase(), f);
  };
  const onEvents = (attr) => attr.startsWith("on");
  const others = (attr) => !attr.startsWith("on");
  const setup = (attr) => addEvt(attr.substring(2), attrs[attr]);
  const teardown = (attr) => remEvt(attr.substring(2), attrs[attr]);
  const apply = (attrName) => {
    const value = attrs[attrName];
    const oldValue = oldAttrs[attrName];
    if (value === oldValue) return;
    if (attrName === "class") {
      ;
      node.className = value ?? "";
      return;
    }
    if (assignableProps.has(attrName)) {
      ;
      node[attrName] = value ?? "";
      return;
    }
    if (typeof value === "boolean" && !attrName.includes("aria-")) {
      ;
      node.toggleAttribute(getAttributeName(node, attrName), value);
      return;
    }
    if (attrName === "children") {
      node.innerHTML = value;
      return;
    }
    if (value != null) {
      node.setAttribute(getAttributeName(node, attrName), value);
      return;
    }
    node.removeAttribute(getAttributeName(node, attrName));
  };
  for (const key in oldAttrs) {
    if (attrs[key] == null) {
      if (key === "class") {
        ;
        node.className = "";
      } else if (assignableProps.has(key)) {
        ;
        node[key] = "";
      } else {
        node.removeAttribute(getAttributeName(node, key));
      }
    }
  }
  const oldEvents = Object.keys(oldAttrs).filter(onEvents);
  oldEvents.forEach((evt) => {
    remEvt(evt.substring(2), oldAttrs[evt]);
  });
  attrKeys.filter(onEvents).forEach(setup);
  attrKeys.filter(others).forEach(apply);
  machineMap.set(scopeKey, attrs);
  return function cleanup() {
    attrKeys.filter(onEvents).forEach(teardown);
    const currentMachineMap = prevAttrsMap.get(node);
    if (currentMachineMap) {
      currentMachineMap.delete(scopeKey);
      if (currentMachineMap.size === 0) {
        prevAttrsMap.delete(node);
      }
    }
  };
}

// node_modules/@zag-js/store/dist/global.mjs
function glob() {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof self !== "undefined") return self;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
}
function globalRef(key, value) {
  const g = glob();
  if (!g) return value();
  g[key] || (g[key] = value());
  return g[key];
}
var refSet = globalRef("__zag__refSet", () => /* @__PURE__ */ new WeakSet());

// node_modules/@zag-js/store/dist/utils.mjs
var isReactElement2 = (x) => typeof x === "object" && x !== null && "$$typeof" in x && "props" in x;
var isVueElement2 = (x) => typeof x === "object" && x !== null && "__v_isVNode" in x;
var isDOMElement = (x) => typeof x === "object" && x !== null && "nodeType" in x && typeof x.nodeName === "string";
var isElement = (x) => isReactElement2(x) || isVueElement2(x) || isDOMElement(x);
var isObject2 = (x) => x !== null && typeof x === "object";
var canProxy = (x) => isObject2(x) && !refSet.has(x) && (Array.isArray(x) || !(Symbol.iterator in x)) && !isElement(x) && !(x instanceof WeakMap) && !(x instanceof WeakSet) && !(x instanceof Error) && !(x instanceof Number) && !(x instanceof Date) && !(x instanceof String) && !(x instanceof RegExp) && !(x instanceof ArrayBuffer) && !(x instanceof Promise) && !(x instanceof File) && !(x instanceof Blob) && !(x instanceof AbortController);
var isDev = () => true;

// node_modules/proxy-compare/dist/index.js
var TRACK_MEMO_SYMBOL = Symbol();
var GET_ORIGINAL_SYMBOL = Symbol();
var getProto = Object.getPrototypeOf;
var objectsToTrack = /* @__PURE__ */ new WeakMap();
var isObjectToTrack = (obj) => obj && (objectsToTrack.has(obj) ? objectsToTrack.get(obj) : getProto(obj) === Object.prototype || getProto(obj) === Array.prototype);
var getUntracked = (obj) => {
  if (isObjectToTrack(obj)) {
    return obj[GET_ORIGINAL_SYMBOL] || null;
  }
  return null;
};
var markToTrack = (obj, mark = true) => {
  objectsToTrack.set(obj, mark);
};

// node_modules/@zag-js/store/dist/proxy.mjs
var proxyStateMap = globalRef("__zag__proxyStateMap", () => /* @__PURE__ */ new WeakMap());
var buildProxyFunction = (objectIs = Object.is, newProxy = (target, handler) => new Proxy(target, handler), snapCache = /* @__PURE__ */ new WeakMap(), createSnapshot = (target, version) => {
  const cache = snapCache.get(target);
  if (cache?.[0] === version) {
    return cache[1];
  }
  const snap = Array.isArray(target) ? [] : Object.create(Object.getPrototypeOf(target));
  markToTrack(snap, true);
  snapCache.set(target, [version, snap]);
  Reflect.ownKeys(target).forEach((key) => {
    const value = Reflect.get(target, key);
    if (refSet.has(value)) {
      markToTrack(value, false);
      snap[key] = value;
    } else if (proxyStateMap.has(value)) {
      snap[key] = snapshot(value);
    } else {
      snap[key] = value;
    }
  });
  return Object.freeze(snap);
}, proxyCache = /* @__PURE__ */ new WeakMap(), versionHolder = [1, 1], proxyFunction2 = (initialObject) => {
  if (!isObject2(initialObject)) {
    throw new Error("object required");
  }
  const found = proxyCache.get(initialObject);
  if (found) {
    return found;
  }
  let version = versionHolder[0];
  const listeners = /* @__PURE__ */ new Set();
  const notifyUpdate = (op, nextVersion = ++versionHolder[0]) => {
    if (version !== nextVersion) {
      version = nextVersion;
      listeners.forEach((listener) => listener(op, nextVersion));
    }
  };
  let checkVersion = versionHolder[1];
  const ensureVersion = (nextCheckVersion = ++versionHolder[1]) => {
    if (checkVersion !== nextCheckVersion && !listeners.size) {
      checkVersion = nextCheckVersion;
      propProxyStates.forEach(([propProxyState]) => {
        const propVersion = propProxyState[1](nextCheckVersion);
        if (propVersion > version) {
          version = propVersion;
        }
      });
    }
    return version;
  };
  const createPropListener = (prop) => (op, nextVersion) => {
    const newOp = [...op];
    newOp[1] = [prop, ...newOp[1]];
    notifyUpdate(newOp, nextVersion);
  };
  const propProxyStates = /* @__PURE__ */ new Map();
  const addPropListener = (prop, propProxyState) => {
    if (isDev() && propProxyStates.has(prop)) {
      throw new Error("prop listener already exists");
    }
    if (listeners.size) {
      const remove = propProxyState[3](createPropListener(prop));
      propProxyStates.set(prop, [propProxyState, remove]);
    } else {
      propProxyStates.set(prop, [propProxyState]);
    }
  };
  const removePropListener = (prop) => {
    const entry = propProxyStates.get(prop);
    if (entry) {
      propProxyStates.delete(prop);
      entry[1]?.();
    }
  };
  const addListener = (listener) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      propProxyStates.forEach(([propProxyState, prevRemove], prop) => {
        if (isDev() && prevRemove) {
          throw new Error("remove already exists");
        }
        const remove = propProxyState[3](createPropListener(prop));
        propProxyStates.set(prop, [propProxyState, remove]);
      });
    }
    const removeListener = () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        propProxyStates.forEach(([propProxyState, remove], prop) => {
          if (remove) {
            remove();
            propProxyStates.set(prop, [propProxyState]);
          }
        });
      }
    };
    return removeListener;
  };
  const baseObject = Array.isArray(initialObject) ? [] : Object.create(Object.getPrototypeOf(initialObject));
  const handler = {
    deleteProperty(target, prop) {
      const prevValue = Reflect.get(target, prop);
      removePropListener(prop);
      const deleted = Reflect.deleteProperty(target, prop);
      if (deleted) {
        notifyUpdate(["delete", [prop], prevValue]);
      }
      return deleted;
    },
    set(target, prop, value, receiver) {
      const hasPrevValue = Reflect.has(target, prop);
      const prevValue = Reflect.get(target, prop, receiver);
      if (hasPrevValue && (objectIs(prevValue, value) || proxyCache.has(value) && objectIs(prevValue, proxyCache.get(value)))) {
        return true;
      }
      removePropListener(prop);
      if (isObject2(value)) {
        value = getUntracked(value) || value;
      }
      let nextValue = value;
      if (Object.getOwnPropertyDescriptor(target, prop)?.set) {
      } else {
        if (!proxyStateMap.has(value) && canProxy(value)) {
          nextValue = proxy(value);
        }
        const childProxyState = !refSet.has(nextValue) && proxyStateMap.get(nextValue);
        if (childProxyState) {
          addPropListener(prop, childProxyState);
        }
      }
      Reflect.set(target, prop, nextValue, receiver);
      notifyUpdate(["set", [prop], value, prevValue]);
      return true;
    }
  };
  const proxyObject = newProxy(baseObject, handler);
  proxyCache.set(initialObject, proxyObject);
  const proxyState = [baseObject, ensureVersion, createSnapshot, addListener];
  proxyStateMap.set(proxyObject, proxyState);
  Reflect.ownKeys(initialObject).forEach((key) => {
    const desc = Object.getOwnPropertyDescriptor(initialObject, key);
    if (desc.get || desc.set) {
      Object.defineProperty(baseObject, key, desc);
    } else {
      proxyObject[key] = initialObject[key];
    }
  });
  return proxyObject;
}) => [
  // public functions
  proxyFunction2,
  // shared state
  proxyStateMap,
  refSet,
  // internal things
  objectIs,
  newProxy,
  canProxy,
  snapCache,
  createSnapshot,
  proxyCache,
  versionHolder
];
var [proxyFunction] = buildProxyFunction();
function proxy(initialObject = {}) {
  return proxyFunction(initialObject);
}
function subscribe(proxyObject, callback, notifyInSync) {
  const proxyState = proxyStateMap.get(proxyObject);
  if (isDev() && !proxyState) {
    console.warn("Please use proxy object");
  }
  let promise;
  const ops = [];
  const addListener = proxyState[3];
  let isListenerActive = false;
  const listener = (op) => {
    ops.push(op);
    if (notifyInSync) {
      callback(ops.splice(0));
      return;
    }
    if (!promise) {
      promise = Promise.resolve().then(() => {
        promise = void 0;
        if (isListenerActive) {
          callback(ops.splice(0));
        }
      });
    }
  };
  const removeListener = addListener(listener);
  isListenerActive = true;
  return () => {
    isListenerActive = false;
    removeListener();
  };
}
function snapshot(proxyObject) {
  const proxyState = proxyStateMap.get(proxyObject);
  if (isDev() && !proxyState) {
    console.warn("Please use proxy object");
  }
  const [target, ensureVersion, createSnapshot] = proxyState;
  return createSnapshot(target, ensureVersion());
}

// node_modules/@zag-js/vanilla/dist/bindable.mjs
function bindable(props) {
  const initial = props().value ?? props().defaultValue;
  if (props().debug) {
    console.log(`[bindable > ${props().debug}] initial`, initial);
  }
  const eq = props().isEqual ?? Object.is;
  const store = proxy({ value: initial });
  const controlled = () => props().value !== void 0;
  return {
    initial,
    ref: store,
    get() {
      return controlled() ? props().value : store.value;
    },
    set(nextValue) {
      const prev2 = controlled() ? props().value : store.value;
      const next2 = isFunction(nextValue) ? nextValue(prev2) : nextValue;
      if (props().debug) {
        console.log(`[bindable > ${props().debug}] setValue`, { next: next2, prev: prev2 });
      }
      if (!controlled()) store.value = next2;
      if (!eq(next2, prev2)) {
        props().onChange?.(next2, prev2);
      }
    },
    invoke(nextValue, prevValue) {
      props().onChange?.(nextValue, prevValue);
    },
    hash(value) {
      return props().hash?.(value) ?? String(value);
    }
  };
}
bindable.cleanup = (_fn) => {
};
bindable.ref = (defaultValue) => {
  let value = defaultValue;
  return {
    get: () => value,
    set: (next2) => {
      value = next2;
    }
  };
};

// node_modules/@zag-js/vanilla/dist/refs.mjs
function createRefs(refs) {
  const ref2 = { current: refs };
  return {
    get(key) {
      return ref2.current[key];
    },
    set(key, value) {
      ref2.current[key] = value;
    }
  };
}

// node_modules/@zag-js/vanilla/dist/merge-machine-props.mjs
function mergeMachineProps(prev2, next2) {
  if (!isPlainObject(prev2) || !isPlainObject(next2)) {
    return next2 === void 0 ? prev2 : next2;
  }
  const result = { ...prev2 };
  for (const key of Object.keys(next2)) {
    const nextValue = next2[key];
    const prevValue = prev2[key];
    if (nextValue === void 0) {
      continue;
    }
    if (isPlainObject(prevValue) && isPlainObject(nextValue)) {
      result[key] = mergeMachineProps(prevValue, nextValue);
    } else {
      result[key] = nextValue;
    }
  }
  return result;
}

// node_modules/@zag-js/vanilla/dist/machine.mjs
var VanillaMachine = class {
  constructor(machine2, userProps = {}) {
    __publicField(this, "machine", machine2);
    __publicField(this, "scope");
    __publicField(this, "context");
    __publicField(this, "prop");
    __publicField(this, "state");
    __publicField(this, "refs");
    __publicField(this, "computed");
    __publicField(this, "event", { type: "" });
    __publicField(this, "previousEvent", { type: "" });
    __publicField(this, "effects", /* @__PURE__ */ new Map());
    __publicField(this, "transition", null);
    __publicField(this, "cleanups", []);
    __publicField(this, "subscriptions", []);
    __publicField(this, "userPropsRef");
    __publicField(this, "getEvent", () => ({
      ...this.event,
      current: () => this.event,
      previous: () => this.previousEvent
    }));
    __publicField(this, "getState", () => ({
      ...this.state,
      matches: (...values) => values.some((value) => matchesState(this.state.get(), value)),
      hasTag: (tag) => hasTag(this.machine, this.state.get(), tag)
    }));
    __publicField(this, "debug", (...args) => {
      if (this.machine.debug) console.log(...args);
    });
    __publicField(this, "notify", () => {
      this.publish();
    });
    __publicField(this, "send", (event) => {
      if (this.status !== MachineStatus.Started) return;
      queueMicrotask(() => {
        if (!event) return;
        this.previousEvent = this.event;
        this.event = event;
        this.debug("send", event);
        let currentState = this.state.get();
        const eventType = event.type;
        const { transitions, source } = findTransition(this.machine, currentState, eventType);
        const transition = this.choose(transitions);
        if (!transition) return;
        this.transition = transition;
        const target = resolveStateValue(this.machine, transition.target ?? currentState, source);
        this.debug("transition", transition);
        const changed = target !== currentState;
        if (changed) {
          this.state.set(target);
        } else if (transition.reenter) {
          this.state.invoke(currentState, currentState);
        } else {
          this.action(transition.actions);
        }
      });
    });
    __publicField(this, "action", (keys) => {
      const strs = isFunction(keys) ? keys(this.getParams()) : keys;
      if (!strs) return;
      const fns = strs.map((s) => {
        const fn = this.machine.implementations?.actions?.[s];
        if (!fn) warn(`[zag-js] No implementation found for action "${JSON.stringify(s)}"`);
        return fn;
      });
      for (const fn of fns) {
        fn?.(this.getParams());
      }
    });
    __publicField(this, "guard", (str) => {
      if (isFunction(str)) return str(this.getParams());
      return this.machine.implementations?.guards?.[str](this.getParams());
    });
    __publicField(this, "effect", (keys) => {
      const strs = isFunction(keys) ? keys(this.getParams()) : keys;
      if (!strs) return;
      const fns = strs.map((s) => {
        const fn = this.machine.implementations?.effects?.[s];
        if (!fn) warn(`[zag-js] No implementation found for effect "${JSON.stringify(s)}"`);
        return fn;
      });
      const cleanups = [];
      for (const fn of fns) {
        const cleanup = fn?.(this.getParams());
        if (cleanup) cleanups.push(cleanup);
      }
      return () => cleanups.forEach((fn) => fn?.());
    });
    __publicField(this, "choose", (transitions) => {
      return toArray(transitions).find((t) => {
        let result = !t.guard;
        if (isString(t.guard)) result = !!this.guard(t.guard);
        else if (isFunction(t.guard)) result = t.guard(this.getParams());
        return result;
      });
    });
    __publicField(this, "subscribe", (fn) => {
      this.subscriptions.push(fn);
      return () => {
        const index = this.subscriptions.indexOf(fn);
        if (index > -1) this.subscriptions.splice(index, 1);
      };
    });
    __publicField(this, "status", MachineStatus.NotStarted);
    __publicField(this, "publish", () => {
      this.callTrackers();
      this.subscriptions.forEach((fn) => fn(this.service));
    });
    __publicField(this, "trackers", []);
    __publicField(this, "setupTrackers", () => {
      this.machine.watch?.(this.getParams());
    });
    __publicField(this, "callTrackers", () => {
      this.trackers.forEach(({ deps, fn }) => {
        const next2 = deps.map((dep) => dep());
        if (!isEqual(fn.prev, next2)) {
          fn();
          fn.prev = next2;
        }
      });
    });
    __publicField(this, "getParams", () => ({
      state: this.getState(),
      context: this.context,
      event: this.getEvent(),
      prop: this.prop,
      send: this.send,
      action: this.action,
      guard: this.guard,
      track: (deps, fn) => {
        fn.prev = deps.map((dep) => dep());
        this.trackers.push({ deps, fn });
      },
      refs: this.refs,
      computed: this.computed,
      flush: identity,
      scope: this.scope,
      choose: this.choose
    }));
    this.userPropsRef = { current: userProps };
    const { id, ids, getRootNode: getRootNode2 } = runIfFn(userProps);
    this.scope = createScope({ id, ids, getRootNode: getRootNode2 });
    const prop = (key) => {
      const __props = runIfFn(this.userPropsRef.current);
      const props = machine2.props?.({ props: compact(__props), scope: this.scope }) ?? __props;
      return props[key];
    };
    this.prop = prop;
    const context = machine2.context?.({
      prop,
      bindable,
      scope: this.scope,
      flush(fn) {
        queueMicrotask(fn);
      },
      getContext() {
        return ctx;
      },
      getComputed() {
        return computed;
      },
      getRefs() {
        return refs;
      },
      getEvent: this.getEvent.bind(this)
    });
    if (context) {
      Object.values(context).forEach((item) => {
        const unsub = subscribe(item.ref, () => this.notify());
        this.cleanups.push(unsub);
      });
    }
    const ctx = {
      get(key) {
        return context?.[key].get();
      },
      set(key, value) {
        context?.[key].set(value);
      },
      initial(key) {
        return context?.[key].initial;
      },
      hash(key) {
        const current = context?.[key].get();
        return context?.[key].hash(current);
      }
    };
    this.context = ctx;
    const computed = (key) => {
      ensure(machine2.computed, () => `[zag-js] No computed object found on machine`);
      return machine2.computed[key]({
        context: ctx,
        event: this.getEvent(),
        prop,
        refs: this.refs,
        scope: this.scope,
        computed
      });
    };
    this.computed = computed;
    const refs = createRefs(machine2.refs?.({ prop, context: ctx }) ?? {});
    this.refs = refs;
    const state = bindable(() => ({
      defaultValue: resolveStateValue(machine2, machine2.initialState({ prop })),
      onChange: (nextState, prevState) => {
        const { exiting, entering } = getExitEnterStates(this.machine, prevState, nextState, this.transition?.reenter);
        exiting.forEach((item) => {
          const exitEffects = this.effects.get(item.path);
          exitEffects?.();
          this.effects.delete(item.path);
        });
        exiting.forEach((item) => {
          this.action(item.state?.exit);
        });
        this.action(this.transition?.actions);
        entering.forEach((item) => {
          const cleanup = this.effect(item.state?.effects);
          if (cleanup) this.effects.set(item.path, cleanup);
        });
        if (prevState === INIT_STATE) {
          this.action(machine2.entry);
          const cleanup = this.effect(machine2.effects);
          if (cleanup) this.effects.set(INIT_STATE, cleanup);
        }
        entering.forEach((item) => {
          this.action(item.state?.entry);
        });
      }
    }));
    this.state = state;
    this.cleanups.push(subscribe(this.state.ref, () => this.notify()));
  }
  updateProps(newProps) {
    const prevSource = this.userPropsRef.current;
    this.userPropsRef.current = () => {
      const prev2 = runIfFn(prevSource);
      const next2 = runIfFn(newProps);
      return mergeMachineProps(prev2, next2);
    };
    this.notify();
  }
  start() {
    this.status = MachineStatus.Started;
    this.debug("initializing...");
    this.state.invoke(this.state.initial, INIT_STATE);
    this.setupTrackers();
  }
  stop() {
    this.effects.forEach((fn) => fn?.());
    this.effects.clear();
    this.transition = null;
    this.action(this.machine.exit);
    this.cleanups.forEach((unsub) => unsub());
    this.cleanups = [];
    this.subscriptions = [];
    this.status = MachineStatus.Stopped;
    this.debug("unmounting...");
  }
  get service() {
    return {
      state: this.getState(),
      send: this.send,
      context: this.context,
      prop: this.prop,
      scope: this.scope,
      refs: this.refs,
      computed: this.computed,
      event: this.getEvent(),
      getStatus: () => this.status
    };
  }
};

// node_modules/@zag-js/anatomy/dist/create-anatomy.mjs
var createAnatomy = (name, parts2 = []) => ({
  parts: (...values) => {
    if (isEmpty(parts2)) {
      return createAnatomy(name, values);
    }
    throw new Error("createAnatomy().parts(...) should only be called once. Did you mean to use .extendWith(...) ?");
  },
  extendWith: (...values) => createAnatomy(name, [...parts2, ...values]),
  omit: (...values) => createAnatomy(name, parts2.filter((part) => !values.includes(part))),
  rename: (newName) => createAnatomy(newName, parts2),
  keys: () => parts2,
  build: () => [...new Set(parts2)].reduce(
    (prev2, part) => Object.assign(prev2, {
      [part]: {
        selector: [
          `&[data-scope="${toKebabCase(name)}"][data-part="${toKebabCase(part)}"]`,
          `& [data-scope="${toKebabCase(name)}"][data-part="${toKebabCase(part)}"]`
        ].join(", "),
        attrs: { "data-scope": toKebabCase(name), "data-part": toKebabCase(part) }
      }
    }),
    {}
  )
});
var toKebabCase = (value) => value.replace(/([A-Z])([A-Z])/g, "$1-$2").replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
var isEmpty = (v) => v.length === 0;

// node_modules/@zag-js/menu/dist/menu.anatomy.mjs
var anatomy = createAnatomy("menu").parts(
  "arrow",
  "arrowTip",
  "content",
  "contextTrigger",
  "indicator",
  "item",
  "itemGroup",
  "itemGroupLabel",
  "itemIndicator",
  "itemText",
  "positioner",
  "separator",
  "trigger",
  "triggerItem"
);
var parts = anatomy.build();

// node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
var sides = ["top", "right", "bottom", "left"];
var min = Math.min;
var max = Math.max;
var round = Math.round;
var floor = Math.floor;
var createCoords = (v) => ({
  x: v,
  y: v
});
var oppositeSideMap = {
  left: "right",
  right: "left",
  bottom: "top",
  top: "bottom"
};
function clamp(start, value, end) {
  return max(start, min(value, end));
}
function evaluate(value, param) {
  return typeof value === "function" ? value(param) : value;
}
function getSide(placement) {
  return placement.split("-")[0];
}
function getAlignment(placement) {
  return placement.split("-")[1];
}
function getOppositeAxis(axis) {
  return axis === "x" ? "y" : "x";
}
function getAxisLength(axis) {
  return axis === "y" ? "height" : "width";
}
function getSideAxis(placement) {
  const firstChar = placement[0];
  return firstChar === "t" || firstChar === "b" ? "y" : "x";
}
function getAlignmentAxis(placement) {
  return getOppositeAxis(getSideAxis(placement));
}
function getAlignmentSides(placement, rects, rtl) {
  if (rtl === void 0) {
    rtl = false;
  }
  const alignment = getAlignment(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const length = getAxisLength(alignmentAxis);
  let mainAlignmentSide = alignmentAxis === "x" ? alignment === (rtl ? "end" : "start") ? "right" : "left" : alignment === "start" ? "bottom" : "top";
  if (rects.reference[length] > rects.floating[length]) {
    mainAlignmentSide = getOppositePlacement(mainAlignmentSide);
  }
  return [mainAlignmentSide, getOppositePlacement(mainAlignmentSide)];
}
function getExpandedPlacements(placement) {
  const oppositePlacement = getOppositePlacement(placement);
  return [getOppositeAlignmentPlacement(placement), oppositePlacement, getOppositeAlignmentPlacement(oppositePlacement)];
}
function getOppositeAlignmentPlacement(placement) {
  return placement.includes("start") ? placement.replace("start", "end") : placement.replace("end", "start");
}
var lrPlacement = ["left", "right"];
var rlPlacement = ["right", "left"];
var tbPlacement = ["top", "bottom"];
var btPlacement = ["bottom", "top"];
function getSideList(side, isStart, rtl) {
  switch (side) {
    case "top":
    case "bottom":
      if (rtl) return isStart ? rlPlacement : lrPlacement;
      return isStart ? lrPlacement : rlPlacement;
    case "left":
    case "right":
      return isStart ? tbPlacement : btPlacement;
    default:
      return [];
  }
}
function getOppositeAxisPlacements(placement, flipAlignment, direction, rtl) {
  const alignment = getAlignment(placement);
  let list = getSideList(getSide(placement), direction === "start", rtl);
  if (alignment) {
    list = list.map((side) => side + "-" + alignment);
    if (flipAlignment) {
      list = list.concat(list.map(getOppositeAlignmentPlacement));
    }
  }
  return list;
}
function getOppositePlacement(placement) {
  const side = getSide(placement);
  return oppositeSideMap[side] + placement.slice(side.length);
}
function expandPaddingObject(padding) {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    ...padding
  };
}
function getPaddingObject(padding) {
  return typeof padding !== "number" ? expandPaddingObject(padding) : {
    top: padding,
    right: padding,
    bottom: padding,
    left: padding
  };
}
function rectToClientRect(rect) {
  const {
    x,
    y,
    width,
    height
  } = rect;
  return {
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    x,
    y
  };
}

// node_modules/@floating-ui/core/dist/floating-ui.core.mjs
function computeCoordsFromPlacement(_ref, placement, rtl) {
  let {
    reference,
    floating
  } = _ref;
  const sideAxis = getSideAxis(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const alignLength = getAxisLength(alignmentAxis);
  const side = getSide(placement);
  const isVertical = sideAxis === "y";
  const commonX = reference.x + reference.width / 2 - floating.width / 2;
  const commonY = reference.y + reference.height / 2 - floating.height / 2;
  const commonAlign = reference[alignLength] / 2 - floating[alignLength] / 2;
  let coords;
  switch (side) {
    case "top":
      coords = {
        x: commonX,
        y: reference.y - floating.height
      };
      break;
    case "bottom":
      coords = {
        x: commonX,
        y: reference.y + reference.height
      };
      break;
    case "right":
      coords = {
        x: reference.x + reference.width,
        y: commonY
      };
      break;
    case "left":
      coords = {
        x: reference.x - floating.width,
        y: commonY
      };
      break;
    default:
      coords = {
        x: reference.x,
        y: reference.y
      };
  }
  switch (getAlignment(placement)) {
    case "start":
      coords[alignmentAxis] -= commonAlign * (rtl && isVertical ? -1 : 1);
      break;
    case "end":
      coords[alignmentAxis] += commonAlign * (rtl && isVertical ? -1 : 1);
      break;
  }
  return coords;
}
async function detectOverflow(state, options) {
  var _await$platform$isEle;
  if (options === void 0) {
    options = {};
  }
  const {
    x,
    y,
    platform: platform2,
    rects,
    elements,
    strategy
  } = state;
  const {
    boundary = "clippingAncestors",
    rootBoundary = "viewport",
    elementContext = "floating",
    altBoundary = false,
    padding = 0
  } = evaluate(options, state);
  const paddingObject = getPaddingObject(padding);
  const altContext = elementContext === "floating" ? "reference" : "floating";
  const element = elements[altBoundary ? altContext : elementContext];
  const clippingClientRect = rectToClientRect(await platform2.getClippingRect({
    element: ((_await$platform$isEle = await (platform2.isElement == null ? void 0 : platform2.isElement(element))) != null ? _await$platform$isEle : true) ? element : element.contextElement || await (platform2.getDocumentElement == null ? void 0 : platform2.getDocumentElement(elements.floating)),
    boundary,
    rootBoundary,
    strategy
  }));
  const rect = elementContext === "floating" ? {
    x,
    y,
    width: rects.floating.width,
    height: rects.floating.height
  } : rects.reference;
  const offsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(elements.floating));
  const offsetScale = await (platform2.isElement == null ? void 0 : platform2.isElement(offsetParent)) ? await (platform2.getScale == null ? void 0 : platform2.getScale(offsetParent)) || {
    x: 1,
    y: 1
  } : {
    x: 1,
    y: 1
  };
  const elementClientRect = rectToClientRect(platform2.convertOffsetParentRelativeRectToViewportRelativeRect ? await platform2.convertOffsetParentRelativeRectToViewportRelativeRect({
    elements,
    rect,
    offsetParent,
    strategy
  }) : rect);
  return {
    top: (clippingClientRect.top - elementClientRect.top + paddingObject.top) / offsetScale.y,
    bottom: (elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom) / offsetScale.y,
    left: (clippingClientRect.left - elementClientRect.left + paddingObject.left) / offsetScale.x,
    right: (elementClientRect.right - clippingClientRect.right + paddingObject.right) / offsetScale.x
  };
}
var MAX_RESET_COUNT = 50;
var computePosition = async (reference, floating, config) => {
  const {
    placement = "bottom",
    strategy = "absolute",
    middleware = [],
    platform: platform2
  } = config;
  const platformWithDetectOverflow = platform2.detectOverflow ? platform2 : {
    ...platform2,
    detectOverflow
  };
  const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(floating));
  let rects = await platform2.getElementRects({
    reference,
    floating,
    strategy
  });
  let {
    x,
    y
  } = computeCoordsFromPlacement(rects, placement, rtl);
  let statefulPlacement = placement;
  let resetCount = 0;
  const middlewareData = {};
  for (let i = 0; i < middleware.length; i++) {
    const currentMiddleware = middleware[i];
    if (!currentMiddleware) {
      continue;
    }
    const {
      name,
      fn
    } = currentMiddleware;
    const {
      x: nextX,
      y: nextY,
      data,
      reset
    } = await fn({
      x,
      y,
      initialPlacement: placement,
      placement: statefulPlacement,
      strategy,
      middlewareData,
      rects,
      platform: platformWithDetectOverflow,
      elements: {
        reference,
        floating
      }
    });
    x = nextX != null ? nextX : x;
    y = nextY != null ? nextY : y;
    middlewareData[name] = {
      ...middlewareData[name],
      ...data
    };
    if (reset && resetCount < MAX_RESET_COUNT) {
      resetCount++;
      if (typeof reset === "object") {
        if (reset.placement) {
          statefulPlacement = reset.placement;
        }
        if (reset.rects) {
          rects = reset.rects === true ? await platform2.getElementRects({
            reference,
            floating,
            strategy
          }) : reset.rects;
        }
        ({
          x,
          y
        } = computeCoordsFromPlacement(rects, statefulPlacement, rtl));
      }
      i = -1;
    }
  }
  return {
    x,
    y,
    placement: statefulPlacement,
    strategy,
    middlewareData
  };
};
var arrow = (options) => ({
  name: "arrow",
  options,
  async fn(state) {
    const {
      x,
      y,
      placement,
      rects,
      platform: platform2,
      elements,
      middlewareData
    } = state;
    const {
      element,
      padding = 0
    } = evaluate(options, state) || {};
    if (element == null) {
      return {};
    }
    const paddingObject = getPaddingObject(padding);
    const coords = {
      x,
      y
    };
    const axis = getAlignmentAxis(placement);
    const length = getAxisLength(axis);
    const arrowDimensions = await platform2.getDimensions(element);
    const isYAxis = axis === "y";
    const minProp = isYAxis ? "top" : "left";
    const maxProp = isYAxis ? "bottom" : "right";
    const clientProp = isYAxis ? "clientHeight" : "clientWidth";
    const endDiff = rects.reference[length] + rects.reference[axis] - coords[axis] - rects.floating[length];
    const startDiff = coords[axis] - rects.reference[axis];
    const arrowOffsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(element));
    let clientSize = arrowOffsetParent ? arrowOffsetParent[clientProp] : 0;
    if (!clientSize || !await (platform2.isElement == null ? void 0 : platform2.isElement(arrowOffsetParent))) {
      clientSize = elements.floating[clientProp] || rects.floating[length];
    }
    const centerToReference = endDiff / 2 - startDiff / 2;
    const largestPossiblePadding = clientSize / 2 - arrowDimensions[length] / 2 - 1;
    const minPadding = min(paddingObject[minProp], largestPossiblePadding);
    const maxPadding = min(paddingObject[maxProp], largestPossiblePadding);
    const min$1 = minPadding;
    const max2 = clientSize - arrowDimensions[length] - maxPadding;
    const center = clientSize / 2 - arrowDimensions[length] / 2 + centerToReference;
    const offset3 = clamp(min$1, center, max2);
    const shouldAddOffset = !middlewareData.arrow && getAlignment(placement) != null && center !== offset3 && rects.reference[length] / 2 - (center < min$1 ? minPadding : maxPadding) - arrowDimensions[length] / 2 < 0;
    const alignmentOffset = shouldAddOffset ? center < min$1 ? center - min$1 : center - max2 : 0;
    return {
      [axis]: coords[axis] + alignmentOffset,
      data: {
        [axis]: offset3,
        centerOffset: center - offset3 - alignmentOffset,
        ...shouldAddOffset && {
          alignmentOffset
        }
      },
      reset: shouldAddOffset
    };
  }
});
var flip = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "flip",
    options,
    async fn(state) {
      var _middlewareData$arrow, _middlewareData$flip;
      const {
        placement,
        middlewareData,
        rects,
        initialPlacement,
        platform: platform2,
        elements
      } = state;
      const {
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = true,
        fallbackPlacements: specifiedFallbackPlacements,
        fallbackStrategy = "bestFit",
        fallbackAxisSideDirection = "none",
        flipAlignment = true,
        ...detectOverflowOptions
      } = evaluate(options, state);
      if ((_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
        return {};
      }
      const side = getSide(placement);
      const initialSideAxis = getSideAxis(initialPlacement);
      const isBasePlacement = getSide(initialPlacement) === initialPlacement;
      const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
      const fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipAlignment ? [getOppositePlacement(initialPlacement)] : getExpandedPlacements(initialPlacement));
      const hasFallbackAxisSideDirection = fallbackAxisSideDirection !== "none";
      if (!specifiedFallbackPlacements && hasFallbackAxisSideDirection) {
        fallbackPlacements.push(...getOppositeAxisPlacements(initialPlacement, flipAlignment, fallbackAxisSideDirection, rtl));
      }
      const placements2 = [initialPlacement, ...fallbackPlacements];
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const overflows = [];
      let overflowsData = ((_middlewareData$flip = middlewareData.flip) == null ? void 0 : _middlewareData$flip.overflows) || [];
      if (checkMainAxis) {
        overflows.push(overflow[side]);
      }
      if (checkCrossAxis) {
        const sides2 = getAlignmentSides(placement, rects, rtl);
        overflows.push(overflow[sides2[0]], overflow[sides2[1]]);
      }
      overflowsData = [...overflowsData, {
        placement,
        overflows
      }];
      if (!overflows.every((side2) => side2 <= 0)) {
        var _middlewareData$flip2, _overflowsData$filter;
        const nextIndex2 = (((_middlewareData$flip2 = middlewareData.flip) == null ? void 0 : _middlewareData$flip2.index) || 0) + 1;
        const nextPlacement = placements2[nextIndex2];
        if (nextPlacement) {
          const ignoreCrossAxisOverflow = checkCrossAxis === "alignment" ? initialSideAxis !== getSideAxis(nextPlacement) : false;
          if (!ignoreCrossAxisOverflow || // We leave the current main axis only if every placement on that axis
          // overflows the main axis.
          overflowsData.every((d) => getSideAxis(d.placement) === initialSideAxis ? d.overflows[0] > 0 : true)) {
            return {
              data: {
                index: nextIndex2,
                overflows: overflowsData
              },
              reset: {
                placement: nextPlacement
              }
            };
          }
        }
        let resetPlacement = (_overflowsData$filter = overflowsData.filter((d) => d.overflows[0] <= 0).sort((a, b) => a.overflows[1] - b.overflows[1])[0]) == null ? void 0 : _overflowsData$filter.placement;
        if (!resetPlacement) {
          switch (fallbackStrategy) {
            case "bestFit": {
              var _overflowsData$filter2;
              const placement2 = (_overflowsData$filter2 = overflowsData.filter((d) => {
                if (hasFallbackAxisSideDirection) {
                  const currentSideAxis = getSideAxis(d.placement);
                  return currentSideAxis === initialSideAxis || // Create a bias to the `y` side axis due to horizontal
                  // reading directions favoring greater width.
                  currentSideAxis === "y";
                }
                return true;
              }).map((d) => [d.placement, d.overflows.filter((overflow2) => overflow2 > 0).reduce((acc, overflow2) => acc + overflow2, 0)]).sort((a, b) => a[1] - b[1])[0]) == null ? void 0 : _overflowsData$filter2[0];
              if (placement2) {
                resetPlacement = placement2;
              }
              break;
            }
            case "initialPlacement":
              resetPlacement = initialPlacement;
              break;
          }
        }
        if (placement !== resetPlacement) {
          return {
            reset: {
              placement: resetPlacement
            }
          };
        }
      }
      return {};
    }
  };
};
function getSideOffsets(overflow, rect) {
  return {
    top: overflow.top - rect.height,
    right: overflow.right - rect.width,
    bottom: overflow.bottom - rect.height,
    left: overflow.left - rect.width
  };
}
function isAnySideFullyClipped(overflow) {
  return sides.some((side) => overflow[side] >= 0);
}
var hide = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "hide",
    options,
    async fn(state) {
      const {
        rects,
        platform: platform2
      } = state;
      const {
        strategy = "referenceHidden",
        ...detectOverflowOptions
      } = evaluate(options, state);
      switch (strategy) {
        case "referenceHidden": {
          const overflow = await platform2.detectOverflow(state, {
            ...detectOverflowOptions,
            elementContext: "reference"
          });
          const offsets = getSideOffsets(overflow, rects.reference);
          return {
            data: {
              referenceHiddenOffsets: offsets,
              referenceHidden: isAnySideFullyClipped(offsets)
            }
          };
        }
        case "escaped": {
          const overflow = await platform2.detectOverflow(state, {
            ...detectOverflowOptions,
            altBoundary: true
          });
          const offsets = getSideOffsets(overflow, rects.floating);
          return {
            data: {
              escapedOffsets: offsets,
              escaped: isAnySideFullyClipped(offsets)
            }
          };
        }
        default: {
          return {};
        }
      }
    }
  };
};
var originSides = /* @__PURE__ */ new Set(["left", "top"]);
async function convertValueToCoords(state, options) {
  const {
    placement,
    platform: platform2,
    elements
  } = state;
  const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
  const side = getSide(placement);
  const alignment = getAlignment(placement);
  const isVertical = getSideAxis(placement) === "y";
  const mainAxisMulti = originSides.has(side) ? -1 : 1;
  const crossAxisMulti = rtl && isVertical ? -1 : 1;
  const rawValue = evaluate(options, state);
  let {
    mainAxis,
    crossAxis,
    alignmentAxis
  } = typeof rawValue === "number" ? {
    mainAxis: rawValue,
    crossAxis: 0,
    alignmentAxis: null
  } : {
    mainAxis: rawValue.mainAxis || 0,
    crossAxis: rawValue.crossAxis || 0,
    alignmentAxis: rawValue.alignmentAxis
  };
  if (alignment && typeof alignmentAxis === "number") {
    crossAxis = alignment === "end" ? alignmentAxis * -1 : alignmentAxis;
  }
  return isVertical ? {
    x: crossAxis * crossAxisMulti,
    y: mainAxis * mainAxisMulti
  } : {
    x: mainAxis * mainAxisMulti,
    y: crossAxis * crossAxisMulti
  };
}
var offset = function(options) {
  if (options === void 0) {
    options = 0;
  }
  return {
    name: "offset",
    options,
    async fn(state) {
      var _middlewareData$offse, _middlewareData$arrow;
      const {
        x,
        y,
        placement,
        middlewareData
      } = state;
      const diffCoords = await convertValueToCoords(state, options);
      if (placement === ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse.placement) && (_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
        return {};
      }
      return {
        x: x + diffCoords.x,
        y: y + diffCoords.y,
        data: {
          ...diffCoords,
          placement
        }
      };
    }
  };
};
var shift = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "shift",
    options,
    async fn(state) {
      const {
        x,
        y,
        placement,
        platform: platform2
      } = state;
      const {
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = false,
        limiter = {
          fn: (_ref) => {
            let {
              x: x2,
              y: y2
            } = _ref;
            return {
              x: x2,
              y: y2
            };
          }
        },
        ...detectOverflowOptions
      } = evaluate(options, state);
      const coords = {
        x,
        y
      };
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const crossAxis = getSideAxis(getSide(placement));
      const mainAxis = getOppositeAxis(crossAxis);
      let mainAxisCoord = coords[mainAxis];
      let crossAxisCoord = coords[crossAxis];
      if (checkMainAxis) {
        const minSide = mainAxis === "y" ? "top" : "left";
        const maxSide = mainAxis === "y" ? "bottom" : "right";
        const min2 = mainAxisCoord + overflow[minSide];
        const max2 = mainAxisCoord - overflow[maxSide];
        mainAxisCoord = clamp(min2, mainAxisCoord, max2);
      }
      if (checkCrossAxis) {
        const minSide = crossAxis === "y" ? "top" : "left";
        const maxSide = crossAxis === "y" ? "bottom" : "right";
        const min2 = crossAxisCoord + overflow[minSide];
        const max2 = crossAxisCoord - overflow[maxSide];
        crossAxisCoord = clamp(min2, crossAxisCoord, max2);
      }
      const limitedCoords = limiter.fn({
        ...state,
        [mainAxis]: mainAxisCoord,
        [crossAxis]: crossAxisCoord
      });
      return {
        ...limitedCoords,
        data: {
          x: limitedCoords.x - x,
          y: limitedCoords.y - y,
          enabled: {
            [mainAxis]: checkMainAxis,
            [crossAxis]: checkCrossAxis
          }
        }
      };
    }
  };
};
var limitShift = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    options,
    fn(state) {
      const {
        x,
        y,
        placement,
        rects,
        middlewareData
      } = state;
      const {
        offset: offset3 = 0,
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = true
      } = evaluate(options, state);
      const coords = {
        x,
        y
      };
      const crossAxis = getSideAxis(placement);
      const mainAxis = getOppositeAxis(crossAxis);
      let mainAxisCoord = coords[mainAxis];
      let crossAxisCoord = coords[crossAxis];
      const rawOffset = evaluate(offset3, state);
      const computedOffset = typeof rawOffset === "number" ? {
        mainAxis: rawOffset,
        crossAxis: 0
      } : {
        mainAxis: 0,
        crossAxis: 0,
        ...rawOffset
      };
      if (checkMainAxis) {
        const len = mainAxis === "y" ? "height" : "width";
        const limitMin = rects.reference[mainAxis] - rects.floating[len] + computedOffset.mainAxis;
        const limitMax = rects.reference[mainAxis] + rects.reference[len] - computedOffset.mainAxis;
        if (mainAxisCoord < limitMin) {
          mainAxisCoord = limitMin;
        } else if (mainAxisCoord > limitMax) {
          mainAxisCoord = limitMax;
        }
      }
      if (checkCrossAxis) {
        var _middlewareData$offse, _middlewareData$offse2;
        const len = mainAxis === "y" ? "width" : "height";
        const isOriginSide = originSides.has(getSide(placement));
        const limitMin = rects.reference[crossAxis] - rects.floating[len] + (isOriginSide ? ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse[crossAxis]) || 0 : 0) + (isOriginSide ? 0 : computedOffset.crossAxis);
        const limitMax = rects.reference[crossAxis] + rects.reference[len] + (isOriginSide ? 0 : ((_middlewareData$offse2 = middlewareData.offset) == null ? void 0 : _middlewareData$offse2[crossAxis]) || 0) - (isOriginSide ? computedOffset.crossAxis : 0);
        if (crossAxisCoord < limitMin) {
          crossAxisCoord = limitMin;
        } else if (crossAxisCoord > limitMax) {
          crossAxisCoord = limitMax;
        }
      }
      return {
        [mainAxis]: mainAxisCoord,
        [crossAxis]: crossAxisCoord
      };
    }
  };
};
var size = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "size",
    options,
    async fn(state) {
      var _state$middlewareData, _state$middlewareData2;
      const {
        placement,
        rects,
        platform: platform2,
        elements
      } = state;
      const {
        apply = () => {
        },
        ...detectOverflowOptions
      } = evaluate(options, state);
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const side = getSide(placement);
      const alignment = getAlignment(placement);
      const isYAxis = getSideAxis(placement) === "y";
      const {
        width,
        height
      } = rects.floating;
      let heightSide;
      let widthSide;
      if (side === "top" || side === "bottom") {
        heightSide = side;
        widthSide = alignment === (await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating)) ? "start" : "end") ? "left" : "right";
      } else {
        widthSide = side;
        heightSide = alignment === "end" ? "top" : "bottom";
      }
      const maximumClippingHeight = height - overflow.top - overflow.bottom;
      const maximumClippingWidth = width - overflow.left - overflow.right;
      const overflowAvailableHeight = min(height - overflow[heightSide], maximumClippingHeight);
      const overflowAvailableWidth = min(width - overflow[widthSide], maximumClippingWidth);
      const noShift = !state.middlewareData.shift;
      let availableHeight = overflowAvailableHeight;
      let availableWidth = overflowAvailableWidth;
      if ((_state$middlewareData = state.middlewareData.shift) != null && _state$middlewareData.enabled.x) {
        availableWidth = maximumClippingWidth;
      }
      if ((_state$middlewareData2 = state.middlewareData.shift) != null && _state$middlewareData2.enabled.y) {
        availableHeight = maximumClippingHeight;
      }
      if (noShift && !alignment) {
        const xMin = max(overflow.left, 0);
        const xMax = max(overflow.right, 0);
        const yMin = max(overflow.top, 0);
        const yMax = max(overflow.bottom, 0);
        if (isYAxis) {
          availableWidth = width - 2 * (xMin !== 0 || xMax !== 0 ? xMin + xMax : max(overflow.left, overflow.right));
        } else {
          availableHeight = height - 2 * (yMin !== 0 || yMax !== 0 ? yMin + yMax : max(overflow.top, overflow.bottom));
        }
      }
      await apply({
        ...state,
        availableWidth,
        availableHeight
      });
      const nextDimensions = await platform2.getDimensions(elements.floating);
      if (width !== nextDimensions.width || height !== nextDimensions.height) {
        return {
          reset: {
            rects: true
          }
        };
      }
      return {};
    }
  };
};

// node_modules/@floating-ui/utils/dist/floating-ui.utils.dom.mjs
function hasWindow() {
  return typeof window !== "undefined";
}
function getNodeName2(node) {
  if (isNode2(node)) {
    return (node.nodeName || "").toLowerCase();
  }
  return "#document";
}
function getWindow2(node) {
  var _node$ownerDocument;
  return (node == null || (_node$ownerDocument = node.ownerDocument) == null ? void 0 : _node$ownerDocument.defaultView) || window;
}
function getDocumentElement2(node) {
  var _ref;
  return (_ref = (isNode2(node) ? node.ownerDocument : node.document) || window.document) == null ? void 0 : _ref.documentElement;
}
function isNode2(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof Node || value instanceof getWindow2(value).Node;
}
function isElement2(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof Element || value instanceof getWindow2(value).Element;
}
function isHTMLElement2(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof HTMLElement || value instanceof getWindow2(value).HTMLElement;
}
function isShadowRoot2(value) {
  if (!hasWindow() || typeof ShadowRoot === "undefined") {
    return false;
  }
  return value instanceof ShadowRoot || value instanceof getWindow2(value).ShadowRoot;
}
function isOverflowElement2(element) {
  const {
    overflow,
    overflowX,
    overflowY,
    display
  } = getComputedStyle3(element);
  return /auto|scroll|overlay|hidden|clip/.test(overflow + overflowY + overflowX) && display !== "inline" && display !== "contents";
}
function isTableElement(element) {
  return /^(table|td|th)$/.test(getNodeName2(element));
}
function isTopLayer(element) {
  try {
    if (element.matches(":popover-open")) {
      return true;
    }
  } catch (_e) {
  }
  try {
    return element.matches(":modal");
  } catch (_e) {
    return false;
  }
}
var willChangeRe = /transform|translate|scale|rotate|perspective|filter/;
var containRe = /paint|layout|strict|content/;
var isNotNone = (value) => !!value && value !== "none";
var isWebKitValue;
function isContainingBlock(elementOrCss) {
  const css2 = isElement2(elementOrCss) ? getComputedStyle3(elementOrCss) : elementOrCss;
  return isNotNone(css2.transform) || isNotNone(css2.translate) || isNotNone(css2.scale) || isNotNone(css2.rotate) || isNotNone(css2.perspective) || !isWebKit() && (isNotNone(css2.backdropFilter) || isNotNone(css2.filter)) || willChangeRe.test(css2.willChange || "") || containRe.test(css2.contain || "");
}
function getContainingBlock(element) {
  let currentNode = getParentNode2(element);
  while (isHTMLElement2(currentNode) && !isLastTraversableNode(currentNode)) {
    if (isContainingBlock(currentNode)) {
      return currentNode;
    } else if (isTopLayer(currentNode)) {
      return null;
    }
    currentNode = getParentNode2(currentNode);
  }
  return null;
}
function isWebKit() {
  if (isWebKitValue == null) {
    isWebKitValue = typeof CSS !== "undefined" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none");
  }
  return isWebKitValue;
}
function isLastTraversableNode(node) {
  return /^(html|body|#document)$/.test(getNodeName2(node));
}
function getComputedStyle3(element) {
  return getWindow2(element).getComputedStyle(element);
}
function getNodeScroll(element) {
  if (isElement2(element)) {
    return {
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop
    };
  }
  return {
    scrollLeft: element.scrollX,
    scrollTop: element.scrollY
  };
}
function getParentNode2(node) {
  if (getNodeName2(node) === "html") {
    return node;
  }
  const result = (
    // Step into the shadow DOM of the parent of a slotted node.
    node.assignedSlot || // DOM Element detected.
    node.parentNode || // ShadowRoot detected.
    isShadowRoot2(node) && node.host || // Fallback.
    getDocumentElement2(node)
  );
  return isShadowRoot2(result) ? result.host : result;
}
function getNearestOverflowAncestor2(node) {
  const parentNode = getParentNode2(node);
  if (isLastTraversableNode(parentNode)) {
    return node.ownerDocument ? node.ownerDocument.body : node.body;
  }
  if (isHTMLElement2(parentNode) && isOverflowElement2(parentNode)) {
    return parentNode;
  }
  return getNearestOverflowAncestor2(parentNode);
}
function getOverflowAncestors(node, list, traverseIframes) {
  var _node$ownerDocument2;
  if (list === void 0) {
    list = [];
  }
  if (traverseIframes === void 0) {
    traverseIframes = true;
  }
  const scrollableAncestor = getNearestOverflowAncestor2(node);
  const isBody = scrollableAncestor === ((_node$ownerDocument2 = node.ownerDocument) == null ? void 0 : _node$ownerDocument2.body);
  const win = getWindow2(scrollableAncestor);
  if (isBody) {
    const frameElement = getFrameElement(win);
    return list.concat(win, win.visualViewport || [], isOverflowElement2(scrollableAncestor) ? scrollableAncestor : [], frameElement && traverseIframes ? getOverflowAncestors(frameElement) : []);
  } else {
    return list.concat(scrollableAncestor, getOverflowAncestors(scrollableAncestor, [], traverseIframes));
  }
}
function getFrameElement(win) {
  return win.parent && Object.getPrototypeOf(win.parent) ? win.frameElement : null;
}

// node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function getCssDimensions(element) {
  const css2 = getComputedStyle3(element);
  let width = parseFloat(css2.width) || 0;
  let height = parseFloat(css2.height) || 0;
  const hasOffset = isHTMLElement2(element);
  const offsetWidth = hasOffset ? element.offsetWidth : width;
  const offsetHeight = hasOffset ? element.offsetHeight : height;
  const shouldFallback = round(width) !== offsetWidth || round(height) !== offsetHeight;
  if (shouldFallback) {
    width = offsetWidth;
    height = offsetHeight;
  }
  return {
    width,
    height,
    $: shouldFallback
  };
}
function unwrapElement(element) {
  return !isElement2(element) ? element.contextElement : element;
}
function getScale(element) {
  const domElement = unwrapElement(element);
  if (!isHTMLElement2(domElement)) {
    return createCoords(1);
  }
  const rect = domElement.getBoundingClientRect();
  const {
    width,
    height,
    $
  } = getCssDimensions(domElement);
  let x = ($ ? round(rect.width) : rect.width) / width;
  let y = ($ ? round(rect.height) : rect.height) / height;
  if (!x || !Number.isFinite(x)) {
    x = 1;
  }
  if (!y || !Number.isFinite(y)) {
    y = 1;
  }
  return {
    x,
    y
  };
}
var noOffsets = /* @__PURE__ */ createCoords(0);
function getVisualOffsets(element) {
  const win = getWindow2(element);
  if (!isWebKit() || !win.visualViewport) {
    return noOffsets;
  }
  return {
    x: win.visualViewport.offsetLeft,
    y: win.visualViewport.offsetTop
  };
}
function shouldAddVisualOffsets(element, isFixed, floatingOffsetParent) {
  if (isFixed === void 0) {
    isFixed = false;
  }
  if (!floatingOffsetParent || isFixed && floatingOffsetParent !== getWindow2(element)) {
    return false;
  }
  return isFixed;
}
function getBoundingClientRect(element, includeScale, isFixedStrategy, offsetParent) {
  if (includeScale === void 0) {
    includeScale = false;
  }
  if (isFixedStrategy === void 0) {
    isFixedStrategy = false;
  }
  const clientRect = element.getBoundingClientRect();
  const domElement = unwrapElement(element);
  let scale = createCoords(1);
  if (includeScale) {
    if (offsetParent) {
      if (isElement2(offsetParent)) {
        scale = getScale(offsetParent);
      }
    } else {
      scale = getScale(element);
    }
  }
  const visualOffsets = shouldAddVisualOffsets(domElement, isFixedStrategy, offsetParent) ? getVisualOffsets(domElement) : createCoords(0);
  let x = (clientRect.left + visualOffsets.x) / scale.x;
  let y = (clientRect.top + visualOffsets.y) / scale.y;
  let width = clientRect.width / scale.x;
  let height = clientRect.height / scale.y;
  if (domElement) {
    const win = getWindow2(domElement);
    const offsetWin = offsetParent && isElement2(offsetParent) ? getWindow2(offsetParent) : offsetParent;
    let currentWin = win;
    let currentIFrame = getFrameElement(currentWin);
    while (currentIFrame && offsetParent && offsetWin !== currentWin) {
      const iframeScale = getScale(currentIFrame);
      const iframeRect = currentIFrame.getBoundingClientRect();
      const css2 = getComputedStyle3(currentIFrame);
      const left = iframeRect.left + (currentIFrame.clientLeft + parseFloat(css2.paddingLeft)) * iframeScale.x;
      const top = iframeRect.top + (currentIFrame.clientTop + parseFloat(css2.paddingTop)) * iframeScale.y;
      x *= iframeScale.x;
      y *= iframeScale.y;
      width *= iframeScale.x;
      height *= iframeScale.y;
      x += left;
      y += top;
      currentWin = getWindow2(currentIFrame);
      currentIFrame = getFrameElement(currentWin);
    }
  }
  return rectToClientRect({
    width,
    height,
    x,
    y
  });
}
function getWindowScrollBarX(element, rect) {
  const leftScroll = getNodeScroll(element).scrollLeft;
  if (!rect) {
    return getBoundingClientRect(getDocumentElement2(element)).left + leftScroll;
  }
  return rect.left + leftScroll;
}
function getHTMLOffset(documentElement, scroll) {
  const htmlRect = documentElement.getBoundingClientRect();
  const x = htmlRect.left + scroll.scrollLeft - getWindowScrollBarX(documentElement, htmlRect);
  const y = htmlRect.top + scroll.scrollTop;
  return {
    x,
    y
  };
}
function convertOffsetParentRelativeRectToViewportRelativeRect(_ref) {
  let {
    elements,
    rect,
    offsetParent,
    strategy
  } = _ref;
  const isFixed = strategy === "fixed";
  const documentElement = getDocumentElement2(offsetParent);
  const topLayer = elements ? isTopLayer(elements.floating) : false;
  if (offsetParent === documentElement || topLayer && isFixed) {
    return rect;
  }
  let scroll = {
    scrollLeft: 0,
    scrollTop: 0
  };
  let scale = createCoords(1);
  const offsets = createCoords(0);
  const isOffsetParentAnElement = isHTMLElement2(offsetParent);
  if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
    if (getNodeName2(offsetParent) !== "body" || isOverflowElement2(documentElement)) {
      scroll = getNodeScroll(offsetParent);
    }
    if (isOffsetParentAnElement) {
      const offsetRect = getBoundingClientRect(offsetParent);
      scale = getScale(offsetParent);
      offsets.x = offsetRect.x + offsetParent.clientLeft;
      offsets.y = offsetRect.y + offsetParent.clientTop;
    }
  }
  const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
  return {
    width: rect.width * scale.x,
    height: rect.height * scale.y,
    x: rect.x * scale.x - scroll.scrollLeft * scale.x + offsets.x + htmlOffset.x,
    y: rect.y * scale.y - scroll.scrollTop * scale.y + offsets.y + htmlOffset.y
  };
}
function getClientRects(element) {
  return Array.from(element.getClientRects());
}
function getDocumentRect(element) {
  const html = getDocumentElement2(element);
  const scroll = getNodeScroll(element);
  const body = element.ownerDocument.body;
  const width = max(html.scrollWidth, html.clientWidth, body.scrollWidth, body.clientWidth);
  const height = max(html.scrollHeight, html.clientHeight, body.scrollHeight, body.clientHeight);
  let x = -scroll.scrollLeft + getWindowScrollBarX(element);
  const y = -scroll.scrollTop;
  if (getComputedStyle3(body).direction === "rtl") {
    x += max(html.clientWidth, body.clientWidth) - width;
  }
  return {
    width,
    height,
    x,
    y
  };
}
var SCROLLBAR_MAX = 25;
function getViewportRect(element, strategy) {
  const win = getWindow2(element);
  const html = getDocumentElement2(element);
  const visualViewport = win.visualViewport;
  let width = html.clientWidth;
  let height = html.clientHeight;
  let x = 0;
  let y = 0;
  if (visualViewport) {
    width = visualViewport.width;
    height = visualViewport.height;
    const visualViewportBased = isWebKit();
    if (!visualViewportBased || visualViewportBased && strategy === "fixed") {
      x = visualViewport.offsetLeft;
      y = visualViewport.offsetTop;
    }
  }
  const windowScrollbarX = getWindowScrollBarX(html);
  if (windowScrollbarX <= 0) {
    const doc = html.ownerDocument;
    const body = doc.body;
    const bodyStyles = getComputedStyle(body);
    const bodyMarginInline = doc.compatMode === "CSS1Compat" ? parseFloat(bodyStyles.marginLeft) + parseFloat(bodyStyles.marginRight) || 0 : 0;
    const clippingStableScrollbarWidth = Math.abs(html.clientWidth - body.clientWidth - bodyMarginInline);
    if (clippingStableScrollbarWidth <= SCROLLBAR_MAX) {
      width -= clippingStableScrollbarWidth;
    }
  } else if (windowScrollbarX <= SCROLLBAR_MAX) {
    width += windowScrollbarX;
  }
  return {
    width,
    height,
    x,
    y
  };
}
function getInnerBoundingClientRect(element, strategy) {
  const clientRect = getBoundingClientRect(element, true, strategy === "fixed");
  const top = clientRect.top + element.clientTop;
  const left = clientRect.left + element.clientLeft;
  const scale = isHTMLElement2(element) ? getScale(element) : createCoords(1);
  const width = element.clientWidth * scale.x;
  const height = element.clientHeight * scale.y;
  const x = left * scale.x;
  const y = top * scale.y;
  return {
    width,
    height,
    x,
    y
  };
}
function getClientRectFromClippingAncestor(element, clippingAncestor, strategy) {
  let rect;
  if (clippingAncestor === "viewport") {
    rect = getViewportRect(element, strategy);
  } else if (clippingAncestor === "document") {
    rect = getDocumentRect(getDocumentElement2(element));
  } else if (isElement2(clippingAncestor)) {
    rect = getInnerBoundingClientRect(clippingAncestor, strategy);
  } else {
    const visualOffsets = getVisualOffsets(element);
    rect = {
      x: clippingAncestor.x - visualOffsets.x,
      y: clippingAncestor.y - visualOffsets.y,
      width: clippingAncestor.width,
      height: clippingAncestor.height
    };
  }
  return rectToClientRect(rect);
}
function hasFixedPositionAncestor(element, stopNode) {
  const parentNode = getParentNode2(element);
  if (parentNode === stopNode || !isElement2(parentNode) || isLastTraversableNode(parentNode)) {
    return false;
  }
  return getComputedStyle3(parentNode).position === "fixed" || hasFixedPositionAncestor(parentNode, stopNode);
}
function getClippingElementAncestors(element, cache) {
  const cachedResult = cache.get(element);
  if (cachedResult) {
    return cachedResult;
  }
  let result = getOverflowAncestors(element, [], false).filter((el) => isElement2(el) && getNodeName2(el) !== "body");
  let currentContainingBlockComputedStyle = null;
  const elementIsFixed = getComputedStyle3(element).position === "fixed";
  let currentNode = elementIsFixed ? getParentNode2(element) : element;
  while (isElement2(currentNode) && !isLastTraversableNode(currentNode)) {
    const computedStyle = getComputedStyle3(currentNode);
    const currentNodeIsContaining = isContainingBlock(currentNode);
    if (!currentNodeIsContaining && computedStyle.position === "fixed") {
      currentContainingBlockComputedStyle = null;
    }
    const shouldDropCurrentNode = elementIsFixed ? !currentNodeIsContaining && !currentContainingBlockComputedStyle : !currentNodeIsContaining && computedStyle.position === "static" && !!currentContainingBlockComputedStyle && (currentContainingBlockComputedStyle.position === "absolute" || currentContainingBlockComputedStyle.position === "fixed") || isOverflowElement2(currentNode) && !currentNodeIsContaining && hasFixedPositionAncestor(element, currentNode);
    if (shouldDropCurrentNode) {
      result = result.filter((ancestor) => ancestor !== currentNode);
    } else {
      currentContainingBlockComputedStyle = computedStyle;
    }
    currentNode = getParentNode2(currentNode);
  }
  cache.set(element, result);
  return result;
}
function getClippingRect(_ref) {
  let {
    element,
    boundary,
    rootBoundary,
    strategy
  } = _ref;
  const elementClippingAncestors = boundary === "clippingAncestors" ? isTopLayer(element) ? [] : getClippingElementAncestors(element, this._c) : [].concat(boundary);
  const clippingAncestors = [...elementClippingAncestors, rootBoundary];
  const firstRect = getClientRectFromClippingAncestor(element, clippingAncestors[0], strategy);
  let top = firstRect.top;
  let right = firstRect.right;
  let bottom = firstRect.bottom;
  let left = firstRect.left;
  for (let i = 1; i < clippingAncestors.length; i++) {
    const rect = getClientRectFromClippingAncestor(element, clippingAncestors[i], strategy);
    top = max(rect.top, top);
    right = min(rect.right, right);
    bottom = min(rect.bottom, bottom);
    left = max(rect.left, left);
  }
  return {
    width: right - left,
    height: bottom - top,
    x: left,
    y: top
  };
}
function getDimensions(element) {
  const {
    width,
    height
  } = getCssDimensions(element);
  return {
    width,
    height
  };
}
function getRectRelativeToOffsetParent(element, offsetParent, strategy) {
  const isOffsetParentAnElement = isHTMLElement2(offsetParent);
  const documentElement = getDocumentElement2(offsetParent);
  const isFixed = strategy === "fixed";
  const rect = getBoundingClientRect(element, true, isFixed, offsetParent);
  let scroll = {
    scrollLeft: 0,
    scrollTop: 0
  };
  const offsets = createCoords(0);
  function setLeftRTLScrollbarOffset() {
    offsets.x = getWindowScrollBarX(documentElement);
  }
  if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
    if (getNodeName2(offsetParent) !== "body" || isOverflowElement2(documentElement)) {
      scroll = getNodeScroll(offsetParent);
    }
    if (isOffsetParentAnElement) {
      const offsetRect = getBoundingClientRect(offsetParent, true, isFixed, offsetParent);
      offsets.x = offsetRect.x + offsetParent.clientLeft;
      offsets.y = offsetRect.y + offsetParent.clientTop;
    } else if (documentElement) {
      setLeftRTLScrollbarOffset();
    }
  }
  if (isFixed && !isOffsetParentAnElement && documentElement) {
    setLeftRTLScrollbarOffset();
  }
  const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
  const x = rect.left + scroll.scrollLeft - offsets.x - htmlOffset.x;
  const y = rect.top + scroll.scrollTop - offsets.y - htmlOffset.y;
  return {
    x,
    y,
    width: rect.width,
    height: rect.height
  };
}
function isStaticPositioned(element) {
  return getComputedStyle3(element).position === "static";
}
function getTrueOffsetParent(element, polyfill) {
  if (!isHTMLElement2(element) || getComputedStyle3(element).position === "fixed") {
    return null;
  }
  if (polyfill) {
    return polyfill(element);
  }
  let rawOffsetParent = element.offsetParent;
  if (getDocumentElement2(element) === rawOffsetParent) {
    rawOffsetParent = rawOffsetParent.ownerDocument.body;
  }
  return rawOffsetParent;
}
function getOffsetParent(element, polyfill) {
  const win = getWindow2(element);
  if (isTopLayer(element)) {
    return win;
  }
  if (!isHTMLElement2(element)) {
    let svgOffsetParent = getParentNode2(element);
    while (svgOffsetParent && !isLastTraversableNode(svgOffsetParent)) {
      if (isElement2(svgOffsetParent) && !isStaticPositioned(svgOffsetParent)) {
        return svgOffsetParent;
      }
      svgOffsetParent = getParentNode2(svgOffsetParent);
    }
    return win;
  }
  let offsetParent = getTrueOffsetParent(element, polyfill);
  while (offsetParent && isTableElement(offsetParent) && isStaticPositioned(offsetParent)) {
    offsetParent = getTrueOffsetParent(offsetParent, polyfill);
  }
  if (offsetParent && isLastTraversableNode(offsetParent) && isStaticPositioned(offsetParent) && !isContainingBlock(offsetParent)) {
    return win;
  }
  return offsetParent || getContainingBlock(element) || win;
}
var getElementRects = async function(data) {
  const getOffsetParentFn = this.getOffsetParent || getOffsetParent;
  const getDimensionsFn = this.getDimensions;
  const floatingDimensions = await getDimensionsFn(data.floating);
  return {
    reference: getRectRelativeToOffsetParent(data.reference, await getOffsetParentFn(data.floating), data.strategy),
    floating: {
      x: 0,
      y: 0,
      width: floatingDimensions.width,
      height: floatingDimensions.height
    }
  };
};
function isRTL(element) {
  return getComputedStyle3(element).direction === "rtl";
}
var platform = {
  convertOffsetParentRelativeRectToViewportRelativeRect,
  getDocumentElement: getDocumentElement2,
  getClippingRect,
  getOffsetParent,
  getElementRects,
  getClientRects,
  getDimensions,
  getScale,
  isElement: isElement2,
  isRTL
};
function rectsAreEqual(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function observeMove(element, onMove) {
  let io = null;
  let timeoutId;
  const root = getDocumentElement2(element);
  function cleanup() {
    var _io;
    clearTimeout(timeoutId);
    (_io = io) == null || _io.disconnect();
    io = null;
  }
  function refresh(skip, threshold) {
    if (skip === void 0) {
      skip = false;
    }
    if (threshold === void 0) {
      threshold = 1;
    }
    cleanup();
    const elementRectForRootMargin = element.getBoundingClientRect();
    const {
      left,
      top,
      width,
      height
    } = elementRectForRootMargin;
    if (!skip) {
      onMove();
    }
    if (!width || !height) {
      return;
    }
    const insetTop = floor(top);
    const insetRight = floor(root.clientWidth - (left + width));
    const insetBottom = floor(root.clientHeight - (top + height));
    const insetLeft = floor(left);
    const rootMargin = -insetTop + "px " + -insetRight + "px " + -insetBottom + "px " + -insetLeft + "px";
    const options = {
      rootMargin,
      threshold: max(0, min(1, threshold)) || 1
    };
    let isFirstUpdate = true;
    function handleObserve(entries) {
      const ratio = entries[0].intersectionRatio;
      if (ratio !== threshold) {
        if (!isFirstUpdate) {
          return refresh();
        }
        if (!ratio) {
          timeoutId = setTimeout(() => {
            refresh(false, 1e-7);
          }, 1e3);
        } else {
          refresh(false, ratio);
        }
      }
      if (ratio === 1 && !rectsAreEqual(elementRectForRootMargin, element.getBoundingClientRect())) {
        refresh();
      }
      isFirstUpdate = false;
    }
    try {
      io = new IntersectionObserver(handleObserve, {
        ...options,
        // Handle <iframe>s
        root: root.ownerDocument
      });
    } catch (_e) {
      io = new IntersectionObserver(handleObserve, options);
    }
    io.observe(element);
  }
  refresh(true);
  return cleanup;
}
function autoUpdate(reference, floating, update, options) {
  if (options === void 0) {
    options = {};
  }
  const {
    ancestorScroll = true,
    ancestorResize = true,
    elementResize = typeof ResizeObserver === "function",
    layoutShift = typeof IntersectionObserver === "function",
    animationFrame = false
  } = options;
  const referenceEl = unwrapElement(reference);
  const ancestors = ancestorScroll || ancestorResize ? [...referenceEl ? getOverflowAncestors(referenceEl) : [], ...floating ? getOverflowAncestors(floating) : []] : [];
  ancestors.forEach((ancestor) => {
    ancestorScroll && ancestor.addEventListener("scroll", update, {
      passive: true
    });
    ancestorResize && ancestor.addEventListener("resize", update);
  });
  const cleanupIo = referenceEl && layoutShift ? observeMove(referenceEl, update) : null;
  let reobserveFrame = -1;
  let resizeObserver = null;
  if (elementResize) {
    resizeObserver = new ResizeObserver((_ref) => {
      let [firstEntry] = _ref;
      if (firstEntry && firstEntry.target === referenceEl && resizeObserver && floating) {
        resizeObserver.unobserve(floating);
        cancelAnimationFrame(reobserveFrame);
        reobserveFrame = requestAnimationFrame(() => {
          var _resizeObserver;
          (_resizeObserver = resizeObserver) == null || _resizeObserver.observe(floating);
        });
      }
      update();
    });
    if (referenceEl && !animationFrame) {
      resizeObserver.observe(referenceEl);
    }
    if (floating) {
      resizeObserver.observe(floating);
    }
  }
  let frameId;
  let prevRefRect = animationFrame ? getBoundingClientRect(reference) : null;
  if (animationFrame) {
    frameLoop();
  }
  function frameLoop() {
    const nextRefRect = getBoundingClientRect(reference);
    if (prevRefRect && !rectsAreEqual(prevRefRect, nextRefRect)) {
      update();
    }
    prevRefRect = nextRefRect;
    frameId = requestAnimationFrame(frameLoop);
  }
  update();
  return () => {
    var _resizeObserver2;
    ancestors.forEach((ancestor) => {
      ancestorScroll && ancestor.removeEventListener("scroll", update);
      ancestorResize && ancestor.removeEventListener("resize", update);
    });
    cleanupIo == null || cleanupIo();
    (_resizeObserver2 = resizeObserver) == null || _resizeObserver2.disconnect();
    resizeObserver = null;
    if (animationFrame) {
      cancelAnimationFrame(frameId);
    }
  };
}
var offset2 = offset;
var shift2 = shift;
var flip2 = flip;
var size2 = size;
var hide2 = hide;
var arrow2 = arrow;
var limitShift2 = limitShift;
var computePosition2 = (reference, floating, options) => {
  const cache = /* @__PURE__ */ new Map();
  const mergedOptions = {
    platform,
    ...options
  };
  const platformWithCache = {
    ...mergedOptions.platform,
    _c: cache
  };
  return computePosition(reference, floating, {
    ...mergedOptions,
    platform: platformWithCache
  });
};

// node_modules/@zag-js/popper/dist/get-anchor.mjs
function createDOMRect(x = 0, y = 0, width = 0, height = 0) {
  if (typeof DOMRect === "function") {
    return new DOMRect(x, y, width, height);
  }
  const rect = {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x
  };
  return { ...rect, toJSON: () => rect };
}
function getDOMRect(anchorRect) {
  if (!anchorRect) return createDOMRect();
  const { x, y, width, height } = anchorRect;
  return createDOMRect(x, y, width, height);
}
function getAnchorElement(anchorElement, getAnchorRect) {
  return {
    contextElement: isHTMLElement(anchorElement) ? anchorElement : anchorElement?.contextElement,
    getBoundingClientRect: () => {
      const anchor = anchorElement;
      const anchorRect = getAnchorRect?.(anchor);
      if (anchorRect || !anchor) {
        return getDOMRect(anchorRect);
      }
      return anchor.getBoundingClientRect();
    }
  };
}

// node_modules/@zag-js/popper/dist/middleware.mjs
var toVar = (value) => ({ variable: value, reference: `var(${value})` });
var cssVars = {
  arrowSize: toVar("--arrow-size"),
  arrowSizeHalf: toVar("--arrow-size-half"),
  arrowBg: toVar("--arrow-background"),
  transformOrigin: toVar("--transform-origin"),
  arrowOffset: toVar("--arrow-offset")
};
var getSideAxis2 = (side) => side === "top" || side === "bottom" ? "y" : "x";
function createTransformOriginMiddleware(opts, arrowEl) {
  return {
    name: "transformOrigin",
    fn(state) {
      const { elements, middlewareData, placement, rects, y } = state;
      const side = placement.split("-")[0];
      const axis = getSideAxis2(side);
      const arrowX = middlewareData.arrow?.x || 0;
      const arrowY = middlewareData.arrow?.y || 0;
      const arrowWidth = arrowEl?.clientWidth || 0;
      const arrowHeight = arrowEl?.clientHeight || 0;
      const transformX = arrowX + arrowWidth / 2;
      const transformY = arrowY + arrowHeight / 2;
      const shiftY = Math.abs(middlewareData.shift?.y || 0);
      const halfAnchorHeight = rects.reference.height / 2;
      const arrowOffset = arrowHeight / 2;
      const gutter = opts.offset?.mainAxis ?? opts.gutter;
      const sideOffsetValue = typeof gutter === "number" ? gutter + arrowOffset : gutter ?? arrowOffset;
      const isOverlappingAnchor = shiftY > sideOffsetValue;
      const adjacentTransformOrigin = {
        top: `${transformX}px calc(100% + ${sideOffsetValue}px)`,
        bottom: `${transformX}px ${-sideOffsetValue}px`,
        left: `calc(100% + ${sideOffsetValue}px) ${transformY}px`,
        right: `${-sideOffsetValue}px ${transformY}px`
      }[side];
      const overlapTransformOrigin = `${transformX}px ${rects.reference.y + halfAnchorHeight - y}px`;
      const useOverlap = Boolean(opts.overlap) && axis === "y" && isOverlappingAnchor;
      elements.floating.style.setProperty(
        cssVars.transformOrigin.variable,
        useOverlap ? overlapTransformOrigin : adjacentTransformOrigin
      );
      return {
        data: {
          transformOrigin: useOverlap ? overlapTransformOrigin : adjacentTransformOrigin
        }
      };
    }
  };
}
var rectMiddleware = {
  name: "rects",
  fn({ rects }) {
    return {
      data: rects
    };
  }
};
var shiftArrowMiddleware = (arrowEl) => {
  if (!arrowEl) return;
  return {
    name: "shiftArrow",
    fn({ placement, middlewareData }) {
      if (!middlewareData.arrow) return {};
      const { x, y } = middlewareData.arrow;
      const dir = placement.split("-")[0];
      Object.assign(arrowEl.style, {
        left: x != null ? `${x}px` : "",
        top: y != null ? `${y}px` : "",
        [dir]: `calc(100% + ${cssVars.arrowOffset.reference})`
      });
      return {};
    }
  };
};

// node_modules/@zag-js/popper/dist/placement.mjs
function getPlacementDetails(placement) {
  const [side, align] = placement.split("-");
  return { side, align, hasAlign: align != null };
}
function getPlacementSide(placement) {
  return placement.split("-")[0];
}

// node_modules/@zag-js/popper/dist/get-placement.mjs
var defaultOptions = {
  strategy: "absolute",
  placement: "bottom",
  listeners: true,
  restoreStyles: false,
  gutter: 8,
  flip: true,
  slide: true,
  overlap: false,
  sameWidth: false,
  fitViewport: false,
  overflowPadding: 8,
  arrowPadding: 4
};
function roundByDpr(win, value) {
  const dpr = win.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}
function isApproximatelyEqual(a, b) {
  return a != null && Math.abs(a - b) < 0.5;
}
function resolveBoundaryOption(boundary) {
  if (typeof boundary === "function") return boundary();
  if (boundary === "clipping-ancestors") return "clippingAncestors";
  return boundary;
}
function getArrowMiddleware(arrowElement, doc, opts) {
  const element = arrowElement || doc.createElement("div");
  return arrow2({ element, padding: opts.arrowPadding });
}
function getOffsetMiddleware(arrowElement, opts) {
  if (isNull(opts.offset ?? opts.gutter)) return;
  return offset2(({ placement }) => {
    const arrowOffset = (arrowElement?.clientHeight || 0) / 2;
    const gutter = opts.offset?.mainAxis ?? opts.gutter;
    const mainAxis = typeof gutter === "number" ? gutter + arrowOffset : gutter ?? arrowOffset;
    const { hasAlign } = getPlacementDetails(placement);
    const shift22 = !hasAlign ? opts.shift : void 0;
    const crossAxis = opts.offset?.crossAxis ?? shift22;
    return compact({
      crossAxis,
      mainAxis,
      alignmentAxis: opts.shift
    });
  });
}
function getFlipMiddleware(opts) {
  if (!opts.flip) return;
  const boundary = resolveBoundaryOption(opts.boundary);
  return flip2({
    ...boundary ? { boundary } : void 0,
    padding: opts.overflowPadding,
    fallbackPlacements: opts.flip === true ? void 0 : opts.flip
  });
}
function getShiftMiddleware(opts) {
  if (!opts.slide && !opts.overlap) return;
  const boundary = resolveBoundaryOption(opts.boundary);
  return shift2({
    ...boundary ? { boundary } : void 0,
    mainAxis: opts.slide,
    crossAxis: opts.overlap,
    padding: opts.overflowPadding,
    limiter: limitShift2()
  });
}
function getSizeMiddleware(opts) {
  if (opts.sizeMiddleware === false && !opts.sameWidth && !opts.fitViewport) return;
  let lastReferenceWidth;
  let lastReferenceHeight;
  let lastAvailableWidth;
  let lastAvailableHeight;
  return size2({
    padding: opts.overflowPadding,
    apply({ elements, rects, availableHeight, availableWidth }) {
      const floating = elements.floating;
      const referenceWidth = Math.round(rects.reference.width);
      const referenceHeight = Math.round(rects.reference.height);
      availableWidth = Math.floor(availableWidth);
      availableHeight = Math.floor(availableHeight);
      if (!isApproximatelyEqual(lastReferenceWidth, referenceWidth)) {
        floating.style.setProperty("--reference-width", `${referenceWidth}px`);
        lastReferenceWidth = referenceWidth;
      }
      if (!isApproximatelyEqual(lastReferenceHeight, referenceHeight)) {
        floating.style.setProperty("--reference-height", `${referenceHeight}px`);
        lastReferenceHeight = referenceHeight;
      }
      if (!isApproximatelyEqual(lastAvailableWidth, availableWidth)) {
        floating.style.setProperty("--available-width", `${availableWidth}px`);
        lastAvailableWidth = availableWidth;
      }
      if (!isApproximatelyEqual(lastAvailableHeight, availableHeight)) {
        floating.style.setProperty("--available-height", `${availableHeight}px`);
        lastAvailableHeight = availableHeight;
      }
    }
  });
}
function hideWhenDetachedMiddleware(opts) {
  if (!opts.hideWhenDetached) return;
  return hide2({ strategy: "referenceHidden", boundary: resolveBoundaryOption(opts.boundary) ?? "clippingAncestors" });
}
function getAutoUpdateOptions(opts) {
  if (!opts) return {};
  if (opts === true) {
    return { ancestorResize: true, ancestorScroll: true, elementResize: true, layoutShift: true };
  }
  return opts;
}
var floatingStyleProps = [
  "transform",
  "visibility",
  "pointer-events",
  "--x",
  "--y",
  "--z-index",
  "--reference-width",
  "--reference-height",
  "--available-width",
  "--available-height",
  "--transform-origin"
];
var arrowStyleProps = ["top", "right", "bottom", "left"];
function createStyleCleanup(el, props) {
  if (!el) return noop;
  const prev2 = new Map(props.map((prop) => [prop, el.style.getPropertyValue(prop)]));
  return () => {
    prev2.forEach((value, prop) => {
      if (value) el.style.setProperty(prop, value);
      else el.style.removeProperty(prop);
    });
    if (el.style.length === 0) {
      el.removeAttribute("style");
    }
  };
}
function anchorIdentity(anchor) {
  if (anchor == null) return null;
  if (isHTMLElement(anchor)) return anchor;
  if (typeof anchor === "object" && anchor && "contextElement" in anchor && anchor.contextElement) {
    return anchor.contextElement;
  }
  return anchor;
}
function getPlacementImpl(referenceOrVirtual, floatingOrVirtual, opts = {}) {
  const resolveFloating = () => {
    const raw = typeof floatingOrVirtual === "function" ? floatingOrVirtual() : floatingOrVirtual;
    return raw ?? null;
  };
  const resolveAnchor = () => {
    const raw = typeof referenceOrVirtual === "function" ? referenceOrVirtual() : referenceOrVirtual;
    return opts.getAnchorElement?.() ?? raw;
  };
  const resolveReference = () => {
    const anchor = resolveAnchor();
    if (!anchor && !opts.getAnchorRect) return null;
    return getAnchorElement(anchor, opts.getAnchorRect);
  };
  const options = Object.assign({}, defaultOptions, opts);
  let middleware = [];
  let cachedMiddlewareFloating = null;
  let restoreFloatingStyles;
  let restoreArrowStyles;
  function rebuildMiddlewareForFloating(floating) {
    restoreFloatingStyles?.();
    restoreArrowStyles?.();
    cachedMiddlewareFloating = floating;
    restoreFloatingStyles = options.restoreStyles ? createStyleCleanup(floating, floatingStyleProps) : void 0;
    const arrowEl = floating.querySelector("[data-part=arrow]");
    restoreArrowStyles = options.restoreStyles ? createStyleCleanup(arrowEl, arrowStyleProps) : void 0;
    middleware = [
      getOffsetMiddleware(arrowEl, options),
      getFlipMiddleware(options),
      getShiftMiddleware(options),
      getArrowMiddleware(arrowEl, floating.ownerDocument, options),
      shiftArrowMiddleware(arrowEl),
      createTransformOriginMiddleware(
        { gutter: options.gutter, offset: options.offset, overlap: options.overlap },
        arrowEl
      ),
      getSizeMiddleware(options),
      hideWhenDetachedMiddleware(options),
      rectMiddleware
    ];
  }
  const { placement, strategy, onComplete, onPositioned } = options;
  let lastX;
  let lastY;
  let zIndexComputed = false;
  let lastAnchorForObserve = void 0;
  let lastFloatingForObserve = void 0;
  let cancelAutoUpdate = noop;
  const autoUpdateOptions = getAutoUpdateOptions(options.listeners);
  function syncAutoUpdateObservers() {
    if (!options.listeners) return;
    const anchor = resolveAnchor();
    const reference = resolveReference();
    const floating = resolveFloating();
    if (!reference || !floating) return;
    const anchorChanged = anchorIdentity(anchor) !== anchorIdentity(lastAnchorForObserve);
    const floatingChanged = floating !== lastFloatingForObserve;
    if (anchorChanged || floatingChanged) {
      cancelAutoUpdate();
      lastAnchorForObserve = anchor;
      lastFloatingForObserve = floating;
      cancelAutoUpdate = autoUpdate(reference, floating, runUpdate, autoUpdateOptions);
    }
  }
  async function updatePosition() {
    syncAutoUpdateObservers();
    const floating = resolveFloating();
    if (!floating) return;
    if (floating !== cachedMiddlewareFloating) {
      rebuildMiddlewareForFloating(floating);
      zIndexComputed = false;
    }
    const reference = resolveReference();
    if (!reference) return;
    const pos = await computePosition2(reference, floating, {
      placement,
      middleware,
      strategy
    });
    onComplete?.(pos);
    const win = getWindow(floating);
    const x = roundByDpr(win, pos.x);
    const y = roundByDpr(win, pos.y);
    if (!isApproximatelyEqual(lastX, x)) {
      floating.style.setProperty("--x", `${x}px`);
      lastX = x;
    }
    if (!isApproximatelyEqual(lastY, y)) {
      floating.style.setProperty("--y", `${y}px`);
      lastY = y;
    }
    if (options.hideWhenDetached) {
      const isHidden = pos.middlewareData.hide?.referenceHidden;
      if (isHidden) {
        floating.style.setProperty("visibility", "hidden");
        floating.style.setProperty("pointer-events", "none");
      } else {
        floating.style.removeProperty("visibility");
        floating.style.removeProperty("pointer-events");
      }
    }
    if (!zIndexComputed) {
      const contentEl = floating.firstElementChild;
      if (contentEl) {
        floating.style.setProperty("--z-index", getComputedStyle2(contentEl).zIndex);
        zIndexComputed = true;
      }
    }
  }
  async function runUpdate() {
    if (opts.updatePosition) {
      await opts.updatePosition({ updatePosition, floatingElement: resolveFloating() });
      onPositioned?.({ placed: true });
    } else {
      await updatePosition();
    }
  }
  runUpdate();
  return () => {
    cancelAutoUpdate();
    restoreArrowStyles?.();
    restoreFloatingStyles?.();
    onPositioned?.({ placed: false });
  };
}
function getPlacement(referenceOrFn, floatingOrFn, opts = {}) {
  const { defer, ...options } = opts;
  const func = defer ? raf : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      cleanups.push(getPlacementImpl(referenceOrFn, floatingOrFn, options));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}

// node_modules/@zag-js/popper/dist/get-styles.mjs
var ARROW_FLOATING_STYLE = {
  bottom: "rotate(45deg)",
  left: "rotate(135deg)",
  top: "rotate(225deg)",
  right: "rotate(315deg)"
};
function getPlacementStyles(options = {}) {
  const { placement, sameWidth, fitViewport, strategy = "absolute" } = options;
  return {
    arrow: {
      position: "absolute",
      width: cssVars.arrowSize.reference,
      height: cssVars.arrowSize.reference,
      [cssVars.arrowSizeHalf.variable]: `calc(${cssVars.arrowSize.reference} / 2)`,
      [cssVars.arrowOffset.variable]: `calc(${cssVars.arrowSizeHalf.reference} * -1)`
    },
    arrowTip: {
      // @ts-expect-error - Fix this
      transform: placement ? ARROW_FLOATING_STYLE[placement.split("-")[0]] : void 0,
      background: cssVars.arrowBg.reference,
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      position: "absolute",
      zIndex: "inherit"
    },
    floating: {
      position: strategy,
      isolation: "isolate",
      minWidth: sameWidth ? void 0 : "max-content",
      width: sameWidth ? "var(--reference-width)" : void 0,
      maxWidth: fitViewport ? "var(--available-width)" : void 0,
      maxHeight: fitViewport ? "var(--available-height)" : void 0,
      pointerEvents: !placement ? "none" : void 0,
      top: "0px",
      left: "0px",
      // move off-screen if placement is not defined
      transform: placement ? "translate3d(var(--x), var(--y), 0)" : "translate3d(0, -100vh, 0)",
      zIndex: "var(--z-index)"
    }
  };
}

// node_modules/@zag-js/menu/dist/menu.dom.mjs
var getTriggerId = (ctx, value) => {
  const customId = ctx.ids?.trigger;
  if (customId != null) return isFunction(customId) ? customId(value) : customId;
  return value ? `menu:${ctx.id}:trigger:${value}` : `menu:${ctx.id}:trigger`;
};
var getContextTriggerId = (ctx, value) => {
  const customId = ctx.ids?.contextTrigger;
  if (customId != null) return isFunction(customId) ? customId(value) : customId;
  return value ? `menu:${ctx.id}:ctx-trigger:${value}` : `menu:${ctx.id}:ctx-trigger`;
};
var getContentId = (ctx) => ctx.ids?.content ?? `menu:${ctx.id}:content`;
var getArrowId = (ctx) => ctx.ids?.arrow ?? `menu:${ctx.id}:arrow`;
var getPositionerId = (ctx) => ctx.ids?.positioner ?? `menu:${ctx.id}:popper`;
var getGroupId = (ctx, id) => ctx.ids?.group?.(id) ?? `menu:${ctx.id}:group:${id}`;
var getItemId = (ctx, id) => `${ctx.id}/${id}`;
var getItemValue = (el) => el?.dataset.value ?? null;
var getGroupLabelId = (ctx, id) => ctx.ids?.groupLabel?.(id) ?? `menu:${ctx.id}:group-label:${id}`;
var getContentEl = (ctx) => ctx.getById(getContentId(ctx));
var getPositionerEl = (ctx) => ctx.getById(getPositionerId(ctx));
var getTriggerEl = (ctx) => ctx.getById(getTriggerId(ctx));
var getItemEl = (ctx, value) => value ? ctx.getById(getItemId(ctx, value)) : null;
var getContextTriggerEl = (ctx) => ctx.getById(getContextTriggerId(ctx));
var getTriggerEls = (ctx) => queryAll(ctx.getDoc(), `[data-scope="menu"][data-part="trigger"][data-ownedby="${ctx.id}"]`);
var getContextTriggerEls = (ctx) => queryAll(ctx.getDoc(), `[data-scope="menu"][data-part="context-trigger"][data-ownedby="${ctx.id}"]`);
var getActiveTriggerEl = (ctx, value) => {
  if (value == null) {
    return getTriggerEl(ctx) ?? getTriggerEls(ctx)[0];
  }
  return ctx.getById(getTriggerId(ctx, value));
};
var getElements = (ctx) => {
  const ownerId = CSS.escape(getContentId(ctx));
  const selector = `[role^="menuitem"][data-ownedby=${ownerId}]:not([data-disabled])`;
  return queryAll(getContentEl(ctx), selector);
};
var getFirstEl = (ctx) => first(getElements(ctx));
var getLastEl = (ctx) => last(getElements(ctx));
var isMatch = (el, value) => {
  if (!value) return false;
  return el.id === value || el.dataset.value === value;
};
var getNextEl = (ctx, opts) => {
  const items = getElements(ctx);
  const index = items.findIndex((el) => isMatch(el, opts.value));
  return next(items, index, { loop: opts.loop ?? opts.loopFocus });
};
var getPrevEl = (ctx, opts) => {
  const items = getElements(ctx);
  const index = items.findIndex((el) => isMatch(el, opts.value));
  return prev(items, index, { loop: opts.loop ?? opts.loopFocus });
};
var getElemByKey = (ctx, opts) => {
  const items = getElements(ctx);
  const item = items.find((el) => isMatch(el, opts.value));
  return getByTypeahead(items, { state: opts.typeaheadState, key: opts.key, activeId: item?.id ?? null });
};
var isTargetDisabled = (v) => {
  return isHTMLElement(v) && (v.dataset.disabled === "" || v.hasAttribute("disabled"));
};
var isTriggerItem = (el) => {
  return !!el?.getAttribute("role")?.startsWith("menuitem") && !!el?.hasAttribute("data-controls");
};
var itemSelectEvent = "menu:select";
function dispatchSelectionEvent(el, value) {
  if (!el) return;
  const win = getWindow(el);
  const event = new win.CustomEvent(itemSelectEvent, { detail: { value } });
  el.dispatchEvent(event);
}
function getPortaledContentEl(scope) {
  const contentId = getContentId(scope);
  return getContentEl(scope) ?? scope.getDoc().getElementById(contentId);
}
function isTargetWithinMenuTree(target, children) {
  if (!isHTMLElement(target)) return false;
  for (const id in children) {
    const child = children[id];
    const childContent = getPortaledContentEl(child.scope);
    if (childContent && contains(childContent, target)) return true;
    const nested = child.refs.get("children");
    if (Object.keys(nested).length > 0 && isTargetWithinMenuTree(target, nested)) return true;
  }
  return false;
}

// node_modules/@zag-js/rect-utils/dist/rect.mjs
var createPoint = (x, y) => ({ x, y });
function createRect(r) {
  const { x, y, width, height } = r;
  const midX = x + width / 2;
  const midY = y + height / 2;
  return {
    x,
    y,
    width,
    height,
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
    midX,
    midY,
    center: createPoint(midX, midY)
  };
}
function getRectCorners(v) {
  const top = createPoint(v.minX, v.minY);
  const right = createPoint(v.maxX, v.minY);
  const bottom = createPoint(v.maxX, v.maxY);
  const left = createPoint(v.minX, v.maxY);
  return { top, right, bottom, left };
}

// node_modules/@zag-js/rect-utils/dist/polygon.mjs
function getElementPolygon(rectValue, placement) {
  const rect = createRect(rectValue);
  const { top, right, left, bottom } = getRectCorners(rect);
  const [base] = placement.split("-");
  return {
    top: [left, top, right, bottom],
    right: [top, right, bottom, left],
    bottom: [top, left, bottom, right],
    left: [right, top, left, bottom]
  }[base];
}
function isPointInPolygon(polygon, point) {
  const { x, y } = point;
  let c = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      c = !c;
    }
  }
  return c;
}

// node_modules/@zag-js/menu/dist/menu.utils.mjs
function closeRootMenu(ctx) {
  let parent = ctx.parent;
  while (parent && parent.context.get("isSubmenu")) {
    parent = parent.refs.get("parent");
  }
  parent?.send({ type: "CLOSE" });
}
function isWithinPolygon(polygon, point) {
  if (!polygon) return false;
  return isPointInPolygon(polygon, point);
}
function resolveItemId(children, value, scope) {
  const hasChildren = Object.keys(children).length > 0;
  if (!value) return null;
  if (!hasChildren) {
    return getItemId(scope, value);
  }
  for (const id in children) {
    const childMenu = children[id];
    const childTriggerId = getTriggerId(childMenu.scope);
    if (childTriggerId === value) {
      return childTriggerId;
    }
  }
  return getItemId(scope, value);
}
function setParentRoutingLock(parent, locked) {
  if (!parent) return;
  parent.refs.set("pointerRoutingLocked", locked);
  parent.context.set("pointerRoutingMode", locked ? "locked" : "interactive");
}
function isHighlightedItemSubmenuOpen(parent) {
  const highlighted = parent.context.get("highlightedValue");
  if (!highlighted) return false;
  const children = parent.refs.get("children");
  for (const id in children) {
    const child = children[id];
    if (!child.state.hasTag("open")) continue;
    if (getTriggerId(child.scope) === highlighted) return true;
  }
  return false;
}
function unlockParentAfterChildClose(parent, childIsSubmenu) {
  if (!parent) return;
  if (parent.refs.get("pointerRoutingLocked")) return;
  if (childIsSubmenu && isHighlightedItemSubmenuOpen(parent)) return;
  setParentRoutingLock(parent, false);
}
function unlockParentOnSubmenuClose(parent) {
  if (!parent) return;
  if (!isHighlightedItemSubmenuOpen(parent)) {
    setParentRoutingLock(parent, false);
  }
}

// node_modules/@zag-js/menu/dist/menu.connect.mjs
function connect(service, normalize) {
  const { context, send, state, computed, prop, scope } = service;
  const open = state.hasTag("open");
  const isSubmenu = context.get("isSubmenu");
  const isTypingAhead = computed("isTypingAhead");
  const composite = prop("composite");
  const currentPlacement = context.get("currentPlacement");
  const anchorPoint = context.get("anchorPoint");
  const highlightedValue = context.get("highlightedValue");
  const triggerValue = context.get("triggerValue");
  const popperStyles = getPlacementStyles({
    ...prop("positioning"),
    placement: anchorPoint ? "bottom" : currentPlacement
  });
  function getItemState(props) {
    return {
      id: getItemId(scope, props.value),
      disabled: !!props.disabled,
      highlighted: highlightedValue === props.value
    };
  }
  function getOptionItemProps(props) {
    const valueText = props.valueText ?? props.value;
    return { ...props, id: props.value, valueText };
  }
  function getOptionItemState(props) {
    const itemState = getItemState(getOptionItemProps(props));
    return {
      ...itemState,
      checked: !!props.checked
    };
  }
  function getItemProps(props) {
    const { closeOnSelect, valueText, value } = props;
    const itemState = getItemState(props);
    const id = getItemId(scope, value);
    return normalize.element({
      ...parts.item.attrs,
      id,
      role: "menuitem",
      "aria-disabled": ariaAttr(itemState.disabled),
      "data-disabled": dataAttr(itemState.disabled),
      "data-ownedby": getContentId(scope),
      "data-highlighted": dataAttr(itemState.highlighted),
      "data-value": value,
      "data-valuetext": valueText,
      onDragStart(event) {
        const isLink = event.currentTarget.matches("a[href]");
        if (isLink) event.preventDefault();
      },
      onPointerMove(event) {
        if (itemState.disabled) return;
        if (event.pointerType !== "mouse") return;
        const target = event.currentTarget;
        if (itemState.highlighted) return;
        const point = getEventPoint(event);
        send({ type: "ITEM_POINTERMOVE", id, target, closeOnSelect, point });
      },
      onPointerLeave(event) {
        if (itemState.disabled) return;
        if (event.pointerType !== "mouse") return;
        const pointerMoved = service.event.previous()?.type.includes("POINTER");
        if (!pointerMoved) return;
        const target = event.currentTarget;
        send({ type: "ITEM_POINTERLEAVE", id, target, closeOnSelect });
      },
      onPointerDown(event) {
        if (itemState.disabled) return;
        const target = event.currentTarget;
        send({ type: "ITEM_POINTERDOWN", target, id, closeOnSelect });
      },
      onClick(event) {
        if (isDownloadingEvent(event)) return;
        if (isOpeningInNewTab(event)) return;
        if (itemState.disabled) return;
        const target = event.currentTarget;
        send({ type: "ITEM_CLICK", target, id, closeOnSelect });
      }
    });
  }
  return {
    highlightedValue,
    open,
    setOpen(nextOpen) {
      const open2 = state.hasTag("open");
      if (open2 === nextOpen) return;
      send({ type: nextOpen ? "OPEN" : "CLOSE" });
    },
    triggerValue,
    setTriggerValue(value) {
      send({ type: "TRIGGER_VALUE.SET", value });
    },
    setHighlightedValue(value) {
      send({ type: "HIGHLIGHTED.SET", value });
    },
    setParent(parent) {
      send({ type: "PARENT.SET", value: parent, id: parent.prop("id") });
    },
    setChild(child) {
      send({ type: "CHILD.SET", value: child, id: child.prop("id") });
    },
    reposition(options = {}) {
      send({ type: "POSITIONING.SET", options });
    },
    addItemListener(props) {
      const node = scope.getById(props.id);
      if (!node) return;
      const listener = () => props.onSelect?.();
      node.addEventListener(itemSelectEvent, listener);
      return () => node.removeEventListener(itemSelectEvent, listener);
    },
    getContextTriggerProps(props = {}) {
      const { value } = props;
      const current = value == null ? false : triggerValue === value;
      const contextTriggerId = getContextTriggerId(scope, value);
      return normalize.element({
        ...parts.contextTrigger.attrs,
        dir: prop("dir"),
        id: contextTriggerId,
        "data-ownedby": scope.id,
        "data-value": value,
        "data-current": dataAttr(current),
        "data-state": open ? "open" : "closed",
        onPointerDown(event) {
          if (event.pointerType === "mouse") return;
          const point = getEventPoint(event);
          send({ type: "CONTEXT_MENU_START", point, value });
        },
        onPointerCancel(event) {
          if (event.pointerType === "mouse") return;
          send({ type: "CONTEXT_MENU_CANCEL" });
        },
        onPointerMove(event) {
          if (event.pointerType === "mouse") return;
          send({ type: "CONTEXT_MENU_CANCEL" });
        },
        onPointerUp(event) {
          if (event.pointerType === "mouse") return;
          send({ type: "CONTEXT_MENU_CANCEL" });
        },
        onContextMenu(event) {
          const point = getEventPoint(event);
          const shouldSwitch = open && value != null && !current;
          send({
            type: shouldSwitch ? "TRIGGER_VALUE.SET" : "CONTEXT_MENU",
            point,
            value
          });
          event.preventDefault();
        },
        style: {
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          userSelect: "none"
        }
      });
    },
    getTriggerItemProps(childApi) {
      const triggerProps = childApi.getTriggerProps();
      return mergeProps(getItemProps({ value: triggerProps.id }), triggerProps);
    },
    getTriggerProps(props = {}) {
      const { value } = props;
      const current = value == null ? false : triggerValue === value;
      const triggerId = getTriggerId(scope, value);
      return normalize.button({
        ...isSubmenu ? parts.triggerItem.attrs : parts.trigger.attrs,
        "data-placement": context.get("currentPlacement"),
        type: "button",
        dir: prop("dir"),
        id: triggerId,
        // Multi-trigger attributes - only included when value is provided
        ...value != null && {
          "data-ownedby": scope.id,
          "data-value": value,
          "data-current": dataAttr(current)
        },
        "data-uid": prop("id"),
        "aria-haspopup": composite ? "menu" : "dialog",
        "aria-controls": getContentId(scope),
        "data-controls": getContentId(scope),
        "aria-expanded": value == null ? open : open && current,
        "data-state": open ? "open" : "closed",
        onPointerMove(event) {
          if (event.pointerType !== "mouse") return;
          const disabled = isTargetDisabled(event.currentTarget);
          if (disabled || !isSubmenu) return;
          const point = getEventPoint(event);
          send({ type: "TRIGGER_POINTERMOVE", target: event.currentTarget, point });
        },
        onPointerLeave(event) {
          if (isTargetDisabled(event.currentTarget)) return;
          if (event.pointerType !== "mouse") return;
          if (!isSubmenu) return;
          setParentRoutingLock(service.refs.get("parent"), true);
          const point = getEventPoint(event);
          send({
            type: "TRIGGER_POINTERLEAVE",
            target: event.currentTarget,
            point
          });
        },
        onPointerDown(event) {
          if (isTargetDisabled(event.currentTarget)) return;
          if (isContextMenuEvent(event)) return;
          event.preventDefault();
        },
        onClick(event) {
          if (event.defaultPrevented) return;
          if (isTargetDisabled(event.currentTarget)) return;
          const shouldSwitch = open && value != null && !current;
          send({
            type: shouldSwitch ? "TRIGGER_VALUE.SET" : "TRIGGER_CLICK",
            target: event.currentTarget,
            value
          });
        },
        onBlur() {
          send({ type: "TRIGGER_BLUR" });
        },
        onFocus() {
          send({ type: "TRIGGER_FOCUS" });
        },
        onKeyDown(event) {
          if (event.defaultPrevented) return;
          const keyMap2 = {
            ArrowDown() {
              send({ type: "ARROW_DOWN", value });
            },
            ArrowUp() {
              send({ type: "ARROW_UP", value });
            },
            Enter() {
              send({ type: "ARROW_DOWN", src: "enter", value });
            },
            Space() {
              send({ type: "ARROW_DOWN", src: "space", value });
            }
          };
          const key = getEventKey(event, {
            orientation: "vertical",
            dir: prop("dir")
          });
          const exec = keyMap2[key];
          if (exec) {
            event.preventDefault();
            exec(event);
          }
        }
      });
    },
    getIndicatorProps() {
      return normalize.element({
        ...parts.indicator.attrs,
        dir: prop("dir"),
        "data-state": open ? "open" : "closed"
      });
    },
    getPositionerProps() {
      return normalize.element({
        ...parts.positioner.attrs,
        dir: prop("dir"),
        id: getPositionerId(scope),
        style: popperStyles.floating
      });
    },
    getArrowProps() {
      return normalize.element({
        id: getArrowId(scope),
        ...parts.arrow.attrs,
        dir: prop("dir"),
        style: popperStyles.arrow
      });
    },
    getArrowTipProps() {
      return normalize.element({
        ...parts.arrowTip.attrs,
        dir: prop("dir"),
        style: popperStyles.arrowTip
      });
    },
    getContentProps() {
      return normalize.element({
        ...parts.content.attrs,
        id: getContentId(scope),
        "aria-label": prop("aria-label"),
        hidden: !open,
        "data-state": open ? "open" : "closed",
        role: composite ? "menu" : "dialog",
        tabIndex: 0,
        dir: prop("dir"),
        "aria-activedescendant": computed("highlightedId") || void 0,
        "aria-labelledby": anchorPoint ? getContextTriggerId(scope, triggerValue ?? void 0) : getTriggerId(scope, triggerValue ?? void 0),
        "data-placement": currentPlacement,
        onPointerEnter(event) {
          if (event.pointerType !== "mouse") return;
          send({ type: "MENU_POINTERENTER" });
        },
        onKeyDown(event) {
          if (event.defaultPrevented) return;
          if (!contains(event.currentTarget, getEventTarget(event))) return;
          const target = getEventTarget(event);
          const sameMenu = target?.closest("[role=menu]") === event.currentTarget || target === event.currentTarget;
          if (!sameMenu) return;
          if (event.key === "Tab") {
            const valid = isValidTabEvent(event);
            if (!valid) {
              event.preventDefault();
              return;
            }
          }
          const keyMap2 = {
            ArrowDown() {
              send({ type: "ARROW_DOWN" });
            },
            ArrowUp() {
              send({ type: "ARROW_UP" });
            },
            ArrowLeft() {
              send({ type: "ARROW_LEFT" });
            },
            ArrowRight() {
              send({ type: "ARROW_RIGHT" });
            },
            Enter() {
              send({ type: "ENTER" });
            },
            Space(event2) {
              if (isTypingAhead) {
                send({ type: "TYPEAHEAD", key: event2.key });
              } else {
                keyMap2.Enter?.(event2);
              }
            },
            Home() {
              send({ type: "HOME" });
            },
            End() {
              send({ type: "END" });
            }
          };
          const key = getEventKey(event, { dir: prop("dir") });
          const exec = keyMap2[key];
          if (exec) {
            exec(event);
            event.stopPropagation();
            event.preventDefault();
            return;
          }
          if (!prop("typeahead")) return;
          if (!isPrintableKey(event)) return;
          if (isModifierKey(event)) return;
          if (isEditableElement(target)) return;
          send({ type: "TYPEAHEAD", key: event.key });
          event.preventDefault();
        }
      });
    },
    getSeparatorProps() {
      return normalize.element({
        ...parts.separator.attrs,
        role: "separator",
        dir: prop("dir"),
        "aria-orientation": "horizontal"
      });
    },
    getItemState,
    getItemProps,
    getOptionItemState,
    getOptionItemProps(props) {
      const { type, disabled, closeOnSelect } = props;
      const option = getOptionItemProps(props);
      const itemState = getOptionItemState(props);
      return {
        ...getItemProps(option),
        ...normalize.element({
          "data-type": type,
          ...parts.item.attrs,
          dir: prop("dir"),
          "data-value": option.value,
          role: `menuitem${type}`,
          "aria-checked": !!itemState.checked,
          "data-state": itemState.checked ? "checked" : "unchecked",
          onClick(event) {
            if (disabled) return;
            if (isDownloadingEvent(event)) return;
            if (isOpeningInNewTab(event)) return;
            const target = event.currentTarget;
            send({ type: "ITEM_CLICK", target, option, closeOnSelect });
          }
        })
      };
    },
    getItemIndicatorProps(props) {
      const itemState = getOptionItemState(cast(props));
      const dataState = itemState.checked ? "checked" : "unchecked";
      return normalize.element({
        ...parts.itemIndicator.attrs,
        dir: prop("dir"),
        "data-disabled": dataAttr(itemState.disabled),
        "data-highlighted": dataAttr(itemState.highlighted),
        "data-state": hasProp(props, "checked") ? dataState : void 0,
        hidden: hasProp(props, "checked") ? !itemState.checked : void 0
      });
    },
    getItemTextProps(props) {
      const itemState = getOptionItemState(cast(props));
      const dataState = itemState.checked ? "checked" : "unchecked";
      return normalize.element({
        ...parts.itemText.attrs,
        dir: prop("dir"),
        "data-disabled": dataAttr(itemState.disabled),
        "data-highlighted": dataAttr(itemState.highlighted),
        "data-state": hasProp(props, "checked") ? dataState : void 0
      });
    },
    getItemGroupLabelProps(props) {
      return normalize.element({
        ...parts.itemGroupLabel.attrs,
        id: getGroupLabelId(scope, props.htmlFor),
        dir: prop("dir")
      });
    },
    getItemGroupProps(props) {
      return normalize.element({
        id: getGroupId(scope, props.id),
        ...parts.itemGroup.attrs,
        dir: prop("dir"),
        "aria-labelledby": getGroupLabelId(scope, props.id),
        role: "group"
      });
    }
  };
}

// node_modules/@zag-js/interact-outside/dist/frame-utils.mjs
function getWindowFrames(win) {
  const frames = {
    each(cb) {
      for (let i = 0; i < win.frames?.length; i += 1) {
        const frame = win.frames[i];
        if (frame) cb(frame);
      }
    },
    addEventListener(event, listener, options) {
      frames.each((frame) => {
        try {
          frame.document.addEventListener(event, listener, options);
        } catch {
        }
      });
      return () => {
        try {
          frames.removeEventListener(event, listener, options);
        } catch {
        }
      };
    },
    removeEventListener(event, listener, options) {
      frames.each((frame) => {
        try {
          frame.document.removeEventListener(event, listener, options);
        } catch {
        }
      });
    }
  };
  return frames;
}
function getParentWindow(win) {
  const parent = win.frameElement != null ? win.parent : null;
  return {
    addEventListener: (event, listener, options) => {
      try {
        parent?.addEventListener(event, listener, options);
      } catch {
      }
      return () => {
        try {
          parent?.removeEventListener(event, listener, options);
        } catch {
        }
      };
    },
    removeEventListener: (event, listener, options) => {
      try {
        parent?.removeEventListener(event, listener, options);
      } catch {
      }
    }
  };
}

// node_modules/@zag-js/interact-outside/dist/index.mjs
var POINTER_OUTSIDE_EVENT = "pointerdown.outside";
var FOCUS_OUTSIDE_EVENT = "focus.outside";
function isComposedPathFocusable(composedPath) {
  for (const node of composedPath) {
    if (isHTMLElement(node) && isFocusable(node)) return true;
  }
  return false;
}
var isPointerEvent = (event) => "clientY" in event;
function isEventPointWithin(node, event) {
  if (!isPointerEvent(event) || !node) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
}
function isPointInRect(rect, point) {
  return rect.y <= point.y && point.y <= rect.y + rect.height && rect.x <= point.x && point.x <= rect.x + rect.width;
}
function isEventWithinScrollbar(event, ancestor) {
  if (!ancestor || !isPointerEvent(event)) return false;
  const isScrollableY = ancestor.scrollHeight > ancestor.clientHeight;
  const onScrollbarY = isScrollableY && event.clientX > ancestor.offsetLeft + ancestor.clientWidth;
  const isScrollableX = ancestor.scrollWidth > ancestor.clientWidth;
  const onScrollbarX = isScrollableX && event.clientY > ancestor.offsetTop + ancestor.clientHeight;
  const rect = {
    x: ancestor.offsetLeft,
    y: ancestor.offsetTop,
    width: ancestor.clientWidth + (isScrollableY ? 16 : 0),
    height: ancestor.clientHeight + (isScrollableX ? 16 : 0)
  };
  const point = {
    x: event.clientX,
    y: event.clientY
  };
  if (!isPointInRect(rect, point)) return false;
  return onScrollbarY || onScrollbarX;
}
function trackInteractOutsideImpl(node, options) {
  const {
    exclude,
    onFocusOutside,
    onPointerDownOutside,
    onInteractOutside,
    defer,
    followControlledElements = true
  } = options;
  if (!node) return;
  const doc = getDocument(node);
  const win = getWindow(node);
  const frames = getWindowFrames(win);
  const parentWin = getParentWindow(win);
  function isEventOutside(event, target) {
    if (!isHTMLElement(target)) return false;
    if (!target.isConnected) return false;
    if (contains(node, target)) return false;
    if (isEventPointWithin(node, event)) return false;
    if (followControlledElements && isControlledElement(node, target)) return false;
    const triggerEl = doc.querySelector(`[aria-controls="${node.id}"]`);
    if (triggerEl) {
      const triggerAncestor = getNearestOverflowAncestor(triggerEl);
      if (isEventWithinScrollbar(event, triggerAncestor)) return false;
    }
    const nodeAncestor = getNearestOverflowAncestor(node);
    if (isEventWithinScrollbar(event, nodeAncestor)) return false;
    return !exclude?.(target);
  }
  const pointerdownCleanups = /* @__PURE__ */ new Set();
  const isInShadowRoot = isShadowRoot(node?.getRootNode());
  let isPointerDown = false;
  function onPointerDown(event) {
    isPointerDown = true;
    const onPointerUp = () => {
      isPointerDown = false;
    };
    doc.addEventListener("pointerup", onPointerUp, { once: true });
    win.addEventListener("pointerup", onPointerUp, { once: true });
    function handler(clickEvent) {
      const func = defer && !isTouchDevice() ? raf : (v) => v();
      const evt = clickEvent ?? event;
      const composedPath = evt?.composedPath?.() ?? [evt?.target];
      func(() => {
        const target = isInShadowRoot ? composedPath[0] : getEventTarget(event);
        if (!node || !isEventOutside(event, target)) return;
        if (onPointerDownOutside || onInteractOutside) {
          const handler2 = callAll(onPointerDownOutside, onInteractOutside);
          node.addEventListener(POINTER_OUTSIDE_EVENT, handler2, { once: true });
        }
        fireCustomEvent(node, POINTER_OUTSIDE_EVENT, {
          bubbles: false,
          cancelable: true,
          detail: {
            originalEvent: evt,
            contextmenu: isContextMenuEvent(evt),
            focusable: isComposedPathFocusable(composedPath),
            target
          }
        });
      });
    }
    if (event.pointerType === "touch") {
      pointerdownCleanups.forEach((fn) => fn());
      pointerdownCleanups.add(addDomEvent(doc, "click", handler, { once: true }));
      pointerdownCleanups.add(parentWin.addEventListener("click", handler, { once: true }));
      pointerdownCleanups.add(frames.addEventListener("click", handler, { once: true }));
    } else {
      handler();
    }
  }
  const cleanups = /* @__PURE__ */ new Set();
  const timer = setTimeout(() => {
    cleanups.add(addDomEvent(doc, "pointerdown", onPointerDown, true));
    cleanups.add(parentWin.addEventListener("pointerdown", onPointerDown, true));
    cleanups.add(frames.addEventListener("pointerdown", onPointerDown, true));
  }, 0);
  function onFocusin(event) {
    if (isPointerDown) return;
    const func = defer ? raf : (v) => v();
    func(() => {
      const composedPath = event?.composedPath?.() ?? [event?.target];
      const target = isInShadowRoot ? composedPath[0] : getEventTarget(event);
      if (!node || !isEventOutside(event, target)) return;
      if (onFocusOutside || onInteractOutside) {
        const handler = callAll(onFocusOutside, onInteractOutside);
        node.addEventListener(FOCUS_OUTSIDE_EVENT, handler, { once: true });
      }
      fireCustomEvent(node, FOCUS_OUTSIDE_EVENT, {
        bubbles: false,
        cancelable: true,
        detail: {
          originalEvent: event,
          contextmenu: false,
          focusable: isFocusable(target),
          target
        }
      });
    });
  }
  if (!isTouchDevice()) {
    cleanups.add(addDomEvent(doc, "focusin", onFocusin, true));
    cleanups.add(parentWin.addEventListener("focusin", onFocusin, true));
    cleanups.add(frames.addEventListener("focusin", onFocusin, true));
  }
  return () => {
    clearTimeout(timer);
    pointerdownCleanups.forEach((fn) => fn());
    cleanups.forEach((fn) => fn());
  };
}
function trackInteractOutside(nodeOrFn, options) {
  const { defer } = options;
  const func = defer ? raf : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      const node = typeof nodeOrFn === "function" ? nodeOrFn() : nodeOrFn;
      cleanups.push(trackInteractOutsideImpl(node, options));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}
function fireCustomEvent(el, type, init) {
  const win = el.ownerDocument.defaultView || window;
  const event = new win.CustomEvent(type, init);
  return el.dispatchEvent(event);
}

// node_modules/@zag-js/dismissable/dist/escape-keydown.mjs
function trackEscapeKeydown(node, fn) {
  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (event.isComposing) return;
    fn?.(event);
  };
  return addDomEvent(getDocument(node), "keydown", handleKeyDown, { capture: true });
}

// node_modules/@zag-js/dismissable/dist/layer-stack.mjs
var LAYER_REQUEST_DISMISS_EVENT = "layer:request-dismiss";
var layerStack = {
  layers: [],
  branches: [],
  recentlyRemoved: /* @__PURE__ */ new Set(),
  count() {
    return this.layers.length;
  },
  pointerBlockingLayers() {
    return this.layers.filter((layer) => layer.pointerBlocking);
  },
  topMostPointerBlockingLayer() {
    return [...this.pointerBlockingLayers()].slice(-1)[0];
  },
  hasPointerBlockingLayer() {
    return this.pointerBlockingLayers().length > 0;
  },
  isBelowPointerBlockingLayer(node) {
    const index = this.indexOf(node);
    const highestBlockingIndex = this.topMostPointerBlockingLayer() ? this.indexOf(this.topMostPointerBlockingLayer()?.node) : -1;
    return index < highestBlockingIndex;
  },
  isTopMost(node) {
    const layer = this.layers[this.count() - 1];
    return layer?.node === node;
  },
  getNestedLayers(node) {
    return Array.from(this.layers).slice(this.indexOf(node) + 1);
  },
  getLayersByType(type) {
    return this.layers.filter((layer) => layer.type === type);
  },
  getNestedLayersByType(node, type) {
    const index = this.indexOf(node);
    if (index === -1) return [];
    return this.layers.slice(index + 1).filter((layer) => layer.type === type);
  },
  getParentLayerOfType(node, type) {
    const index = this.indexOf(node);
    if (index <= 0) return void 0;
    return this.layers.slice(0, index).reverse().find((layer) => layer.type === type);
  },
  countNestedLayersOfType(node, type) {
    return this.getNestedLayersByType(node, type).length;
  },
  isInNestedLayer(node, target) {
    const inNested = this.getNestedLayers(node).some((layer) => contains(layer.node, target));
    if (inNested) return true;
    if (this.recentlyRemoved.size > 0) return true;
    return false;
  },
  isInBranch(target) {
    return Array.from(this.branches).some((branch) => contains(branch, target));
  },
  add(layer) {
    this.layers.push(layer);
    this.syncLayers();
  },
  addBranch(node) {
    this.branches.push(node);
  },
  remove(node) {
    const index = this.indexOf(node);
    if (index < 0) return;
    this.recentlyRemoved.add(node);
    nextTick(() => this.recentlyRemoved.delete(node));
    if (index < this.count() - 1) {
      const _layers = this.getNestedLayers(node);
      _layers.forEach((layer) => layerStack.dismiss(layer.node, node));
    }
    this.layers.splice(index, 1);
    this.syncLayers();
  },
  removeBranch(node) {
    const index = this.branches.indexOf(node);
    if (index >= 0) this.branches.splice(index, 1);
  },
  syncLayers() {
    this.layers.forEach((layer, index) => {
      layer.node.style.setProperty("--layer-index", `${index}`);
      layer.node.removeAttribute("data-nested");
      layer.node.removeAttribute("data-has-nested");
      const parentOfSameType = this.getParentLayerOfType(layer.node, layer.type);
      if (parentOfSameType) {
        layer.node.setAttribute("data-nested", layer.type);
      }
      const nestedCount = this.countNestedLayersOfType(layer.node, layer.type);
      if (nestedCount > 0) {
        layer.node.setAttribute("data-has-nested", layer.type);
      }
      layer.node.style.setProperty("--nested-layer-count", `${nestedCount}`);
    });
  },
  indexOf(node) {
    return this.layers.findIndex((layer) => layer.node === node);
  },
  dismiss(node, parent) {
    const index = this.indexOf(node);
    if (index === -1) return;
    const layer = this.layers[index];
    addListenerOnce(node, LAYER_REQUEST_DISMISS_EVENT, (event) => {
      layer.requestDismiss?.(event);
      if (!event.defaultPrevented) {
        layer?.dismiss();
      }
    });
    fireCustomEvent2(node, LAYER_REQUEST_DISMISS_EVENT, {
      originalLayer: node,
      targetLayer: parent,
      originalIndex: index,
      targetIndex: parent ? this.indexOf(parent) : -1
    });
    this.syncLayers();
  },
  clear() {
    this.remove(this.layers[0].node);
  }
};
function fireCustomEvent2(el, type, detail) {
  const win = el.ownerDocument.defaultView || window;
  const event = new win.CustomEvent(type, { cancelable: true, bubbles: true, detail });
  return el.dispatchEvent(event);
}
function addListenerOnce(el, type, callback) {
  el.addEventListener(type, callback, { once: true });
}

// node_modules/@zag-js/dismissable/dist/pointer-event-outside.mjs
var originalBodyPointerEvents;
function assignPointerEventToLayers() {
  layerStack.layers.forEach(({ node }) => {
    node.style.pointerEvents = layerStack.isBelowPointerBlockingLayer(node) ? "none" : "auto";
  });
}
function clearPointerEvent(node) {
  node.style.pointerEvents = "";
}
function disablePointerEventsOutside(node, persistentElements) {
  const doc = getDocument(node);
  const cleanups = [];
  if (layerStack.hasPointerBlockingLayer() && !doc.body.hasAttribute("data-inert")) {
    originalBodyPointerEvents = document.body.style.pointerEvents;
    queueMicrotask(() => {
      doc.body.style.pointerEvents = "none";
      doc.body.setAttribute("data-inert", "");
    });
  }
  persistentElements?.forEach((el) => {
    const [promise, abort] = waitForElement(
      () => {
        const node2 = el();
        return isHTMLElement(node2) ? node2 : null;
      },
      { timeout: 1e3 }
    );
    promise.then((el2) => cleanups.push(setStyle(el2, { pointerEvents: "auto" })));
    cleanups.push(abort);
  });
  return () => {
    if (layerStack.hasPointerBlockingLayer()) return;
    queueMicrotask(() => {
      doc.body.style.pointerEvents = originalBodyPointerEvents;
      doc.body.removeAttribute("data-inert");
      if (doc.body.style.length === 0) doc.body.removeAttribute("style");
    });
    cleanups.forEach((fn) => fn());
  };
}

// node_modules/@zag-js/dismissable/dist/dismissable-layer.mjs
function trackDismissableElementImpl(node, options) {
  const { warnOnMissingNode = true } = options;
  if (warnOnMissingNode && !node) {
    warn("[@zag-js/dismissable] node is `null` or `undefined`");
    return;
  }
  if (!node) {
    return;
  }
  const { onDismiss, onRequestDismiss, pointerBlocking, exclude: excludeContainers, debug, type = "dialog" } = options;
  const layer = { dismiss: onDismiss, node, type, pointerBlocking, requestDismiss: onRequestDismiss };
  layerStack.add(layer);
  assignPointerEventToLayers();
  function onPointerDownOutside(event) {
    const target = getEventTarget(event.detail.originalEvent);
    if (layerStack.isBelowPointerBlockingLayer(node) || layerStack.isInBranch(target)) return;
    options.onPointerDownOutside?.(event);
    options.onInteractOutside?.(event);
    if (event.defaultPrevented) return;
    if (debug) {
      console.log("onPointerDownOutside:", event.detail.originalEvent);
    }
    onDismiss?.();
  }
  function onFocusOutside(event) {
    const target = getEventTarget(event.detail.originalEvent);
    if (layerStack.isInBranch(target)) return;
    options.onFocusOutside?.(event);
    options.onInteractOutside?.(event);
    if (event.defaultPrevented) return;
    if (debug) {
      console.log("onFocusOutside:", event.detail.originalEvent);
    }
    onDismiss?.();
  }
  function onEscapeKeyDown(event) {
    if (!layerStack.isTopMost(node)) return;
    options.onEscapeKeyDown?.(event);
    if (!event.defaultPrevented && onDismiss) {
      event.preventDefault();
      onDismiss();
    }
  }
  function exclude(target) {
    if (!node) return false;
    const containers = typeof excludeContainers === "function" ? excludeContainers() : excludeContainers;
    const _containers = Array.isArray(containers) ? containers : [containers];
    const persistentElements = options.persistentElements?.map((fn) => fn()).filter(isHTMLElement);
    if (persistentElements) _containers.push(...persistentElements);
    return _containers.some((node2) => contains(node2, target)) || layerStack.isInNestedLayer(node, target);
  }
  const cleanups = [
    pointerBlocking ? disablePointerEventsOutside(node, options.persistentElements) : void 0,
    trackEscapeKeydown(node, onEscapeKeyDown),
    trackInteractOutside(node, { exclude, onFocusOutside, onPointerDownOutside, defer: options.defer })
  ];
  return () => {
    layerStack.remove(node);
    assignPointerEventToLayers();
    clearPointerEvent(node);
    cleanups.forEach((fn) => fn?.());
  };
}
function trackDismissableElement(nodeOrFn, options) {
  const { defer } = options;
  const func = defer ? raf : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      const node = isFunction(nodeOrFn) ? nodeOrFn() : nodeOrFn;
      cleanups.push(trackDismissableElementImpl(node, options));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}

// node_modules/@zag-js/focus-visible/dist/index.mjs
function isValidKey(e) {
  return !(e.metaKey || !isMac() && e.altKey || e.ctrlKey || e.key === "Control" || e.key === "Shift" || e.key === "Meta");
}
var nonTextInputTypes = /* @__PURE__ */ new Set(["checkbox", "radio", "range", "color", "file", "image", "button", "submit", "reset"]);
function isKeyboardFocusEvent(isTextInput, modality, e) {
  const eventTarget = e ? getEventTarget(e) : null;
  const doc = getDocument(eventTarget);
  const win = getWindow(eventTarget);
  const activeElement = getActiveElement(doc);
  isTextInput = isTextInput || activeElement instanceof win.HTMLInputElement && !nonTextInputTypes.has(activeElement?.type) || activeElement instanceof win.HTMLTextAreaElement || activeElement instanceof win.HTMLElement && activeElement.isContentEditable;
  return !(isTextInput && modality === "keyboard" && e instanceof win.KeyboardEvent && !Reflect.has(FOCUS_VISIBLE_INPUT_KEYS, e.key));
}
var currentModality = null;
var changeHandlers = /* @__PURE__ */ new Set();
var listenerMap = /* @__PURE__ */ new Map();
var hasEventBeforeFocus = false;
var hasBlurredWindowRecently = false;
var ignoreFocusEvent = false;
var FOCUS_VISIBLE_INPUT_KEYS = {
  Tab: true,
  Escape: true
};
function triggerChangeHandlers(modality, e) {
  for (let handler of changeHandlers) {
    handler(modality, e);
  }
}
function handleKeyboardEvent(e) {
  hasEventBeforeFocus = true;
  if (isValidKey(e)) {
    currentModality = "keyboard";
    triggerChangeHandlers("keyboard", e);
  }
}
function handlePointerEvent(e) {
  currentModality = "pointer";
  if (e.type === "mousedown" || e.type === "pointerdown") {
    hasEventBeforeFocus = true;
    triggerChangeHandlers("pointer", e);
  }
}
function handleClickEvent(e) {
  if (isVirtualClick(e)) {
    hasEventBeforeFocus = true;
    currentModality = "virtual";
  }
}
function handleFocusEvent(e) {
  const target = getEventTarget(e);
  if (target === getWindow(target) || target === getDocument(target) || ignoreFocusEvent || !e.isTrusted) {
    return;
  }
  if (!hasEventBeforeFocus && !hasBlurredWindowRecently) {
    currentModality = "virtual";
    triggerChangeHandlers("virtual", e);
  }
  hasEventBeforeFocus = false;
  hasBlurredWindowRecently = false;
}
function handleWindowBlur() {
  if (ignoreFocusEvent) return;
  hasEventBeforeFocus = false;
  hasBlurredWindowRecently = true;
}
function setupGlobalFocusEvents(root) {
  if (typeof window === "undefined" || listenerMap.get(getWindow(root))) {
    return;
  }
  const win = getWindow(root);
  const doc = getDocument(root);
  let focus = win.HTMLElement.prototype.focus;
  function patchedFocus() {
    hasEventBeforeFocus = true;
    focus.apply(this, arguments);
  }
  try {
    Object.defineProperty(win.HTMLElement.prototype, "focus", {
      configurable: true,
      value: patchedFocus
    });
  } catch {
  }
  doc.addEventListener("keydown", handleKeyboardEvent, true);
  doc.addEventListener("keyup", handleKeyboardEvent, true);
  doc.addEventListener("click", handleClickEvent, true);
  win.addEventListener("focus", handleFocusEvent, true);
  win.addEventListener("blur", handleWindowBlur, false);
  if (typeof win.PointerEvent !== "undefined") {
    doc.addEventListener("pointerdown", handlePointerEvent, true);
    doc.addEventListener("pointermove", handlePointerEvent, true);
    doc.addEventListener("pointerup", handlePointerEvent, true);
  } else {
    doc.addEventListener("mousedown", handlePointerEvent, true);
    doc.addEventListener("mousemove", handlePointerEvent, true);
    doc.addEventListener("mouseup", handlePointerEvent, true);
  }
  win.addEventListener(
    "beforeunload",
    () => {
      tearDownWindowFocusTracking(root);
    },
    { once: true }
  );
  listenerMap.set(win, { focus });
}
var tearDownWindowFocusTracking = (root, loadListener) => {
  const win = getWindow(root);
  const doc = getDocument(root);
  if (loadListener) {
    doc.removeEventListener("DOMContentLoaded", loadListener);
  }
  const listenerData = listenerMap.get(win);
  if (!listenerData) {
    return;
  }
  try {
    Object.defineProperty(win.HTMLElement.prototype, "focus", {
      configurable: true,
      value: listenerData.focus
    });
  } catch {
  }
  doc.removeEventListener("keydown", handleKeyboardEvent, true);
  doc.removeEventListener("keyup", handleKeyboardEvent, true);
  doc.removeEventListener("click", handleClickEvent, true);
  win.removeEventListener("focus", handleFocusEvent, true);
  win.removeEventListener("blur", handleWindowBlur, false);
  if (typeof win.PointerEvent !== "undefined") {
    doc.removeEventListener("pointerdown", handlePointerEvent, true);
    doc.removeEventListener("pointermove", handlePointerEvent, true);
    doc.removeEventListener("pointerup", handlePointerEvent, true);
  } else {
    doc.removeEventListener("mousedown", handlePointerEvent, true);
    doc.removeEventListener("mousemove", handlePointerEvent, true);
    doc.removeEventListener("mouseup", handlePointerEvent, true);
  }
  listenerMap.delete(win);
};
function getInteractionModality() {
  return currentModality;
}
function setInteractionModality(modality) {
  currentModality = modality;
  triggerChangeHandlers(modality, null);
}
function isFocusVisible() {
  return currentModality === "keyboard" || currentModality === "virtual";
}
function trackFocusVisible(props = {}) {
  const { isTextInput, autoFocus, onChange, root } = props;
  setupGlobalFocusEvents(root);
  onChange?.({ isFocusVisible: autoFocus || isFocusVisible(), modality: currentModality });
  const handler = (modality, e) => {
    if (!isKeyboardFocusEvent(!!isTextInput, modality, e)) return;
    onChange?.({ isFocusVisible: isFocusVisible(), modality });
  };
  changeHandlers.add(handler);
  return () => {
    changeHandlers.delete(handler);
  };
}

// node_modules/@zag-js/menu/dist/menu.machine.mjs
var { not, and, or } = createGuards();
var machine = createMachine({
  props({ props }) {
    return {
      closeOnSelect: true,
      typeahead: true,
      composite: true,
      loopFocus: false,
      navigate(details) {
        clickIfLink(details.node);
      },
      ...props,
      positioning: {
        placement: "bottom-start",
        gutter: 8,
        ...props.positioning
      }
    };
  },
  initialState({ prop }) {
    const open = prop("open") || prop("defaultOpen");
    return open ? "open" : "idle";
  },
  context({ bindable: bindable2, prop, scope }) {
    return {
      highlightedValue: bindable2(() => ({
        defaultValue: prop("defaultHighlightedValue") || null,
        value: prop("highlightedValue"),
        onChange(value) {
          prop("onHighlightChange")?.({ highlightedValue: value });
        }
      })),
      lastHighlightedValue: bindable2(() => ({
        defaultValue: null
      })),
      currentPlacement: bindable2(() => ({
        defaultValue: void 0
      })),
      intentPolygon: bindable2(() => ({
        defaultValue: null
      })),
      anchorPoint: bindable2(() => ({
        defaultValue: null,
        hash(value) {
          return `x: ${value?.x}, y: ${value?.y}`;
        }
      })),
      isSubmenu: bindable2(() => ({
        defaultValue: false
      })),
      triggerValue: bindable2(() => ({
        defaultValue: prop("defaultTriggerValue") ?? null,
        value: prop("triggerValue"),
        onChange(value) {
          const onTriggerValueChange = prop("onTriggerValueChange");
          if (!onTriggerValueChange) return;
          const triggerElement = getActiveTriggerEl(scope, value);
          onTriggerValueChange({ value, triggerElement });
        }
      })),
      pointerRoutingMode: bindable2(() => ({
        defaultValue: "interactive"
      }))
    };
  },
  refs() {
    return {
      parent: null,
      children: {},
      pointerRoutingLocked: false,
      typeaheadState: { ...getByTypeahead.defaultOptions },
      positioningOverride: {}
    };
  },
  computed: {
    isRtl: ({ prop }) => prop("dir") === "rtl",
    isTypingAhead: ({ refs }) => refs.get("typeaheadState").keysSoFar !== "",
    highlightedId: ({ context, scope, refs }) => resolveItemId(refs.get("children"), context.get("highlightedValue"), scope)
  },
  watch({ track, action, context, prop }) {
    track([() => context.get("isSubmenu")], () => {
      action(["setSubmenuPlacement"]);
    });
    track([() => context.hash("anchorPoint")], () => {
      if (!context.get("anchorPoint")) return;
      action(["reposition"]);
    });
    track([() => prop("open")], () => {
      action(["toggleVisibility"]);
    });
  },
  on: {
    "TRIGGER_VALUE.SET": {
      actions: ["setTriggerValue", "setAnchorPoint", "reposition", "focusMenu"]
    },
    "PARENT.SET": {
      actions: ["setParentMenu"]
    },
    "CHILD.SET": {
      actions: ["setChildMenu"]
    },
    OPEN: [
      {
        guard: "isOpenControlled",
        actions: ["setTriggerValue", "invokeOnOpen"]
      },
      {
        target: "open",
        actions: ["setTriggerValue", "invokeOnOpen"]
      }
    ],
    OPEN_AUTOFOCUS: [
      {
        guard: "isOpenControlled",
        actions: ["setTriggerValue", "invokeOnOpen"]
      },
      {
        // internal: true,
        target: "open",
        actions: ["setTriggerValue", "highlightFirstItem", "invokeOnOpen"]
      }
    ],
    CLOSE: [
      {
        guard: "isOpenControlled",
        actions: ["invokeOnClose", "releaseParentRoutingLock"]
      },
      {
        target: "closed",
        actions: ["invokeOnClose", "releaseParentRoutingLock", "focusTrigger"]
      }
    ],
    "HIGHLIGHTED.RESTORE": {
      actions: ["restoreHighlightedItem"]
    },
    "HIGHLIGHTED.SET": {
      actions: ["setHighlightedItem"]
    },
    "HIGHLIGHTED.SUGGEST": {
      actions: ["suggestHighlightedItem"]
    }
  },
  states: {
    idle: {
      tags: ["closed"],
      on: {
        "CONTROLLED.OPEN": {
          target: "open"
        },
        "CONTROLLED.CLOSE": {
          target: "closed"
        },
        CONTEXT_MENU_START: {
          target: "opening:contextmenu",
          actions: ["setAnchorPoint", "setTriggerValue"]
        },
        CONTEXT_MENU: [
          {
            guard: "isOpenControlled",
            actions: ["setAnchorPoint", "setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setAnchorPoint", "setTriggerValue", "invokeOnOpen"]
          }
        ],
        TRIGGER_CLICK: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen", "setTriggerValue"]
          },
          {
            target: "open",
            actions: ["invokeOnOpen", "setTriggerValue"]
          }
        ],
        TRIGGER_FOCUS: {
          guard: not("isSubmenu"),
          target: "closed"
        },
        TRIGGER_POINTERMOVE: {
          guard: "isSubmenu",
          target: "opening"
        }
      }
    },
    "opening:contextmenu": {
      tags: ["closed"],
      effects: ["waitForLongPress"],
      on: {
        "CONTROLLED.OPEN": { target: "open" },
        "CONTROLLED.CLOSE": { target: "closed", actions: ["focusTrigger"] },
        CONTEXT_MENU_CANCEL: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose", "releaseParentRoutingLock", "focusTrigger"]
          }
        ],
        "LONG_PRESS.OPEN": [
          {
            guard: "isOpenControlled",
            actions: ["setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setTriggerValue", "invokeOnOpen"]
          }
        ]
      }
    },
    opening: {
      tags: ["closed"],
      effects: ["waitForOpenDelay"],
      on: {
        "CONTROLLED.OPEN": {
          target: "open"
        },
        "CONTROLLED.CLOSE": {
          target: "closed",
          actions: ["focusTrigger"]
        },
        BLUR: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose", "releaseParentRoutingLock", "focusTrigger"]
          }
        ],
        TRIGGER_POINTERLEAVE: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose", "releaseParentRoutingLock", "focusTrigger"]
          }
        ],
        "DELAY.OPEN": [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["invokeOnOpen"]
          }
        ]
      }
    },
    closing: {
      tags: ["open"],
      effects: ["trackPointerMove", "trackInteractOutside", "waitForCloseDelay"],
      on: {
        "CONTROLLED.OPEN": {
          target: "open"
        },
        "CONTROLLED.CLOSE": {
          target: "closed",
          actions: ["focusParentMenu", "restoreParentHighlightedItem"]
        },
        // don't invoke on open here since the menu is still open (we're only keeping it open)
        MENU_POINTERENTER: {
          target: "open",
          actions: ["clearIntentPolygon"]
        },
        POINTER_MOVED_AWAY_FROM_SUBMENU: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            target: "closed",
            actions: ["focusParentMenu", "restoreParentHighlightedItem"]
          }
        ],
        "DELAY.CLOSE": [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            target: "closed",
            actions: ["focusParentMenu", "restoreParentHighlightedItem", "invokeOnClose", "releaseParentRoutingLock"]
          }
        ]
      }
    },
    closed: {
      tags: ["closed"],
      entry: ["clearHighlightedItem", "unlockParentOnClose", "clearAnchorPoint"],
      on: {
        "CONTROLLED.OPEN": [
          {
            guard: or("isOpenAutoFocusEvent", "isArrowDownEvent"),
            target: "open",
            actions: ["highlightFirstItem"]
          },
          {
            guard: "isArrowUpEvent",
            target: "open",
            actions: ["highlightLastItem"]
          },
          {
            target: "open"
          }
        ],
        CONTEXT_MENU_START: {
          target: "opening:contextmenu",
          actions: ["setAnchorPoint", "setTriggerValue"]
        },
        CONTEXT_MENU: [
          {
            guard: "isOpenControlled",
            actions: ["setAnchorPoint", "setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setAnchorPoint", "setTriggerValue", "invokeOnOpen"]
          }
        ],
        TRIGGER_CLICK: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen", "setTriggerValue"]
          },
          {
            target: "open",
            actions: ["invokeOnOpen", "setTriggerValue"]
          }
        ],
        TRIGGER_POINTERMOVE: {
          guard: "isTriggerItem",
          target: "opening"
        },
        TRIGGER_BLUR: { target: "idle" },
        ARROW_DOWN: [
          {
            guard: "isOpenControlled",
            actions: ["setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setTriggerValue", "highlightFirstItem", "invokeOnOpen"]
          }
        ],
        ARROW_UP: [
          {
            guard: "isOpenControlled",
            actions: ["setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setTriggerValue", "highlightLastItem", "invokeOnOpen"]
          }
        ]
      }
    },
    open: {
      tags: ["open"],
      effects: ["trackInteractOutside", "trackFocusVisible", "trackPositioning", "scrollToHighlightedItem"],
      entry: ["focusMenu", "unlockParentOnOpen"],
      on: {
        "CONTROLLED.CLOSE": [
          {
            target: "closed",
            guard: "isArrowLeftEvent",
            actions: ["focusParentMenu"]
          },
          {
            target: "closed",
            actions: ["focusTrigger"]
          }
        ],
        TRIGGER_CLICK: [
          {
            guard: and(not("isTriggerItem"), "isOpenControlled"),
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            guard: not("isTriggerItem"),
            target: "closed",
            actions: ["invokeOnClose", "releaseParentRoutingLock", "focusTrigger"]
          }
        ],
        CONTEXT_MENU: {
          actions: ["setAnchorPoint", "setTriggerValue", "focusMenu"]
        },
        ARROW_UP: {
          actions: ["highlightPrevItem", "focusMenu"]
        },
        ARROW_DOWN: {
          actions: ["highlightNextItem", "focusMenu"]
        },
        ARROW_LEFT: [
          {
            guard: and("isSubmenu", "isOpenControlled"),
            actions: ["invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            guard: "isSubmenu",
            target: "closed",
            actions: ["focusParentMenu", "invokeOnClose", "releaseParentRoutingLock"]
          }
        ],
        HOME: {
          actions: ["highlightFirstItem", "focusMenu"]
        },
        END: {
          actions: ["highlightLastItem", "focusMenu"]
        },
        ARROW_RIGHT: {
          guard: "isTriggerItemHighlighted",
          actions: ["openSubmenu"]
        },
        ENTER: [
          {
            guard: "isTriggerItemHighlighted",
            actions: ["openSubmenu"]
          },
          {
            actions: ["clickHighlightedItem"]
          }
        ],
        ITEM_POINTERMOVE: [
          {
            guard: not("isPointerRoutingLocked"),
            actions: ["setHighlightedItem", "focusMenu", "closeSiblingMenus"]
          },
          {
            actions: ["setLastHighlightedItem", "closeSiblingMenus"]
          }
        ],
        ITEM_POINTERLEAVE: {
          guard: and(not("isPointerRoutingLocked"), not("isTriggerItem")),
          actions: ["clearHighlightedItem"]
        },
        ITEM_CLICK: [
          // == grouped ==
          {
            guard: and(
              not("isTriggerItemHighlighted"),
              not("isHighlightedItemEditable"),
              "closeOnSelect",
              "isOpenControlled"
            ),
            actions: ["invokeOnSelect", "setOptionState", "closeRootMenu", "invokeOnClose", "releaseParentRoutingLock"]
          },
          {
            guard: and(not("isTriggerItemHighlighted"), not("isHighlightedItemEditable"), "closeOnSelect"),
            target: "closed",
            actions: [
              "invokeOnSelect",
              "setOptionState",
              "closeRootMenu",
              "invokeOnClose",
              "releaseParentRoutingLock",
              "focusTrigger"
            ]
          },
          //
          {
            guard: and(not("isTriggerItemHighlighted"), not("isHighlightedItemEditable")),
            actions: ["invokeOnSelect", "setOptionState"]
          },
          { actions: ["setHighlightedItem"] }
        ],
        TRIGGER_POINTERMOVE: {
          guard: "isTriggerItem",
          actions: ["setIntentPolygon"]
        },
        TRIGGER_POINTERLEAVE: {
          target: "closing",
          actions: ["setIntentPolygon"]
        },
        ITEM_POINTERDOWN: {
          actions: ["setHighlightedItem"]
        },
        TYPEAHEAD: {
          actions: ["highlightMatchedItem"]
        },
        FOCUS_MENU: {
          actions: ["focusMenu"]
        },
        "POSITIONING.SET": {
          actions: ["reposition"]
        }
      }
    }
  },
  implementations: {
    guards: {
      closeOnSelect: ({ prop, event }) => !!(event?.closeOnSelect ?? prop("closeOnSelect")),
      // whether the trigger is also a menu item
      isTriggerItem: ({ event }) => isTriggerItem(event.target),
      // whether the trigger item is the active item
      isTriggerItemHighlighted: ({ event, scope, computed }) => {
        const target = event.target ?? scope.getById(computed("highlightedId"));
        return !!target?.hasAttribute("data-controls");
      },
      isSubmenu: ({ context }) => context.get("isSubmenu"),
      isPointerRoutingLocked: ({ refs }) => refs.get("pointerRoutingLocked"),
      isHighlightedItemEditable: ({ scope, computed }) => isEditableElement(scope.getById(computed("highlightedId"))),
      // guard assertions (for controlled mode)
      isOpenControlled: ({ prop }) => prop("open") !== void 0,
      isArrowLeftEvent: ({ event }) => event.previousEvent?.type === "ARROW_LEFT",
      isArrowUpEvent: ({ event }) => event.previousEvent?.type === "ARROW_UP",
      isArrowDownEvent: ({ event }) => event.previousEvent?.type === "ARROW_DOWN",
      isOpenAutoFocusEvent: ({ event }) => event.previousEvent?.type === "OPEN_AUTOFOCUS"
    },
    effects: {
      waitForOpenDelay({ send }) {
        const timer = setTimeout(() => {
          send({ type: "DELAY.OPEN" });
        }, 200);
        return () => clearTimeout(timer);
      },
      waitForCloseDelay({ send }) {
        const timer = setTimeout(() => {
          send({ type: "DELAY.CLOSE" });
        }, 100);
        return () => clearTimeout(timer);
      },
      waitForLongPress({ send }) {
        const timer = setTimeout(() => {
          send({ type: "LONG_PRESS.OPEN" });
        }, 700);
        return () => clearTimeout(timer);
      },
      trackFocusVisible({ scope }) {
        return trackFocusVisible({ root: scope.getRootNode?.() });
      },
      trackPositioning({ context, prop, scope, refs }) {
        const hasContextTrigger = getContextTriggerEl(scope) || getContextTriggerEls(scope).length > 0;
        if (hasContextTrigger) return;
        const positioning = {
          ...prop("positioning"),
          ...refs.get("positioningOverride")
        };
        context.set("currentPlacement", positioning.placement);
        const getPositionerEl2 = () => getPositionerEl(scope);
        const getTriggerEl2 = () => getActiveTriggerEl(scope, context.get("triggerValue"));
        return getPlacement(getTriggerEl2, getPositionerEl2, {
          ...positioning,
          defer: true,
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      trackInteractOutside({ refs, scope, prop, context, send }) {
        const getContentEl2 = () => getContentEl(scope);
        let restoreFocus = true;
        const isWithinAnyContextTrigger = (target) => {
          return getContextTriggerEls(scope).some((el) => contains(el, target));
        };
        return trackDismissableElement(getContentEl2, {
          type: "menu",
          defer: true,
          exclude: [getTriggerEl(scope), ...getTriggerEls(scope)].filter(Boolean),
          onInteractOutside: prop("onInteractOutside"),
          onRequestDismiss: prop("onRequestDismiss"),
          onFocusOutside(event) {
            prop("onFocusOutside")?.(event);
            const target = getEventTarget(event.detail.originalEvent);
            if (isWithinAnyContextTrigger(target)) {
              event.preventDefault();
              return;
            }
            if (isTargetWithinMenuTree(target, refs.get("children"))) {
              event.preventDefault();
              return;
            }
          },
          onEscapeKeyDown(event) {
            prop("onEscapeKeyDown")?.(event);
            if (context.get("isSubmenu")) event.preventDefault();
            closeRootMenu({ parent: refs.get("parent") });
          },
          onPointerDownOutside(event) {
            prop("onPointerDownOutside")?.(event);
            const target = getEventTarget(event.detail.originalEvent);
            if (isWithinAnyContextTrigger(target) && event.detail.contextmenu) {
              event.preventDefault();
              return;
            }
            restoreFocus = !event.detail.focusable;
          },
          onDismiss() {
            send({ type: "CLOSE", src: "interact-outside", restoreFocus });
          }
        });
      },
      trackPointerMove({ context, scope, send, refs }) {
        const parent = refs.get("parent");
        if (!parent) return;
        setParentRoutingLock(parent, true);
        const doc = scope.getDoc();
        return addDomEvent(doc, "pointermove", (e) => {
          const isMovingToSubmenu = isWithinPolygon(context.get("intentPolygon"), {
            x: e.clientX,
            y: e.clientY
          });
          if (!isMovingToSubmenu) {
            send({ type: "POINTER_MOVED_AWAY_FROM_SUBMENU" });
            setParentRoutingLock(parent, false);
          }
        });
      },
      scrollToHighlightedItem({ scope, computed }) {
        const exec = () => {
          const modality = getInteractionModality();
          if (modality === "pointer") return;
          const itemEl = scope.getById(computed("highlightedId"));
          const contentEl2 = getContentEl(scope);
          scrollIntoView(itemEl, { rootEl: contentEl2, block: "nearest" });
        };
        raf(() => {
          setInteractionModality("virtual");
          exec();
        });
        const contentEl = () => getContentEl(scope);
        return observeAttributes(contentEl, {
          defer: true,
          attributes: ["aria-activedescendant"],
          callback: exec
        });
      }
    },
    actions: {
      setAnchorPoint({ context, event }) {
        context.set("anchorPoint", (prev2) => isEqual(prev2, event.point) ? prev2 : event.point);
      },
      setSubmenuPlacement({ context, computed, refs }) {
        if (!context.get("isSubmenu")) return;
        const placement = computed("isRtl") ? "left-start" : "right-start";
        refs.set("positioningOverride", { placement, gutter: 0 });
      },
      reposition({ context, scope, prop, event, refs }) {
        const getPositionerEl2 = () => getPositionerEl(scope);
        const anchorPoint = event.point ?? context.get("anchorPoint");
        const getAnchorRect = anchorPoint ? () => ({ width: 0, height: 0, ...anchorPoint }) : void 0;
        const positioning = {
          ...prop("positioning"),
          ...refs.get("positioningOverride")
        };
        const triggerValue = event.value ?? context.get("triggerValue");
        const getTriggerEl2 = () => getActiveTriggerEl(scope, triggerValue);
        getPlacement(getTriggerEl2, getPositionerEl2, {
          ...positioning,
          defer: true,
          getAnchorRect,
          ...event.options ?? {},
          listeners: false,
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      setOptionState({ event }) {
        if (!event.option) return;
        const { checked, onCheckedChange, type } = event.option;
        if (type === "radio") {
          onCheckedChange?.(true);
        } else if (type === "checkbox") {
          onCheckedChange?.(!checked);
        }
      },
      clickHighlightedItem({ scope, computed, prop, context }) {
        const itemEl = scope.getById(computed("highlightedId"));
        if (!itemEl || itemEl.dataset.disabled) return;
        const highlightedValue = context.get("highlightedValue");
        if (isAnchorElement(itemEl)) {
          prop("navigate")?.({ value: highlightedValue, node: itemEl, href: itemEl.href });
        } else {
          queueMicrotask(() => itemEl.click());
        }
      },
      setIntentPolygon({ context, scope, event }) {
        const menu = getContentEl(scope);
        const placement = context.get("currentPlacement");
        if (!menu || !placement) return;
        const rect = menu.getBoundingClientRect();
        const polygon = getElementPolygon(rect, placement);
        if (!polygon) return;
        const rightSide = getPlacementSide(placement) === "right";
        const bleed = rightSide ? -5 : 5;
        context.set("intentPolygon", [{ ...event.point, x: event.point.x + bleed }, ...polygon]);
      },
      clearIntentPolygon({ context }) {
        context.set("intentPolygon", null);
      },
      clearAnchorPoint({ context }) {
        context.set("anchorPoint", null);
      },
      unlockParentOnOpen({ refs, context, scope }) {
        const parent = refs.get("parent");
        if (context.get("isSubmenu")) {
          const value = getTriggerId(scope);
          parent?.send({ type: "HIGHLIGHTED.SUGGEST", value });
        }
        setParentRoutingLock(parent, false);
      },
      unlockParentOnClose({ refs, context }) {
        unlockParentAfterChildClose(refs.get("parent"), context.get("isSubmenu"));
      },
      setHighlightedItem({ context, event }) {
        const value = event.value || getItemValue(event.target);
        context.set("highlightedValue", value);
      },
      clearHighlightedItem({ context }) {
        context.set("highlightedValue", null);
      },
      focusMenu({ scope }) {
        raf(() => {
          const contentEl = getContentEl(scope);
          const initialFocusEl = getInitialFocus({
            root: contentEl,
            enabled: !contains(contentEl, scope.getActiveElement()),
            filter(node) {
              return !node.role?.startsWith("menuitem");
            }
          });
          initialFocusEl?.focus({ preventScroll: true });
        });
      },
      highlightFirstItem({ context, scope }) {
        const fn = getContentEl(scope) ? queueMicrotask : raf;
        fn(() => {
          const first2 = getFirstEl(scope);
          if (!first2) return;
          context.set("highlightedValue", getItemValue(first2));
        });
      },
      highlightLastItem({ context, scope }) {
        const fn = getContentEl(scope) ? queueMicrotask : raf;
        fn(() => {
          const last2 = getLastEl(scope);
          if (!last2) return;
          context.set("highlightedValue", getItemValue(last2));
        });
      },
      highlightNextItem({ context, scope, event, prop }) {
        const next2 = getNextEl(scope, {
          loop: event.loop,
          value: context.get("highlightedValue"),
          loopFocus: prop("loopFocus")
        });
        context.set("highlightedValue", getItemValue(next2));
      },
      highlightPrevItem({ context, scope, event, prop }) {
        const prev2 = getPrevEl(scope, {
          loop: event.loop,
          value: context.get("highlightedValue"),
          loopFocus: prop("loopFocus")
        });
        context.set("highlightedValue", getItemValue(prev2));
      },
      invokeOnSelect({ context, prop, scope }) {
        const value = context.get("highlightedValue");
        if (value == null) return;
        const node = getItemEl(scope, value);
        dispatchSelectionEvent(node, value);
        prop("onSelect")?.({ value });
      },
      focusTrigger({ scope, context, event }) {
        if (context.get("isSubmenu") || context.get("anchorPoint") || event.restoreFocus === false) return;
        queueMicrotask(() => {
          const triggerEl = getActiveTriggerEl(scope, context.get("triggerValue"));
          triggerEl?.focus({ preventScroll: true });
        });
      },
      highlightMatchedItem({ scope, context, event, refs }) {
        const node = getElemByKey(scope, {
          key: event.key,
          value: context.get("highlightedValue"),
          typeaheadState: refs.get("typeaheadState")
        });
        if (!node) return;
        context.set("highlightedValue", getItemValue(node));
      },
      setParentMenu({ refs, event, context }) {
        refs.set("parent", event.value);
        context.set("isSubmenu", true);
      },
      setChildMenu({ refs, event }) {
        const children = refs.get("children");
        children[event.id] = event.value;
        refs.set("children", children);
      },
      closeSiblingMenus({ refs, event, scope }) {
        const target = event.target;
        if (!isTriggerItem(target)) return;
        const hoveredChildId = target?.getAttribute("data-uid");
        const children = refs.get("children");
        for (const id in children) {
          if (id === hoveredChildId) continue;
          const child = children[id];
          const intentPolygon = child.context.get("intentPolygon");
          if (intentPolygon && event.point && isPointInPolygon(intentPolygon, event.point)) {
            continue;
          }
          getContentEl(scope)?.focus({ preventScroll: true });
          child.send({ type: "CLOSE" });
        }
      },
      closeRootMenu({ refs }) {
        closeRootMenu({ parent: refs.get("parent") });
      },
      openSubmenu({ refs, scope, computed }) {
        const item = scope.getById(computed("highlightedId"));
        const id = item?.getAttribute("data-uid");
        const children = refs.get("children");
        const child = id ? children[id] : null;
        child?.send({ type: "OPEN_AUTOFOCUS" });
      },
      focusParentMenu({ refs }) {
        refs.get("parent")?.send({ type: "FOCUS_MENU" });
      },
      setLastHighlightedItem({ context, event }) {
        context.set("lastHighlightedValue", getItemValue(event.target));
      },
      suggestHighlightedItem({ context, event }) {
        const value = event.value;
        if (!value) return;
        if (context.get("highlightedValue") != null) {
          context.set("lastHighlightedValue", value);
          return;
        }
        context.set("highlightedValue", value);
      },
      restoreHighlightedItem({ context }) {
        const last2 = context.get("lastHighlightedValue");
        context.set("lastHighlightedValue", null);
        if (!last2) return;
        context.set("highlightedValue", last2);
      },
      restoreParentHighlightedItem({ refs }) {
        refs.get("parent")?.send({ type: "HIGHLIGHTED.RESTORE" });
      },
      invokeOnOpen({ prop }) {
        prop("onOpenChange")?.({ open: true });
      },
      invokeOnClose({ prop }) {
        prop("onOpenChange")?.({ open: false });
      },
      releaseParentRoutingLock({ refs, context }) {
        if (!context.get("isSubmenu")) return;
        unlockParentOnSubmenuClose(refs.get("parent"));
      },
      toggleVisibility({ prop, event, send }) {
        send({
          type: prop("open") ? "CONTROLLED.OPEN" : "CONTROLLED.CLOSE",
          previousEvent: event
        });
      },
      setTriggerValue({ context, event }) {
        if (event.value === void 0) return;
        context.set("triggerValue", event.value);
      }
    }
  }
});
export {
  VanillaMachine,
  connect,
  machine,
  mergeProps2 as mergeProps,
  normalizeProps,
  spreadProps
};

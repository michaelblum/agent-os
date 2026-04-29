export {
  LOCATOR_PRIORITY,
  LOCATOR_STRATEGY_VERSION,
  buildLocatorCandidates,
  canonicalizeBrowserAnnotation,
  canonicalizeBrowserMark,
  selectLocatorCandidate,
} from './canonicalize.js'
export {
  containedDescriptors,
  descriptorFromElement,
  elementsInsideRect,
} from './dom-crawl.js'
export { createBrowserIntentSensor } from './overlay.js'
export { installBrowserIntentSensor } from './install.js'

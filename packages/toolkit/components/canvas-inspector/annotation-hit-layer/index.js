import { declareManifest, emitReady } from '../../../runtime/manifest.js'

declareManifest({
  name: 'canvas-inspector-annotation-hit-layer',
  title: 'Annotation hit layer',
  accepts: [],
  emits: [],
})

emitReady()

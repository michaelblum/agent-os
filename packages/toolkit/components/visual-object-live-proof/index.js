import { createSlider } from '../../controls/slider.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import {
  createToolkitSliderVisualObjectDescriptor,
} from '../../workbench/visual-object-contract.js'
import { applyVisualObjectControllerUpdate } from '../../workbench/visual-object-controller.js'
import {
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../workbench/visual-object-resource-lifecycle.js'

const root = document.getElementById('root')
const state = { toolkit: { controls: { opacity: { value: 0.2 } } } }
const descriptor = createToolkitSliderVisualObjectDescriptor({
  id: 'toolkit-live-slider-opacity',
  label: 'Opacity',
  state_path: 'toolkit.controls.opacity.value',
  min: 0,
  max: 1,
  step: 0.05,
  object_ids: ['dom.aos-slider.live-opacity'],
})
const slider = createSlider({
  document,
  id: 'visual-object-live-opacity',
  label: 'Opacity',
  value: state.toolkit.controls.opacity.value,
  min: 0,
  max: 1,
  step: 0.05,
})

if (root) root.append(slider.el)

declareManifest({
  name: 'visual-object-live-proof',
  emits: ['ready'],
  surface: 'toolkit',
})

window.__visualObjectLiveProof = {
  runDomControlProof({
    editValues = ['0.35', '0.5', '0.65', '0.8', '0.55'],
  } = {}) {
    const beforeRoot = slider.el
    const startedAt = performance.now()
    let result = null
    for (const value of editValues) {
      result = applyVisualObjectControllerUpdate(descriptor, value, state, {
        routeHandlers: {
          'dom_toolkit.control.value.patch': ({ mutation }) => mutation.state_path,
        },
        rendererSyncHandlers: {
          syncDomControlValue: ({ mutation }) => slider.setValue(mutation.value),
        },
      })
    }
    const durationMs = performance.now() - startedAt
    const evidence = createVisualObjectResourceLifecycleEvidence({
      descriptor,
      updateResult: result,
      rendererSync: ['syncDomControlValue'],
      editCount: editValues.length,
      retainedResources: [beforeRoot],
      retainedResourceLimit: 1,
      identityStable: slider.el === beforeRoot,
      cleanupResult: {
        removed: false,
        reason: 'proof-surface-retained-for-canvas-cleanup',
      },
      poolingBoundary: {
        owner: 'toolkit-dom-control',
        decision: 'not-applicable',
        rationale: 'The live DOM slider proof retains the root control element and serializable state; it has no GPU material or geometry pool.',
      },
      proofWindow: {
        kind: 'live_dom_control_edit_loop',
        duration_ms: durationMs,
        iteration_limit: editValues.length,
      },
      jsonSerializableState: state,
    })
    return {
      ok: validateVisualObjectResourceLifecycleEvidence(evidence).ok,
      value: slider.getValue(),
      output: slider.el.querySelector('[data-aos-slider-output]')?.textContent || null,
      evidence,
    }
  },
}

emitReady()

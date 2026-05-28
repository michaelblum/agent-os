import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js';

export const STEP_DESCRIPTOR_WORKBENCH_SURFACE = 'step-descriptor-workbench-v0';
export const STEP_DESCRIPTOR_WORKBENCH_MANIFEST = 'step-descriptor-workbench';
export const STEP_DESCRIPTOR_WORKBENCH_URL = 'aos://toolkit/components/step-descriptor-workbench/index.html';

const REF_IDS = Object.freeze({
  root: 'root',
  stepDescriptor: 'step-descriptor',
  targetSummary: 'target-summary',
  gateRef: 'gate-ref',
  gateToken: 'gate-token',
  gateApply: 'gate-apply',
  gateStatus: 'gate-status',
  simulate: 'simulate',
  verifierStatus: 'verifier-status',
  diagnostics: 'diagnostics',
  workRecordSummary: 'work-record-summary',
  openWorkRecord: 'open-work-record',
});

function refPart(part) {
  return String(part || 'unknown').replace(/\s+/g, '-');
}

export function stepDescriptorWorkbenchAosRef(...parts) {
  return [STEP_DESCRIPTOR_WORKBENCH_SURFACE, ...parts].map(refPart).join(':');
}

export function stepDescriptorWorkbenchSemanticRefs() {
  return Object.fromEntries(
    Object.entries(REF_IDS).map(([key, value]) => [key, stepDescriptorWorkbenchAosRef(value)]),
  );
}

export function applyStepDescriptorWorkbenchSemanticTarget(element, target = {}) {
  if (!element) return null;
  return applySemanticTargetAttributes(element, {
    role: 'AXGroup',
    surface: STEP_DESCRIPTOR_WORKBENCH_SURFACE,
    aosRef: target.aosRef || stepDescriptorWorkbenchAosRef(target.id),
    ...target,
  }, {
    idPrefix: null,
  });
}

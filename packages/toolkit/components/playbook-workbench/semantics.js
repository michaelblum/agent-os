import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js';

export const PLAYBOOK_WORKBENCH_SURFACE = 'playbook-workbench-v0';
export const PLAYBOOK_WORKBENCH_URL = 'aos://toolkit/components/playbook-workbench/index.html';

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

export function playbookWorkbenchAosRef(...parts) {
  return [PLAYBOOK_WORKBENCH_SURFACE, ...parts].map(refPart).join(':');
}

export function playbookWorkbenchSemanticRefs() {
  return Object.fromEntries(
    Object.entries(REF_IDS).map(([key, value]) => [key, playbookWorkbenchAosRef(value)]),
  );
}

export function applyPlaybookWorkbenchSemanticTarget(element, target = {}) {
  if (!element) return null;
  return applySemanticTargetAttributes(element, {
    role: 'AXGroup',
    surface: PLAYBOOK_WORKBENCH_SURFACE,
    aosRef: target.aosRef || playbookWorkbenchAosRef(target.id),
    ...target,
  }, {
    idPrefix: null,
  });
}

import { SCHEMA_VERSION } from './core.mjs';
import { savedRefSupportedActionsForBackend } from './contracts.mjs';

function textValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export function refSummary(record) {
  return {
    ref: record.ref,
    action_target: record.action_target,
    copyable_action_target: record.copyable_action_target,
    backend: record.backend,
    resolution_class: record.resolution_class,
    confidence: record.confidence,
    supported_actions: record.supported_actions,
    target_summary: record.target_summary,
    warnings: record.warnings,
    known_limits: record.known_limits,
  };
}

export function queryMatches(record, query) {
  if (!query) return true;
  const needle = String(query).toLowerCase();
  const haystack = [
    record.ref,
    record.action_target,
    record.backend,
    record.resolution_class,
    record.confidence,
    record.target_summary,
    ...(record.supported_actions ?? []),
    JSON.stringify(record.hint_facts ?? {}),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function browserSessionFromTarget(target) {
  if (!target?.startsWith?.('browser:')) return null;
  const remainder = target.slice('browser:'.length);
  if (!remainder) return process.env.PLAYWRIGHT_CLI_SESSION || null;
  return remainder.split('/')[0] || null;
}

function browserActionsForElement(element) {
  const role = String(element.role || '').toLowerCase();
  if (['textbox', 'searchbox', 'combobox', 'input'].includes(role)) return ['click', 'fill', 'hover', 'scroll', 'drag', 'type', 'key'];
  if (['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab'].includes(role)) return ['click', 'hover', 'scroll', 'drag'];
  return ['click', 'hover', 'scroll', 'drag'];
}

function savedRefActions(actions, backend) {
  return [...new Set(savedRefSupportedActionsForBackend(backend, actions))];
}

export function generateRefRecords(capture, context) {
  const records = [];
  const artifactRefs = context.artifact_refs ?? [];
  const nextRef = () => `r${records.length + 1}`;
  const stateID = capture.state_id ?? null;

  for (const target of capture.semantic_targets ?? []) {
    const sourceRef = textValue(target.ref);
    const canvasID = textValue(target.provenance?.canvas_id);
    const actionTarget = textValue(target.provenance?.do_target, canvasID && sourceRef ? `canvas:${canvasID}/${sourceRef}` : null);
    const producerSupported = Array.isArray(target.actions) ? target.actions.filter(Boolean) : [];
    const supported = savedRefActions(producerSupported, 'aos_canvas');
    const record = {
      schema_version: SCHEMA_VERSION,
      ref: nextRef(),
      ref_scope: 'snapshot',
      workspace_id: context.workspace_id,
      snapshot_id: context.snapshot_id,
      copyable_action_target: `ref:${context.snapshot_id}:r${records.length + 1}`,
      short_action_target: `ref:r${records.length + 1}`,
      action_target: actionTarget,
      backend: 'aos_canvas',
      resolution_class: actionTarget ? 'reacquirable' : 'unsupported',
      confidence: actionTarget ? 'high' : 'low',
      supported_actions: supported,
      target_summary: [target.role, target.name, sourceRef].filter(Boolean).join(' ') || sourceRef || 'canvas target',
      identity_facts: {
        state_id: stateID,
        source_ref: sourceRef,
        target: target.target ?? null,
        canvas_id: canvasID,
        provenance: target.provenance ?? null,
        reacquisition: target.reacquisition ?? null,
      },
      hint_facts: {
        role: target.role ?? null,
        name: target.name ?? null,
        surface: target.surface ?? null,
        extension: target.extension ?? null,
      },
      current_address: {
        action_target: actionTarget,
        provenance: target.provenance ?? null,
      },
      artifact_refs: artifactRefs,
      warnings: producerSupported.length && supported.length === 0
        ? ['producer actions are present, but this saved-ref slice only supports canvas click and set-value mutation']
        : [],
      known_limits: [
        'canvas refs are re-read from the current canvas; missing, disabled, segmented, or ambiguous current targets fail closed',
      ],
    };
    records.push(record);
  }

  const browserSession = browserSessionFromTarget(context.target);
  for (const element of capture.elements ?? []) {
    if (!element.ref && !element.bounds) continue;
    const isBrowser = Boolean(browserSession && element.ref);
    const sourceRef = textValue(element.ref);
    const actionTarget = isBrowser ? `browser:${browserSession}/${sourceRef}` : null;
    const record = {
      schema_version: SCHEMA_VERSION,
      ref: nextRef(),
      ref_scope: 'snapshot',
      workspace_id: context.workspace_id,
      snapshot_id: context.snapshot_id,
      copyable_action_target: `ref:${context.snapshot_id}:r${records.length + 1}`,
      short_action_target: `ref:r${records.length + 1}`,
      action_target: actionTarget,
      backend: isBrowser ? 'browser' : 'native_ax',
      resolution_class: isBrowser ? 'snapshot_scoped' : 'volatile',
      confidence: isBrowser ? 'medium' : 'low',
      supported_actions: isBrowser ? savedRefActions(browserActionsForElement(element), 'browser') : [],
      target_summary: [element.role, element.title, element.label, element.value, sourceRef].filter(Boolean).join(' ') || 'element',
      identity_facts: {
        state_id: stateID,
        source_ref: sourceRef,
        context_path: element.context_path ?? [],
      },
      hint_facts: {
        role: element.role ?? null,
        title: element.title ?? null,
        label: element.label ?? null,
        value: element.value ?? null,
      },
      current_address: {
        action_target: actionTarget,
        bounds: element.bounds ?? null,
      },
      artifact_refs: artifactRefs,
      warnings: isBrowser
        ? ['browser refs are snapshot-scoped; real mutation fails closed until page/frame/navigation identity is persisted; dry-run includes advisory current xray validation']
        : ['native AX element refs are inspection-only; saved-ref actions do not claim no-foreground safety'],
      known_limits: isBrowser
        ? ['navigation or DOM replacement can stale a browser ref; saved-ref real mutation returns REF_REVALIDATION_REQUIRED even when advisory xray validation matches role/title/label/context']
        : [
            'AX titles, labels, bounds, and context paths are hints, not durable identity',
            'native AX saved-ref mutation is disabled until durable AX identity and no-foreground validation are implemented',
            'use direct AX commands only when the caller accepts current AX matching semantics; saved refs fail closed',
          ],
    };
    records.push(record);
  }

  return records;
}

export function omittedPayloads(capture) {
  const omitted = [];
  if (capture.elements) omitted.push('elements');
  if (capture.semantic_targets) omitted.push('semantic_targets');
  if (capture.annotations) omitted.push('annotations');
  if (capture.perceptions) omitted.push('perceptions');
  if (capture.base64_artifacts) omitted.push('base64');
  return omitted;
}

import { SCHEMA_VERSION } from './core.mjs';
import {
  nativeAxSavedRefHasRequiredIdentity,
  nativeAxSavedRefHasBlockingKnownLimit,
  nativeAxSavedRefBlockedKnownLimitReasons,
  nativeAxSavedRefMissingIdentityFacts,
  nativeAxNoForegroundConformance,
  notApplicableNoForegroundConformance,
  savedRefActionKnownLimit,
  savedRefProofStory,
  savedRefProducerActionsForBrowserElement,
  savedRefSupportedActionsForBackend,
} from './contracts.mjs';

function textValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function contextPathValue(contextPath, prefix) {
  if (!Array.isArray(contextPath)) return null;
  const marker = `${prefix}:`;
  for (const item of contextPath) {
    const text = textValue(item);
    if (text?.startsWith(marker)) return textValue(text.slice(marker.length));
  }
  return null;
}

function arrayValue(...values) {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value].filter(Boolean);
  }
  return [];
}

function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function nativeAXActionsForElement(element) {
  const actionNames = arrayValue(element.action_names, element.actionNames);
  return [...new Set(actionNames.flatMap((action) => {
    switch (String(action)) {
      case 'AXPress':
        return ['press'];
      case 'AXSetValue':
        return ['set-value'];
      case 'AXFocus':
        return ['focus'];
      default:
        return [];
    }
  }))];
}

function nativeAXActionTarget(facts) {
  const target = textValue(facts.ax_identifier);
  if (!facts.app_pid || !target) return null;
  return `native_ax:${facts.app_pid}/${target}`;
}

export function refSummary(record) {
  return {
    ref: record.ref,
    ref_scope: record.ref_scope,
    workspace_id: record.workspace_id,
    snapshot_id: record.snapshot_id,
    capture_target: record.capture_target,
    capture_source: record.capture_source,
    capture_mode: record.capture_mode,
    action_target: record.action_target,
    copyable_action_target: record.copyable_action_target,
    backend: record.backend,
    resolution_class: record.resolution_class,
    confidence: record.confidence,
    supported_actions: record.supported_actions,
    target_summary: record.target_summary,
    identity_facts: record.identity_facts,
    hint_facts: record.hint_facts,
    current_address: record.current_address,
    artifact_refs: record.artifact_refs,
    conformance: record.conformance,
    warnings: record.warnings,
    known_limits: record.known_limits,
  };
}

function searchableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(searchableValue).join(' ');
  if (typeof value === 'object') return Object.values(value).map(searchableValue).join(' ');
  return String(value);
}

export function queryMatches(record, query) {
  if (!query) return true;
  const needle = String(query).toLowerCase();
  const haystack = [
    record.ref,
    record.ref_scope,
    record.workspace_id,
    record.snapshot_id,
    record.capture_target,
    searchableValue(record.capture_source),
    record.capture_mode,
    record.action_target,
    record.copyable_action_target,
    record.short_action_target,
    record.backend,
    record.resolution_class,
    record.confidence,
    record.target_summary,
    ...(record.supported_actions ?? []),
    searchableValue(record.identity_facts),
    searchableValue(record.hint_facts),
    searchableValue(record.current_address),
    searchableValue(record.artifact_refs),
    searchableValue(record.conformance),
    ...(record.warnings ?? []),
    ...(record.known_limits ?? []),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function browserSessionFromTarget(target) {
  if (!target?.startsWith?.('browser:')) return null;
  const remainder = target.slice('browser:'.length);
  if (!remainder) return process.env.PLAYWRIGHT_CLI_SESSION || null;
  return remainder.split('/')[0] || null;
}

function savedRefActions(actions, backend) {
  return [...new Set(savedRefSupportedActionsForBackend(backend, actions))];
}

function targetUncertainty(status, reasons, missingIdentityFacts = [], availableIdentityFacts = []) {
  return {
    status,
    reasons,
    missing_identity_facts: missingIdentityFacts,
    available_identity_facts: availableIdentityFacts,
  };
}

function availableIdentityFacts(facts) {
  return Object.entries(facts)
    .filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return String(value).length > 0;
    })
    .map(([key]) => key);
}

function savedRefConformance(backend, resolutionClass, supportedActions, facts = {}) {
  const hasMutation = supportedActions.length > 0;
  const nativeNoForeground = backend === 'native_ax'
    ? nativeAxNoForegroundConformance({ permissionState: facts.permission_state ?? 'unknown' })
    : notApplicableNoForegroundConformance();
  const proof = savedRefProofStory(backend, resolutionClass, hasMutation);
  const nativeBlockedKnownLimitReasons = backend === 'native_ax'
    ? nativeAxSavedRefBlockedKnownLimitReasons(facts)
    : [];

  if (resolutionClass === 'coordinate_fallback') {
    return {
      actionability: 'diagnostic_fallback_refused',
      mutation: 'refused',
      validation: 'coordinate_fallback_refused_before_dispatch',
      proof_level: 'known_limit_contract',
      proof,
      no_foreground: nativeNoForeground,
      target_uncertainty: targetUncertainty(
        'blocked_coordinate_fallback',
        ['coordinate fallback refs are diagnostic-only and refused before dispatch'],
        [],
        availableIdentityFacts(facts),
      ),
    };
  }

  if (backend === 'native_ax') {
    const hasRequiredNativeIdentity = nativeAxSavedRefHasRequiredIdentity(facts);
    const missingNativeIdentityFacts = nativeAxSavedRefMissingIdentityFacts(facts);
    if (hasRequiredNativeIdentity && nativeBlockedKnownLimitReasons.length > 0) {
      return {
        actionability: 'inspection_only',
        mutation: 'unsupported',
        validation: 'native_known_limit_blocked',
        proof_level: 'known_limit_contract',
        proof,
        no_foreground: nativeNoForeground,
        target_uncertainty: targetUncertainty(
          'blocked_native_known_limit',
          nativeBlockedKnownLimitReasons,
          [],
          availableIdentityFacts(facts),
        ),
      };
    }

    if (hasMutation && hasRequiredNativeIdentity) {
      return {
        actionability: 'direct_ax_saved_ref_mutation',
        mutation: 'supported_after_direct_ax_current_matching',
        validation: 'durable_native_identity_facts_plus_direct_ax_current_matching_semantics',
        proof_level: 'native_saved_ref_contract_tests_plus_approval_gates',
        proof,
        no_foreground: nativeNoForeground,
        target_uncertainty: targetUncertainty(
          'requires_direct_ax_current_matching',
          [
            'saved native AX ref has durable pid/window/AX identifier/enabled-state/action/permission/baseline facts plus an actionable native producer verdict',
            'stable path evidence is preserved for inspection, but v0 direct AX dispatch requires an actual AX identifier selector',
            'mutation routes through direct AX current matching semantics and still does not claim no-foreground proof',
          ],
          [],
          availableIdentityFacts(facts),
        ),
      };
    }

    if (hasRequiredNativeIdentity) {
      return {
        actionability: 'inspection_only',
        mutation: 'unsupported',
        validation: 'native_action_matrix_unsupported',
        proof_level: 'known_limit_contract',
        proof,
        no_foreground: nativeNoForeground,
        target_uncertainty: targetUncertainty(
          'blocked_unsupported_native_action',
          ['native AX durable identity facts are present, but captured action_names do not map to v0 saved-ref actions'],
          [],
          availableIdentityFacts(facts),
        ),
      };
    }

    return {
      actionability: 'inspection_only',
      mutation: 'unsupported',
      validation: 'native_durable_identity_facts_missing',
      proof_level: 'known_limit_contract',
      proof,
      no_foreground: nativeNoForeground,
      target_uncertainty: targetUncertainty(
        'blocked_missing_native_identity',
        [
          ...(missingNativeIdentityFacts.includes('native_saved_ref_evidence')
            ? ['native producer did not emit an actionable saved-ref evidence verdict']
            : []),
          'native AX snapshot facts are hints, not durable identity',
        ],
        missingNativeIdentityFacts,
        availableIdentityFacts(facts),
      ),
    };
  }

  if (!hasMutation || resolutionClass === 'unsupported') {
    return {
      actionability: 'unsupported',
      mutation: 'unsupported',
      validation: 'none',
      proof_level: 'known_limit_contract',
      proof,
      no_foreground: nativeNoForeground,
      target_uncertainty: targetUncertainty(
        'blocked_unsupported',
        ['ref has no supported saved-ref action in this action matrix'],
        [],
        availableIdentityFacts(facts),
      ),
    };
  }

  if (backend === 'browser' && hasMutation) {
    return {
      actionability: 'validated_saved_ref_mutation',
      mutation: 'supported_after_validation',
      validation: 'browser_page_frame_navigation_and_element_revalidation',
      proof_level: 'deterministic_contract_tests',
      proof,
      no_foreground: nativeNoForeground,
      target_uncertainty: targetUncertainty(
        'requires_current_validation',
        ['snapshot-scoped browser refs require fresh page/frame/navigation and element validation before mutation'],
        [],
        availableIdentityFacts(facts),
      ),
    };
  }

  if (backend === 'aos_canvas' && hasMutation) {
    return {
      actionability: 'reacquirable_saved_ref_mutation',
      mutation: 'supported_after_current_resolution',
      validation: 'current_canvas_target_resolution',
      proof_level: 'deterministic_contract_tests',
      proof,
      no_foreground: nativeNoForeground,
      target_uncertainty: targetUncertainty(
        'requires_current_resolution',
        ['AOS canvas refs require current canvas target resolution before mutation'],
        [],
        availableIdentityFacts(facts),
      ),
    };
  }

  return {
    actionability: 'unsupported',
    mutation: 'unsupported',
    validation: 'none',
    proof_level: 'known_limit_contract',
    proof,
    no_foreground: nativeNoForeground,
    target_uncertainty: targetUncertainty(
      'blocked_unsupported',
      ['ref is unsupported by the saved-ref action matrix'],
      [],
      availableIdentityFacts(facts),
    ),
  };
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
    const identityFacts = {
      state_id: stateID,
      source_ref: sourceRef,
      target: target.target ?? null,
      canvas_id: canvasID,
      provenance: target.provenance ?? null,
      reacquisition: target.reacquisition ?? null,
    };
    const record = {
      schema_version: SCHEMA_VERSION,
      ref: nextRef(),
      ref_scope: 'snapshot',
      workspace_id: context.workspace_id,
      snapshot_id: context.snapshot_id,
      capture_target: context.capture_target ?? context.target,
      capture_source: context.capture_source,
      capture_mode: context.capture_mode,
      query: context.query ?? null,
      copyable_action_target: `ref:${context.snapshot_id}:r${records.length + 1}`,
      short_action_target: `ref:r${records.length + 1}`,
      action_target: actionTarget,
      backend: 'aos_canvas',
      resolution_class: actionTarget ? 'reacquirable' : 'unsupported',
      confidence: actionTarget ? 'high' : 'low',
      supported_actions: supported,
      target_summary: [target.role, target.name, sourceRef].filter(Boolean).join(' ') || sourceRef || 'canvas target',
      identity_facts: identityFacts,
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
      conformance: savedRefConformance('aos_canvas', actionTarget ? 'reacquirable' : 'unsupported', supported, identityFacts),
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
  const browserIdentity = context.browser_identity ?? null;
  for (const element of capture.elements ?? []) {
    if (!element.ref && !element.bounds) continue;
    const isBrowser = Boolean(browserSession && element.ref);
    const sourceRef = textValue(element.ref);
    const browserKnownLimit = isBrowser ? savedRefActionKnownLimit('click', 'browser') : null;
    const contextPath = Array.isArray(element.context_path) ? element.context_path : [];
    const identityFacts = {
      state_id: stateID,
      session: isBrowser ? browserSession : null,
      source_ref: sourceRef,
      app_pid: isBrowser ? null : numberValue(element.app_pid, element.pid),
      app_name: isBrowser ? null : textValue(element.app_name, element.app),
      window_id: isBrowser ? null : numberValue(element.window_id, element.windowID),
      role: element.role ?? null,
      title: element.title ?? null,
      label: element.label ?? null,
      value: element.value ?? null,
      enabled: element.enabled ?? null,
      focused: isBrowser ? null : (element.focused ?? null),
      context_path: contextPath,
      app_hint: isBrowser ? null : textValue(element.app_name, element.app, contextPathValue(contextPath, 'app')),
      window_hint: isBrowser ? null : contextPathValue(contextPath, 'window'),
      ax_identifier: isBrowser ? null : textValue(element.ax_identifier, element.identifier),
      stable_path: isBrowser ? null : textValue(element.stable_path, element.ax_path),
      ax_identifier_or_stable_path: isBrowser ? null : textValue(element.ax_identifier, element.identifier, element.stable_path, element.ax_path),
      action_names: isBrowser ? [] : arrayValue(element.action_names, element.actionNames),
      permission_state: isBrowser ? null : textValue(element.permission_state),
      focus_cursor_space_baseline: isBrowser ? null : (element.focus_cursor_space_baseline ?? null),
      native_saved_ref_evidence: isBrowser ? null : (element.native_saved_ref_evidence ?? element.nativeSavedRefEvidence ?? null),
      window_state: isBrowser ? null : textValue(element.window_state),
      space_state: isBrowser ? null : textValue(element.space_state),
      control_kind: isBrowser ? null : textValue(element.control_kind, element.native_control_kind),
      surface_kind: isBrowser ? null : textValue(element.surface_kind),
      focus_state: isBrowser ? null : textValue(element.focus_state),
      minimized: isBrowser ? null : (element.minimized ?? null),
      off_space: isBrowser ? null : (element.off_space ?? null),
      custom_control: isBrowser ? null : (element.custom_control ?? null),
      canvas_surface: isBrowser ? null : (element.canvas_surface ?? null),
      bounds: element.bounds ?? null,
      page_url: isBrowser ? (browserIdentity?.page_url ?? null) : null,
      document_title: isBrowser ? (browserIdentity?.document_title ?? null) : null,
      frame_url: isBrowser ? (browserIdentity?.frame_url ?? null) : null,
      top_frame_url: isBrowser ? (browserIdentity?.top_frame_url ?? null) : null,
    };
    const nativeBlockedKnownLimit = !isBrowser && nativeAxSavedRefHasBlockingKnownLimit(identityFacts);
    const nativeKnownLimitReasons = !isBrowser ? nativeAxSavedRefBlockedKnownLimitReasons(identityFacts) : [];
    const nativeActionable = !isBrowser && nativeAxSavedRefHasRequiredIdentity(identityFacts) && !nativeBlockedKnownLimit;
    const nativeProducerActions = !isBrowser ? nativeAXActionsForElement(element) : [];
    const supported = isBrowser
      ? savedRefProducerActionsForBrowserElement(element)
      : nativeActionable
        ? savedRefActions(nativeProducerActions, 'native_ax')
        : [];
    const nativeSavedRefActionable = nativeActionable && supported.length > 0;
    const actionTarget = isBrowser
      ? `browser:${browserSession}/${sourceRef}`
      : nativeSavedRefActionable
        ? nativeAXActionTarget(identityFacts)
        : null;
    const record = {
      schema_version: SCHEMA_VERSION,
      ref: nextRef(),
      ref_scope: 'snapshot',
      workspace_id: context.workspace_id,
      snapshot_id: context.snapshot_id,
      capture_target: context.capture_target ?? context.target,
      capture_source: context.capture_source,
      capture_mode: context.capture_mode,
      query: context.query ?? null,
      copyable_action_target: `ref:${context.snapshot_id}:r${records.length + 1}`,
      short_action_target: `ref:r${records.length + 1}`,
      action_target: actionTarget,
      backend: isBrowser ? 'browser' : 'native_ax',
      resolution_class: isBrowser ? 'snapshot_scoped' : nativeSavedRefActionable ? 'stable' : 'volatile',
      confidence: isBrowser ? 'medium' : nativeSavedRefActionable ? 'medium' : 'low',
      supported_actions: supported,
      target_summary: [element.role, element.title, element.label, element.value, sourceRef].filter(Boolean).join(' ') || 'element',
      identity_facts: identityFacts,
      hint_facts: {
        role: element.role ?? null,
        title: element.title ?? null,
        label: element.label ?? null,
        value: element.value ?? null,
        enabled: element.enabled ?? null,
      },
      current_address: {
        action_target: actionTarget,
        bounds: element.bounds ?? null,
        browser_identity: isBrowser ? browserIdentity : null,
        direct_ax_args: isBrowser || !nativeActionable ? null : {
          app_pid: identityFacts.app_pid,
          role: identityFacts.role,
          title: identityFacts.title,
          label: identityFacts.label,
          ax_identifier: identityFacts.ax_identifier,
          stable_path: identityFacts.stable_path,
          window_id: identityFacts.window_id,
        },
      },
      artifact_refs: artifactRefs,
      conformance: savedRefConformance(
        isBrowser ? 'browser' : 'native_ax',
        isBrowser ? 'snapshot_scoped' : nativeSavedRefActionable ? 'stable' : 'volatile',
        supported,
        identityFacts,
      ),
      warnings: isBrowser
        ? ['browser refs are snapshot-scoped; real mutation dispatches only after fresh page/frame/navigation and element validation passes']
        : nativeSavedRefActionable
          ? ['native AX saved-ref actions route through direct AX current matching and do not claim no-foreground safety']
          : nativeBlockedKnownLimit
            ? ['native AX element ref is blocked by captured native known-limit state; saved-ref actions fail closed']
            : nativeActionable
            ? ['native AX element refs have durable identity facts but no v0 supported saved-ref action; saved-ref actions fail closed']
            : ['native AX element refs are inspection-only; saved-ref actions do not claim no-foreground safety'],
      known_limits: isBrowser
        ? [browserKnownLimit].filter(Boolean)
        : nativeSavedRefActionable
          ? [
              'native AX saved-ref mutation uses direct AX current matching semantics and may fail if the target is missing, ambiguous, or changed',
              'live native AX dispatch is proven for stable saved refs, but no foreground, focus, cursor, or Space preservation guarantee is claimed',
              'fresh capture is recommended after native saved-ref mutation',
            ]
          : nativeActionable
            ? [
                'native AX durable identity facts and native producer verdict are present, but captured action_names do not map to v0 saved-ref actions',
                'no saved-ref mutation or no-foreground proof is claimed for unsupported native action names',
                'use direct AX commands only when the caller accepts current AX matching semantics; saved refs fail closed',
              ]
          : nativeBlockedKnownLimit
            ? [
                ...nativeKnownLimitReasons,
                'native AX saved refs fail closed for captured off-Space, minimized-window, custom-control, canvas/game-surface, or focus-mismatch states until live proof supports them',
              ]
          : [
              'AX titles, labels, bounds, and context paths are hints, not durable identity',
              'native AX saved-ref mutation is disabled when required durable AX identity facts or the actionable native producer verdict are missing; no saved-action no-foreground proof is claimed',
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

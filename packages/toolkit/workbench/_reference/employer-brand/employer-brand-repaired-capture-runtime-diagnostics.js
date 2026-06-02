import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan,
} from './employer-brand-live-evidence-capture-repair-promotion.js';

export const EMPLOYER_BRAND_REPAIRED_CAPTURE_RUNTIME_DIAGNOSTICS_TYPE =
  'aos.employer_brand_repaired_capture_runtime_diagnostics';
export const EMPLOYER_BRAND_REPAIRED_CAPTURE_RUNTIME_DIAGNOSTICS_SCHEMA_VERSION =
  '2026-05-employer-brand-repaired-capture-runtime-diagnostics-v0';

const DEFAULT_FIXTURE_ROOT = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const DEFAULT_MANIFEST_PATH = 'source-artifacts/live-evidence-element-clip-manifest.json';
const DEFAULT_CAPTURE_PLAN_PATH = 'live-evidence-repaired-locator-capture-plan.json';
const DEFAULT_OUT_PATH = 'live-evidence-repaired-capture-runtime-diagnostics.json';
const DEFAULT_CAPTURE_SCRIPT_PATH = 'scripts/employer-brand-repaired-live-element-capture.mjs';
const RUNTIME_FAILURE_NEXT_ACTION = 'retry_after_runtime_repair';
const NON_RUNTIME_REVIEW_NEXT_ACTION = 'requires_non_runtime_review';

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function repairCommandForPlaywrightBrowser(missingExecutablePath) {
  return String(missingExecutablePath || '').includes('chromium_headless_shell')
    ? 'playwright install chromium-headless-shell'
    : 'playwright install chromium';
}

function extractMissingPlaywrightExecutablePath(message) {
  const match = String(message || '').match(/Executable doesn't exist at ([^\n\r╔]+)/);
  return match ? match[1].trim() : null;
}

function playwrightCachePathFromExecutable(executablePath) {
  const marker = `${path.sep}ms-playwright${path.sep}`;
  const index = String(executablePath || '').indexOf(marker);
  if (index < 0) return null;
  const afterMarker = executablePath.slice(index + marker.length);
  const cacheEntry = afterMarker.split(path.sep)[0];
  return cacheEntry ? executablePath.slice(0, index + marker.length + cacheEntry.length) : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function runtimeFailureKind(entry) {
  const reason = text(entry.blocker_reason);
  if (/capture_command_failed|approved_url_open_failed|capture_preflight_/i.test(reason)) {
    return 'runtime_capture_invocation_failure';
  }
  if (/reviewed_locator_matches_zero_elements|locator/i.test(reason)) {
    return 'locator_failure';
  }
  if (/login|sign.?in|paywall|captcha|consent|blocked|not_visible|ambiguous/i.test(reason)) {
    return 'content_or_access_blocker';
  }
  return 'unknown_failure';
}

function stableFailedCommandSurface(metadata) {
  const command = metadata.backend_command || 'playwright-cli';
  const surface = metadata.failed_command_surface || `${command} run-code`;
  if (/\brun-code\b/.test(surface)) return `${command} run-code`;
  if (/\s--help\b/.test(surface)) return `${command} --help`;
  if (/\bopen\b/.test(surface)) return `${command} open`;
  return surface;
}

function parseRuntimeError(entry, {
  timeoutMs = 45_000,
  workingDirectory = 'repo_root',
} = {}) {
  const metadata = objectValue(entry.capture_metadata);
  const reason = text(entry.blocker_reason);
  const timeoutMatch = reason.match(/\bETIMEDOUT\b/i);
  const missingBrowserExecutablePath = metadata.environment_assumptions?.missing_browser_executable_path
    || metadata.missing_browser_executable_path
    || extractMissingPlaywrightExecutablePath(reason)
    || null;
  const browserCachePath = metadata.environment_assumptions?.browser_cache_path
    || metadata.browser_cache_path
    || playwrightCachePathFromExecutable(missingBrowserExecutablePath)
    || null;
  const repairCommand = metadata.environment_assumptions?.repair_command
    || metadata.repair_command
    || (missingBrowserExecutablePath ? repairCommandForPlaywrightBrowser(missingBrowserExecutablePath) : null);
  return {
    reason,
    kind: runtimeFailureKind(entry),
    runner_type: metadata.runner_type || metadata.backend || 'playwright-cli',
    command: metadata.backend_command || 'playwright-cli',
    failed_command_surface: stableFailedCommandSurface(metadata),
    execution_phase: metadata.execution_phase || null,
    failed_phase: metadata.failed_phase || metadata.execution_phase || null,
    started_phases: Array.isArray(metadata.started_phases) ? cloneJson(metadata.started_phases) : [],
    completed_phases: Array.isArray(metadata.completed_phases) ? cloneJson(metadata.completed_phases) : [],
    phase_timings_ms: objectValue(metadata.phase_timings_ms),
    phase_timeout_ms: Number.isFinite(metadata.phase_timeout_ms) ? metadata.phase_timeout_ms : null,
    tool_path: metadata.tool_path || null,
    timeout_ms: Number.isFinite(metadata.timeout_ms) ? metadata.timeout_ms : timeoutMs,
    timed_out: metadata.timed_out === true || Boolean(timeoutMatch),
    exit_status: Number.isFinite(metadata.exit_status) ? metadata.exit_status : null,
    exit_signal: timeoutMatch ? 'ETIMEDOUT' : (metadata.exit_signal || null),
    error_code: metadata.error_code || (timeoutMatch ? 'ETIMEDOUT' : null),
    stdout_snippet: nullableText(metadata.stdout_snippet),
    stderr_snippet: nullableText(metadata.stderr_snippet),
    working_directory: workingDirectory,
    retry_recommendation: metadata.retry_recommendation || repairCommand || RUNTIME_FAILURE_NEXT_ACTION,
    environment_assumptions: {
      browser_readiness_check: metadata.environment_assumptions?.browser_readiness_check === true
        || metadata.browser_readiness_check === true,
      missing_browser_executable_path: missingBrowserExecutablePath,
      browser_cache_path: browserCachePath,
      repair_command: repairCommand,
    },
  };
}

function plannedPathNull(entry, fieldName) {
  return entry[fieldName] === null;
}

function slotDiagnostic(entry, options = {}) {
  const runtime = parseRuntimeError(entry, options);
  const isRuntimeFailure = runtime.kind === 'runtime_capture_invocation_failure';
  return {
    slot_id: entry.slot_id,
    target_id: entry.target_id,
    work_unit_id: entry.work_unit_id,
    company: entry.company,
    source_category: entry.source_category,
    original_url: entry.original_url,
    final_url: entry.final_url,
    reviewed_locator: cloneJson(entry.reviewed_locator),
    locator_provenance: cloneJson(entry.locator_provenance),
    status: entry.status,
    failure_classification: runtime.kind,
    locator_failure: runtime.kind === 'locator_failure',
    content_failure: runtime.kind === 'content_or_access_blocker',
    runtime_capture_invocation_failure: isRuntimeFailure,
    blocker_reason: entry.blocker_reason,
    required_next_action: isRuntimeFailure
      ? RUNTIME_FAILURE_NEXT_ACTION
      : entry.required_next_action,
    retry_eligibility: isRuntimeFailure
      ? RUNTIME_FAILURE_NEXT_ACTION
      : NON_RUNTIME_REVIEW_NEXT_ACTION,
    clip_path: entry.clip_path,
    text_extract_path: entry.text_extract_path,
    text_extract_content: entry.text_extract_content,
    planned_clip_path: entry.capture_metadata?.clip_path_planned || null,
    planned_text_extract_path: entry.capture_metadata?.text_extract_path_planned || null,
    full_page_grab: entry.full_page_grab,
    runtime,
  };
}

function contextDiagnostic(entry) {
  return {
    slot_id: entry.slot_id || null,
    target_id: entry.target_id,
    work_unit_id: entry.work_unit_id,
    company: entry.company,
    source_category: entry.source_category,
    status: entry.status,
    blocker_reason: entry.blocker_reason,
    required_next_action: entry.required_next_action || null,
    clip_path: entry.clip_path,
    text_extract_path: entry.text_extract_path,
    full_page_grab: entry.full_page_grab,
    context_kind: entry.target_id === 'live-target:symphony-talent:linkedin-presence'
      ? 'source_unavailable'
      : 'non_executable_context',
  };
}

export function normalizeEmployerBrandRepairedCaptureRuntimeDiagnostics(input = {}) {
  const manifest = objectValue(input.manifest);
  const capturePlan = normalizeEmployerBrandLiveEvidenceRepairedLocatorCapturePlan(input.capturePlan || {});
  const entries = arrayValue(manifest.entries);
  const failedEntries = entries.filter((entry) => entry.status === 'failed');
  const contextEntries = entries.filter((entry) => entry.status === 'blocked_not_run');
  const runtimeFailures = failedEntries.filter((entry) => runtimeFailureKind(entry) === 'runtime_capture_invocation_failure');
  const locatorFailures = failedEntries.filter((entry) => runtimeFailureKind(entry) === 'locator_failure');
  const contentFailures = failedEntries.filter((entry) => runtimeFailureKind(entry) === 'content_or_access_blocker');
  const linkedInUnavailable = contextEntries.filter((entry) => entry.target_id === 'live-target:symphony-talent:linkedin-presence');
  const nonExecutableContext = contextEntries.filter((entry) => entry.target_id !== 'live-target:symphony-talent:linkedin-presence');
  const captureScriptPath = input.captureScriptPath || DEFAULT_CAPTURE_SCRIPT_PATH;
  const timeoutMs = Number.isFinite(input.timeoutMs) ? input.timeoutMs : 45_000;
  const workingDirectory = input.workingDirectory || 'repo_root';
  const manifestPath = input.manifestPath || DEFAULT_MANIFEST_PATH;
  const capturePlanPath = input.capturePlanPath || DEFAULT_CAPTURE_PLAN_PATH;
  const diagnosticsPath = input.diagnosticsPath || DEFAULT_OUT_PATH;
  const createdAt = input.createdAt || manifest.provenance?.created_at || new Date().toISOString();
  const commandSurfaces = unique(runtimeFailures.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).failed_command_surface));
  const runtimeSourceEntries = runtimeFailures.length > 0 ? runtimeFailures : failedEntries;

  return {
    type: EMPLOYER_BRAND_REPAIRED_CAPTURE_RUNTIME_DIAGNOSTICS_TYPE,
    schema_version: EMPLOYER_BRAND_REPAIRED_CAPTURE_RUNTIME_DIAGNOSTICS_SCHEMA_VERSION,
    id: 'live-evidence-repaired-capture-runtime-diagnostics:symphony-talent-phenom-radancy',
    label: 'Employer Brand Repaired Capture Runtime Diagnostics',
    status: runtimeFailures.length > 0
      ? 'runtime_repair_required'
      : (failedEntries.length > 0 ? 'non_runtime_capture_blockers_detected' : 'no_runtime_failure_detected'),
    source_refs: {
      manifest_id: manifest.id || null,
      manifest_path: manifestPath,
      manifest_schema: 'shared/schemas/employer-brand-live-evidence-element-clip-manifest-v0.schema.json',
      repaired_locator_capture_plan_id: capturePlan.id || null,
      repaired_locator_capture_plan_path: capturePlanPath,
      repaired_locator_capture_plan_schema: 'shared/schemas/employer-brand-live-evidence-repaired-locator-capture-plan-v0.schema.json',
      capture_script_path: captureScriptPath,
    },
    summary: {
      repaired_executable_slot_count: capturePlan.summary?.repaired_executable_slot_count ?? capturePlan.summary?.planned_output_slot_count ?? 4,
      attempted_repaired_slot_count: failedEntries.length + entries.filter((entry) => entry.status === 'captured').length,
      accepted_capture_count: manifest.summary?.captured_slot_count ?? 0,
      failed_slot_count: manifest.summary?.failed_slot_count ?? failedEntries.length,
      runtime_capture_invocation_failure_count: runtimeFailures.length,
      locator_failure_count: locatorFailures.length,
      content_failure_count: contentFailures.length,
      linked_in_source_unavailable_count: linkedInUnavailable.length,
      non_executable_context_count: nonExecutableContext.length,
      actual_capture_file_count: entries.filter((entry) => entry.clip_path || entry.text_extract_path).length,
      clip_output_path_null_count: failedEntries.filter((entry) => plannedPathNull(entry, 'clip_path')).length,
      text_output_path_null_count: failedEntries.filter((entry) => plannedPathNull(entry, 'text_extract_path')).length,
      full_page_grab_count: manifest.summary?.full_page_grab_count ?? entries.filter((entry) => entry.full_page_grab === true).length,
    },
    runtime_invocation: {
      capture_script_path: captureScriptPath,
      command_surfaces: commandSurfaces,
      execution_phases: unique(runtimeSourceEntries.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).execution_phase)),
      runner_types: unique(runtimeSourceEntries.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).runner_type)),
      failed_phases: unique(runtimeSourceEntries.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).failed_phase)),
      backend_commands: unique(failedEntries.map((entry) => entry.capture_metadata?.backend_command)),
      tool_paths: unique(runtimeSourceEntries.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).tool_path)),
      timeout_ms_values: unique(runtimeSourceEntries.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).timeout_ms).filter(Number.isFinite)),
      working_directories: unique(runtimeSourceEntries.map((entry) => parseRuntimeError(entry, { timeoutMs, workingDirectory }).working_directory)),
      environment_assumptions: {
        local_playwright_command_required: true,
        node_api_runner_preflight_required: true,
        local_fixture_smoke_required: true,
        browser_readiness_check_required: true,
        missing_browser_executable_paths: unique(runtimeFailures.map((entry) => (
          parseRuntimeError(entry, { timeoutMs, workingDirectory }).environment_assumptions.missing_browser_executable_path
        ))),
        browser_cache_paths: unique(runtimeFailures.map((entry) => (
          parseRuntimeError(entry, { timeoutMs, workingDirectory }).environment_assumptions.browser_cache_path
        ))),
        repair_commands: unique(runtimeFailures.map((entry) => (
          parseRuntimeError(entry, { timeoutMs, workingDirectory }).environment_assumptions.repair_command
        ))),
        no_live_capture_attempted_by_diagnostics: true,
        no_locator_resolution_or_codegen: true,
      },
    },
    repaired_slots: failedEntries.map((entry) => slotDiagnostic(entry, { timeoutMs, workingDirectory })),
    non_executable_context: contextEntries.map(contextDiagnostic),
    invariants: {
      failed_slots_classified: runtimeFailures.length + locatorFailures.length + contentFailures.length === failedEntries.length,
      accepted_capture_count_zero: (manifest.summary?.captured_slot_count ?? 0) === 0,
      actual_capture_file_count_zero: entries.every((entry) => entry.clip_path === null && entry.text_extract_path === null),
      failed_slot_output_paths_null: failedEntries.every((entry) => entry.clip_path === null && entry.text_extract_path === null && entry.text_extract_content === null),
      linkedin_source_unavailable_preserved: linkedInUnavailable.length === 1
        && linkedInUnavailable[0]?.blocker_reason === 'source_unavailable',
      non_executable_context_preserved: nonExecutableContext.length === 14,
      full_page_grab_false: entries.every((entry) => entry.full_page_grab === false),
    },
    controls: {
      read_only_diagnostics: true,
      live_capture_attempted: false,
      locator_resolution_authorized: false,
      locator_codegen_authorized: false,
      report_renderer_authorized: false,
      export_execution_authorized: false,
      workflow_engine_authorized: false,
      full_page_grabs_authorized: false,
      login_bypass_authorized: false,
      paywall_bypass_authorized: false,
      captcha_bypass_authorized: false,
      consent_bypass_authorized: false,
    },
    provenance: {
      created_at: createdAt,
      diagnostics_path: diagnosticsPath,
      read_only: true,
      derived_from_manifest_path: manifestPath,
      derived_from_repaired_capture_plan_path: capturePlanPath,
      no_capture_assets_produced: true,
      non_goals: [
        'live_capture_attempt',
        'locator_resolution',
        'locator_codegen',
        'selector_invention',
        'report_rendering',
        'export_work',
        'workflow_execution',
        'full_page_grabs',
        'login_bypass',
        'paywall_bypass',
        'captcha_bypass',
        'consent_bypass',
      ],
    },
  };
}

export function buildEmployerBrandRepairedCaptureRuntimeDiagnostics(input = {}) {
  return normalizeEmployerBrandRepairedCaptureRuntimeDiagnostics(input);
}

export function loadEmployerBrandRepairedCaptureRuntimeDiagnosticsInputs({
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  capturePlanPath = DEFAULT_CAPTURE_PLAN_PATH,
} = {}) {
  return {
    manifest: readJson(path.join(fixtureRoot, manifestPath)),
    capturePlan: readJson(path.join(fixtureRoot, capturePlanPath)),
    manifestPath,
    capturePlanPath,
  };
}

export function loadEmployerBrandRepairedCaptureRuntimeDiagnostics(options = {}) {
  return normalizeEmployerBrandRepairedCaptureRuntimeDiagnostics({
    ...loadEmployerBrandRepairedCaptureRuntimeDiagnosticsInputs(options),
    ...options,
  });
}

export function validateEmployerBrandRepairedCaptureRuntimeDiagnostics(diagnostics = {}) {
  const errors = [];
  const repairedSlots = arrayValue(diagnostics.repaired_slots);
  const contextEntries = arrayValue(diagnostics.non_executable_context);
  if (diagnostics.type !== EMPLOYER_BRAND_REPAIRED_CAPTURE_RUNTIME_DIAGNOSTICS_TYPE) errors.push('type must identify repaired capture runtime diagnostics');
  if (diagnostics.schema_version !== EMPLOYER_BRAND_REPAIRED_CAPTURE_RUNTIME_DIAGNOSTICS_SCHEMA_VERSION) errors.push('schema_version must be v0');
  if (diagnostics.summary?.repaired_executable_slot_count !== 4) errors.push('must preserve 4 repaired executable slots');
  if (diagnostics.summary?.attempted_repaired_slot_count !== 4) errors.push('must preserve 4 attempted repaired slots');
  if (
    diagnostics.summary?.runtime_capture_invocation_failure_count
      + diagnostics.summary?.locator_failure_count
      + diagnostics.summary?.content_failure_count
    !== diagnostics.summary?.failed_slot_count
  ) {
    errors.push('failed repaired slots must be classified as runtime, locator, or content/access blockers');
  }
  if (diagnostics.summary?.accepted_capture_count !== 0) errors.push('accepted capture count must remain 0');
  if (diagnostics.summary?.actual_capture_file_count !== 0) errors.push('actual capture file count must remain 0');
  if (diagnostics.summary?.linked_in_source_unavailable_count !== 1) errors.push('LinkedIn source-unavailable context must be preserved once');
  if (diagnostics.summary?.non_executable_context_count !== 14) errors.push('14 non-executable context entries must be preserved');
  if (diagnostics.summary?.full_page_grab_count !== 0) errors.push('full-page grab count must be 0');
  if (repairedSlots.length !== 4) errors.push('repaired slot diagnostics must include 4 slots');
  if (!repairedSlots.every((slot) => (
    slot.retry_eligibility === RUNTIME_FAILURE_NEXT_ACTION
      || slot.retry_eligibility === NON_RUNTIME_REVIEW_NEXT_ACTION
  ))) errors.push('failed slots must record runtime retry or non-runtime review eligibility');
  if (!repairedSlots.every((slot) => slot.clip_path === null && slot.text_extract_path === null && slot.text_extract_content === null)) errors.push('failed repaired slots must not point at clip/text outputs');
  if (!repairedSlots.every((slot) => slot.full_page_grab === false)) errors.push('failed repaired slots must keep full_page_grab=false');
  if (contextEntries.length !== 15) errors.push('diagnostics context must include LinkedIn plus 14 non-executable entries');
  if (!Object.values(objectValue(diagnostics.invariants)).every((value) => value === true)) errors.push('all diagnostics invariants must pass');
  if (diagnostics.controls?.read_only_diagnostics !== true) errors.push('diagnostics must be read-only');
  if (diagnostics.controls?.live_capture_attempted !== false) errors.push('diagnostics must not run live capture');
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function writeEmployerBrandRepairedCaptureRuntimeDiagnostics(diagnostics, {
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  diagnosticsPath = DEFAULT_OUT_PATH,
} = {}) {
  const out = path.isAbsolute(diagnosticsPath)
    ? diagnosticsPath
    : path.join(fixtureRoot, diagnosticsPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(diagnostics, null, 2)}\n`);
  return toPosix(out);
}

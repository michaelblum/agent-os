import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  executeEmployerBrandRepairedLiveElementCapture,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-live-evidence-element-capture.js';
import {
  loadEmployerBrandRepairedCaptureRuntimeDiagnostics,
  validateEmployerBrandRepairedCaptureRuntimeDiagnostics,
} from '../../packages/toolkit/workbench/_reference/employer-brand/employer-brand-repaired-capture-runtime-diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(
  repoRoot,
  'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit',
);
const schemaPath = path.join(repoRoot, 'shared/schemas/employer-brand-repaired-capture-runtime-diagnostics-v0.schema.json');
const diagnosticsPath = path.join(fixtureRoot, 'live-evidence-repaired-capture-runtime-diagnostics.json');
const capturePlanPath = path.join(fixtureRoot, 'live-evidence-repaired-locator-capture-plan.json');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function validateSchema(schema, instance) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
      schema,
      instance,
    ],
    { encoding: 'utf8' },
  );
}

test('Repaired capture runtime diagnostics fixture validates and distinguishes runtime from locator failures', async () => {
  const diagnostics = await readJson(diagnosticsPath);
  const schemaValidation = validateSchema(schemaPath, diagnosticsPath);

  assert.equal(schemaValidation.status, 0, `${schemaValidation.stdout}${schemaValidation.stderr}`);
  assert.deepEqual(validateEmployerBrandRepairedCaptureRuntimeDiagnostics(diagnostics), { valid: true, errors: [] });
  assert.equal(diagnostics.status, 'non_runtime_capture_blockers_detected');
  assert.equal(diagnostics.summary.repaired_executable_slot_count, 4);
  assert.equal(diagnostics.summary.runtime_capture_invocation_failure_count, 0);
  assert.equal(diagnostics.summary.locator_failure_count, 4);
  assert.equal(diagnostics.summary.content_failure_count, 0);
  assert.equal(diagnostics.summary.accepted_capture_count, 0);
  assert.equal(diagnostics.summary.actual_capture_file_count, 0);
  assert.equal(diagnostics.summary.linked_in_source_unavailable_count, 1);
  assert.equal(diagnostics.summary.non_executable_context_count, 14);
  assert.equal(diagnostics.summary.full_page_grab_count, 0);
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.failure_classification === 'locator_failure'));
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.blocker_reason === 'reviewed_locator_element_not_visible'));
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.retry_eligibility === 'requires_non_runtime_review'));
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.clip_path === null && slot.text_extract_path === null));
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.full_page_grab === false));
  assert.equal(
    diagnostics.non_executable_context.filter((entry) => entry.context_kind === 'source_unavailable').length,
    1,
  );
  assert.equal(
    diagnostics.non_executable_context.filter((entry) => entry.context_kind === 'non_executable_context').length,
    14,
  );
  assert.deepEqual(diagnostics.runtime_invocation.environment_assumptions.repair_commands, []);
  assert.deepEqual(diagnostics.runtime_invocation.environment_assumptions.missing_browser_executable_paths, []);
  assert.deepEqual(diagnostics.runtime_invocation.environment_assumptions.browser_cache_paths, []);
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.runtime.environment_assumptions.repair_command === null));
  assert.ok(diagnostics.repaired_slots.every((slot) => slot.runtime.environment_assumptions.missing_browser_executable_path === null));
});

test('Repaired capture runtime diagnostics generator is stable and read-only', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-repaired-runtime-diagnostics-'));
  const out = path.join(tmp, 'diagnostics.json');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-repaired-capture-runtime-diagnostics.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(out, 'utf8'), await fs.readFile(diagnosticsPath, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Repaired runtime diagnostics normalizer is loadable from fixture inputs', () => {
  const diagnostics = loadEmployerBrandRepairedCaptureRuntimeDiagnostics({
    fixtureRoot,
    createdAt: '2026-05-09T00:44:37.770Z',
  });
  assert.deepEqual(validateEmployerBrandRepairedCaptureRuntimeDiagnostics(diagnostics), { valid: true, errors: [] });
  assert.equal(diagnostics.status, 'non_runtime_capture_blockers_detected');
  assert.equal(diagnostics.controls.live_capture_attempted, false);
});

test('Repaired capture preflight failure is classified once before slot execution', async () => {
  const capturePlan = await readJson(capturePlanPath);
  const manifest = await executeEmployerBrandRepairedLiveElementCapture(capturePlan, {
    fixtureRoot,
    capturedAt: '2026-05-09T00:44:37.770Z',
    executionGate: 'execute-repaired-live-element-capture-v0',
    playwrightCli: 'definitely-not-a-playwright-command',
    runnerType: 'playwright_cli_run_code',
  });
  const failed = manifest.entries.filter((entry) => entry.status === 'failed');

  assert.equal(manifest.summary.failed_slot_count, 4);
  assert.equal(manifest.summary.captured_slot_count, 0);
  assert.equal(manifest.summary.blocked_not_run_count, 15);
  assert.equal(failed.length, 4);
  assert.ok(failed.every((entry) => entry.blocker_reason.startsWith('capture_preflight_command_availability_failed:')));
  assert.ok(failed.every((entry) => entry.required_next_action === 'retry_after_runtime_repair'));
  assert.ok(failed.every((entry) => entry.retry_eligibility === 'retry_after_runtime_repair'));
  assert.ok(failed.every((entry) => entry.capture_metadata.failed_command_surface === 'definitely-not-a-playwright-command --help'));
  assert.ok(failed.every((entry) => entry.capture_metadata.execution_phase === 'command_availability'));
  assert.ok(failed.every((entry) => entry.capture_metadata.error_code === 'ENOENT'));
});

test('Repaired capture exact invocation smoke failure stops before live slot URLs open', async () => {
  const capturePlan = await readJson(capturePlanPath);
  const calls = [];
  const manifest = await executeEmployerBrandRepairedLiveElementCapture(capturePlan, {
    fixtureRoot,
    capturedAt: '2026-05-09T00:44:37.770Z',
    executionGate: 'execute-repaired-live-element-capture-v0',
    playwrightCli: 'fake-playwright-cli',
    runnerType: 'playwright_cli_run_code',
    playwrightRunner: (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('--help')) {
        return {
          status: 0,
          stdout: 'help',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} --help`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('open') && args.includes('about:blank')) {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} open`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('run-code')) {
        return {
          status: 1,
          stdout: '',
          stderr: 'spawnSync fake-playwright-cli ETIMEDOUT',
          error: Object.assign(new Error('spawnSync fake-playwright-cli ETIMEDOUT'), { code: 'ETIMEDOUT' }),
          runtime_metadata: {
            command,
            command_surface_stable: `${command} run-code`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            timed_out: true,
            exit_status: null,
            exit_signal: 'SIGTERM',
            error_code: 'ETIMEDOUT',
            stderr_snippet: 'spawnSync fake-playwright-cli ETIMEDOUT',
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('close')) {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} close`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      throw new Error(`unexpected fake runner call: ${args.join(' ')}`);
    },
  });
  const failed = manifest.entries.filter((entry) => entry.status === 'failed');

  assert.equal(failed.length, 4);
  assert.ok(failed.every((entry) => entry.blocker_reason.startsWith('capture_preflight_exact_invocation_failed:')));
  assert.ok(failed.every((entry) => entry.capture_metadata.execution_phase === 'exact_invocation_smoke_run_code'));
  assert.ok(failed.every((entry) => entry.capture_metadata.failed_command_surface === 'fake-playwright-cli run-code'));
  assert.ok(failed.every((entry) => entry.capture_metadata.timed_out === true));
  assert.equal(calls.filter((call) => call.args.includes('open') && !call.args.includes('about:blank')).length, 0);
  assert.equal(manifest.summary.captured_slot_count, 0);
  assert.equal(manifest.summary.full_page_grab_count, 0);
});

test('Repaired Node API runner preflight smoke failure stops before live slot URLs open', async () => {
  const capturePlan = await readJson(capturePlanPath);
  let slotCaptureCalled = false;
  const manifest = await executeEmployerBrandRepairedLiveElementCapture(capturePlan, {
    fixtureRoot,
    capturedAt: '2026-05-09T00:44:37.770Z',
    executionGate: 'execute-repaired-live-element-capture-v0',
    playwrightModule: {},
    slotCaptureRunner: async () => {
      slotCaptureCalled = true;
      return { status: 'captured', slot_results: [] };
    },
  });
  const failed = manifest.entries.filter((entry) => entry.status === 'failed');

  assert.equal(slotCaptureCalled, false);
  assert.equal(failed.length, 4);
  assert.ok(failed.every((entry) => entry.blocker_reason.startsWith('capture_preflight_local_fixture_smoke_failed:')));
  assert.ok(failed.every((entry) => entry.capture_metadata.runner_type === 'playwright_node_api'));
  assert.ok(failed.every((entry) => entry.capture_metadata.execution_phase === 'runner_preflight'));
  assert.ok(failed.every((entry) => entry.capture_metadata.failed_phase === 'runner_preflight'));
  assert.ok(failed.every((entry) => entry.capture_metadata.started_phases.includes('runner_preflight')));
  assert.equal(manifest.summary.captured_slot_count, 0);
  assert.equal(manifest.summary.full_page_grab_count, 0);
});

test('Repaired Node API missing browser readiness failure stops before live slot URLs open', async () => {
  const capturePlan = await readJson(capturePlanPath);
  const missingPath = '/Users/Michael/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';
  let slotCaptureCalled = false;
  const manifest = await executeEmployerBrandRepairedLiveElementCapture(capturePlan, {
    fixtureRoot,
    capturedAt: '2026-05-09T00:44:37.770Z',
    executionGate: 'execute-repaired-live-element-capture-v0',
    playwrightModule: {
      chromium: {
        executablePath: () => missingPath,
        launch: async () => {
          throw new Error(`browserType.launch: Executable doesn't exist at ${missingPath}`);
        },
      },
    },
    slotCaptureRunner: async () => {
      slotCaptureCalled = true;
      return { status: 'captured', slot_results: [] };
    },
  });
  const failed = manifest.entries.filter((entry) => entry.status === 'failed');

  assert.equal(slotCaptureCalled, false);
  assert.equal(failed.length, 4);
  assert.ok(failed.every((entry) => entry.blocker_reason.startsWith('capture_preflight_local_fixture_smoke_failed:')));
  assert.ok(failed.every((entry) => entry.capture_metadata.execution_phase === 'browser_readiness'));
  assert.ok(failed.every((entry) => entry.capture_metadata.failed_phase === 'browser_readiness'));
  assert.ok(failed.every((entry) => entry.capture_metadata.error_code === 'PLAYWRIGHT_BROWSER_EXECUTABLE_MISSING'));
  assert.ok(failed.every((entry) => entry.capture_metadata.missing_browser_executable_path === missingPath));
  assert.ok(failed.every((entry) => entry.capture_metadata.repair_command === 'playwright install chromium-headless-shell'));
  assert.ok(failed.every((entry) => entry.capture_metadata.current_url === null));
  assert.equal(manifest.summary.captured_slot_count, 0);
  assert.equal(manifest.summary.full_page_grab_count, 0);
});


test('Repaired capture slot timeout records slot execution phase and timeout budget', async () => {
  const capturePlan = await readJson(capturePlanPath);
  const manifest = await executeEmployerBrandRepairedLiveElementCapture(capturePlan, {
    fixtureRoot,
    capturedAt: '2026-05-09T00:44:37.770Z',
    executionGate: 'execute-repaired-live-element-capture-v0',
    playwrightCli: 'fake-playwright-cli',
    timeoutMs: 12_345,
    runnerType: 'playwright_cli_run_code',
    playwrightRunner: (command, args, options) => {
      if (args.includes('--help')) {
        return {
          status: 0,
          stdout: 'help',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} --help`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('open')) {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} open`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('run-code') && options.executionPhase === 'exact_invocation_smoke_run_code') {
        return {
          status: 0,
          stdout: '### Result\n{"status":"captured","current_url":"about:blank","match_count":1,"smoke":true}\n',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} run-code`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('run-code') && options.executionPhase === 'slot_element_capture_run_code') {
        return {
          status: 1,
          stdout: '',
          stderr: 'spawnSync fake-playwright-cli ETIMEDOUT',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} run-code`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            timed_out: true,
            exit_status: null,
            exit_signal: 'SIGTERM',
            error_code: 'ETIMEDOUT',
            stderr_snippet: 'spawnSync fake-playwright-cli ETIMEDOUT',
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      if (args.includes('close')) {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          runtime_metadata: {
            command,
            command_surface_stable: `${command} close`,
            execution_phase: options.executionPhase,
            timeout_ms: options.timeout,
            working_directory: repoRoot,
            tool_path: '/tmp/fake-playwright-cli',
          },
        };
      }
      throw new Error(`unexpected fake runner call: ${args.join(' ')}`);
    },
  });
  const failed = manifest.entries.filter((entry) => entry.status === 'failed');

  assert.equal(failed.length, 4);
  assert.ok(failed.every((entry) => entry.blocker_reason === 'capture_command_failed: spawnSync fake-playwright-cli ETIMEDOUT'));
  assert.ok(failed.every((entry) => entry.capture_metadata.execution_phase === 'slot_element_capture_run_code'));
  assert.ok(failed.every((entry) => entry.capture_metadata.timeout_ms === 12_345));
  assert.ok(failed.every((entry) => entry.capture_metadata.error_code === 'ETIMEDOUT'));
  assert.ok(failed.every((entry) => entry.capture_metadata.retry_recommendation === 'repair_capture_runtime_before_retry'));
  assert.equal(manifest.summary.captured_slot_count, 0);
  assert.equal(manifest.summary.full_page_grab_count, 0);
});

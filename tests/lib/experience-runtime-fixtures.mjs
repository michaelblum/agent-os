import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '../..');
export const toolkitRoot = path.join(repoRoot, 'packages/toolkit');
export const runtimeContextSchemaPath = path.join(repoRoot, 'shared/schemas/aos-experience-runtime-context-v0.schema.json');

export function runNode(args, env = {}) {
  return spawnSync('node', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_RUNTIME_MODE: 'repo',
      AOS_BYPASS_PREFLIGHT: '1',
      ...env,
    },
    encoding: 'utf8',
  });
}

export function dryRunToggleURL(id, env = {}) {
  const result = runNode(['scripts/aos-experience.mjs', 'activate', id, '--dry-run', '--json'], env);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout).status_item.toggle_surface.url;
}

export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeFakeAosScript(tmp, {
  filename,
  logName,
  recordCwd = false,
  allowKnownMutations = false,
}) {
  const fake = path.join(tmp, filename);
  const log = path.join(tmp, logName);
  const logExpression = recordCwd
    ? 'JSON.stringify({ args, cwd: process.cwd() })'
    : 'JSON.stringify(args)';
  const mutationGuard = allowKnownMutations
    ? `
if (key.startsWith('config set ')) process.exit(0);
if (key === 'content wait --root toolkit --auto-start --allow-start --timeout 15s') process.exit(0);
`
    : `
const denied = [
  'config set',
  'service start',
  'service restart',
  'show remove',
  'experience activate',
];
if (denied.some((prefix) => key.startsWith(prefix))) {
  console.error(JSON.stringify({ code: 'MUTATION_NOT_ALLOWED', argv: args }));
  process.exit(23);
}
`;
  await fs.writeFile(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AOS_LOG, ${logExpression} + '\\n');
const key = args.join(' ');
${mutationGuard}
const responses = JSON.parse(process.env.FAKE_AOS_RESPONSES || '{}');
if (!Object.hasOwn(responses, key)) {
  console.error(JSON.stringify({ code: 'UNEXPECTED_FAKE_AOS_CALL', argv: args${recordCwd ? ', cwd: process.cwd()' : ''} }));
  process.exit(2);
}
const response = responses[key];
if (response.stderr) process.stderr.write(response.stderr);
if (Object.hasOwn(response, 'value')) process.stdout.write(JSON.stringify(response.value));
else if (response.stdout) process.stdout.write(response.stdout);
process.exit(response.exit_code ?? 0);
`, { mode: 0o755 });
  return { fake, log };
}

export function writeFakeAos(tmp, _responses = null) {
  return writeFakeAosScript(tmp, {
    filename: 'fake-aos.mjs',
    logName: 'aos-calls.jsonl',
  });
}

export function writeCwdRecordingFakeAos(tmp, _responses = null) {
  return writeFakeAosScript(tmp, {
    filename: 'fake-aos-cwd.mjs',
    logName: 'aos-cwd-calls.jsonl',
    recordCwd: true,
  });
}

export function writeMutableFakeAos(tmp, _responses = null) {
  return writeFakeAosScript(tmp, {
    filename: 'fake-mutable-aos.mjs',
    logName: 'aos-calls.jsonl',
    allowKnownMutations: true,
  });
}

export function baseResponses(tmp, {
  contentRoots = { toolkit: toolkitRoot },
  canvases = [],
  service = {},
  permissions = {},
} = {}) {
  return {
    'service status --mode repo --json': {
      value: {
        status: 'ok',
        mode: 'repo',
        loaded: true,
        running: true,
        pid: 12345,
        label: 'com.agent-os.aos.repo',
        target_matches_expected: true,
        state_dir: path.join(tmp, 'repo'),
        notes: [],
        ...service,
      },
    },
    'permissions check --json': {
      value: {
        status: 'ok',
        permissions: {
          accessibility: true,
          screen_recording: true,
          listen_access: true,
          post_access: true,
          ...(permissions.permissions || {}),
        },
        daemon_view: {
          reachable: true,
          input_tap: {
            status: 'active',
            attempts: 1,
            listen_access: true,
            post_access: true,
          },
          ...(permissions.daemon_view || {}),
        },
        cli_view: {
          accessibility: true,
          screen_recording: true,
          listen_access: true,
          post_access: true,
          ...(permissions.permissions || {}),
          ...(permissions.cli_view || {}),
        },
        requirements: permissions.requirements || [],
        setup: {
          marker_exists: true,
          setup_completed: true,
          bundle_matches_current: true,
        },
        missing_permissions: permissions.missing_permissions || [],
        ready_for_testing: permissions.ready_for_testing ?? true,
        ready_source: permissions.ready_source || 'daemon',
        notes: permissions.notes || [],
        ...(permissions.status ? { status: permissions.status } : {}),
      },
    },
    'content status --json': {
      value: { roots: contentRoots },
    },
    'show list --json': {
      value: { status: 'success', canvases },
    },
  };
}

export async function readFakeAosCalls(log) {
  let text = '';
  try {
    text = await fs.readFile(log, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function runContext(tmp, id, responses) {
  const { fake, log } = await writeFakeAos(tmp);
  const result = runNode(['scripts/aos-experience.mjs', 'status', id, '--json'], {
    AOS_STATE_ROOT: tmp,
    AOS_PATH: fake,
    FAKE_AOS_LOG: log,
    FAKE_AOS_RESPONSES: JSON.stringify(responses),
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return {
    payload: JSON.parse(result.stdout),
    calls: await readFakeAosCalls(log),
  };
}

export async function writeExperienceManifestFixture({
  experiencesRoot,
  id,
  title,
  contentRootId,
  contentRootPath,
  surfaceId,
  expectedURL,
  menu = [],
}) {
  await fs.mkdir(path.join(experiencesRoot, id), { recursive: true });
  await writeJSON(path.join(experiencesRoot, id, 'aos-experience.json'), {
    schema_version: 0,
    id,
    title,
    version: '0.1.0',
    exclusive: true,
    default_activation: {
      kind: 'status_item',
      status_item_first: true,
      primary_entry: surfaceId,
    },
    vanilla_fallback: {
      status_item: true,
      tools: [],
    },
    content_roots: [{
      id: contentRootId,
      path: contentRootPath,
      branch_scoped: false,
    }],
    status_item: {
      enabled: true,
      label: title,
      icon: 'aos',
      toggle_surface: {
        id: surfaceId,
        url: expectedURL,
        track: 'union',
      },
    },
    branding: {
      display_name: title,
      surface_title_prefix: title,
      theme_ref: 'packages/toolkit/runtime',
      about: `${title} fixture.`,
    },
    menu,
    surfaces: {
      [surfaceId]: {
        summary: `${title} surface.`,
      },
    },
  });
}

export async function writeRuntimeStateFixture({
  stateRoot,
  id,
  contentRootKey,
  contentRootPath,
  surfaceId,
  expectedURL,
}) {
  await writeJSON(path.join(stateRoot, 'repo', 'experience-state.json'), {
    active_experience: id,
    exclusive: true,
  });
  await writeJSON(path.join(stateRoot, 'repo', 'config.json'), {
    content: {
      roots: {
        [contentRootKey]: contentRootPath,
      },
    },
    status_item: {
      enabled: true,
      toggle_id: surfaceId,
      toggle_url: expectedURL,
      toggle_track: 'union',
      icon: 'aos',
    },
  });
}

export function validateJSONAgainstSchema(instancePath, schemaPath = runtimeContextSchemaPath) {
  const result = spawnSync(
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
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

export function rejectJSONAgainstSchema(instancePath, schemaPath = runtimeContextSchemaPath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
sys.exit(0 if errors else 1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

export async function writeTempRuntimeContextPayload(payload, prefix = 'aos-runtime-context-instance-') {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const instancePath = path.join(tmp, 'runtime-context.json');
  await writeJSON(instancePath, payload);
  return instancePath;
}

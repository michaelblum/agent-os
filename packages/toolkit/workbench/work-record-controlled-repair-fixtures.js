import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultRepoRoot() {
  return path.resolve(__dirname, '../../..');
}

function fixtureScript(repoRoot) {
  return path.join(repoRoot, 'scripts/work-record-fixture-operation.mjs');
}

export function createWorkRecordControlledRepairFixtureRegistry(repoRoot = defaultRepoRoot()) {
  const script = fixtureScript(repoRoot);
  const base = {
    registry_kind: 'controlled_repair_fixture_registry',
    operation_kind: 'deterministic_repo_command_file_fixture',
    executable: process.execPath,
    script,
    timeout_ms: 2000,
    allowed_mutations: ['output/result.txt'],
    digest_paths: ['input.txt', 'output/result.txt'],
    environment: {
      AOS_CONTROLLED_REPAIR_EXECUTOR: '1',
    },
  };
  return new Map([
    ['controlled_fixture.write_success', {
      ...base,
      id: 'controlled_fixture.write_success',
      argv: [process.execPath, script, '--mode', 'write', '--file', 'output/result.txt', '--value', 'controlled repair succeeded'],
      cleanup: { id: 'cleanup:result-file', argv: [process.execPath, script, '--mode', 'cleanup', '--file', 'cleanup.tmp'] },
    }],
    ['controlled_fixture.write_failure', {
      ...base,
      id: 'controlled_fixture.write_failure',
      argv: [process.execPath, script, '--mode', 'fail-after-write', '--file', 'output/result.txt', '--value', 'controlled repair failed'],
      rollback: { id: 'rollback:result-file', argv: [process.execPath, script, '--mode', 'rollback', '--file', 'output/result.txt'] },
    }],
    ['controlled_fixture.write_timeout', {
      ...base,
      id: 'controlled_fixture.write_timeout',
      timeout_ms: 50,
      argv: [process.execPath, script, '--mode', 'sleep', '--ms', '5000'],
    }],
    ['controlled_fixture.cleanup_success', {
      ...base,
      id: 'controlled_fixture.cleanup_success',
      allowed_mutations: ['output/result.txt', 'cleanup.tmp'],
      digest_paths: ['input.txt', 'output/result.txt', 'cleanup.tmp'],
      argv: [process.execPath, script, '--mode', 'write', '--file', 'output/result.txt', '--value', 'cleanup succeeds'],
      cleanup: { id: 'cleanup:declared-temp', argv: [process.execPath, script, '--mode', 'cleanup', '--file', 'cleanup.tmp'] },
    }],
    ['controlled_fixture.cleanup_failure', {
      ...base,
      id: 'controlled_fixture.cleanup_failure',
      argv: [process.execPath, script, '--mode', 'write', '--file', 'output/result.txt', '--value', 'cleanup fails'],
      cleanup: { id: 'cleanup:declared-temp', argv: [process.execPath, script, '--mode', 'cleanup-fail', '--file', 'cleanup.tmp'] },
    }],
    ['controlled_fixture.rollback_success', {
      ...base,
      id: 'controlled_fixture.rollback_success',
      argv: [process.execPath, script, '--mode', 'fail-after-write', '--file', 'output/result.txt', '--value', 'rollback succeeds'],
      rollback: { id: 'rollback:result-file', argv: [process.execPath, script, '--mode', 'rollback', '--file', 'output/result.txt'] },
    }],
    ['controlled_fixture.rollback_failure', {
      ...base,
      id: 'controlled_fixture.rollback_failure',
      argv: [process.execPath, script, '--mode', 'fail-after-write', '--file', 'output/result.txt', '--value', 'rollback fails'],
      rollback: { id: 'rollback:result-file', argv: [process.execPath, script, '--mode', 'rollback-fail', '--file', 'output/result.txt'] },
    }],
  ]);
}

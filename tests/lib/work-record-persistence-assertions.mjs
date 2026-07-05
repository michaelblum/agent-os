import assert from 'node:assert/strict';

export function emptyWorkRecordPersistence() {
  return {
    stdout_required: false,
    stdout_artifact: {},
    save_stdout_to: '',
    requires_saved_output_from: [],
    persistence_command: '',
  };
}

export function expectedWorkRecordPersistence(command = {}, continuable = true) {
  if (continuable !== true || !command) return emptyWorkRecordPersistence();
  const stdoutArtifact = command.stdout_artifact || {};
  const stdoutRequired = stdoutArtifact.required === true || Boolean(stdoutArtifact.path || command.save_stdout_to);
  return {
    stdout_required: stdoutRequired,
    stdout_artifact: stdoutRequired ? stdoutArtifact : {},
    save_stdout_to: stdoutRequired ? (command.save_stdout_to || stdoutArtifact.path || '') : '',
    requires_saved_output_from: command.requires_saved_output_from || [],
    persistence_command: stdoutRequired ? (command.persistence_command || '') : '',
  };
}

export function assertWorkRecordPersistenceMatchesCommand(actual, command, { continuable = true } = {}) {
  assert.deepEqual(actual, expectedWorkRecordPersistence(command, continuable));
}

export function assertEmptyWorkRecordPersistence(actual) {
  assert.deepEqual(actual, emptyWorkRecordPersistence());
}

export function assertContinuationPersistence(envelope, { continuable }) {
  if (continuable !== true) {
    assert.equal(envelope.continuation.safe_next_descriptor_id, '');
    assert.equal(envelope.continuation.command, '');
    assert.deepEqual(envelope.continuation.argv, []);
    assert.deepEqual(envelope.continuation.stdout_artifact, {});
    assert.equal(envelope.continuation.save_stdout_to, '');
    assert.deepEqual(envelope.continuation.requires_saved_output_from, []);
    assert.equal(envelope.continuation.persistence_command, '');
    assert.equal(envelope.continuation.requires_human_approval, false);
    assert.equal(envelope.continuation.would_mutate_state, false);
    assertEmptyWorkRecordPersistence(envelope.continuation.persistence);
    assert.equal(envelope.recovery_summary.next.command_id, '');
    assert.deepEqual(envelope.recovery_summary.next.argv, []);
    assertEmptyWorkRecordPersistence(envelope.recovery_summary.next.persistence);
    return;
  }

  assert.equal(envelope.recovery_summary.next.command_id, envelope.continuation.safe_next_descriptor_id);
  assert.deepEqual(envelope.recovery_summary.next.argv, envelope.continuation.argv);
  assert.deepEqual(envelope.recovery_summary.next.persistence, envelope.continuation.persistence);
  assert.equal(envelope.continuation.persistence.stdout_required, true);
  assert.equal(envelope.continuation.persistence.save_stdout_to, envelope.continuation.save_stdout_to);
  assert.deepEqual(envelope.continuation.persistence.stdout_artifact, envelope.continuation.stdout_artifact);
  assert.deepEqual(envelope.continuation.persistence.requires_saved_output_from, envelope.continuation.requires_saved_output_from);
  assert.equal(envelope.continuation.persistence.persistence_command, envelope.continuation.persistence_command);
  assert.notEqual(envelope.continuation.safe_next_descriptor_id, '');
  assert.notDeepEqual(envelope.continuation.argv, []);
}

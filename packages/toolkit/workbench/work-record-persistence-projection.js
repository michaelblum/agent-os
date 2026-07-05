function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rawString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function emptyPersistence() {
  return {
    stdout_required: false,
    stdout_artifact: {},
    save_stdout_to: '',
    requires_saved_output_from: [],
    persistence_command: '',
  };
}

export function projectDescriptorPersistence(descriptor = {}, continuable = true) {
  if (continuable !== true) return emptyPersistence();
  const safe = objectValue(descriptor);
  const stdoutArtifact = objectValue(safe.stdout_artifact);
  const stdoutPath = rawString(stdoutArtifact.path || safe.save_stdout_to);
  const stdoutRequired = stdoutArtifact.required === true || stdoutPath !== '';
  return {
    stdout_required: stdoutRequired,
    stdout_artifact: stdoutRequired ? { ...stdoutArtifact } : {},
    save_stdout_to: stdoutRequired ? rawString(safe.save_stdout_to || stdoutArtifact.path) : '',
    requires_saved_output_from: arrayValue(safe.requires_saved_output_from).map((item) => ({ ...objectValue(item) })),
    persistence_command: stdoutRequired ? rawString(safe.persistence_command) : '',
  };
}

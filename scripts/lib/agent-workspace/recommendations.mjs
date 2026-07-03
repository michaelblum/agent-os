export function commandToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function commandString(argv, displayName = null) {
  const tokens = argv.map((arg, index) => (index === 0 && displayName ? displayName : arg));
  return tokens.map(commandToken).join(' ');
}

export function refsRecommendation(workspace, snapshotIDValue, env = process.env) {
  const display = env.AOS_INVOCATION_DISPLAY_NAME || 'aos';
  const argv = ['aos', 'see', 'refs', '--workspace', String(workspace), '--snapshot', String(snapshotIDValue), '--json'];
  return {
    kind: 'inspect_saved_refs',
    reason: 'read compact refs before choosing a saved-ref action',
    command: commandString(argv, display),
    argv,
    workspace_id: String(workspace),
    snapshot_id: String(snapshotIDValue),
  };
}

export function sampleActionRecommendation(workspace, snapshotIDValue, refs, env = process.env) {
  const display = env.AOS_INVOCATION_DISPLAY_NAME || 'aos';
  const refTarget = (record) => `ref:${snapshotIDValue}:${record.ref}`;
  const byPreferredAction = (action) => refs.find((record) => record.action_target && (record.supported_actions ?? []).includes(action));
  for (const action of ['click', 'set-value', 'fill', 'hover', 'scroll', 'press', 'focus']) {
    const record = byPreferredAction(action);
    if (!record) continue;
    const baseArgv = ['aos', 'do', action, refTarget(record)];
    const descriptor = {
      kind: 'dry_run_saved_ref_action',
      reason: 'validate the saved ref before real mutation',
      action,
      workspace_id: String(workspace),
      snapshot_id: String(snapshotIDValue),
      ref: record.ref,
      backend: record.backend,
      resolution_class: record.resolution_class,
    };
    if (action === 'click' || action === 'hover' || action === 'press' || action === 'focus') {
      const argv = [...baseArgv, '--workspace', String(workspace), '--dry-run'];
      return { ...descriptor, command: commandString(argv, display), argv };
    }
    if (action === 'set-value') {
      const argv = [...baseArgv, '--workspace', String(workspace), '--value', '42', '--dry-run'];
      return { ...descriptor, command: commandString(argv, display), argv };
    }
    if (action === 'fill') {
      const argv = [...baseArgv, 'sample text', '--workspace', String(workspace), '--dry-run'];
      return { ...descriptor, command: commandString(argv, display), argv };
    }
    if (action === 'scroll') {
      const argv = [...baseArgv, '0,-200', '--workspace', String(workspace), '--dry-run'];
      return { ...descriptor, command: commandString(argv, display), argv };
    }
  }
  return null;
}

export function compactNextRecommendations(workspace, snapshotIDValue, refs, env = process.env) {
  return [
    refsRecommendation(workspace, snapshotIDValue, env),
    sampleActionRecommendation(workspace, snapshotIDValue, refs, env),
  ].filter(Boolean);
}

import {
  DO_VALUE_FLAGS,
  exitAgentWorkspaceError,
  validateLocalID,
} from './core.mjs';

export function positionalIndexes(args) {
  const indexes = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (DO_VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    indexes.push(i);
  }
  return indexes;
}

export function parseRefToken(value) {
  if (!value?.startsWith?.('ref:')) return null;
  const body = value.slice('ref:'.length);
  const parts = body.split(':');
  if (parts.length === 1) return { snapshot_id: null, ref: validateLocalID(parts[0], 'ref id') };
  if (parts.length === 2) return { snapshot_id: validateLocalID(parts[0], 'snapshot id'), ref: validateLocalID(parts[1], 'ref id') };
  exitAgentWorkspaceError('ref target must be ref:<id> or ref:<snapshot-id>:<id>', 'INVALID_REF_TARGET');
}

export function stripWorkspaceFlags(args) {
  const out = [];
  let workspace = null;
  let snapshot = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--workspace' || args[i] === '--snapshot') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitAgentWorkspaceError(`${args[i]} requires a value`, 'MISSING_ARG');
      }
      if (args[i] === '--workspace') workspace = args[i + 1];
      if (args[i] === '--snapshot') snapshot = args[i + 1];
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return { args: out, workspace, snapshot };
}

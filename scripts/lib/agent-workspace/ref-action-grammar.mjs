import { exitAgentWorkspaceError } from './core.mjs';
import { loadRefRecord } from './ref-action-resolution.mjs';
import { parseRefToken, positionalIndexes } from './ref-action-args.mjs';

const COMMON_BOOL_FLAGS = new Set(['--dry-run']);
const COMMON_VALUE_FLAGS = new Set(['--state-id']);

function flagPolicy(action, record) {
  const boolFlags = new Set(COMMON_BOOL_FLAGS);
  const valueFlags = new Set(COMMON_VALUE_FLAGS);
  if (action === 'click') {
    boolFlags.add('--right');
    boolFlags.add('--double');
    if (record?.backend === 'aos_canvas') valueFlags.add('--dwell');
  }
  if (action === 'set-value') valueFlags.add('--value');
  return { boolFlags, valueFlags };
}

function validateKnownFlags(action, args, record) {
  const { boolFlags, valueFlags } = flagPolicy(action, record);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!String(arg).startsWith('--')) continue;
    if (boolFlags.has(arg)) continue;
    if (valueFlags.has(arg)) {
      if (i + 1 >= args.length || String(args[i + 1]).startsWith('--')) {
        exitAgentWorkspaceError(`${arg} requires a value`, 'MISSING_ARG');
      }
      i += 1;
      continue;
    }
    exitAgentWorkspaceError(`Unknown saved-ref ${action} flag: ${arg}`, 'UNKNOWN_FLAG');
  }
}

export function validateActionArgs(action, args, targetIndex, record = null) {
  validateKnownFlags(action, args, record);
  if (['click', 'hover'].includes(action)) {
    const positions = positionalIndexes(args);
    const extra = positions.find((index) => index !== targetIndex);
    if (extra !== undefined) {
      exitAgentWorkspaceError(`${action} saved-ref actions do not accept extra positional arguments`, 'UNKNOWN_ARG');
    }
  }
  if (['press', 'focus'].includes(action)) {
    const positions = positionalIndexes(args);
    const extra = positions.find((index) => index !== targetIndex);
    if (extra !== undefined) {
      exitAgentWorkspaceError(`${action} saved-ref actions do not accept extra positional arguments`, 'UNKNOWN_ARG');
    }
  }
  if (action === 'set-value') {
    const valueFlagIndexes = args
      .map((arg, index) => (arg === '--value' ? index : null))
      .filter((index) => index !== null);
    if (valueFlagIndexes.length > 1) {
      exitAgentWorkspaceError('set-value accepts at most one --value flag', 'INVALID_ARG');
    }
    const valueFlagIndex = valueFlagIndexes[0] ?? -1;
    if (valueFlagIndex >= 0 && (
      valueFlagIndex + 1 >= args.length
      || String(args[valueFlagIndex + 1]).startsWith('--')
    )) {
      exitAgentWorkspaceError('set-value requires --value or a positional value', 'MISSING_ARG');
    }
    const hasFlagValue = valueFlagIndex >= 0;
    const positions = positionalIndexes(args);
    const valuePositions = positions.filter((index) => index !== targetIndex);
    if (hasFlagValue && valuePositions.length > 0) {
      exitAgentWorkspaceError('set-value accepts exactly one value source: --value or a positional value', 'INVALID_ARG');
    }
    if (!hasFlagValue && valuePositions.length > 1) {
      exitAgentWorkspaceError('set-value saved-ref actions accept only one positional value', 'UNKNOWN_ARG');
    }
    const hasPositionalValue = valuePositions.length === 1;
    if (!hasFlagValue && !hasPositionalValue) {
      exitAgentWorkspaceError('set-value requires --value or a positional value', 'MISSING_ARG');
    }
  }
  if (action === 'fill') {
    const positions = positionalIndexes(args);
    const textPositions = positions.filter((index) => index !== targetIndex);
    if (textPositions.length === 0) {
      exitAgentWorkspaceError('fill requires a text argument', 'MISSING_ARG');
    }
    if (textPositions.length > 1) {
      exitAgentWorkspaceError('fill saved-ref actions accept only one positional text argument', 'UNKNOWN_ARG');
    }
  }
  if (action === 'type') {
    const positions = positionalIndexes(args);
    const textPositions = positions.filter((index) => index !== targetIndex);
    if (textPositions.length === 0) {
      exitAgentWorkspaceError('type requires a text argument', 'MISSING_ARG');
    }
    if (textPositions.length > 1) {
      exitAgentWorkspaceError('type saved-ref actions accept only one positional text argument', 'UNKNOWN_ARG');
    }
  }
  if (action === 'key') {
    const positions = positionalIndexes(args);
    const comboPositions = positions.filter((index) => index !== targetIndex);
    if (comboPositions.length === 0) {
      exitAgentWorkspaceError('key requires a key combo argument', 'MISSING_ARG');
    }
    if (comboPositions.length > 1) {
      exitAgentWorkspaceError('key saved-ref actions accept only one positional key combo argument', 'UNKNOWN_ARG');
    }
  }
  if (action === 'scroll') {
    const positions = positionalIndexes(args);
    const deltaPositions = positions.filter((index) => index !== targetIndex);
    const delta = deltaPositions[0];
    if (delta === undefined) {
      exitAgentWorkspaceError('scroll requires a dx,dy argument for saved browser refs', 'MISSING_ARG');
    }
    if (deltaPositions.length > 1) {
      exitAgentWorkspaceError('scroll saved-ref actions accept only one positional dx,dy argument', 'UNKNOWN_ARG');
    }
    if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(String(args[delta]))) {
      exitAgentWorkspaceError('scroll dx,dy must use the form x,y', 'INVALID_ARG');
    }
  }
  if (action === 'drag') {
    const positions = positionalIndexes(args);
    const destinationPositions = positions.filter((index) => index !== targetIndex);
    const destination = destinationPositions[0];
    if (destination === undefined) {
      exitAgentWorkspaceError('drag requires a destination ref target', 'MISSING_ARG');
    }
    if (destinationPositions.length > 1) {
      exitAgentWorkspaceError('drag saved-ref actions accept only one destination ref target', 'UNKNOWN_ARG');
    }
  }
}

export function loadDragDestinationRecord(args, targetIndex, workspace, explicitSnapshot, env) {
  const positions = positionalIndexes(args);
  const destinationIndex = positions.find((index) => index !== targetIndex);
  if (destinationIndex === undefined) {
    exitAgentWorkspaceError('drag requires a destination ref target', 'MISSING_ARG');
  }
  const destinationToken = parseRefToken(args[destinationIndex]);
  if (!destinationToken) {
    exitAgentWorkspaceError('drag with a saved ref source requires a saved ref destination', 'INVALID_REF_TARGET');
  }
  return {
    index: destinationIndex,
    record: loadRefRecord(workspace, destinationToken, explicitSnapshot, env),
  };
}

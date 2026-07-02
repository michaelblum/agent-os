import { exitAgentWorkspaceError } from './core.mjs';
import { loadRefRecord } from './ref-action-resolution.mjs';
import { parseRefToken, positionalIndexes } from './ref-action-args.mjs';

export function validateActionArgs(action, args, targetIndex) {
  if (action === 'set-value') {
    const valueFlagIndex = args.indexOf('--value');
    const hasFlagValue = valueFlagIndex >= 0
      && valueFlagIndex + 1 < args.length
      && !String(args[valueFlagIndex + 1]).startsWith('--');
    const positions = positionalIndexes(args);
    const hasPositionalValue = positions.some((index) => index !== targetIndex);
    if (!hasFlagValue && !hasPositionalValue) {
      exitAgentWorkspaceError('set-value requires --value or a positional value', 'MISSING_ARG');
    }
  }
  if (action === 'fill') {
    const positions = positionalIndexes(args);
    const hasText = positions.some((index) => index !== targetIndex);
    if (!hasText) {
      exitAgentWorkspaceError('fill requires a text argument', 'MISSING_ARG');
    }
  }
  if (action === 'scroll') {
    const positions = positionalIndexes(args);
    const delta = positions.find((index) => index !== targetIndex);
    if (delta === undefined) {
      exitAgentWorkspaceError('scroll requires a dx,dy argument for saved browser refs', 'MISSING_ARG');
    }
    if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(String(args[delta]))) {
      exitAgentWorkspaceError('scroll dx,dy must use the form x,y', 'INVALID_ARG');
    }
  }
  if (action === 'drag') {
    const positions = positionalIndexes(args);
    const destination = positions.find((index) => index !== targetIndex);
    if (destination === undefined) {
      exitAgentWorkspaceError('drag requires a destination ref target', 'MISSING_ARG');
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

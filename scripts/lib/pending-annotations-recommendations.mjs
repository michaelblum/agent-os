import {
  array,
  fail,
  requiredText,
} from './pending-annotations-constants.mjs';

export function defaultRecommendedNext({ savedRef, fallbackOnly, workspace }) {
  if (savedRef) {
    return [{
      kind: 'inspect_saved_ref',
      reason: 'Review compact saved ref context before acting.',
      argv: [
        'aos',
        'see',
        'refs',
        '--workspace',
        savedRef.workspace_id,
        '--snapshot',
        savedRef.snapshot_id,
        '--json',
      ],
    }];
  }
  return [{
    kind: fallbackOnly ? 'refresh_saved_perception' : 'inspect_current_perception',
    reason: fallbackOnly
      ? 'Target has fallback evidence only; capture saved perception before mutation.'
      : 'No saved perception ref was attached to this annotation.',
    argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', workspace, '--mode', 'som'],
  }];
}

export function normalizeRecommendedNext(items, context) {
  const raw = array(items);
  if (!raw.length) return defaultRecommendedNext(context);
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`recommended_next[${index}] must be an object`, 'INVALID_ARG');
    }
    const argv = array(item.argv);
    if (!argv.length || argv.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
      fail(`recommended_next[${index}].argv must be a non-empty string array`, 'INVALID_ARG');
    }
    return {
      kind: requiredText(item.kind || 'follow_up', `recommended_next[${index}].kind`),
      reason: requiredText(item.reason || 'Follow-up command for this annotation.', `recommended_next[${index}].reason`),
      argv,
    };
  });
}

export function captureInspectNext(workspace, snapshot) {
  if (workspace && snapshot) {
    return [{
      kind: 'inspect_saved_ref',
      reason: 'Inspect saved refs for the captured selection before acting.',
      argv: ['aos', 'see', 'refs', '--workspace', workspace, '--snapshot', snapshot, '--json'],
    }];
  }
  return [];
}

export function captureRefreshNext(workspace) {
  return [{
    kind: 'refresh_saved_perception',
    reason: 'Capture fresh saved perception before acting from this annotation.',
    argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', workspace || 'default', '--mode', 'som'],
  }];
}

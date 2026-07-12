export const MICROPHONE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

const MICROPHONE_AUTHORIZATION_STATES = new Set([
  'not_determined',
  'restricted',
  'denied',
  'authorized',
  'unknown',
]);

export function daemonMicrophoneAuthorizationState(daemon) {
  const state = daemon?.permissions?.microphoneState;
  if (MICROPHONE_AUTHORIZATION_STATES.has(state)) return state;
  if (daemon?.permissions?.microphone === true) return 'authorized';
  return 'unknown';
}

export function daemonMicrophoneIsAuthorized(daemon) {
  return daemonMicrophoneAuthorizationState(daemon) === 'authorized'
    && daemon?.permissions?.microphone === true;
}

export function microphonePermissionBlocker(daemon, targetPath) {
  if (!daemon) {
    return {
      kind: 'permission',
      id: 'microphone',
      scope: 'daemon',
      reason: 'microphone_unknown',
      authorization_state: 'unknown',
      message: 'Daemon Microphone authorization cannot be verified while the daemon is unreachable.',
      target_path: targetPath,
      settings_url: MICROPHONE_SETTINGS_URL,
      blocks: ['listen'],
    };
  }
  if (daemonMicrophoneIsAuthorized(daemon)) return null;

  const state = daemonMicrophoneAuthorizationState(daemon);
  const inconsistent = state === 'authorized';
  const messages = {
    not_determined: 'Daemon Microphone authorization has not been requested; first use must invoke the daemon-owned prompt.',
    denied: 'Daemon Microphone authorization is denied; open Microphone settings and poll the live daemon state.',
    restricted: 'Daemon Microphone authorization is restricted by system policy.',
    unknown: 'Daemon Microphone authorization is unavailable; voice readiness fails closed.',
  };
  return {
    kind: 'permission',
    id: 'microphone',
    scope: 'daemon',
    reason: inconsistent ? 'microphone_state_inconsistent' : `microphone_${state}`,
    authorization_state: state,
    message: inconsistent
      ? 'Daemon Microphone authorization fields disagree; voice readiness fails closed.'
      : messages[state] ?? messages.unknown,
    target_path: targetPath,
    settings_url: MICROPHONE_SETTINGS_URL,
    blocks: ['listen'],
  };
}

export function microphoneNextActions(state, prefix) {
  const actions = [];
  if (state === 'not_determined') {
    actions.push({
      type: 'command',
      label: 'request the first-use Microphone prompt from the managed daemon',
      command: `${prefix} permissions setup --once`,
    });
  } else if (state === 'denied') {
    actions.push({
      type: 'open_settings',
      label: 'open macOS Microphone privacy settings',
      settings_url: MICROPHONE_SETTINGS_URL,
    });
  } else if (state === 'restricted') {
    actions.push({
      type: 'manual',
      label: 'ask the device administrator to allow Microphone access for aos',
      reason: 'microphone_restricted',
    });
  }
  actions.push({
    type: 'command',
    label: 'poll the live daemon Microphone authorization state',
    command: `${prefix} permissions check --json`,
  });
  return actions;
}

export function daemonMicrophoneReadinessNote(daemon) {
  if (!daemon) return 'Daemon Microphone authorization is unavailable; voice readiness fails closed.';
  if (daemonMicrophoneIsAuthorized(daemon)) return null;
  const state = daemonMicrophoneAuthorizationState(daemon);
  return state === 'authorized'
    ? 'Daemon Microphone authorization fields disagree; voice readiness fails closed.'
    : `Daemon Microphone authorization is ${state}.`;
}

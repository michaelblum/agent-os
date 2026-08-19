import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('daemon exclusively owns the microphone authorization request primitive', () => {
  const authorization = read('src/daemon/microphone-authorization.swift');
  const operator = read('src/commands/operator.swift');
  const unified = read('src/daemon/unified.swift');

  assert.match(authorization, /AVCaptureDevice\.requestAccess\(for: \.audio\)/);
  assert.doesNotMatch(operator, /func requestMicrophoneAccess/);
  assert.doesNotMatch(operator, /AVCaptureDevice\.requestAccess\(for: \.audio\)/);
  assert.match(operator, /service: "voice",\s*action: "microphone_authorization_request"/);
  assert.match(unified, /voice-microphone-authorization-status/);
  assert.match(unified, /voice-microphone-authorization-request/);
});

test('daemon health exposes explicit microphone authorization state', () => {
  const unified = read('src/daemon/unified.swift');
  const health = read('src/shared/input-tap-health.swift');

  assert.match(unified, /["']microphone_state["']:\s*microphoneAuthorization\.rawValue/);
  assert.match(health, /microphoneState:\s*String\?/);
  assert.match(health, /microphoneState == ["]authorized["]/);
});

test('screen microphone authorization and native-session ownership stay daemon-shared and effect-ordered', () => {
  const adapter = read('src/daemon/screen-recording-operation-adapter.swift');
  const unified = read('src/daemon/unified.swift');
  const segmented = read('src/daemon/segmented-microphone-capture.swift');
  const session = read('src/daemon/microphone-native-session.swift');
  const state = read('src/daemon/operation-state.swift');
  const acquire = adapter.slice(
    adapter.indexOf('private func acquireAndStart()'),
    adapter.indexOf('private func createArtifactRoot()'),
  );

  assert.ok(acquire.indexOf('authorizeMicrophoneIfSelected()') < acquire.indexOf('sessionFactory('));
  assert.ok(acquire.indexOf('authorizeMicrophoneIfSelected()') < acquire.indexOf('createArtifactRoot()'));
  assert.match(unified, /microphoneAuthorization:\s*AOSScreenRecordingMicrophoneAuthorizationDependencies/u);
  assert.doesNotMatch(adapter, /AVCaptureDevice\.requestAccess/u);
  assert.equal((session.match(/AVAudioEngine\(\)/gu) ?? []).length, 1);
  assert.equal((session.match(/installTap\(/gu) ?? []).length, 1);
  assert.doesNotMatch(segmented, /AVAudioEngine|installTap|removeTap/u);
  assert.doesNotMatch(adapter, /AVAudioEngine|installTap|removeTap/u);
  for (const code of [
    'MICROPHONE_PERMISSION_NOT_DETERMINED',
    'MICROPHONE_PERMISSION_RESTRICTED',
    'MICROPHONE_PERMISSION_DENIED',
    'MICROPHONE_PERMISSION_UNKNOWN',
  ]) assert.match(state, new RegExp(code, 'u'));
});

test('raw repo build stays plain while packaged metadata owns microphone usage text', () => {
  const build = read('build.sh');
  const metadata = read('packaging/Info.plist');

  assert.match(build, /swiftc "\$\{SWIFTC_FLAGS\[@\]\}" "\$\{SWIFT_INPUTS\[@\]\}"/);
  assert.doesNotMatch(build, /RepoRuntimeLinkInfo|sectcreate|__info_plist/);
  assert.doesNotMatch(build, /^\s*(?:\/usr\/bin\/)?(?:codesign|install_name_tool|spctl)\b/m);
  assert.doesNotMatch(build, /^\s*(?:cp|mv)\s+.*(?:\$OUTPUT_PATH|\.\/aos)/m);
  assert.match(metadata, /NSMicrophoneUsageDescription/);
});

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

test('raw repo build stays plain while packaged metadata owns microphone usage text', () => {
  const build = read('build.sh');
  const metadata = read('packaging/Info.plist');

  assert.match(build, /swiftc "\$\{SWIFTC_FLAGS\[@\]\}" "\$\{SWIFT_INPUTS\[@\]\}"/);
  assert.doesNotMatch(build, /RepoRuntimeLinkInfo|sectcreate|__info_plist/);
  assert.doesNotMatch(build, /^\s*(?:\/usr\/bin\/)?(?:codesign|install_name_tool|spctl)\b/m);
  assert.doesNotMatch(build, /^\s*(?:cp|mv)\s+.*(?:\$OUTPUT_PATH|\.\/aos)/m);
  assert.match(metadata, /NSMicrophoneUsageDescription/);
});

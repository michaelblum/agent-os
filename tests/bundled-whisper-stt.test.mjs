import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bundledWhisperStatus,
  STTProviderError,
  transcribeWithBundledWhisper,
} from '../scripts/lib/aos-stt/bundled-whisper.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'tests/fixtures/stt/bundled-whisper');
const audioPath = path.join(fixtureRoot, 'hello.fixture-audio.txt');
const modelPath = path.join(fixtureRoot, 'fake-whisper-model.json');

test('fake Bundled Whisper runner returns deterministic transcript for fixture audio', async () => {
  const result = await transcribeWithBundledWhisper({
    audioPath,
    modelPath,
    fakeRunner: true,
  });

  assert.equal(result.provider, 'bundled-whisper');
  assert.equal(result.mode, 'fake-runner');
  assert.equal(result.model.id, 'fake-bundled-whisper-tiny');
  assert.equal(result.model.distribution, 'fake-test-fixture');
  assert.equal(result.transcript.text, 'hello agent os');
  assert.equal(result.transcript.language, 'en');
  assert.equal(result.audio.bytes > 0, true);
  assert.match(result.audio.sha256, /^[a-f0-9]{64}$/);
});

test('missing model is explicit before runner dispatch', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aos-stt-missing-model-'));
  const missingModel = path.join(tmp, 'missing-whisper-model.bin');
  const status = await bundledWhisperStatus({
    audioPath,
    modelPath: missingModel,
    fakeRunner: true,
  });

  assert.equal(status.status, 'missing_model');
  assert.equal(status.reason, 'model_not_installed');
  await assert.rejects(
    transcribeWithBundledWhisper({ audioPath, modelPath: missingModel, fakeRunner: true }),
    (error) => error instanceof STTProviderError
      && error.code === 'STT_MODEL_MISSING'
      && error.details.model?.installed === false,
  );
});

test('real runner remains unavailable in the spike', async () => {
  const status = await bundledWhisperStatus({
    modelPath,
    runnerPath: path.join(os.tmpdir(), 'aos-missing-whisper-runner'),
  });

  assert.equal(status.status, 'runner_unavailable');
  assert.equal(status.reason, 'runner_not_available');
  await assert.rejects(
    transcribeWithBundledWhisper({ audioPath, modelPath }),
    (error) => error instanceof STTProviderError
      && error.code === 'STT_RUNNER_UNAVAILABLE'
      && error.details.runner?.available === false,
  );
});

test('fake runner fails closed when fixture transcript is absent', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aos-stt-unknown-audio-'));
  const unknownAudio = path.join(tmp, 'unknown.fixture-audio.txt');
  await writeFile(unknownAudio, 'synthetic fixture audio: no transcript here');

  await assert.rejects(
    transcribeWithBundledWhisper({ audioPath: unknownAudio, modelPath, fakeRunner: true }),
    (error) => error instanceof STTProviderError
      && error.code === 'STT_TRANSCRIPT_NOT_FOUND'
      && error.details.audio_path === unknownAudio,
  );
});

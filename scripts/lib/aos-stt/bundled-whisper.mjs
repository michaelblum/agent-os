import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const BUNDLED_WHISPER_PROVIDER_ID = 'bundled-whisper';

export class STTProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'STTProviderError';
    this.code = code;
    this.details = details;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFakeModel(modelPath) {
  let raw;
  try {
    raw = await fs.readFile(modelPath, 'utf8');
  } catch {
    throw new STTProviderError('STT_MODEL_MISSING', `Bundled Whisper model is not installed: ${modelPath}`, {
      model_path: modelPath,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new STTProviderError('STT_MODEL_INVALID', `Bundled Whisper model metadata is invalid: ${modelPath}`, {
      model_path: modelPath,
      cause: error.message,
    });
  }
}

export async function bundledWhisperStatus({ modelPath, runnerPath, fakeRunner = false } = {}) {
  const modelInstalled = Boolean(modelPath) && await fileExists(modelPath);
  const runnerAvailable = fakeRunner || (Boolean(runnerPath) && await fileExists(runnerPath));
  let status = 'available';
  let reason = null;

  if (!modelInstalled) {
    status = 'missing_model';
    reason = 'model_not_installed';
  } else if (!runnerAvailable) {
    status = 'runner_unavailable';
    reason = 'runner_not_available';
  }

  return {
    provider: BUNDLED_WHISPER_PROVIDER_ID,
    status,
    reason,
    model: {
      path: modelPath ?? null,
      installed: modelInstalled,
      distribution: 'not-bundled',
    },
    runner: {
      mode: fakeRunner ? 'fake' : 'external',
      path: runnerPath ?? null,
      available: runnerAvailable,
    },
  };
}

export async function transcribeWithBundledWhisper({ audioPath, modelPath, runnerPath, fakeRunner = false } = {}) {
  if (!audioPath) {
    throw new STTProviderError('STT_AUDIO_MISSING', 'audioPath is required');
  }
  const audio = await fs.readFile(audioPath).catch(() => {
    throw new STTProviderError('STT_AUDIO_MISSING', `Audio fixture is missing: ${audioPath}`, {
      audio_path: audioPath,
    });
  });
  const status = await bundledWhisperStatus({ modelPath, runnerPath, fakeRunner });
  if (status.status === 'missing_model') {
    throw new STTProviderError('STT_MODEL_MISSING', `Bundled Whisper model is not installed: ${modelPath}`, status);
  }
  if (status.status === 'runner_unavailable') {
    throw new STTProviderError('STT_RUNNER_UNAVAILABLE', 'Bundled Whisper runner is unavailable', status);
  }
  if (!fakeRunner) {
    throw new STTProviderError('STT_RUNNER_UNAVAILABLE', 'Real Bundled Whisper runner is not implemented in this spike', status);
  }

  const model = await readFakeModel(modelPath);
  const audioBasename = path.basename(audioPath);
  const audioSha256 = crypto.createHash('sha256').update(audio).digest('hex');
  const transcript = model.transcripts_by_sha256?.[audioSha256]
    ?? model.transcripts_by_fixture?.[audioBasename];
  if (typeof transcript !== 'string' || transcript.length === 0) {
    throw new STTProviderError('STT_TRANSCRIPT_NOT_FOUND', 'Fake Bundled Whisper model has no transcript for fixture audio', {
      audio_path: audioPath,
      audio_sha256: audioSha256,
      model_path: modelPath,
    });
  }

  return {
    provider: BUNDLED_WHISPER_PROVIDER_ID,
    mode: 'fake-runner',
    audio: {
      path: audioPath,
      bytes: audio.byteLength,
      sha256: audioSha256,
    },
    model: {
      path: modelPath,
      id: model.model_id ?? 'fake-bundled-whisper',
      distribution: model.distribution ?? 'fake-test-fixture',
    },
    transcript: {
      text: transcript,
      language: model.language ?? 'en',
    },
  };
}

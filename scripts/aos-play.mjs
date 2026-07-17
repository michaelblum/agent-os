#!/usr/bin/env node

import {
  playAudioFollow,
  writeVoiceCLIError,
} from './lib/aos-voice-follow.mjs';

if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
  process.stdout.write('Usage: aos play --audio <absolute.wav> --follow\n');
  process.exit(0);
}

try {
  await playAudioFollow(process.argv.slice(2));
} catch (error) {
  writeVoiceCLIError(error);
}

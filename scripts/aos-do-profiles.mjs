#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NATURAL_PROFILE = {
  name: 'natural',
  description: 'Default human-like feel — moderate speed, natural variance',
  timing: {
    keystroke_delay: { min: 80, max: 250, distribution: 'gaussian' },
    typing_cadence: { wpm: 65, variance: 0.3, pause_after_word: { min: 30, max: 150 } },
    click_dwell: { min: 40, max: 120 },
    action_gap: { min: 100, max: 400 },
  },
  mouse: {
    pixels_per_second: 800,
    curve: 'bezier',
    jitter: 2,
    overshoot: 0.05,
  },
  scroll: {
    events_per_action: 4,
    deceleration: 0.7,
    interval_ms: 30,
  },
  ax: {
    depth: 20,
    timeout: 5000,
  },
};

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  const text = String(arg);
  if (text.startsWith('-')) error(`Unknown flag: ${text}`, 'UNKNOWN_FLAG');
  error(`Unknown argument: ${text}`, 'UNKNOWN_ARG');
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function profilesDir() {
  return path.join(stateRoot(), runtimeMode(), 'profiles');
}

function readUserProfile(name) {
  const file = path.join(profilesDir(), `${name}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadProfile(name) {
  const userProfile = readUserProfile(name);
  if (userProfile) return userProfile;
  if (name === 'natural') return NATURAL_PROFILE;
  return null;
}

function listProfiles() {
  const results = [];
  const seen = new Set();
  try {
    for (const entry of fs.readdirSync(profilesDir())) {
      if (!entry.endsWith('.json')) continue;
      const name = entry.slice(0, -5);
      const profile = readUserProfile(name);
      if (!profile) continue;
      const item = { name, source: 'user' };
      if (profile.description !== undefined) item.description = profile.description;
      results.push(item);
      seen.add(name);
    }
  } catch {
    // Missing profile directory is normal.
  }
  if (!seen.has('natural')) {
    results.push({
      name: 'natural',
      source: 'built-in',
      description: NATURAL_PROFILE.description,
    });
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === 'list') {
  process.stdout.write(`${JSON.stringify(listProfiles())}\n`);
} else if (args.length === 1) {
  const profile = loadProfile(args[0]);
  if (!profile) error(`Profile not found: ${args[0]}`, 'PROFILE_NOT_FOUND');
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
} else {
  unknownArg(args[1]);
}

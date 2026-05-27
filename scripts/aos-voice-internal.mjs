#!/usr/bin/env node

const voicePrefix = 'voice://';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function makeVoiceID(provider, providerVoiceID) {
  if (!provider || provider.includes('/') || !providerVoiceID) return null;
  return `${voicePrefix}${provider}/${providerVoiceID}`;
}

function parseVoiceID(id) {
  if (!id.startsWith(voicePrefix)) return null;
  const body = id.slice(voicePrefix.length);
  const slash = body.indexOf('/');
  if (slash < 0) return null;
  const provider = body.slice(0, slash);
  const suffix = body.slice(slash + 1);
  if (!provider || !suffix) return null;
  return { provider, provider_voice_id: suffix };
}

function canonicalize(rawID) {
  if (rawID.startsWith(voicePrefix)) return rawID;
  return makeVoiceID('system', rawID);
}

function unknownArg(arg) {
  if (String(arg).startsWith('-')) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  error(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
}

function parseValueFlags(args, allowed) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) unknownArg(arg);
    if (!allowed.includes(arg)) unknownArg(arg);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) error(`Missing value for ${arg}`, 'MISSING_ARG');
    values.set(arg, args[i + 1]);
    i += 1;
  }
  return values;
}

function idRoundtrip(args) {
  const flags = parseValueFlags(args, ['--provider', '--suffix', '--raw']);
  const raw = flags.get('--raw');
  if (raw !== undefined) {
    const parsed = parseVoiceID(raw);
    if (!parsed) {
      process.stderr.write('VOICE_ID_INVALID\n');
      process.exit(2);
    }
    process.stdout.write(`${raw}|${parsed.provider}|${parsed.provider_voice_id}\n`);
    return;
  }

  const provider = flags.get('--provider');
  const suffix = flags.get('--suffix');
  const uri = makeVoiceID(provider, suffix);
  if (!uri) error('missing --provider/--suffix', 'MISSING_ARG');
  const parsed = parseVoiceID(uri);
  if (!parsed) error('VOICE_ID_INVALID', 'VOICE_ID_INVALID');
  process.stdout.write(`${uri}|${parsed.provider}|${parsed.provider_voice_id}\n`);
}

function canonicalizeCommand(args) {
  const flags = parseValueFlags(args, ['--id']);
  const id = flags.get('--id');
  if (id === undefined) error('missing --id', 'MISSING_ARG');
  process.stdout.write(`${canonicalize(id)}\n`);
}

function mockVoices() {
  return ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((name, index) => ({
    id: makeVoiceID('mock', `mock-${name.toLowerCase()}`),
    provider: 'mock',
    provider_voice_id: `mock-${name.toLowerCase()}`,
    name,
    display_name: null,
    locale: 'en-US',
    language: 'en',
    region: 'US',
    gender: index % 2 === 0 ? 'female' : 'male',
    kind: 'human',
    quality_tier: index === 0 ? 'premium' : (index === 1 ? 'enhanced' : 'standard'),
    tags: index === 4 ? ['novelty'] : (index % 2 === 0 ? ['calm'] : ['bright']),
    capabilities: { local: true, streaming: false, ssml: false, speak_supported: true },
    availability: { installed: true, enabled: true, reachable: true },
    metadata: {},
  }));
}

function elevenLabsVoices() {
  const rows = [
    ['21m00Tcm4TlvDq8ikWAM', 'Rachel', 'female', 'human', 'standard'],
    ['AZnzlk1XvdvUeBnXmlld', 'Domi', 'female', 'human', 'standard'],
    ['ErXwobaYiN019PkySvjV', 'Antoni', 'male', 'human', 'standard'],
    ['MF3mGyEYCl7XYWbV9V6O', 'Elli', 'female', 'human', 'standard'],
    ['VR6AewLTigWG4xSOukaG', 'Arnold', 'neutral', 'character', 'premium'],
  ];
  const reachable = process.env.AOS_VOICE_TEST_ELEVENLABS_UNREACHABLE !== '1';
  return rows.map(([suffix, name, gender, kind, costClass]) => ({
    id: makeVoiceID('elevenlabs', suffix),
    provider: 'elevenlabs',
    provider_voice_id: suffix,
    name,
    display_name: null,
    locale: 'en-US',
    language: 'en',
    region: 'US',
    gender,
    kind,
    quality_tier: 'standard',
    tags: [kind, 'remote', 'stub'],
    capabilities: { local: false, streaming: true, ssml: false, speak_supported: false },
    availability: { installed: true, enabled: true, reachable },
    metadata: { cost_class: costClass },
  }));
}

function registrySnapshot(args) {
  if (args.length > 0) unknownArg(args[0]);
  const voices = [...elevenLabsVoices()];
  if (process.env.AOS_VOICE_TEST_PROVIDERS === 'mock') voices.push(...mockVoices());
  voices.sort((a, b) => (
    a.provider.localeCompare(b.provider)
    || a.name.localeCompare(b.name)
    || a.provider_voice_id.localeCompare(b.provider_voice_id)
  ));
  process.stdout.write(`${JSON.stringify(voices, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case '_internal-id-roundtrip':
    idRoundtrip(args);
    break;
  case '_internal-canonicalize':
    canonicalizeCommand(args);
    break;
  case '_internal-registry-snapshot':
    registrySnapshot(args);
    break;
  default:
    error(`Unknown voice internal command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
}

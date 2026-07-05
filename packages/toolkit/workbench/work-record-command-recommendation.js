function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function shellQuoteArg(value = '') {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(raw)) return raw;
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

export function commandHintFromArgv(argv = []) {
  return Array.isArray(argv) ? argv.map(shellQuoteArg).join(' ') : '';
}

export function commandRecommendation(argv = []) {
  const normalizedArgv = Array.isArray(argv) ? argv.map((arg) => String(arg)) : [];
  if (normalizedArgv.length === 0 || !text(normalizedArgv[0])) {
    return { argv: [], command_hint: '' };
  }
  return {
    argv: normalizedArgv,
    command_hint: commandHintFromArgv(normalizedArgv),
  };
}

export function workRecordReadRecommendation(id = '', root = '') {
  if (!text(id) || !text(root)) return { argv: [], command_hint: '' };
  return commandRecommendation(['./aos', 'work-record', 'read', id, '--root', root, '--json']);
}

export function workRecordSupersessionLookupRecommendation(source = '', indexRoot = '') {
  if (!text(source) || !text(indexRoot)) return { argv: [], command_hint: '' };
  return commandRecommendation(['./aos', 'work-record', 'supersession', 'lookup', '--source', source, '--index-root', indexRoot, '--json']);
}

export function workRecordSupersessionWriteRecommendation({
  source = '',
  replacement = '',
  indexRoot = '',
  replacementRoot = '',
} = {}) {
  if (!text(source) || !text(replacement) || !text(indexRoot) || !text(replacementRoot)) {
    return { argv: [], command_hint: '' };
  }
  return commandRecommendation([
    './aos',
    'work-record',
    'supersession',
    'write',
    '--source',
    source,
    '--replacement',
    replacement,
    '--index-root',
    indexRoot,
    '--replacement-root',
    replacementRoot,
    '--json',
  ]);
}

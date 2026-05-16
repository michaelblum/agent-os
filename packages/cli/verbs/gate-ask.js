#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createGateService, normalizeGateRequest } from '../../daemon/gate/index.js';

function usage() {
  return `Usage:
  aos gate ask "Prompt title"
  aos gate ask --preset approve_deny --title "Run test?" --timeout 30
  aos gate ask --request gate-request.json
  aos gate ask --json '{"prompt":{"title":"Continue?"},"ui":{"variant":"yes_no_with_escape"}}'

	Writes an answered JSON value, or a no-answer envelope with status "dismissed" or "timeout", to stdout.`;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(data));
  });
}

function parseArgs(argv) {
  const parsed = {
    title: null,
    message: null,
    preset: null,
    timeoutSeconds: null,
    requestFile: null,
    json: null,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--request') {
      parsed.requestFile = argv[++index];
    } else if (arg === '--json') {
      parsed.json = argv[++index];
    } else if (arg === '--preset') {
      parsed.preset = argv[++index];
    } else if (arg === '--title') {
      parsed.title = argv[++index];
    } else if (arg === '--message' || arg === '--body') {
      parsed.message = argv[++index];
    } else if (arg === '--timeout') {
      parsed.timeoutSeconds = Number(argv[++index]);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!parsed.title && positional.length) parsed.title = positional.join(' ');
  return parsed;
}

async function requestFromArgs(args) {
  if (args.requestFile) return JSON.parse(await readFile(args.requestFile, 'utf8'));
  if (args.json) return JSON.parse(args.json);

  if (!args.title && !process.stdin.isTTY) {
    const stdin = (await readStdin()).trim();
    if (stdin) return JSON.parse(stdin);
  }

  if (!args.title) throw new Error('prompt title is required');
  return {
    schema_version: 'aos.gate.request.v1',
    prompt: { title: args.title, body: args.message ?? null },
    ui: { variant: args.preset || 'yes_no_with_escape' },
    timeout_ms: Number.isFinite(args.timeoutSeconds) ? args.timeoutSeconds * 1000 : 20000,
    source: { surface: 'aos-cli' },
  };
}

export async function runGateAsk(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
  service = createGateService(),
} = {}) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const request = normalizeGateRequest(await requestFromArgs(args));
    const result = await service.ask(request);
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code ? `${error.code}: ` : '';
    stderr.write(`aos gate ask: ${code}${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runGateAsk();
}

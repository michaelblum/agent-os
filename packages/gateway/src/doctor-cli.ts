#!/usr/bin/env node
import { collectReport, renderText } from './doctor.js';
import type { RuntimeMode } from './mode.js';

interface Args {
  mode?: RuntimeMode;
  stateRoot?: string;
  quick: boolean;
  json?: boolean;
  pretty?: boolean;
  tail?: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { quick: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--quick':
        out.quick = true;
        break;
      case '--json':
        out.json = true;
        break;
      case '--pretty':
        out.pretty = true;
        break;
      case '--mode': {
        const v = argv[++i];
        if (v !== 'repo' && v !== 'installed') throw new Error(`--mode must be repo or installed (got ${v})`);
        out.mode = v;
        break;
      }
      case '--state-root':
        out.stateRoot = argv[++i];
        break;
      case '--tail': {
        const n = Number.parseInt(argv[++i] ?? '', 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error('--tail requires positive integer');
        out.tail = n;
        break;
      }
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  const stateDirHint = process.env.AOS_STATE_ROOT ?? '~/.config/aos';
  process.stdout.write(`aos-gateway doctor

Usage: aos-gateway-doctor [--mode repo|installed] [--state-root PATH]
                          [--quick] [--json|--pretty] [--tail N]

Reports coordinated health of the gateway MCP server and integration broker.

Output format defaults to JSON on non-TTY, pretty text on TTY.

State root: ${stateDirHint}
  (override via --state-root or AOS_STATE_ROOT)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.stateRoot) process.env.AOS_STATE_ROOT = args.stateRoot;
  if (args.mode) process.env.AOS_RUNTIME_MODE = args.mode;

  const mode: RuntimeMode = args.mode ?? (process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo');

  const report = await collectReport(mode, process.env, { quick: args.quick, tail: args.tail });

  const useJson = args.json === true ? true : args.pretty === true ? false : !process.stdout.isTTY;
  if (useJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(renderText(report));
  process.exit(report.exit_code);
}

main().catch((err) => {
  process.stderr.write(`aos-gateway-doctor: ${err.message}\n`);
  process.exit(2);
});

#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`{\n  "code" : ${JSON.stringify(code)},\n  "error" : ${JSON.stringify(message)}\n}\n`);
  process.exit(1);
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function zonesPath() {
  return path.join(stateRoot(), runtimeMode(), 'zones.json');
}

function loadZones() {
  try {
    return JSON.parse(fs.readFileSync(zonesPath(), 'utf8'));
  } catch {
    return {};
  }
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function saveZones(zones) {
  const file = zonesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sortObject(zones), null, 2)}\n`);
}

function parseBounds(value) {
  const parts = String(value).split(',').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    error('Bounds must be x,y,w,h', 'INVALID_ARG');
  }
  return value;
}

function listCommand(args) {
  if (args.length > 0) error(`Unknown argument: ${args[0]}`, 'UNKNOWN_ARG');
  process.stdout.write(`${JSON.stringify(loadZones(), null, 2)}\n`);
}

function saveCommand(args) {
  if (args.length < 2) {
    error('zone save requires <name> and <bounds>. Usage: aos see zone save <name> <x,y,w,h> [--target <d>]', 'MISSING_ARG');
  }
  const name = args[0];
  let target = 'main';
  let bounds;
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--target') {
      i += 1;
      if (i >= args.length) error('--target requires a value', 'MISSING_ARG');
      target = args[i];
    } else if (args[i] === '--bounds') {
      i += 1;
      if (i >= args.length) error('--bounds requires a value', 'MISSING_ARG');
      bounds = args[i];
    } else {
      bounds = args[i];
    }
  }
  if (!bounds) error('Missing bounds. Provide x,y,w,h.', 'MISSING_ARG');
  const zones = loadZones();
  zones[name] = { target, crop: parseBounds(bounds) };
  saveZones(zones);
  process.stdout.write(`${JSON.stringify({ status: 'saved', zone: name }, null, 2)}\n`);
}

function deleteCommand(args) {
  if (args.length < 1) {
    error('zone delete requires <name>. Usage: aos see zone delete <name>', 'MISSING_ARG');
  }
  if (args.length > 1) error(`Unknown argument: ${args[1]}`, 'UNKNOWN_ARG');
  const zones = loadZones();
  if (!Object.prototype.hasOwnProperty.call(zones, args[0])) {
    error(`Zone '${args[0]}' not found`, 'ZONE_NOT_FOUND');
  }
  delete zones[args[0]];
  saveZones(zones);
  process.stdout.write(`${JSON.stringify({ status: 'deleted', zone: args[0] }, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'list':
    listCommand(args);
    break;
  case 'save':
  case 'define':
    saveCommand(args);
    break;
  case 'delete':
    deleteCommand(args);
    break;
  default:
    error(`Unknown zone command: '${command ?? ''}'. Use save, define, list, or delete.`, 'UNKNOWN_SUBCOMMAND');
}

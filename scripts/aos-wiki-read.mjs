#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const namespace = 'aos';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function wikiRoot() {
  return path.join(stateRoot(), runtimeMode(), 'wiki');
}

function asJSON(args) {
  return args.includes('--json');
}

function rejectUnknownFlags(args, allowed) {
  for (const arg of args) {
    if (arg.startsWith('--') && !allowed.includes(arg)) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  }
}

function nonFlags(args) {
  return args.filter((arg) => !arg.startsWith('-'));
}

function bareNameCandidates(arg) {
  return [
    `${namespace}/entities/${arg}.md`,
    `${namespace}/concepts/${arg}.md`,
    `${namespace}/plugins/${arg}/SKILL.md`,
    `entities/${arg}.md`,
    `concepts/${arg}.md`,
    `plugins/${arg}/SKILL.md`,
  ];
}

function resolveWikiPath(arg) {
  if (arg.includes('/') || arg.includes('.md')) {
    const absolute = path.join(wikiRoot(), arg);
    return fs.existsSync(absolute) ? { relative: arg, absolute } : null;
  }
  for (const relative of bareNameCandidates(arg)) {
    const absolute = path.join(wikiRoot(), relative);
    if (fs.existsSync(absolute)) return { relative, absolute };
  }
  return null;
}

function resolvePluginSkill(name) {
  for (const relative of [
    `${namespace}/plugins/${name}/SKILL.md`,
    `plugins/${name}/SKILL.md`,
  ]) {
    const absolute = path.join(wikiRoot(), relative);
    if (fs.existsSync(absolute)) return { relative, absolute };
  }
  return null;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return { raw: {}, body: content };
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { raw: {}, body: content };
  const rawText = content.slice(4, end);
  const body = content.slice(end + '\n---'.length).replace(/^\r?\n/, '');
  const raw = {};
  for (const line of rawText.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    raw[key] = value;
  }
  return { raw, body };
}

function parseTags(raw) {
  const value = raw.tags || '';
  if (!value.startsWith('[') || !value.endsWith(']')) return [];
  return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
}

function showCommand(args) {
  rejectUnknownFlags(args, ['--json', '--raw']);
  const json = asJSON(args);
  const rawMode = args.includes('--raw');
  const target = nonFlags(args)[0];
  if (!target) error('wiki show requires a path. Usage: aos wiki show <path> [--raw] [--json]', 'MISSING_ARG');
  const resolved = resolveWikiPath(target);
  if (!resolved) error(`Page '${target}' not found. Try 'aos wiki list' to see available pages.`, 'WIKI_NOT_FOUND');
  const content = fs.readFileSync(resolved.absolute, 'utf8');
  if (rawMode) {
    process.stdout.write(content);
    if (!content.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  const page = parseFrontmatter(content);
  if (json) {
    process.stdout.write(`${JSON.stringify({ path: resolved.relative, frontmatter: page.raw, body: page.body, raw: content }, null, 2)}\n`);
  } else {
    if (page.raw.name) process.stdout.write(`# ${page.raw.name}\n`);
    if (page.raw.type) process.stdout.write(`Type: ${page.raw.type}\n`);
    if (page.raw.description) process.stdout.write(`Description: ${page.raw.description}\n`);
    const tags = parseTags(page.raw);
    if (tags.length) process.stdout.write(`Tags: ${tags.join(', ')}\n`);
    process.stdout.write('---\n');
    process.stdout.write(page.body);
    if (!page.body.endsWith('\n')) process.stdout.write('\n');
  }
}

function invokeCommand(args) {
  rejectUnknownFlags(args, ['--json']);
  const json = asJSON(args);
  const name = nonFlags(args)[0];
  if (!name) error('wiki invoke requires a plugin name. Usage: aos wiki invoke <name>', 'MISSING_ARG');
  const resolved = resolvePluginSkill(name);
  if (!resolved) error(`Plugin '${name}' not found`, 'WIKI_NOT_FOUND');
  const pluginDir = path.dirname(resolved.absolute);
  let bundle = fs.readFileSync(resolved.absolute, 'utf8');

  const refsDir = path.join(pluginDir, 'references');
  if (fs.existsSync(refsDir)) {
    for (const refFile of fs.readdirSync(refsDir).sort().filter((file) => file.endsWith('.md'))) {
      bundle += `\n\n--- BEGIN reference: ${refFile} ---\n\n`;
      bundle += fs.readFileSync(path.join(refsDir, refFile), 'utf8');
      bundle += `\n\n--- END reference: ${refFile} ---`;
    }
  }

  const scriptsDir = path.join(pluginDir, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    for (const scriptFile of fs.readdirSync(scriptsDir).sort()) {
      const scriptPath = path.join(scriptsDir, scriptFile);
      if (!fs.statSync(scriptPath).isFile()) continue;
      bundle += `\n\n--- BEGIN script: ${scriptFile} ---\n\n`;
      bundle += fs.readFileSync(scriptPath, 'utf8');
      bundle += `\n\n--- END script: ${scriptFile} ---`;
    }
  }

  if (json) process.stdout.write(`${JSON.stringify({ plugin: name, bundle }, null, 2)}\n`);
  else process.stdout.write(bundle.endsWith('\n') ? bundle : `${bundle}\n`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'show') showCommand(args);
else if (command === 'invoke') invokeCommand(args);
else error(`Unknown wiki read command: ${command ?? ''}`, 'UNKNOWN_COMMAND');

#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const namespace = 'aos';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
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

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function asJSON(args) {
  return args.includes('--json');
}

function rejectUnknownFlags(args, allowed = ['--json']) {
  for (const arg of args) {
    if (arg.startsWith('--') && !allowed.includes(arg)) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
  }
}

function nonFlags(args) {
  return args.filter((arg) => !arg.startsWith('-'));
}

function displayName(name) {
  return name.replaceAll('-', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function emitJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function containedPath(root, ...parts) {
  const base = path.resolve(root);
  const absolute = path.resolve(base, ...parts);
  const relative = path.relative(base, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    error('Wiki path must stay inside the wiki root', 'WIKI_INVALID_PATH');
  }
  return { relative: relative.split(path.sep).join('/'), absolute };
}

function runAOS(args, capture = false) {
  const result = spawnSync(aosPath(), args, {
    encoding: 'utf8',
    env: process.env,
  });
  if (!capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
}

function reindex() {
  runAOS(['wiki', 'reindex'], true);
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
    const resolved = containedPath(wikiRoot(), arg);
    return fs.existsSync(resolved.absolute) ? resolved : null;
  }
  for (const relative of bareNameCandidates(arg)) {
    const resolved = containedPath(wikiRoot(), relative);
    if (fs.existsSync(resolved.absolute)) return resolved;
  }
  return null;
}

function relativeLink(from, to) {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common += 1;
  return [...Array(fromParts.length - common).fill('..'), ...toParts.slice(common)].join('/');
}

function frontmatterName(content, fallback) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fallback;
  const name = match[1].split(/\r?\n/).find((line) => line.startsWith('name:'));
  if (!name) return fallback;
  return name.slice('name:'.length).trim().replace(/^["']|["']$/g, '') || fallback;
}

function createPlugin(args) {
  rejectUnknownFlags(args);
  const json = asJSON(args);
  const positional = nonFlags(args);
  const name = positional[0];
  if (!name) error('wiki create-plugin requires a name. Usage: aos wiki create-plugin <name>', 'MISSING_ARG');
  if (positional.length > 1) unknownArg(positional[1]);
  const pluginDir = containedPath(wikiRoot(), namespace, 'plugins', name).absolute;
  const skillPath = containedPath(pluginDir, 'SKILL.md').absolute;
  if (fs.existsSync(skillPath)) error(`Plugin '${name}' already exists at ${pluginDir}`, 'WIKI_PLUGIN_EXISTS');

  fs.mkdirSync(path.join(pluginDir, 'references'), { recursive: true });
  const template = `---
name: ${name}
description: >
  Describe when this plugin should be used. Include trigger phrases
  and contexts where it should activate.
version: "0.1.0"
author: ""
tags: []
triggers: []
requires: []
---

# ${displayName(name)}

## Purpose

Describe what this workflow does and why.

## Steps

1. First step
2. Second step

## Related

`;
  fs.writeFileSync(skillPath, template);
  reindex();
  if (json) emitJSON({ status: 'ok', plugin: name, path: pluginDir });
  else process.stdout.write(`Created plugin '${name}' at ${pluginDir}\nEdit: ${skillPath}\n`);
}

function addPage(args) {
  rejectUnknownFlags(args);
  const json = asJSON(args);
  const positional = nonFlags(args);
  if (positional.length < 2) error('wiki add requires <entity|concept> <name>. Usage: aos wiki add <entity|concept> <name> [--description <d>]', 'MISSING_ARG');
  if (positional.length > 2) unknownArg(positional[2]);
  const [typeArg, name] = positional;
  if (!['entity', 'concept'].includes(typeArg)) error(`Type must be 'entity' or 'concept', got '${typeArg}'`, 'WIKI_INVALID_TYPE');
  const dirName = typeArg === 'entity' ? 'entities' : 'concepts';
  const filePath = containedPath(wikiRoot(), namespace, dirName, `${name}.md`).absolute;
  if (fs.existsSync(filePath)) error(`Page '${name}' already exists at ${filePath}`, 'WIKI_PAGE_EXISTS');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const title = displayName(name);
  const template = `---
type: ${typeArg}
name: ${title}
description: ""
tags: []
---

# ${title}

## Overview

## Related

`;
  fs.writeFileSync(filePath, template);
  reindex();
  if (json) emitJSON({ status: 'ok', type: typeArg, name, path: filePath });
  else process.stdout.write(`Created ${typeArg} '${name}' at ${filePath}\n`);
}

function removePage(args) {
  rejectUnknownFlags(args);
  const json = asJSON(args);
  const positional = nonFlags(args);
  const target = positional[0];
  if (!target) error('wiki rm requires a path. Usage: aos wiki rm <path>', 'MISSING_ARG');
  if (positional.length > 1) unknownArg(positional[1]);
  const resolved = resolveWikiPath(target);
  if (!resolved) error(`Page '${target}' not found`, 'WIKI_NOT_FOUND');
  let incoming = [];
  try {
    incoming = JSON.parse(runAOS(['wiki', 'list', '--links-to', resolved.relative, '--json'], true));
  } catch {
    incoming = [];
  }
  fs.rmSync(resolved.absolute, { force: true });
  reindex();
  if (json) emitJSON({ status: 'ok', removed: resolved.relative, broken_links: incoming.length });
  else {
    if (incoming.length > 0) {
      process.stdout.write(`Warning: ${incoming.length} page(s) link to this page:\n`);
      for (const link of incoming) process.stdout.write(`  ${link.source_path}\n`);
    }
    process.stdout.write(`Removed ${resolved.relative}\n`);
  }
}

function linkPages(args) {
  rejectUnknownFlags(args);
  const json = asJSON(args);
  const positional = nonFlags(args);
  if (positional.length < 2) error('wiki link requires <from> and <to>. Usage: aos wiki link <from> <to>', 'MISSING_ARG');
  if (positional.length > 2) unknownArg(positional[2]);
  const from = resolveWikiPath(positional[0]);
  if (!from) error(`Source page '${positional[0]}' not found`, 'WIKI_NOT_FOUND');
  const to = resolveWikiPath(positional[1]);
  if (!to) error(`Target page '${positional[1]}' not found`, 'WIKI_NOT_FOUND');

  const toContent = fs.readFileSync(to.absolute, 'utf8');
  const linkLine = `- [${frontmatterName(toContent, positional[1])}](${relativeLink(from.relative, to.relative)})`;
  let content = fs.readFileSync(from.absolute, 'utf8');
  if (content.includes('## Related')) content = content.replace('## Related\n', `## Related\n${linkLine}\n`);
  else content += `\n## Related\n${linkLine}\n`;
  fs.writeFileSync(from.absolute, content);
  reindex();
  if (json) emitJSON({ status: 'ok', from: from.relative, to: to.relative });
  else process.stdout.write(`Linked ${from.relative} -> ${to.relative}\n`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'create-plugin':
    createPlugin(args);
    break;
  case 'add':
    addPage(args);
    break;
  case 'rm':
    removePage(args);
    break;
  case 'link':
    linkPages(args);
    break;
  default:
    error(`Unknown wiki mutation command: ${command ?? ''}`, 'UNKNOWN_COMMAND');
}

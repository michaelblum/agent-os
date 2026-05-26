#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectionID = 'repo_docs_v0';
const defaultManifest = 'docs/wiki/repo-docs-projection-v0.json';
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

function repoRoot() {
  const configured = process.env.AOS_REPO_ROOT;
  return configured && !configured.startsWith('$') ? configured : process.cwd();
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function parseArgs(args) {
  const options = { json: false, dryRun: false, manifest: defaultManifest };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--manifest') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) error('--manifest requires a value', 'MISSING_ARG');
      options.manifest = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--')) error(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    else error(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
  }
  return options;
}

function absoluteRepoPath(root, relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
}

function isSafeRepoRelativePath(value) {
  return value && !path.isAbsolute(value) && !value.includes('..') && !value.includes('\\');
}

function isSafeWikiSlug(value) {
  return /^[a-z0-9][a-z0-9-]*$/.test(value || '');
}

function yamlScalar(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function yamlInlineArray(values) {
  return `[${values.map(yamlScalar).join(', ')}]`;
}

function sha256String(content) {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

function markdownCodeFence(content) {
  let longest = 0;
  let current = 0;
  for (const ch of content) {
    if (ch === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function escapeSourceLinksForWikiProjection(content) {
  return content.replaceAll('](', ']\\(');
}

function projectedWikiRelativePath(slug) {
  return `${namespace}/concepts/${slug}.md`;
}

function relatedProjectionEntries(entry, entries) {
  const concepts = new Set(entry.concepts.map((concept) => concept.toLowerCase()));
  const related = new Map();
  for (const candidate of entries) {
    if (!candidate.concepts.some((concept) => concepts.has(concept.toLowerCase()))) continue;
    related.set(candidate.slug, candidate);
  }
  return [...related.values()];
}

function renderProjectedRepoDocPage(entry, sourceContent, sourceHash, relatedEntries) {
  const projectedSource = escapeSourceLinksForWikiProjection(sourceContent.trimEnd());
  const related = relatedEntries
    .filter((candidate) => candidate.slug !== entry.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((candidate) => `- [${candidate.name}](${candidate.slug}.md)`)
    .join('\n');
  const relatedBlock = related || '- No same-concept projected pages in this manifest.';
  const fence = markdownCodeFence(projectedSource);

  return `---
type: ${entry.type}
name: ${yamlScalar(entry.name)}
description: ${yamlScalar(entry.description)}
tags: ${yamlInlineArray(entry.tags)}
generated: true
projection: ${projectionID}
source_path: ${entry.source_path}
source_hash: ${sourceHash}
source_type: ${entry.source_type}
concepts: ${yamlInlineArray(entry.concepts)}
---

# ${entry.name}

This runtime wiki page is generated from repo Git docs. Git is canonical; this wiki page is only a deterministic projection for query and orientation.

## Canonical Source

- Source path: \`${entry.source_path}\`
- Source hash: \`${sourceHash}\`
- Source type: \`${entry.source_type}\`

## Controlled Concepts

${entry.concepts.map((concept) => `- \`${concept}\``).join('\n')}

## Projected Source

${fence}markdown
${projectedSource}
${fence}

## Related Projected Pages

${relatedBlock}
`;
}

function parseFrontmatterRaw(content) {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end < 0) return {};
  const raw = {};
  let currentKey = null;
  let currentValue = '';
  for (const line of content.slice(4, end).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\s/.test(line) && currentKey) {
      currentValue += ` ${trimmed}`;
      raw[currentKey] = currentValue;
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    currentKey = trimmed.slice(0, colon).trim();
    currentValue = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    raw[currentKey] = currentValue;
  }
  return raw;
}

function findStaleRepoDocProjectionPages(root, livePaths) {
  const conceptsDir = path.join(root, namespace, 'concepts');
  if (!fs.existsSync(conceptsDir)) return [];
  const stale = [];
  for (const file of fs.readdirSync(conceptsDir).sort()) {
    if (!file.endsWith('.md')) continue;
    const relative = `${namespace}/concepts/${file}`;
    if (livePaths.has(relative)) continue;
    const content = fs.readFileSync(path.join(conceptsDir, file), 'utf8');
    const frontmatter = parseFrontmatterRaw(content);
    if (frontmatter.generated === 'true' && frontmatter.projection === projectionID) stale.push(relative);
  }
  return stale;
}

function projectionResult(manifestPath, dryRun, projected, unchanged, removed, stale, indexed, pages, errors) {
  return {
    status: errors.length === 0 ? 'ok' : 'error',
    manifest: manifestPath,
    projection: projectionID,
    dry_run: dryRun,
    projected,
    unchanged,
    removed,
    stale,
    indexed,
    errored: errors.length,
    pages: [...pages].sort(),
    errors,
  };
}

function runReindex() {
  const result = spawnSync(aosPath(), ['wiki', 'reindex', '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

function runProjection(options) {
  const root = repoRoot();
  const rootWiki = wikiRoot();
  const manifestPath = absoluteRepoPath(root, options.manifest);
  if (!fs.existsSync(manifestPath)) {
    return projectionResult(manifestPath, options.dryRun, 0, 0, 0, 0, 0, [], [`Manifest not found at ${manifestPath}`]);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return projectionResult(manifestPath, options.dryRun, 0, 0, 0, 0, 0, [], [`Could not parse manifest: ${err.message}`]);
  }
  if (manifest.projection !== projectionID) {
    return projectionResult(manifestPath, options.dryRun, 0, 0, 0, 0, 0, [], [`Unsupported projection '${manifest.projection}'`]);
  }

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const errors = [];
  const slugs = new Set();
  const sources = new Set();
  for (const entry of entries) {
    if (!isSafeRepoRelativePath(entry.source_path)) errors.push(`Unsafe source path: ${entry.source_path}`);
    if (!isSafeWikiSlug(entry.slug)) errors.push(`Unsafe slug: ${entry.slug}`);
    if (slugs.has(entry.slug)) errors.push(`Duplicate slug: ${entry.slug}`);
    slugs.add(entry.slug);
    if (sources.has(entry.source_path)) errors.push(`Duplicate source path: ${entry.source_path}`);
    sources.add(entry.source_path);
  }
  if (errors.length > 0) return projectionResult(manifestPath, options.dryRun, 0, 0, 0, 0, 0, [], errors);

  const livePaths = new Set(entries.map((entry) => projectedWikiRelativePath(entry.slug)));
  let projected = 0;
  let unchanged = 0;
  const pages = [];

  for (const entry of [...entries].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const sourcePath = absoluteRepoPath(root, entry.source_path);
    if (!fs.existsSync(sourcePath)) {
      errors.push(`Could not read source: ${entry.source_path}`);
      continue;
    }
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    const sourceHash = sha256String(sourceContent);
    const relativePath = projectedWikiRelativePath(entry.slug);
    const targetPath = path.join(rootWiki, relativePath);
    const content = renderProjectedRepoDocPage(entry, sourceContent, sourceHash, relatedProjectionEntries(entry, entries));
    pages.push(relativePath);

    if (fs.existsSync(targetPath) && fs.readFileSync(targetPath, 'utf8') === content) {
      unchanged += 1;
      continue;
    }

    projected += 1;
    if (!options.dryRun) {
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content);
      } catch (err) {
        errors.push(`Could not write ${relativePath}: ${err.message}`);
      }
    }
  }

  const stalePages = findStaleRepoDocProjectionPages(rootWiki, livePaths);
  if (!options.dryRun) {
    for (const stale of stalePages) fs.rmSync(path.join(rootWiki, stale), { force: true });
  }

  let indexed = 0;
  if (!options.dryRun && errors.length === 0) {
    runReindex();
    indexed = pages.length;
  }

  return projectionResult(
    manifestPath,
    options.dryRun,
    projected,
    unchanged,
    options.dryRun ? 0 : stalePages.length,
    stalePages.length,
    indexed,
    pages,
    errors,
  );
}

const options = parseArgs(process.argv.slice(2));
const result = runProjection(options);
if (result.errored > 0) {
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const item of result.errors) process.stderr.write(`Error: ${item}\n`);
  process.exit(1);
}
if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (options.dryRun) {
  process.stdout.write(`Repo docs projection dry run: ${result.projected} would update, ${result.unchanged} unchanged, ${result.removed} stale generated page(s) would be removed.\n`);
} else {
  process.stdout.write(`Repo docs projection complete: ${result.projected} projected, ${result.unchanged} unchanged, ${result.removed} stale generated page(s) removed, ${result.indexed} indexed.\n`);
}

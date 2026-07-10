#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const detectorNotice = 'Heuristic tripwire only: passing this lint does not prove durable docs are drift-free or current.';

const defaultIncludePrefixes = [
  '.docks/',
  'docs/adr/',
  'docs/design/',
  'docs/dev/',
];

const defaultExcludedPrefixes = [
  'docs/design/work-cards/',
  'docs/dev/work-cards/',
];

const lifecycleKeywords = [
  'open',
  'closed',
  'merged',
  'active',
  'parked',
  'blocked',
  'valid',
  'closable',
  'ready',
  'waiting',
];
const lifecycleKeywordPattern = lifecycleKeywords.map(escapeRegex).join('|');
const lifecycleKeywordLookaheads = lifecycleKeywords.map((keyword) => `(?!${escapeRegex(keyword)}\\b)`).join('');

const claimMarkerPattern = /\b(at the time of writing|as of\s+(?:\d{4}-\d{2}-\d{2}|[0-9a-f]{7,40})|observed (?:on|at)\s+\d{4}-\d{2}-\d{2}|historical|former|then-current|at commit\s+[0-9a-f]{7,40}|recorded at write time|snapshot|settlement)\b/i;
const evidenceHeadingPattern = /\b(\d{4}-\d{2}-\d{2}|as of\s+(?:\d{4}-\d{2}-\d{2}|[0-9a-f]{7,40})|observed (?:on|at)\s+\d{4}-\d{2}-\d{2}|at commit\s+[0-9a-f]{7,40})\b/i;
const pastTensePattern = /\b(was merged|was closed|was observed|was created|was reported|was restored|was dropped|was removed|was settled|was retargeted|had been|reported|observed|created on|closed on|merged on)\b/i;
const liveQueryPattern = /\b(Query (?:GitHub|Git|live|`?\.\/aos)|run `?git stash list`?|use `?node scripts\/aos-dev-gh\.mjs|Use `?node scripts\/aos-dev-gh\.mjs|GitHub for current|before assuming|before acting)\b/i;
const pastTenseLicensedRuleIds = new Set([
  'lane_label_standing_claim',
  'stash_lifecycle_standing_claim',
  'runtime_lifecycle_standing_claim',
]);

const rules = [
  {
    id: 'issue_lifecycle_standing_claim',
    reason: 'Issue or PR lifecycle status should be dated/historical or queried live.',
    pattern: new RegExp(String.raw`(?:\b(?:issue|pr|pull request)\s+)?#\d+\s+(?:is|are|remains?|stays?|should\s+stay|still)\s+(?:${lifecycleKeywordPattern})\b`, 'i'),
    suggested_fix: 'Cite the issue or PR number and query live JSON, or move the claim into a dated historical block.',
  },
  {
    id: 'issue_identity_paraphrase',
    reason: 'Issue identity should be cited by number and queried; scope paraphrases become stale.',
    pattern: new RegExp(String.raw`(?:\b(?:issue|pr|pull request)\s+)?#\d+\s+(?:is|are)\s+(?!not\b)(?!an?\s+older\b)(?!a\s+historical\b)(?!history\b)${lifecycleKeywordLookaheads}[^.!?\n]{3,}`, 'i'),
    suggested_fix: 'Cite the number and query its current title, labels, and state instead of paraphrasing scope.',
  },
  {
    id: 'lane_label_standing_claim',
    reason: 'Lane labels are live GitHub metadata, not durable standing prose.',
    pattern: /\blane:(?:active|tech-debt|research|parked)\b/i,
    suggested_fix: 'Query GitHub for current labels or mark the label reference as historical.',
  },
  {
    id: 'branch_lifecycle_standing_claim',
    reason: 'Branch lifecycle and ahead/behind state are live Git facts.',
    pattern: /\b(?:only\s+real\s+branch\s+is|current\s+branch\s+(?:is|remains|stays|points|has|contains)|branch\s+(?:is|remains|stays)\s+(?:ahead|behind|clean|dirty|pushed|merged|open|closed))\b/i,
    suggested_fix: 'Query Git for current branch state or mark the branch claim as historical.',
  },
  {
    id: 'stash_lifecycle_standing_claim',
    reason: 'Stash refs are live Git ordering facts unless explicitly historical.',
    pattern: /\b(?:current\s+)?stash@\{\d+\}/i,
    suggested_fix: 'Use a dated former-stash block or tell readers to run git stash list.',
  },
  {
    id: 'runtime_lifecycle_standing_claim',
    reason: 'Runtime readiness/status/tap state must come from ./aos ready/status at read time.',
    pattern: /\b(?:ready=true|status=degraded|status=ok|tap=active|input[_ -]?tap=active)\b/i,
    suggested_fix: 'Move runtime output into a dated evidence block or tell readers to run ./aos ready --json and ./aos status --json.',
  },
];

function printJSON(value) {
  process.stdout.write(formatJSON(value));
}

function formatJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exitError(message, code) {
  process.stderr.write(formatJSON({ code, error: message }));
  process.exit(1);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runGit(args, cwd) {
  const result = spawnSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
  return {
    exitCode: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? `${result.error.message}\n` : ''),
  };
}

function resolveRepoRoot(requested) {
  const start = path.resolve(requested || process.env.REPO_ROOT || process.cwd());
  const result = runGit(['-C', start, 'rev-parse', '--show-toplevel'], start);
  if (result.exitCode === 0 && result.stdout.trim()) return path.resolve(result.stdout.trim());
  return start;
}

function parseArgs(args) {
  const options = { json: false, files: [], paths: [] };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      i += 1;
    } else if (arg === '--repo') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) exitError('--repo requires a path', 'MISSING_ARG');
      options.repo = args[i + 1];
      i += 2;
    } else if (arg === '--paths') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) exitError('--paths requires a comma-separated path list', 'MISSING_ARG');
      options.paths.push(...args[i + 1].split(',').filter(Boolean));
      i += 2;
    } else if (arg === '--files') {
      i += 1;
      let consumed = false;
      while (i < args.length && !args[i].startsWith('--')) {
        options.files.push(args[i]);
        consumed = true;
        i += 1;
      }
      if (!consumed) exitError('--files requires at least one path', 'MISSING_ARG');
    } else if (arg === '--all-markdown') {
      options.allMarkdown = true;
      i += 1;
    } else if (arg.startsWith('--')) {
      exitError(`Unknown maintainer drift-lint flag: ${arg}`, 'UNKNOWN_FLAG');
    } else {
      options.files.push(arg);
      i += 1;
    }
  }
  return options;
}

function normalizeRepoRelative(value, repoRoot) {
  const resolved = path.resolve(value);
  const root = path.resolve(repoRoot);
  if (resolved === root) return '.';
  if (resolved.startsWith(`${root}${path.sep}`)) return resolved.slice(root.length + 1);
  return value.replace(/^\.\//, '');
}

function defaultMarkdownFiles(repoRoot, includeArchives) {
  const result = runGit(['ls-files', '-z', '--', '*.md'], repoRoot);
  if (result.exitCode !== 0) exitError(`git ls-files failed: ${result.stderr.trim()}`, 'GIT_FAILED');
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((file) => defaultIncludePrefixes.some((prefix) => file.startsWith(prefix)))
    .filter((file) => includeArchives || !defaultExcludedPrefixes.some((prefix) => file.startsWith(prefix)));
}

function selectedFiles(options, repoRoot) {
  const explicit = [...options.paths, ...options.files];
  const files = explicit.length ? explicit : defaultMarkdownFiles(repoRoot, options.allMarkdown);
  return [...new Set(files.map((file) => normalizeRepoRelative(path.isAbsolute(file) ? file : path.join(repoRoot, file), repoRoot)))]
    .filter((file) => file.endsWith('.md'));
}

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, '');
}

function isHeading(line) {
  return /^(#{1,6})\s+/.test(line);
}

function headingDepth(line) {
  return line.match(/^(#{1,6})\s+/)?.[1].length ?? 0;
}

function headingText(line) {
  return line.replace(/^#{1,6}\s+/, '').trim();
}

function hasEvidenceHeading(headings) {
  return headings.some((heading) => evidenceHeadingPattern.test(heading));
}

function claimScope(text, start, end) {
  let scopeStart = 0;
  for (const match of text.matchAll(/[.!?;\n]/g)) {
    if (match.index < start) scopeStart = match.index + 1;
    else break;
  }
  let scopeEnd = text.length;
  for (const match of text.matchAll(/[.!?;\n]/g)) {
    if (match.index >= end) {
      scopeEnd = match.index;
      break;
    }
  }
  return text.slice(scopeStart, scopeEnd).trim();
}

function claimLicensed(prose, match, headings, rule) {
  if (hasEvidenceHeading(headings)) return true;
  const scope = claimScope(prose, match.index, match.index + match.text.length);
  if (claimMarkerPattern.test(scope) || liveQueryPattern.test(scope)) return true;
  return pastTenseLicensedRuleIds.has(rule.id) && pastTensePattern.test(scope);
}

function ruleMatches(rule, prose) {
  const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
  const pattern = new RegExp(rule.pattern.source, flags);
  return [...prose.matchAll(pattern)].map((match) => ({
    text: match[0],
    index: match.index ?? 0,
  }));
}

function checkBlock(block, headings, file, findings) {
  for (const item of block) {
    const prose = stripInlineCode(item.text);
    if (!prose.trim()) continue;
    for (const rule of rules) {
      for (const match of ruleMatches(rule, prose)) {
        if (claimLicensed(prose, match, headings, rule)) continue;
        findings.push({
          path: file,
          line: item.line,
          token: match.text.trim(),
          rule_id: rule.id,
          reason: rule.reason,
          suggested_fix: rule.suggested_fix,
        });
      }
    }
  }
}

function lintMarkdown(file, repoRoot) {
  const fullPath = path.join(repoRoot, file);
  let raw;
  try {
    raw = fs.readFileSync(fullPath, 'utf8');
  } catch (err) {
    return [{
      path: file,
      line: 1,
      token: file,
      rule_id: 'file_unreadable',
      reason: `Could not read file: ${err.message}`,
      suggested_fix: 'Pass an existing markdown file path.',
    }];
  }

  const findings = [];
  const headings = [];
  let block = [];
  let fenced = false;
  const lines = raw.split(/\r?\n/);

  function flush() {
    if (block.length) checkBlock(block, headings, file, findings);
    block = [];
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      flush();
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    if (isHeading(line)) {
      flush();
      const depth = headingDepth(line);
      headings.length = Math.max(0, depth - 1);
      headings[depth - 1] = headingText(line);
      return;
    }
    if (!line.trim()) {
      flush();
      return;
    }
    block.push({ line: lineNumber, text: line });
  });
  flush();
  return findings;
}

function lint(options) {
  const repoRoot = resolveRepoRoot(options.repo);
  const files = selectedFiles(options, repoRoot);
  const findings = files.flatMap((file) => lintMarkdown(file, repoRoot));
  return {
    status: findings.length ? 'failed' : 'success',
    schema_version: 1,
    subject: 'durable-status-claim-drift-tripwire',
    detector: {
      kind: 'heuristic_tripwire',
      proof: false,
      notice: detectorNotice,
      denylist_complete: false,
      block_scoped_markers: false,
      claim_scoped_markers: true,
      dated_heading_scoped_markers: true,
      excludes_fenced_code_blocks: true,
      excludes_inline_code_spans: true,
    },
    convention: 'Status claims about issues, PRs, branches, stashes, and runtime state must be dated, past-tense, fenced evidence, or instruct readers to query live sources.',
    repo: repoRoot,
    scanned_files: files,
    findings,
    summary: {
      scanned_file_count: files.length,
      finding_count: findings.length,
    },
  };
}

function printText(payload) {
  process.stdout.write(`maintainer drift-lint: ${payload.status}\n`);
  process.stdout.write(`${payload.detector.notice}\n`);
  process.stdout.write(`Scanned files: ${payload.summary.scanned_file_count}\n`);
  process.stdout.write(`Findings: ${payload.summary.finding_count}\n`);
  for (const finding of payload.findings) {
    process.stdout.write(`${finding.path}:${finding.line}: ${finding.rule_id}: ${finding.token}\n`);
  }
}

const options = parseArgs(process.argv.slice(2));
const payload = lint(options);
options.json ? printJSON(payload) : printText(payload);
process.exit(payload.findings.length ? 1 : 0);

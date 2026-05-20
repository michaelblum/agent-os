#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const toolkitRoot = 'packages/toolkit';
const tokenSourceFiles = [
  'packages/design-tokens/tokens.css',
  'packages/toolkit/components/_base/theme.css',
  'packages/toolkit/controls/defaults.css',
  'packages/toolkit/panel/defaults.css',
  'packages/toolkit/workbench/defaults.css',
];

export const TOOLKIT_TAXONOMY = [
  {
    layer: 'runtime',
    path: 'packages/toolkit/runtime',
    intent: 'Generic in-canvas bridge over daemon primitives.',
  },
  {
    layer: 'controls',
    path: 'packages/toolkit/controls',
    intent: 'Reusable semantic app-control behavior for WKWebView surfaces.',
  },
  {
    layer: 'adapters/zag',
    path: 'packages/toolkit/adapters/zag',
    intent: 'Browser-safe behavior adapters for disclosure, selection, focus, and related Zag-style primitives.',
  },
  {
    layer: 'panel',
    path: 'packages/toolkit/panel',
    intent: 'Reusable panel/window primitives and layouts, including chrome, tabs, split panes, and stage affordances.',
  },
  {
    layer: 'workbench',
    path: 'packages/toolkit/workbench',
    intent: 'Reusable subject/workbench contracts and helpers.',
  },
  {
    layer: 'components',
    path: 'packages/toolkit/components',
    intent: 'Reusable panels, surfaces, and content units built from lower layers.',
  },
];

export const PLANNED_CONSUMERS = [
  {
    name: 'InfoTag',
    layer: 'controls',
    note: 'First semantic tag primitive planned against this integrity contract.',
  },
  {
    name: 'ThumbsFeedback',
    layer: 'components',
    molecule: 'feedback group',
    note: 'First feedback molecule candidate; do not promote a durable molecule module until reuse is proven.',
  },
  {
    name: 'StarRating',
    layer: 'components',
    molecule: 'feedback group',
    note: 'First feedback molecule candidate; should reuse controls/theme contracts instead of private styling.',
  },
  {
    name: 'StarRatingWithComment',
    layer: 'components',
    molecule: 'feedback group',
    note: 'Second composed feedback variant; promotion still waits for 2-3 real consumers of the same pattern.',
  },
];

export const PROMOTION_RULE =
  'Molecule means a composed reusable pattern, not a folder. Create a new folder or durable molecule module only after 2-3 real consumers demonstrate the same composed pattern; until then document the pattern and enforce usage through tests/reporting.';

const CATEGORY_DEFINITIONS = [
  ['privateTabStyling', 'Private tab styling'],
  ['segmentedAsTabMisuse', 'Segmented-as-tab misuse'],
  ['primitiveCssImports', 'Primitive CSS imports'],
  ['legacyOrUndefinedTokens', 'Legacy or undefined tokens'],
  ['hardcodedStyleValues', 'Hardcoded style values where tokens likely exist'],
  ['duplicatedComposedPatterns', 'Duplicated composed patterns that may become molecules'],
];

const STYLE_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
const ACTIONABLE_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
const KNOWN_FALLBACK_TOKENS = new Set([
  '--aos-markdown-preview-padding',
  '--aos-markdown-preview-color',
  '--aos-markdown-preview-heading-color',
]);
const LEGACY_TOKEN_PATTERN = /--(?:aos-text(?:-strong|-muted)?|aos-muted)\b/g;
const TOKEN_USE_PATTERN = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const TOKEN_DEFINITION_PATTERN = /(--[A-Za-z0-9_-]+)\s*:/g;
const CSS_IMPORT_PATTERN = /(?:<link[^>]+href=["'][^"']*(?:components\/_base\/theme|controls\/defaults|panel\/defaults|workbench\/defaults|markdown\/preview)\.css["'][^>]*>|@import\s+(?:url\()?["'][^"']*(?:components\/_base\/theme|controls\/defaults|panel\/defaults|workbench\/defaults|markdown\/preview)\.css["'])/g;
const CLASS_PATTERN = /(?:class|className)\s*=\s*(["'`])([^"'`]+)\1/g;
const CSS_CLASS_PATTERN = /\.([A-Za-z_-][A-Za-z0-9_-]*)/g;

function emptyCategories() {
  return Object.fromEntries(
    CATEGORY_DEFINITIONS.map(([id, title]) => [
      id,
      {
        id,
        title,
        severity: 'warn',
        count: 0,
        findings: [],
      },
    ]),
  );
}

function listTrackedToolkitFiles(root) {
  const stdout = execFileSync('git', ['ls-files', toolkitRoot], {
    cwd: root,
    encoding: 'utf8',
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => ACTIONABLE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => !file.includes('/vendor/'));
}

async function readRepoFile(root, relPath) {
  return readFile(path.join(root, relPath), 'utf8');
}

async function definedTokens(root, files) {
  const definitions = new Set(KNOWN_FALLBACK_TOKENS);
  const cssFiles = new Set([
    ...files.filter((file) => file.endsWith('.css')),
    ...tokenSourceFiles,
  ]);
  for (const file of cssFiles) {
    let source;
    try {
      source = await readRepoFile(root, file);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const match of source.matchAll(TOKEN_DEFINITION_PATTERN)) {
      definitions.add(match[1]);
    }
  }
  return definitions;
}

function lineNumberForIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function lineAt(source, index) {
  const start = source.lastIndexOf('\n', index) + 1;
  const end = source.indexOf('\n', index);
  return source.slice(start, end === -1 ? source.length : end).trim();
}

function addFinding(categories, id, finding, maxFindings) {
  const category = categories[id];
  category.count += 1;
  if (category.findings.length < maxFindings) {
    category.findings.push(finding);
  }
}

function likelyStyleToken(property) {
  if (/font/.test(property)) return '--aos-type-*';
  if (/radius/.test(property)) return '--aos-panel-radius or --aos-control-radius';
  if (/padding/.test(property)) return '--aos-control-padding or --aos-panel-titlebar-padding';
  if (/gap/.test(property)) return '--aos-control-gap or --aos-panel-control-gap';
  if (/shadow/.test(property)) return '--aos-panel-shadow';
  if (/border/.test(property)) return '--aos-panel-border or --aos-control-border';
  if (/background|color|outline|accent-color/.test(property)) return 'theme color tokens';
  if (/width|height|min-height/.test(property)) return 'control, icon, panel, or layout tokens';
  return 'shared toolkit token';
}

function recordRegexMatches(source, pattern, onMatch) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    onMatch(match);
  }
}

function scanPrivateTabStyling(categories, file, source, maxFindings) {
  if (!file.endsWith('.css')) return;
  const tabSelectorPattern = /^\s*[^{}]*\btab(?:s|list|panel|trigger|content)?\b[^{}]*\{/gim;
  recordRegexMatches(source, tabSelectorPattern, (match) => {
    const text = match[0];
    if (/\baos-tab(?:s|-content)?\b/.test(text) || /data-aos-tabs/.test(text)) return;
    addFinding(categories, 'privateTabStyling', {
      file,
      line: lineNumberForIndex(source, match.index),
      sample: text.trim(),
      message: 'Tab-like selector does not use the shared aos-tabs/aos-tab/aos-tab-content contract.',
    }, maxFindings);
  });
}

function scanSegmentedTabMisuse(categories, file, source, maxFindings) {
  if (!STYLE_EXTENSIONS.has(path.extname(file))) return;
  const misusePatterns = [
    /aos-segmented[\s\S]{0,180}role=["']tab(?:list)?["']/g,
    /role=["']tab(?:list)?["'][\s\S]{0,180}aos-segmented/g,
  ];
  for (const pattern of misusePatterns) {
    recordRegexMatches(source, pattern, (match) => {
      addFinding(categories, 'segmentedAsTabMisuse', {
        file,
        line: lineNumberForIndex(source, match.index),
        sample: lineAt(source, match.index),
        message: 'Segmented controls should stay role="group"; tabs should use the shared tabs primitive.',
      }, maxFindings);
    });
  }
}

function scanPrimitiveCssImports(categories, file, source, maxFindings) {
  if (!file.endsWith('.html') && !file.endsWith('.css')) return;
  recordRegexMatches(source, CSS_IMPORT_PATTERN, (match) => {
    addFinding(categories, 'primitiveCssImports', {
      file,
      line: lineNumberForIndex(source, match.index),
      sample: lineAt(source, match.index),
      message: 'Direct primitive CSS import; expected for mounted surfaces, but tracked so lower-layer coupling stays visible.',
    }, maxFindings);
  });
}

function scanTokens(categories, file, source, tokenDefinitions, maxFindings) {
  if (!STYLE_EXTENSIONS.has(path.extname(file))) return;
  recordRegexMatches(source, LEGACY_TOKEN_PATTERN, (match) => {
    addFinding(categories, 'legacyOrUndefinedTokens', {
      file,
      line: lineNumberForIndex(source, match.index),
      token: match[0],
      sample: lineAt(source, match.index),
      message: 'Legacy token alias; prefer current base theme aliases.',
    }, maxFindings);
  });
  recordRegexMatches(source, TOKEN_USE_PATTERN, (match) => {
    const token = match[1];
    if (tokenDefinitions.has(token)) return;
    addFinding(categories, 'legacyOrUndefinedTokens', {
      file,
      line: lineNumberForIndex(source, match.index),
      token,
      sample: lineAt(source, match.index),
      message: 'Token is used with var() but is not defined by the scanned toolkit/design token sources.',
    }, maxFindings);
  });
}

function scanHardcodedStyles(categories, file, source, maxFindings) {
  if (!STYLE_EXTENSIONS.has(path.extname(file))) return;
  if (file === 'packages/toolkit/components/_base/theme.css') return;
  const stylePattern = /^\s*(color|background(?:-color)?|border(?:-(?:color|top|right|bottom|left))?|box-shadow|outline|accent-color|border-radius|padding|gap|font(?:-size)?|min-height|width|height)\s*:\s*([^;]+);/gim;
  recordRegexMatches(source, stylePattern, (match) => {
    const property = match[1];
    const value = match[2].trim();
    if (value.includes('var(') || value === '0' || value === 'none' || value === 'transparent' || value === 'inherit') return;
    if (!/(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b\d+(?:\.\d+)?(?:px|rem|em)\b|color-mix\(|linear-gradient|radial-gradient|inset\b)/i.test(value)) return;
    addFinding(categories, 'hardcodedStyleValues', {
      file,
      line: lineNumberForIndex(source, match.index),
      property,
      sample: lineAt(source, match.index),
      suggestedToken: likelyStyleToken(property),
      message: 'Hardcoded style value in toolkit surface code; check whether an existing shared token should own it.',
    }, maxFindings);
  });
}

function extractClassNames(source, extension) {
  const names = [];
  if (extension === '.css') {
    recordRegexMatches(source, CSS_CLASS_PATTERN, (match) => names.push(match[1]));
    return names;
  }
  recordRegexMatches(source, CLASS_PATTERN, (match) => {
    for (const name of match[2].split(/\s+/)) {
      if (name && !name.includes('${')) names.push(name);
    }
  });
  return names;
}

function moleculeFamily(className) {
  const name = className.toLowerCase();
  if (/feedback|rating|thumb|star/.test(name)) return 'feedback group';
  if (/segmented|action-group|button-group/.test(name)) return 'segmented group';
  if (/toolbar|actions|control-group/.test(name)) return 'toolbar section';
  if (/pane-header|panel-header|titlebar|header/.test(name)) return 'pane header';
  if (/tabs|tab-list|tabstrip|tab-strip/.test(name)) return 'tab strip plus body';
  if (/row|entry|item/.test(name)) return 'list row';
  if (/disclosure|accordion|collapsible|tree/.test(name)) return 'disclosure stack';
  return null;
}

function scanDuplicatedPatterns(categories, filesByFamily, maxFindings) {
  for (const [family, files] of [...filesByFamily.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const uniqueFiles = [...files].sort();
    if (uniqueFiles.length < 2) continue;
    addFinding(categories, 'duplicatedComposedPatterns', {
      molecule: family,
      files: uniqueFiles.slice(0, maxFindings),
      fileCount: uniqueFiles.length,
      message: `Potential ${family} molecule candidate; document the pattern now and promote only after 2-3 real consumers match.`,
    }, maxFindings);
  }
}

function summarize(categories, filesScanned, maxFindings) {
  const categoryCounts = Object.fromEntries(
    Object.entries(categories).map(([id, category]) => [id, category.count]),
  );
  const totalFindings = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);
  return {
    filesScanned,
    totalFindings,
    categoryCounts,
    sampledFindingsPerCategory: maxFindings,
  };
}

export async function runToolkitDebtReport(options = {}) {
  const root = options.repoRoot || repoRoot;
  const maxFindings = Number.isFinite(options.maxFindings) ? options.maxFindings : 25;
  const files = listTrackedToolkitFiles(root);
  const tokenDefinitions = await definedTokens(root, files);
  const categories = emptyCategories();
  const filesByFamily = new Map();

  for (const file of files) {
    const source = await readRepoFile(root, file);
    scanPrivateTabStyling(categories, file, source, maxFindings);
    scanSegmentedTabMisuse(categories, file, source, maxFindings);
    scanPrimitiveCssImports(categories, file, source, maxFindings);
    scanTokens(categories, file, source, tokenDefinitions, maxFindings);
    scanHardcodedStyles(categories, file, source, maxFindings);

    const extension = path.extname(file);
    for (const className of extractClassNames(source, extension)) {
      const family = moleculeFamily(className);
      if (!family) continue;
      if (!filesByFamily.has(family)) filesByFamily.set(family, new Set());
      filesByFamily.get(family).add(file);
    }
  }

  scanDuplicatedPatterns(categories, filesByFamily, maxFindings);

  return {
    schema: 'aos.toolkit.integrityDebtReport.v0',
    mode: 'warn',
    exitBehavior: 'findings never set a non-zero exit code',
    generatedAt: new Date().toISOString(),
    toolkitRoot,
    context: {
      taxonomy: TOOLKIT_TAXONOMY,
      promotionRule: PROMOTION_RULE,
      plannedConsumers: PLANNED_CONSUMERS,
    },
    summary: summarize(categories, files.length, maxFindings),
    categories,
  };
}

function formatReport(report) {
  const lines = [];
  lines.push('Toolkit debt report (warn mode)');
  lines.push(`Schema: ${report.schema}`);
  lines.push(`Toolkit root: ${report.toolkitRoot}`);
  lines.push(`Files scanned: ${report.summary.filesScanned}`);
  lines.push(`Total findings: ${report.summary.totalFindings}`);
  lines.push('');
  lines.push('Canonical taxonomy:');
  for (const layer of report.context.taxonomy) {
    lines.push(`- ${layer.layer}: ${layer.intent}`);
  }
  lines.push('');
  lines.push(`Promotion rule: ${report.context.promotionRule}`);
  lines.push('');
  lines.push('Planned consumers:');
  for (const consumer of report.context.plannedConsumers) {
    lines.push(`- ${consumer.name} (${consumer.layer})`);
  }
  lines.push('');
  lines.push('Debt categories:');
  for (const category of Object.values(report.categories)) {
    lines.push(`- ${category.title}: ${category.count}`);
    for (const finding of category.findings.slice(0, 3)) {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file || finding.molecule;
      lines.push(`  ${location} - ${finding.message}`);
    }
  }
  lines.push('');
  lines.push('Warn mode: findings are reported for follow-up planning and do not fail the command.');
  return `${lines.join('\n')}\n`;
}

function numberArg(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return Number(inline.slice(prefix.length));
  const index = process.argv.indexOf(name);
  if (index >= 0) return Number(process.argv[index + 1]);
  return fallback;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const report = await runToolkitDebtReport({
    maxFindings: numberArg('--max-findings', 25),
  });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

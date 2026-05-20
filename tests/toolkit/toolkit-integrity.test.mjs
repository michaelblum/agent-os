import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import test from 'node:test';

import {
  PLANNED_CONSUMERS,
  TOOLKIT_TAXONOMY,
  runToolkitDebtReport,
} from '../../scripts/toolkit-debt-report.mjs';

const repo = new URL('../../', import.meta.url);
const reportScript = new URL('scripts/toolkit-debt-report.mjs', repo);

const expectedCategories = [
  'privateTabStyling',
  'segmentedAsTabMisuse',
  'primitiveCssImports',
  'legacyOrUndefinedTokens',
  'hardcodedStyleValues',
  'duplicatedComposedPatterns',
];

test('toolkit debt report script exists and exports the canonical integrity context', async () => {
  await access(reportScript);

  assert.deepEqual(TOOLKIT_TAXONOMY.map((entry) => entry.layer), [
    'runtime',
    'controls',
    'adapters/zag',
    'panel',
    'workbench',
    'components',
  ]);
  assert.deepEqual(PLANNED_CONSUMERS.map((consumer) => consumer.name), [
    'InfoTag',
    'ThumbsFeedback',
    'StarRating',
    'StarRatingWithComment',
  ]);
});

test('toolkit debt report returns warn-mode structure without asserting zero debt', async () => {
  const report = await runToolkitDebtReport({ maxFindings: 4 });

  assert.equal(report.schema, 'aos.toolkit.integrityDebtReport.v0');
  assert.equal(report.mode, 'warn');
  assert.match(report.exitBehavior, /non-zero exit code/);
  assert.equal(report.toolkitRoot, 'packages/toolkit');
  assert.equal(typeof report.summary.filesScanned, 'number');
  assert.equal(typeof report.summary.totalFindings, 'number');
  assert.ok(report.summary.filesScanned > 0);
  assert.ok(report.summary.totalFindings >= 0);
  assert.match(report.context.promotionRule, /2-3 real consumers/);

  for (const id of expectedCategories) {
    assert.equal(report.categories[id].severity, 'warn');
    assert.equal(typeof report.categories[id].count, 'number');
    assert.ok(Array.isArray(report.categories[id].findings));
    assert.ok(report.categories[id].findings.length <= 4);
  }
});

test('toolkit debt report CLI emits JSON in warn mode and exits zero even with findings', () => {
  const result = spawnSync(process.execPath, [reportScript.pathname, '--json', '--max-findings=2'], {
    cwd: repo.pathname,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'warn');
  assert.equal(report.exitBehavior, 'findings never set a non-zero exit code');
  assert.equal(Object.keys(report.categories).length, expectedCategories.length);
  assert.deepEqual(Object.keys(report.summary.categoryCounts), expectedCategories);
});

test('toolkit debt report text output names planned consumers and warn behavior', () => {
  const result = spawnSync(process.execPath, [reportScript.pathname, '--max-findings=1'], {
    cwd: repo.pathname,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit debt report \(warn mode\)/);
  assert.match(result.stdout, /Planned consumers:/);
  assert.match(result.stdout, /InfoTag/);
  assert.match(result.stdout, /ThumbsFeedback/);
  assert.match(result.stdout, /findings are reported for follow-up planning and do not fail/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const reportRoot = path.join(repoRoot, 'Employer_Brand_Audit');
const reportDataPath = path.join(reportRoot, 'scripts/report-data.fixture.js');
const appPath = path.join(reportRoot, 'scripts/app.js');
const indexPath = path.join(reportRoot, 'index.html');

async function loadReportData() {
  const source = await fs.readFile(reportDataPath, 'utf8');
  const context = vm.createContext({});
  return vm.runInContext(`${source}\n({ templateMeta, client, competitors, comparison, introContent });`, context);
}

async function renderReportWithFakeDom() {
  const reportDataSource = await fs.readFile(reportDataPath, 'utf8');
  const appSource = await fs.readFile(appPath, 'utf8');
  const elements = new Map([
    'main-header',
    'overview-view',
    'summary-view',
    'summary-content-wrapper',
    'competition-view',
    'competition-content-wrapper',
    'deepdives-view',
    'deepdives-content-wrapper',
    'sub-nav-container',
  ].map((id) => [id, {
    id,
    innerHTML: '',
    offsetHeight: 64,
    style: {},
    scrollIntoView() {},
  }]));
  const document = {
    title: '',
    body: { innerHTML: '' },
    documentElement: { style: {} },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector() {
      return null;
    },
  };
  const context = vm.createContext({
    document,
    window: { scrollTo() {} },
    ResizeObserver: class {
      observe() {}
    },
  });

  vm.runInContext(`${reportDataSource}\n${appSource}`, context);
  const audit = vm.runInContext('brandAudit()', context);
  audit.$nextTick = (callback) => callback();
  audit.init();
  return { audit, document, elements };
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
    return strings;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectStrings(child, strings);
  }
  return strings;
}

function collectByKey(value, keys, results = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectByKey(item, keys, results);
    return results;
  }
  if (!value || typeof value !== 'object') return results;

  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key)) {
      if (Array.isArray(child)) results.push(...child.filter((item) => typeof item === 'string'));
      if (typeof child === 'string') results.push(child);
    }
    collectByKey(child, keys, results);
  }
  return results;
}

async function assertReportRelativePathExists(relativePath) {
  assert.doesNotMatch(relativePath, /^https?:\/\//);
  const absolutePath = path.resolve(reportRoot, relativePath);
  assert.ok(absolutePath.startsWith(repoRoot), `${relativePath} should stay inside repo`);
  await fs.stat(absolutePath);
}

test('Employer Brand report data generator matches the checked-in fixture payload', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-employer-brand-report-data-'));
  const out = path.join(tmp, 'report-data.fixture.js');
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/employer-brand-report-data.mjs', '--out', out],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(
      await fs.readFile(out, 'utf8'),
      await fs.readFile(reportDataPath, 'utf8'),
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('Employer Brand root prototype loads fixture data instead of the placeholder template', async () => {
  const index = await fs.readFile(indexPath, 'utf8');

  assert.match(index, /scripts\/report-data\.fixture\.js/);
  assert.doesNotMatch(index, /scripts\/report-data\.template\.js/);
});

test('Employer Brand report data is populated for Symphony Talent, Phenom, and Radancy', async () => {
  const data = await loadReportData();
  const companies = [data.client, ...data.competitors].map((company) => company.companyName);
  const serialized = JSON.stringify(data);

  assert.deepEqual(companies, ['Symphony Talent', 'Phenom', 'Radancy']);
  assert.equal(data.templateMeta.reportTitle, 'Employer Brand Comparative Audit Fixture');
  assert.match(data.templateMeta.reportSubtitle, /Symphony Talent with Phenom and Radancy/);
  assert.match(data.introContent.auditPreamble.methodology, /does not browse/);

  for (const placeholder of [
    'Client Company',
    'Replace with',
    'Add the client',
    'Add a supporting',
    'Document the common themes',
    'Competitor One',
    'placeholder',
  ]) {
    assert.equal(serialized.includes(placeholder), false, `unexpected placeholder text: ${placeholder}`);
  }
});

test('Employer Brand report data carries KILOS and comparative content', async () => {
  const data = await loadReportData();
  const matrix = data.comparison.kilosMessagingMatrix;

  assert.deepEqual(Array.from(matrix.map((row) => row.dimension)), [
    'Kinship',
    'Impact',
    'Lifestyle',
    'Opportunity',
    'Status',
  ]);
  assert.equal(matrix.find((row) => row.dimension === 'Impact').companyScores.Phenom, 'Strong');
  assert.equal(matrix.find((row) => row.dimension === 'Opportunity').companyScores['Symphony Talent'], 'Strong');
  assert.equal(matrix.find((row) => row.dimension === 'Status').companyScores.Radancy, 'Strong');
  assert.match(data.comparison.executiveSummary.sharedThemes, /talent-experience work/);
  assert.match(data.comparison.executiveSummary.keyDifferentiators, /Phenom/);
  assert.match(data.comparison.executiveSummary.keyDifferentiators, /Radancy/);
  assert.match(data.comparison.executiveSummary.whiteSpaceOpportunities, /human relevance layer/);
});

test('Employer Brand report shell renders fixture content without placeholder state', async () => {
  const { document, elements } = await renderReportWithFakeDom();
  const rendered = [...elements.values()].map((element) => element.innerHTML).join('\n');

  assert.equal(document.title, 'Employer Brand Comparative Audit Fixture');
  assert.match(rendered, /Symphony Talent/);
  assert.match(rendered, /Phenom/);
  assert.match(rendered, /Radancy/);
  assert.match(rendered, /KILOS Messaging Matrix/);
  assert.match(rendered, /human relevance layer/);
  assert.doesNotMatch(rendered, /Data Loading Error/);
  assert.doesNotMatch(rendered, /Client Company/);
  assert.doesNotMatch(rendered, /Add rows/);
});

test('Employer Brand report data preserves traceability and existing local fixture assets', async () => {
  const data = await loadReportData();
  const allStrings = collectStrings(data);
  const localAssetRefs = [
    data.templateMeta.headerLogo,
    data.templateMeta.heroLogo,
    data.templateMeta.overviewBackground,
    data.templateMeta.contentBackground,
    data.client.companyLogo.localPath,
    ...collectByKey(data, new Set(['localPath'])).filter((item) => item.startsWith('../docs/')),
  ];
  const localSourceRefs = collectByKey(data, new Set(['sourceURL', 'sourceURLs']))
    .filter((item) => item.startsWith('../docs/'));
  const fixtureScreenshots = localAssetRefs
    .filter((item) => item.includes('/browser-evidence/screenshots/'));

  assert.deepEqual([...new Set(allStrings.filter((item) => item.endsWith('_careers_site_planning')))], [
    'symphony_talent_careers_site_planning',
    'phenom_careers_site_planning',
    'radancy_careers_site_planning',
  ]);
  assert.ok(allStrings.some((item) => item.includes('not a live-web capture')));
  assert.ok(allStrings.includes('https://www.symphonytalent.com/'));
  assert.ok(allStrings.includes('https://www.phenom.com/'));
  assert.ok(allStrings.includes('https://www.radancy.com/en/'));

  assert.equal(new Set(fixtureScreenshots).size, 3);
  assert.ok(fixtureScreenshots.every((item) => (
    item.startsWith('../docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/screenshots/')
  )));
  assert.ok(localSourceRefs.every((item) => (
    item.startsWith('../docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/html/')
  )));

  for (const relativePath of [...new Set([...localAssetRefs, ...localSourceRefs])]) {
    await assertReportRelativePathExists(relativePath);
  }
});

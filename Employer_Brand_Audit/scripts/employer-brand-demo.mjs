import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const auditRoot = path.resolve(__dirname, '..')
const generatedDataPath = path.join(auditRoot, 'scripts', 'report-data.generated.js')
const latestArtifactDir = path.join(auditRoot, 'artifacts', 'demo', 'latest')

const KILOS = {
  Kinship: ['belong', 'culture', 'inclusive', 'diverse', 'community', 'team', 'collaboration', 'wellbeing', 'values'],
  Impact: ['impact', 'purpose', 'mission', 'change', 'transform', 'innovation', 'customers', 'society', 'future'],
  Lifestyle: ['benefits', 'flexible', 'remote', 'hybrid', 'balance', 'wellness', 'health', 'support', 'life'],
  Opportunity: ['grow', 'growth', 'career', 'learning', 'develop', 'development', 'mobility', 'mentor', 'advance'],
  Status: ['leader', 'award', 'recognized', 'global', 'trusted', 'reputation', 'industry', 'heritage', 'best'],
}

export const defaultRun = {
  client: {
    name: 'Symphony Talent',
    urls: ['https://www.symphonytalent.com/'],
  },
  competitors: [
    { name: 'Phenom', urls: ['https://www.phenom.com/'] },
    { name: 'Radancy', urls: ['https://www.radancy.com/en/'] },
  ],
}

function slug(text) {
  return String(text || 'unknown')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

function cleanText(text, max = 900) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
    .slice(0, max)
}

function scoreDimension(text, keywords) {
  const source = ` ${String(text || '').toLowerCase()} `
  return keywords.reduce((score, keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = source.match(new RegExp(`\\b${escaped}\\w*\\b`, 'g'))
    return score + (matches?.length || 0)
  }, 0)
}

export function classifyKilos(text) {
  const scores = Object.fromEntries(Object.entries(KILOS).map(([dimension, keywords]) => [
    dimension,
    scoreDimension(text, keywords),
  ]))
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([dimension, score]) => ({
      dimension,
      score,
      rating: score >= 5 ? 'Strong' : score >= 2 ? 'Present' : score === 1 ? 'Weak' : 'Absent',
    }))
}

function bestExcerpt(text, dimension) {
  const keywords = KILOS[dimension] || []
  const sentences = String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40 && sentence.length < 260)
  return sentences.find((sentence) => keywords.some((keyword) => sentence.toLowerCase().includes(keyword)))
    || sentences[0]
    || cleanText(text, 220)
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown-source'
  }
}

function globalPlaywrightModulePath() {
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  const candidate = path.join(globalRoot, 'playwright', 'index.mjs')
  if (existsSync(candidate)) return pathToFileURL(candidate).href
  throw new Error('Playwright is not available. Install @playwright/test or playwright before running the demo.')
}

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    return import(globalPlaywrightModulePath())
  }
}

async function collectPage(browser, company, url, companyDir) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const safeDomain = slug(domainFromUrl(url))
  const screenshotPath = path.join(companyDir, `${safeDomain}.png`)
  const textPath = path.join(companyDir, `${safeDomain}.txt`)
  const htmlPath = path.join(companyDir, `${safeDomain}.html`)
  const startedAt = new Date().toISOString()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1400)
    await page.locator('button, [role="button"], a').filter({ hasText: /accept|agree|allow all|got it/i }).first().click({ timeout: 1500 }).catch(() => {})
    const title = await page.title().catch(() => '')
    const headline = await page.locator('h1').first().innerText({ timeout: 3000 }).catch(() => '')
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    const html = await page.content().catch(() => '')
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => null)
    writeFileSync(textPath, bodyText)
    writeFileSync(htmlPath, html)
    return {
      status: 'collected',
      company: company.name,
      url: page.url(),
      requested_url: url,
      domain: domainFromUrl(page.url()),
      title,
      headline: cleanText(headline, 180),
      text: cleanText(bodyText, 2200),
      screenshot: path.relative(auditRoot, screenshotPath).replaceAll(path.sep, '/'),
      textArtifact: path.relative(auditRoot, textPath).replaceAll(path.sep, '/'),
      htmlArtifact: path.relative(auditRoot, htmlPath).replaceAll(path.sep, '/'),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      status: 'failed',
      company: company.name,
      requested_url: url,
      url,
      domain: domainFromUrl(url),
      title: '',
      headline: '',
      text: '',
      error: String(error?.message || error),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    }
  } finally {
    await page.close().catch(() => {})
  }
}

export async function collectArtifacts(run = defaultRun, outputDir = latestArtifactDir) {
  mkdirSync(outputDir, { recursive: true })
  const { chromium } = await loadPlaywright()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    if (!String(error?.message || error).includes('Executable doesn')) throw error
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  }
  const companies = [run.client, ...(run.competitors || [])]
  const records = []
  try {
    for (const company of companies) {
      const companyDir = path.join(outputDir, slug(company.name))
      mkdirSync(companyDir, { recursive: true })
      for (const url of company.urls || []) {
        records.push(await collectPage(browser, company, url, companyDir))
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
  writeFileSync(path.join(outputDir, 'collection-records.json'), `${JSON.stringify(records, null, 2)}\n`)
  return records
}

function ratingFor(companyRecords, dimension) {
  const text = companyRecords.map((record) => `${record.headline} ${record.text}`).join('\n')
  return classifyKilos(text).find((entry) => entry.dimension === dimension)?.rating || 'Absent'
}

function companyProfile(company, records) {
  const companyRecords = records.filter((record) => record.company === company.name)
  const combinedText = companyRecords.map((record) => `${record.headline}. ${record.text}`).join('\n')
  const classes = classifyKilos(combinedText)
  const primary = classes.find((entry) => entry.score > 0) || classes[0]
  const sourceUrls = companyRecords.map((record) => record.url || record.requested_url).filter(Boolean)
  const primaryRecord = companyRecords.find((record) => record.headline) || companyRecords[0] || {}
  const evidenceByDomain = {}
  for (const record of companyRecords) {
    const key = record.domain || domainFromUrl(record.url || record.requested_url)
    evidenceByDomain[key] = {
      sourceDomain: key,
      images: record.screenshot ? [{
        localPath: `./${record.screenshot}`,
        description: `${company.name} source capture from ${key}`,
        sourceURL: record.url || record.requested_url,
      }] : [],
      textualEvidence: [{
        sourceURL: record.url || record.requested_url,
        type: 'browser_capture_excerpt',
        context: record.title || key,
        content: { text: cleanText(record.text, 420) },
      }],
    }
  }

  const kilosFrameworkAnalysis = {}
  for (const { dimension, rating } of classes) {
    const excerpt = bestExcerpt(combinedText, dimension)
    kilosFrameworkAnalysis[dimension] = {
      presence: rating !== 'Absent',
      summary: rating === 'Absent'
        ? `${dimension} was not a clear signal in the captured source material.`
        : `${dimension} appears as a ${rating.toLowerCase()} signal in the captured source material.`,
      sourceURLs: sourceUrls,
      supportingEvidence: excerpt ? [{
        evidenceText: excerpt,
        evidenceType: 'browser_capture_excerpt',
        theme: `${dimension} signal`,
        sourceURL: sourceUrls[0] || '',
      }] : [],
    }
  }

  return {
    companyName: company.name,
    companyLogo: { description: `${company.name} logo placeholder`, sourceURL: sourceUrls[0] || '' },
    companyEvidence: evidenceByDomain,
    analysis: {
      scientificTalentValueProposition: {
        primaryHeadline: {
          text: primaryRecord.headline || primaryRecord.title || `${company.name} careers source`,
          sourceURL: primaryRecord.url || primaryRecord.requested_url || '',
        },
        keyPillarStatements: classes
          .filter((entry) => entry.score > 0)
          .slice(0, 3)
          .map((entry) => ({
            statement: `${entry.dimension}: ${entry.rating} signal detected from automated browser collection.`,
            sourceURL: sourceUrls[0] || '',
          })),
        summary: `${company.name} shows its strongest automated signal around ${primary.dimension}. This is a demo-quality first pass based on captured public web text, intended to prove the collection-to-report loop rather than final strategy.`,
        sourceURLs: sourceUrls,
      },
      kilosFrameworkAnalysis,
    },
  }
}

export function buildReportData(records, run = defaultRun) {
  const client = companyProfile(run.client, records)
  const competitors = (run.competitors || []).map((company) => companyProfile(company, records))
  const companies = [run.client, ...(run.competitors || [])]
  const matrix = Object.keys(KILOS).map((dimension) => ({
    theme: `${dimension} signal`,
    dimension,
    companyScores: Object.fromEntries(companies.map((company) => [
      company.name,
      ratingFor(records.filter((record) => record.company === company.name), dimension),
    ])),
  }))
  const sourceURLs = records.map((record) => record.url || record.requested_url).filter(Boolean)
  return {
    templateMeta: {
      reportTitle: 'Employer Brand Competitive Audit',
      reportSubtitle: `${run.client.name} automated source-artifact demo run`,
      footerText: `© ${new Date().getFullYear()} Symphony Talent, LLC. Demo output generated by agent-os.`,
      headerLogo: './assets/branding/symphony-talent-header.png',
      heroLogo: './assets/branding/symphony-talent-hero.png',
      overviewBackground: './assets/backgrounds/overview-bg.jpg',
      contentBackground: './assets/backgrounds/content-bg.jpg',
      watermarkGraphic: '',
    },
    client,
    competitors,
    comparison: {
      executiveSummary: {
        sharedThemes: 'This automated pass collected public web artifacts and converted them into a KILOS-oriented evidence map. The current output is suitable for demo review, not final client strategy.',
        keyDifferentiators: `${client.companyName} and the comparison set differ most in which KILOS signals appear first in captured homepage messaging. The generated deep dives show source screenshots and excerpts so a strategist can validate the machine pass.`,
        whiteSpaceOpportunities: 'The next step is to add company-specific careers subpages, social proof, review sources, and human QA gates so weak or missing signals become either real gaps or recipe repair work.',
        sourceURLs,
      },
      kilosMessagingMatrix: matrix,
    },
    introContent: {
      auditPreamble: {
        title: `${run.client.name}: automated employer brand audit run`,
        introduction: 'This demo shows an end-to-end automated run: browser collection, evidence artifact capture, heuristic KILOS classification, and branded report generation.',
        methodologyTitle: 'Demo Methodology',
        methodology: 'A Playwright-backed collector opened each source URL, captured visible text and a screenshot, stored raw artifacts, and generated this static report from the resulting evidence records.',
        methodologyFocusAreas: [
          'Owned web messaging on public company and careers-adjacent pages',
          'Visible headline and page-copy signals that map to KILOS dimensions',
          'Traceability from report claims back to captured source URLs and artifacts',
        ],
        closing: 'This proves the report-producing loop while leaving strategic interpretation and final scoring to a later, human-reviewed workflow.',
        frameworkIntroduction: 'KILOS scoring in this demo is intentionally lightweight: keyword signals are grouped into Kinship, Impact, Lifestyle, Opportunity, and Status.',
      },
    },
  }
}

export function writeReportData(reportData, filename = generatedDataPath) {
  const js = [
    '// Generated by Employer_Brand_Audit/scripts/employer-brand-demo.mjs',
    `const templateMeta = ${JSON.stringify(reportData.templateMeta, null, 2)};`,
    `const client = ${JSON.stringify(reportData.client, null, 2)};`,
    `const competitors = ${JSON.stringify(reportData.competitors, null, 2)};`,
    `const comparison = ${JSON.stringify(reportData.comparison, null, 2)};`,
    `const introContent = ${JSON.stringify(reportData.introContent, null, 2)};`,
    '',
  ].join('\n\n')
  writeFileSync(filename, js)
}

export async function runDemo() {
  console.log('[employer-brand-demo] collecting browser artifacts...')
  const records = await collectArtifacts()
  console.log(`[employer-brand-demo] collected ${records.filter((record) => record.status === 'collected').length}/${records.length} sources`)
  const reportData = buildReportData(records)
  writeReportData(reportData)
  console.log(`[employer-brand-demo] wrote ${path.relative(process.cwd(), generatedDataPath)}`)
  console.log(`[employer-brand-demo] report: ${path.join(auditRoot, 'demo.html')}`)
  console.log(`[employer-brand-demo] artifacts: ${latestArtifactDir}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runDemo().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

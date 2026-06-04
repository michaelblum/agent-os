#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEmployerBrandComparativeAuditDataBundle,
} from '../packages/toolkit/workbench/_reference/employer-brand/employer-brand-comparative-audit-data-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureRoot = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit';
const defaultReportRoot = 'Employer_Brand_Audit';
const defaultOut = 'Employer_Brand_Audit/scripts/report-data.fixture.js';

const dimensionThemeLabels = {
  Kinship: 'Collaborative culture and belonging',
  Impact: 'Talent experience impact',
  Lifestyle: 'Lifestyle evidence gaps',
  Opportunity: 'Expertise and career opportunity',
  Status: 'Scale and reputation proof',
};

function usage() {
  return `Usage: node scripts/employer-brand-report-data.mjs [--fixture-root <dir>] [--report-root <dir>] [--out <file>]

Builds the Employer_Brand_Audit report-data fixture from checked-in local audit
fixtures. This is deterministic data shaping only; it does not browse websites,
collect evidence, generate strategy, run exports, or execute a workflow.`;
}

function parseArgs(argv) {
  const args = {
    fixtureRoot: defaultFixtureRoot,
    reportRoot: defaultReportRoot,
    out: defaultOut,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--report-root') {
      args.reportRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function reportRelative(reportRootAbs, absolutePath) {
  const relative = toPosix(path.relative(reportRootAbs, absolutePath));
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function titleCaseDimension(value) {
  if (!value) return value;
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function sentenceList(values) {
  return values.filter(Boolean).join(' ');
}

function parseKilosSnapshot(markdown, expectedCompanies) {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('| Dimension |'));
  if (headerIndex === -1) {
    throw new Error('Could not find KILOS Snapshot table in report.md.');
  }

  const header = splitMarkdownTableRow(lines[headerIndex]);
  for (const company of expectedCompanies) {
    if (!header.includes(company)) {
      throw new Error(`KILOS Snapshot table is missing company column: ${company}`);
    }
  }

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) break;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < header.length) continue;

    const dimension = cells[0];
    const companyScores = {};
    for (const company of expectedCompanies) {
      companyScores[company] = cells[header.indexOf(company)];
    }

    rows.push({
      theme: dimensionThemeLabels[dimension] || dimension,
      dimension,
      companyScores,
      fixtureImplication: cells[header.indexOf('Fixture implication')],
    });
  }

  if (rows.length === 0) {
    throw new Error('KILOS Snapshot table did not contain any score rows.');
  }
  return rows;
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function sourceUrlsForRequestIds({
  requestIds,
  registryByRequest,
  reportRootAbs,
  browserEvidenceRootAbs,
  publicSourceUrl,
}) {
  const fixtureSourceUrls = requestIds.map((requestId) => {
    const evidence = evidenceForRequest(registryByRequest, requestId);
    return reportRelative(reportRootAbs, path.join(browserEvidenceRootAbs, evidence.source_url));
  });
  return unique([...fixtureSourceUrls, publicSourceUrl]);
}

function evidenceForRequest(registryByRequest, requestId) {
  const evidence = registryByRequest.get(requestId);
  if (!evidence) {
    throw new Error(`Unknown Browser Evidence request ID: ${requestId}`);
  }
  return evidence;
}

function caveatsForAudit(audit, comparativeCaveats = []) {
  return unique([
    ...(audit.caveats || []),
    audit.employee_sentiment_and_review_sites?.caveat,
    ...comparativeCaveats,
  ]);
}

function buildCompanyProfile({
  audit,
  source,
  registryByRequest,
  reportRootAbs,
  browserEvidenceRootAbs,
  symphonyLogoPath,
}) {
  const companyName = audit.company.name;
  const publicSourceUrl = source?.url || '';
  const requestIds = audit.provenance.browser_evidence_request_ids || [];
  const sourceURLs = sourceUrlsForRequestIds({
    requestIds,
    registryByRequest,
    reportRootAbs,
    browserEvidenceRootAbs,
    publicSourceUrl,
  });
  const caveats = caveatsForAudit(audit);
  const evidenceBlocks = audit.cited_evidence.map((citation) => evidenceForRequest(registryByRequest, citation.request_id));
  const firstSourceURL = sourceURLs[0] || publicSourceUrl;

  const companyLogo = companyName === 'Symphony Talent'
    ? {
      localPath: symphonyLogoPath,
      description: 'Symphony Talent report header logo',
      sourceURL: publicSourceUrl,
    }
    : {
      description: `No local ${companyName} logo asset is included in this fixture slice; the static report shell renders a name fallback.`,
      sourceURL: publicSourceUrl,
      caveat: 'No local company logo asset is included in this fixture slice.',
    };

  const companyEvidence = {};
  if (evidenceBlocks.length > 0) {
    companyEvidence['local fixture careers page'] = {
      sourceDomain: 'Local fixture careers page',
      sourceURL: firstSourceURL,
      sourceURLs,
      publicSourceURL: publicSourceUrl,
      requestIDs: requestIds,
      caveats,
      images: evidenceBlocks.map((evidence) => ({
        localPath: reportRelative(reportRootAbs, path.join(browserEvidenceRootAbs, evidence.screenshot_path)),
        description: evidence.evidence_goal,
        sourceURL: reportRelative(reportRootAbs, path.join(browserEvidenceRootAbs, evidence.source_url)),
        publicSourceURL: publicSourceUrl,
        requestID: evidence.request_id,
        requestIDs: [evidence.request_id],
        selector: evidence.selector,
        capturedAt: evidence.captured_at,
        caveat: evidence.notes || evidence.caveat || null,
        extractedText: evidence.extracted_text,
      })),
      textualEvidence: evidenceBlocks.map((evidence) => ({
        sourceURL: reportRelative(reportRootAbs, path.join(browserEvidenceRootAbs, evidence.source_url)),
        publicSourceURL: publicSourceUrl,
        requestID: evidence.request_id,
        requestIDs: [evidence.request_id],
        type: 'browser_evidence_excerpt',
        context: evidence.evidence_goal,
        caveat: evidence.notes || evidence.caveat || null,
        content: {
          text: evidence.extracted_text,
        },
      })),
    };
  }

  const valueProp = {
    primaryHeadline: {
      text: audit.main_promise,
      sourceURL: firstSourceURL,
      sourceURLs,
      requestIDs: requestIds,
      caveats,
    },
    keyPillarStatements: [
      ...audit.messaging_themes.map((theme) => {
        const themeSourceURLs = sourceUrlsForRequestIds({
          requestIds: theme.request_ids,
          registryByRequest,
          reportRootAbs,
          browserEvidenceRootAbs,
          publicSourceUrl,
        });
        return {
          statement: `${theme.theme}: ${theme.summary}`,
          sourceURL: themeSourceURLs[0] || firstSourceURL,
          sourceURLs: themeSourceURLs,
          requestIDs: theme.request_ids,
          caveats,
        };
      }),
      ...audit.differentiators.map((item) => {
        const itemSourceURLs = sourceUrlsForRequestIds({
          requestIds: item.request_ids,
          registryByRequest,
          reportRootAbs,
          browserEvidenceRootAbs,
          publicSourceUrl,
        });
        return {
          statement: item.summary,
          sourceURL: itemSourceURLs[0] || firstSourceURL,
          sourceURLs: itemSourceURLs,
          requestIDs: item.request_ids,
          caveats,
        };
      }),
    ],
    summary: audit.employer_value_proposition,
    sourceURLs,
    requestIDs: requestIds,
    caveats,
  };

  const kilosFrameworkAnalysis = {};
  for (const dimensionAudit of audit.kilos_analysis) {
    const dimension = titleCaseDimension(dimensionAudit.dimension);
    const dimensionSourceURLs = sourceUrlsForRequestIds({
      requestIds: dimensionAudit.request_ids,
      registryByRequest,
      reportRootAbs,
      browserEvidenceRootAbs,
      publicSourceUrl,
    });
    kilosFrameworkAnalysis[dimension] = {
      presence: true,
      summary: dimensionAudit.interpretation,
      sourceURLs: dimensionSourceURLs,
      requestIDs: dimensionAudit.request_ids,
      caveats,
      supportingEvidence: [
        {
          evidenceText: dimensionAudit.interpretation,
          theme: dimensionAudit.factors.join(', '),
          sourceURL: dimensionSourceURLs[0] || firstSourceURL,
          sourceURLs: dimensionSourceURLs,
          requestIDs: dimensionAudit.request_ids,
          caveat: evidenceBlocks.find((evidence) => dimensionAudit.request_ids.includes(evidence.request_id))?.notes || null,
        },
        ...audit.evidence_backed_claims
          .filter((claim) => claim.request_ids.some((requestId) => dimensionAudit.request_ids.includes(requestId)))
          .map((claim) => ({
            evidenceText: claim.claim,
            theme: claim.id,
            sourceURL: dimensionSourceURLs[0] || firstSourceURL,
            sourceURLs: dimensionSourceURLs,
            requestIDs: claim.request_ids,
            caveat: 'Fixture claim derived from local company audit JSON.',
          })),
      ],
    };
  }

  return {
    companyName,
    companyRole: audit.company.role,
    companyLogo,
    companyEvidence,
    sourceMetadata: {
      sourceID: source?.id || null,
      publicSourceURL: publicSourceUrl,
      collectionStatus: source?.collection_status || null,
      fixtureSignal: source?.fixture_signal || null,
      notes: source?.notes || null,
    },
    requestIDs: requestIds,
    caveats,
    analysis: {
      scientificTalentValueProposition: valueProp,
      kilosFrameworkAnalysis,
      brandVoiceAndTone: audit.brand_voice_and_tone,
      evidenceBackedClaims: audit.evidence_backed_claims,
      genericMessagingOrWeakSpots: audit.generic_messaging_or_weak_spots,
    },
  };
}

function combineComparativeItems(items, formatter) {
  return items.map(formatter).join(' ');
}

function buildReportData({
  fixtureRootAbs,
  reportRootAbs,
}) {
  const sources = readJson(path.join(fixtureRootAbs, 'sources.json'));
  const project = readJson(path.join(fixtureRootAbs, 'intake/project.json'));
  const registry = readJson(path.join(fixtureRootAbs, 'browser-evidence/registry.json'));
  const normalizedBundle = loadEmployerBrandComparativeAuditDataBundle({
    fixtureRoot: fixtureRootAbs,
    createdAt: '2026-05-08T00:00:00Z',
  });
  const comparative = readJson(path.join(fixtureRootAbs, normalizedBundle.inputs.comparative_audit_paths[0]));
  const reportMarkdown = fs.readFileSync(path.join(fixtureRootAbs, 'report.md'), 'utf8');
  const browserEvidenceRootAbs = path.join(fixtureRootAbs, 'browser-evidence');
  const registryByRequest = new Map(registry.evidence.map((evidence) => [evidence.request_id, evidence]));
  const companies = [
    project.intake.client_company.name,
    ...project.intake.competitor_companies.map((company) => company.name),
  ];

  const sourceByCompany = new Map(sources.sources.map((source) => [source.company, source]));
  const companyAudits = normalizedBundle.inputs.company_audit_paths
    .map((relativePath) => readJson(path.join(fixtureRootAbs, relativePath)));

  const symphonyLogoPath = reportRelative(reportRootAbs, path.join(reportRootAbs, 'assets/branding/symphony-talent-header.png'));
  const profiles = companyAudits.map((audit) => buildCompanyProfile({
    audit,
    source: sourceByCompany.get(audit.company.name),
    registryByRequest,
    reportRootAbs,
    browserEvidenceRootAbs,
    symphonyLogoPath,
  }));
  const client = profiles.find((profile) => profile.companyRole === 'client');
  const competitors = profiles.filter((profile) => profile.companyRole !== 'client');
  const allSourceURLs = unique(profiles.flatMap((profile) => [
    profile.sourceMetadata.publicSourceURL,
    ...Object.values(profile.companyEvidence).flatMap((evidence) => evidence.sourceURLs || []),
  ]));
  const allRequestIDs = unique(profiles.flatMap((profile) => profile.requestIDs));
  const allCaveats = unique([
    ...comparative.caveats,
    ...profiles.flatMap((profile) => profile.caveats),
    sources.limitations?.join(' '),
  ]);

  const comparison = {
    executiveSummary: {
      sharedThemes: sentenceList([
        comparative.comparative_synthesis.summary,
        combineComparativeItems(
          comparative.shared_themes,
          (theme) => `${theme.theme}: ${theme.summary}`,
        ),
      ]),
      keyDifferentiators: combineComparativeItems(
        comparative.key_differentiators,
        (item) => `${item.company}: ${item.summary}`,
      ),
      whiteSpaceOpportunities: combineComparativeItems(
        comparative.whitespace_opportunities,
        (item) => `${item.opportunity} ${item.rationale}`,
      ),
      sourceURLs: allSourceURLs,
      requestIDs: allRequestIDs,
      caveats: allCaveats,
      comparativeAuditID: comparative.id,
    },
    kilosMessagingMatrix: parseKilosSnapshot(reportMarkdown, companies).map((row) => ({
      ...row,
      sourceURLs: allSourceURLs,
      requestIDs: allRequestIDs,
      caveats: allCaveats,
    })),
    kilosPositioningMatrix: comparative.kilos_positioning_matrix,
    standoutEngagementExamples: comparative.standout_engagement_examples,
    implicationsForClient: comparative.implications_for_client,
    evidenceBackedClaims: comparative.evidence_backed_claims,
    reviewSiteComparison: comparative.review_site_comparison,
    provenance: comparative.provenance,
  };

  return {
    templateMeta: {
      reportTitle: 'Employer Brand Comparative Audit Fixture',
      reportSubtitle: `${client.companyName} with ${competitors.map((profile) => profile.companyName).join(' and ')} | Local fixture data`,
      footerText: '(c) 2026 AOS local fixture. No live-web collection or export execution.',
      headerLogo: './assets/branding/symphony-talent-header.png',
      heroLogo: './assets/branding/symphony-talent-hero.png',
      overviewBackground: './assets/backgrounds/overview-bg.jpg',
      contentBackground: './assets/backgrounds/content-bg.jpg',
      watermarkGraphic: '',
      generatedFrom: toPosix(path.relative(repoRoot, fixtureRootAbs)),
      generatedBy: 'scripts/employer-brand-report-data.mjs',
      dataBundle: {
        id: normalizedBundle.id,
        path: './data-bundle.json',
        schema: 'shared/schemas/employer-brand-comparative-audit-data-bundle-v0.schema.json',
        companyCount: normalizedBundle.project.company_count,
        targetCount: normalizedBundle.source_artifact_targets.target_count,
        expectedClipCount: normalizedBundle.source_artifact_targets.expected_clip_count,
        readOnly: normalizedBundle.provenance.read_only,
        provenanceOnly: normalizedBundle.provenance.provenance_only,
      },
    },
    client,
    competitors,
    comparison,
    introContent: {
      auditPreamble: {
        title: 'Local fixture comparative audit',
        introduction: 'This report renders the checked-in Symphony Talent, Phenom, and Radancy Employer Brand comparative audit fixture. The claims are fixture claims grounded in local source metadata, company audit JSON, comparative KILOS synthesis, and Browser Evidence registry rows.',
        methodologyTitle: 'Fixture methodology',
        methodology: 'The payload is deterministically composed from existing repo files: project intake, public source metadata, local Browser Evidence registry entries, Company Brand Audit fixtures, Comparative Brand Audit fixtures, and the Markdown KILOS snapshot. It does not browse, collect live pages, infer current market state, run a workflow, or execute an export.',
        methodologyFocusAreas: [
          'Company employer value proposition and KILOS analysis from the structured company audit JSON files.',
          'Comparative shared themes, differentiators, whitespace, and client implications from the Comparative Brand Audit fixture.',
          'Local Browser Evidence fixture pages and crop assets, preserving request IDs, source URLs, selectors, timestamps, and caveats.',
        ],
        closing: 'Use this as a populated prototype fixture for report rendering and evidence handoff inspection, not as a current live-web employer brand audit.',
        frameworkIntroduction: 'KILOS is used here only as the fixture analysis lens across Kinship, Impact, Lifestyle, Opportunity, and Status.',
        sourceURLs: allSourceURLs,
        requestIDs: allRequestIDs,
        caveats: allCaveats,
      },
    },
  };
}

function jsConst(name, value) {
  return `const ${name} = ${JSON.stringify(value, null, 2)};\n`;
}

function renderReportDataJs(data) {
  return [
    '// Generated by scripts/employer-brand-report-data.mjs. Do not edit by hand.',
    '// Source fixture: docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/',
    '',
    jsConst('templateMeta', data.templateMeta),
    jsConst('client', data.client),
    jsConst('competitors', data.competitors),
    jsConst('comparison', data.comparison),
    jsConst('introContent', data.introContent),
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const fixtureRootAbs = path.resolve(repoRoot, args.fixtureRoot);
  const reportRootAbs = path.resolve(repoRoot, args.reportRoot);
  const outAbs = path.resolve(repoRoot, args.out);
  const data = buildReportData({ fixtureRootAbs, reportRootAbs });
  const rendered = renderReportDataJs(data);

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, rendered);
  console.log(`wrote ${toPosix(path.relative(repoRoot, outAbs))}`);
}

try {
  main();
} catch (caught) {
  console.error(caught.message);
  process.exitCode = 1;
}

import { runCommand, tryParseJson } from './command-runner.js';
import type {
  IntegrationProviderDescriptor,
  IntegrationSurfaceDescriptor,
  IntegrationWorkflowDefinition,
  WikiIndexEntry,
  WorkflowInputFieldOptionDescriptor,
  WorkflowInvocationInput,
  WorkflowRunContext,
  WorkflowRunResult,
} from './types.js';

const MAX_WIKI_RESULTS = 6;
const MAX_WORKFLOW_RESULTS = 10;
const MAX_FEATURE_RESULTS = 8;
const MAX_COMING_SOON_RESULTS = 12;

const EMPLOYER_BRAND_PROFILE_FIELDS = {
  clientCompanyName: 'clientCompanyName',
  areaOfFocus: 'areaOfFocus',
  workflowNotes: 'workflowNotes',
} as const;

const EMPLOYER_BRAND_AUDIT_FIELDS = {
  clientCompanyName: 'clientCompanyName',
  competitorCompanyNames: 'competitorCompanyNames',
  areaOfFocus: 'areaOfFocus',
  workflowNotes: 'workflowNotes',
} as const;

const FEATURE_REQUEST_FIELDS = {
  requestTitle: 'requestTitle',
  useCase: 'useCase',
  desiredOutcome: 'desiredOutcome',
  impact: 'impact',
} as const;

const BUG_REPORT_FIELDS = {
  bugTitle: 'bugTitle',
  observedBehavior: 'observedBehavior',
  expectedBehavior: 'expectedBehavior',
  reproductionNotes: 'reproductionNotes',
  severity: 'severity',
} as const;

const IMPACT_OPTIONS: WorkflowInputFieldOptionDescriptor[] = [
  { value: 'high', label: 'High', description: 'Blocks delivery or has strong user impact.' },
  { value: 'medium', label: 'Medium', description: 'Important, but not immediately blocking.' },
  { value: 'low', label: 'Low', description: 'Nice to have or early-stage feedback.' },
];

const SEVERITY_OPTIONS: WorkflowInputFieldOptionDescriptor[] = [
  { value: 'critical', label: 'Critical', description: 'Broken core path or severe regression.' },
  { value: 'major', label: 'Major', description: 'Important defect with workaround or scope limits.' },
  { value: 'minor', label: 'Minor', description: 'Smaller bug, polish issue, or edge-case defect.' },
];

const READY_WORKFLOW_IDS = new Set([
  'wiki-search',
  'dev-status',
  'new-features',
  'workflow-catalog',
  'coming-soon',
  'feature-request',
  'bug-report',
  'employer-brand-profile-kilos',
  'employer-brand-competitor-audit-kilos',
]);

export const DEFAULT_SURFACES: IntegrationSurfaceDescriptor[] = [
  {
    id: 'jobs',
    label: 'Jobs',
    description: 'Recent requests and execution state across connected chat providers.',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Pilot workflow catalog exposed through Slack today and reusable for future transports.',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Provider adapters, configuration state, and transport-specific capabilities.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'A local operator surface for simulating inbound chat commands and watching broker replies.',
  },
];

export function buildProviderCatalog(config: {
  slackConfigured: boolean;
  slackEnabled: boolean;
  slackError?: string;
}): IntegrationProviderDescriptor[] {
  const slackNotes: string[] = [];
  if (!config.slackConfigured) {
    slackNotes.push('Set AOS_SLACK_BOT_TOKEN and AOS_SLACK_APP_TOKEN to enable the Socket Mode adapter.');
  }
  if (config.slackError) slackNotes.push(config.slackError);

  return [
    {
      id: 'slack',
      kind: 'slack',
      label: 'Slack',
      status: config.slackError
        ? 'error'
        : (config.slackEnabled ? 'ready' : 'disabled'),
      enabled: config.slackEnabled,
      configured: config.slackConfigured,
      capabilities: ['dm', 'mentions', 'threads', 'socket-mode', 'block-kit', 'modals', 'app-home'],
      notes: slackNotes,
    },
    {
      id: 'discord',
      kind: 'discord',
      label: 'Discord',
      status: 'planned',
      enabled: false,
      configured: false,
      capabilities: ['dm', 'mentions', 'threads'],
      notes: ['Provider-neutral command routing keeps room for a future Discord adapter without changing workflow or jobs surfaces.'],
    },
  ];
}

function summarizeStatusPayload(payload: any): WorkflowRunResult {
  const daemon = payload?.daemon_snapshot ?? {};
  const git = payload?.git ?? {};
  const runtime = payload?.runtime ?? {};
  const ahead = git.ahead_of_upstream ?? git.ahead_of_origin_main ?? 0;
  const upstream = git.upstream ?? 'none';

  const lines = [
    `branch ${git.branch ?? 'unknown'} | upstream ${upstream} | ahead ${ahead} | dirty ${git.dirty_files ?? 0}`,
    `daemon ${runtime.daemon_running ? 'running' : 'stopped'} | pid ${runtime.daemon_pid ?? 'n/a'} | focused ${daemon.focused_app ?? 'unknown'}`,
    `displays ${daemon.displays ?? 0} | windows ${daemon.windows ?? 0} | channels ${daemon.channels ?? 0}`,
    `mode ${payload?.identity?.mode ?? 'unknown'} | stale ${payload?.stale_resources?.status ?? 'unknown'}`,
  ];

  return {
    summary: 'Current repo/runtime status.',
    lines,
    json: payload,
  };
}

function summarizeWorkflowCatalog(workflows: IntegrationWorkflowDefinition[]): WorkflowRunResult {
  const ready = workflows.filter((workflow) => workflow.availability !== 'coming-soon').slice(0, MAX_WORKFLOW_RESULTS);
  const comingSoon = workflows.filter((workflow) => workflow.availability === 'coming-soon').slice(0, MAX_WORKFLOW_RESULTS);
  const lines = [
    ...ready.map((workflow) => `Ready - ${workflow.title} (${workflow.command.usage})`),
    ...comingSoon.map((workflow) => `Coming soon - ${workflow.title} (${workflow.command.usage})`),
  ];

  return {
    summary: `Live workflow registry: ${ready.length} ready, ${workflows.filter((workflow) => workflow.availability === 'coming-soon').length} coming soon.`,
    lines,
    json: workflows.map(({ run: _run, formatCommandText: _formatCommandText, ...workflow }) => workflow),
  };
}

function summarizeComingSoon(workflows: IntegrationWorkflowDefinition[]): WorkflowRunResult {
  const pending = workflows
    .filter((workflow) => workflow.availability === 'coming-soon')
    .slice(0, MAX_COMING_SOON_RESULTS);

  return {
    summary: pending.length > 0
      ? `${pending.length} workflow plugins are visible in the live registry and can be wired into Slack next.`
      : 'No extra workflow plugins are waiting in the live registry right now.',
    lines: pending.map((workflow) => `${workflow.title} - ${workflow.description}`),
    json: pending.map(({ run: _run, formatCommandText: _formatCommandText, ...workflow }) => workflow),
  };
}

function summarizeWikiSearch(query: string, payload: any, indexedEntry?: string): WorkflowRunResult {
  const entries = Array.isArray(payload) ? payload.slice(0, MAX_WIKI_RESULTS) : [];
  const lines = entries.map((entry: any) => {
    const name = entry?.name ?? entry?.path ?? 'unknown';
    const type = entry?.type ?? 'unknown';
    const path = entry?.path ?? 'no-path';
    const desc = entry?.description ?? 'No description';
    return `${name} [${type}] - ${desc} (${path})`;
  });

  if (indexedEntry && indexedEntry !== query) {
    lines.unshift(`Started from index entry: ${indexedEntry}`);
  }

  return {
    summary: entries.length > 0
      ? `${entries.length} wiki matches for "${query}".`
      : `No wiki matches for "${query}".`,
    lines,
    json: payload,
  };
}

function summarizeRecentFeatures(raw: string): WorkflowRunResult {
  const lines = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_FEATURE_RESULTS)
    .map((line) => {
      const [sha, date, ...subjectParts] = line.split('\t');
      return `${date ?? 'unknown'} ${sha ?? '????'} ${subjectParts.join('\t')}`.trim();
    });

  return {
    summary: lines.length > 0
      ? 'Recent repo changes from the local git history.'
      : 'No recent git history available.',
    lines,
  };
}

async function runAosJson(args: string[], context: WorkflowRunContext) {
  const { stdout } = await runCommand('./aos', args, { cwd: context.repoRoot, timeoutMs: 15_000 });
  const parsed = tryParseJson(stdout);
  if (parsed == null) throw new Error(`Expected JSON from ./aos ${args.join(' ')}`);
  return parsed;
}

function readInputField(input: WorkflowInvocationInput, fieldId: string) {
  return input.fields?.[fieldId]?.trim() ?? input.text?.trim() ?? '';
}

function parseCompanyList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function queuedWorkflowResult(config: {
  summary: string;
  lines: string[];
  json: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): WorkflowRunResult {
  return {
    status: 'queued',
    summary: config.summary,
    lines: config.lines,
    json: config.json,
    metadata: config.metadata,
  };
}

function normalizeWikiIndex(raw: unknown): WikiIndexEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      name: String(entry.name ?? entry.plugin ?? entry.path ?? 'unknown'),
      description: typeof entry.description === 'string' ? entry.description : undefined,
      path: typeof entry.path === 'string' ? entry.path : undefined,
      plugin: typeof entry.plugin === 'string' ? entry.plugin : undefined,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      type: typeof entry.type === 'string' ? entry.type : undefined,
      modified_at: typeof entry.modified_at === 'number' ? entry.modified_at : undefined,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadWikiIndex(repoRoot: string) {
  const payload = await runAosJson(['wiki', 'list', '--json'], { repoRoot });
  return normalizeWikiIndex(payload);
}

function humanizeWorkflowName(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildReadyWorkflowCatalog(wikiIndex: WikiIndexEntry[]): IntegrationWorkflowDefinition[] {
  return [
    {
      id: 'wiki-search',
      title: 'Wiki Search',
      description: 'Search the local wiki index with free text or a quick jump from the live index. For broader browsing, use the App Home wiki browser.',
      surface: 'workflows',
      availability: 'ready',
      group: 'research',
      registrySource: 'built-in',
      requiresInput: true,
      submitLabel: 'Search',
      inlineResultInModal: true,
      inputFields: [
        {
          id: 'query',
          label: 'Search query',
          placeholder: 'sigil, employer brand, command surface',
          helpText: 'Optional if you use the quick-jump field below.',
        },
        {
          id: 'indexedEntry',
          label: 'Quick jump to a known entry',
          type: 'select',
          dynamicOptionsSource: 'wiki-index',
          placeholder: wikiIndex.length > 0
            ? 'Type to search the live wiki index'
            : 'No wiki entries available',
          helpText: wikiIndex.length > 0
            ? `Type to filter the live wiki index (${wikiIndex.length} items detected). For browsing by type, tag, or plugin, use the App Home wiki browser.`
            : 'No indexed entries were available when the modal was built.',
        },
      ],
      aliases: ['wiki', 'search wiki', 'find in wiki'],
      command: {
        label: 'wiki',
        usage: 'wiki <query>',
        examples: ['wiki sigil', 'wiki command surface', 'wiki employer brand'],
      },
      validateInput(input: WorkflowInvocationInput) {
        const indexedEntry = readInputField(input, 'indexedEntry');
        const query = readInputField(input, 'query');
        if (query || indexedEntry) return null;
        return {
          fieldErrors: {
            query: 'Enter a search query, or use quick jump and choose one of the suggestions.',
            indexedEntry: 'Type and select a suggestion, or use the search query field above.',
          },
        };
      },
      async run(input: WorkflowInvocationInput, context: WorkflowRunContext) {
        const indexedEntry = readInputField(input, 'indexedEntry');
        const query = readInputField(input, 'query') || indexedEntry;
        if (!query) {
          return {
            summary: 'Wiki search needs either a search query or an indexed entry.',
            lines: ['Open the Wiki Search modal and type a query, or pick an indexed entry from the live wiki list.'],
          };
        }
        const payload = await runAosJson(['wiki', 'search', query, '--json'], context);
        return summarizeWikiSearch(query, payload, indexedEntry || undefined);
      },
    },
    {
      id: 'dev-status',
      title: 'Dev Status',
      description: 'Report the current `./aos status --json` snapshot so teammates can inspect runtime and repo health from chat.',
      surface: 'jobs',
      availability: 'ready',
      group: 'quick-actions',
      registrySource: 'built-in',
      aliases: ['status', 'dev status'],
      command: {
        label: 'status',
        usage: 'status',
        examples: ['status', 'dev status', '1'],
      },
      async run(_input: WorkflowInvocationInput, context: WorkflowRunContext) {
        const payload = await runAosJson(['status', '--json'], context);
        return summarizeStatusPayload(payload);
      },
    },
    {
      id: 'new-features',
      title: 'New Features',
      description: 'Summarize recent repo changes using the local git history so chat users can ask what changed lately.',
      surface: 'jobs',
      availability: 'ready',
      group: 'quick-actions',
      registrySource: 'built-in',
      aliases: ['features', 'new features', 'recent changes'],
      command: {
        label: 'features',
        usage: 'features',
        examples: ['features', 'new features', '2'],
      },
      async run(_input: WorkflowInvocationInput, context: WorkflowRunContext) {
        const { stdout } = await runCommand(
          'git',
          ['log', '--date=short', '--pretty=format:%h%x09%ad%x09%s', '-n', String(MAX_FEATURE_RESULTS)],
          { cwd: context.repoRoot, timeoutMs: 15_000 },
        );
        return summarizeRecentFeatures(stdout);
      },
    },
    {
      id: 'workflow-catalog',
      title: 'Workflow Catalog',
      description: 'Show the live merged registry of Slack-ready and wiki-discovered workflows.',
      surface: 'workflows',
      availability: 'ready',
      group: 'discovery',
      registrySource: 'built-in',
      aliases: ['workflows', 'list workflows', 'registry'],
      command: {
        label: 'workflows',
        usage: 'workflows',
        examples: ['workflows', 'list workflows', '3'],
      },
      async run(_input: WorkflowInvocationInput, context: WorkflowRunContext) {
        const workflows = await loadLiveWorkflowCatalog(context.repoRoot);
        return summarizeWorkflowCatalog(workflows);
      },
    },
    {
      id: 'coming-soon',
      title: 'Coming Soon',
      description: 'List workflow plugins visible in the live wiki registry that are not yet wired to structured Slack launches.',
      surface: 'workflows',
      availability: 'ready',
      group: 'discovery',
      registrySource: 'built-in',
      aliases: ['coming soon', 'up next', 'pending workflows'],
      command: {
        label: 'coming soon',
        usage: 'coming soon',
        examples: ['coming soon', 'up next', '4'],
      },
      async run(_input: WorkflowInvocationInput, context: WorkflowRunContext) {
        const workflows = await loadLiveWorkflowCatalog(context.repoRoot);
        return summarizeComingSoon(workflows);
      },
    },
    {
      id: 'feature-request',
      title: 'Feature Request',
      description: 'Queue product or workflow feedback from Slack so it can be triaged later and replied back to the requester when done.',
      surface: 'workflows',
      availability: 'ready',
      group: 'feedback',
      registrySource: 'built-in',
      requiresInput: true,
      submitLabel: 'Submit',
      inputFields: [
        {
          id: FEATURE_REQUEST_FIELDS.requestTitle,
          label: 'Feature title',
          placeholder: 'Add Google Drive export for finished audits',
          helpText: 'Short label for the requested capability.',
          required: true,
        },
        {
          id: FEATURE_REQUEST_FIELDS.useCase,
          label: 'Context or use case',
          type: 'textarea',
          placeholder: 'Who needs this, when it matters, and what is blocked without it.',
          helpText: 'Capture the operating context, not just the ask.',
          required: true,
        },
        {
          id: FEATURE_REQUEST_FIELDS.desiredOutcome,
          label: 'Desired outcome',
          type: 'textarea',
          placeholder: 'What should the ideal finished experience look like?',
          helpText: 'Optional, but useful when the ask has multiple valid shapes.',
        },
        {
          id: FEATURE_REQUEST_FIELDS.impact,
          label: 'Impact',
          type: 'select',
          helpText: 'How much this request matters right now.',
          options: IMPACT_OPTIONS,
        },
      ],
      aliases: ['feature request', 'request feature', 'feedback feature'],
      command: {
        label: 'run feature-request',
        usage: 'run feature-request',
        examples: ['run feature-request'],
      },
      formatCommandText(input: WorkflowInvocationInput) {
        const title = readInputField(input, FEATURE_REQUEST_FIELDS.requestTitle) || 'untitled-request';
        return `run feature-request title="${title}"`;
      },
      async run(input: WorkflowInvocationInput) {
        const requestTitle = readInputField(input, FEATURE_REQUEST_FIELDS.requestTitle);
        const useCase = readInputField(input, FEATURE_REQUEST_FIELDS.useCase);
        const desiredOutcome = readInputField(input, FEATURE_REQUEST_FIELDS.desiredOutcome);
        const impact = readInputField(input, FEATURE_REQUEST_FIELDS.impact) || 'unspecified';

        if (!requestTitle || !useCase) {
          return {
            summary: 'Feature Request needs both a title and the user context.',
            lines: ['Open the Feature Request modal and capture what is needed plus why it matters.'],
          };
        }

        const request = {
          requestTitle,
          useCase,
          desiredOutcome: desiredOutcome || null,
          impact,
          intakeSource: 'slack',
        };

        const lines = [
          `Request: ${requestTitle}`,
          `Impact: ${impact}`,
          `Context: ${useCase}`,
          desiredOutcome ? `Desired outcome: ${desiredOutcome}` : 'Desired outcome: none provided',
          'Feedback queued. Reply back in Slack when the request is triaged or completed.',
        ];

        return queuedWorkflowResult({
          summary: `Feature Request queued: ${requestTitle}.`,
          lines,
          json: request,
          metadata: {
            queueType: 'feature-request',
            request,
            notificationMode: 'reply-when-complete',
          },
        });
      },
    },
    {
      id: 'bug-report',
      title: 'Report a Bug',
      description: 'Queue a bug report from Slack with enough context for follow-up, then reply back in Slack when it is resolved or closed.',
      surface: 'workflows',
      availability: 'ready',
      group: 'feedback',
      registrySource: 'built-in',
      requiresInput: true,
      submitLabel: 'Submit',
      inputFields: [
        {
          id: BUG_REPORT_FIELDS.bugTitle,
          label: 'Bug title',
          placeholder: 'Slack modal submission returns nothing',
          helpText: 'Short label for the defect.',
          required: true,
        },
        {
          id: BUG_REPORT_FIELDS.observedBehavior,
          label: 'Observed behavior',
          type: 'textarea',
          placeholder: 'What happened instead of the expected result?',
          helpText: 'Describe the failure or regression clearly.',
          required: true,
        },
        {
          id: BUG_REPORT_FIELDS.expectedBehavior,
          label: 'Expected behavior',
          type: 'textarea',
          placeholder: 'What should have happened?',
          helpText: 'Optional if the expected result is obvious.',
        },
        {
          id: BUG_REPORT_FIELDS.reproductionNotes,
          label: 'Reproduction notes',
          type: 'textarea',
          placeholder: 'Steps, environment, links, screenshots, or timing notes.',
          helpText: 'Optional repro details that help someone chase it down fast.',
        },
        {
          id: BUG_REPORT_FIELDS.severity,
          label: 'Severity',
          type: 'select',
          helpText: 'Rough severity for triage.',
          options: SEVERITY_OPTIONS,
        },
      ],
      aliases: ['report bug', 'bug report', 'file bug'],
      command: {
        label: 'run bug-report',
        usage: 'run bug-report',
        examples: ['run bug-report'],
      },
      formatCommandText(input: WorkflowInvocationInput) {
        const title = readInputField(input, BUG_REPORT_FIELDS.bugTitle) || 'untitled-bug';
        return `run bug-report title="${title}"`;
      },
      async run(input: WorkflowInvocationInput) {
        const bugTitle = readInputField(input, BUG_REPORT_FIELDS.bugTitle);
        const observedBehavior = readInputField(input, BUG_REPORT_FIELDS.observedBehavior);
        const expectedBehavior = readInputField(input, BUG_REPORT_FIELDS.expectedBehavior);
        const reproductionNotes = readInputField(input, BUG_REPORT_FIELDS.reproductionNotes);
        const severity = readInputField(input, BUG_REPORT_FIELDS.severity) || 'unspecified';

        if (!bugTitle || !observedBehavior) {
          return {
            summary: 'Report a Bug needs a title and the observed behavior.',
            lines: ['Open the bug report modal and capture what happened.'],
          };
        }

        const request = {
          bugTitle,
          observedBehavior,
          expectedBehavior: expectedBehavior || null,
          reproductionNotes: reproductionNotes || null,
          severity,
          intakeSource: 'slack',
        };

        const lines = [
          `Bug: ${bugTitle}`,
          `Severity: ${severity}`,
          `Observed: ${observedBehavior}`,
          expectedBehavior ? `Expected: ${expectedBehavior}` : 'Expected: none provided',
          reproductionNotes ? `Repro: ${reproductionNotes}` : 'Repro: none provided',
          'Bug report queued. Reply back in Slack when the issue is resolved or closed.',
        ];

        return queuedWorkflowResult({
          summary: `Bug report queued: ${bugTitle}.`,
          lines,
          json: request,
          metadata: {
            queueType: 'bug-report',
            request,
            notificationMode: 'reply-when-complete',
          },
        });
      },
    },
    {
      id: 'employer-brand-profile-kilos',
      title: 'Employer Brand Profile (KILOS)',
      description: 'Queue the KILOS-backed employer-brand profile intake flow for one client company and notify the requester in Slack when the work is done.',
      surface: 'workflows',
      availability: 'ready',
      group: 'launch',
      registrySource: 'built-in',
      requiresInput: true,
      submitLabel: 'Queue',
      inputFields: [
        {
          id: EMPLOYER_BRAND_PROFILE_FIELDS.clientCompanyName,
          label: 'Client company name',
          placeholder: 'Acme Corp',
          helpText: 'The company that needs the employer-brand profile.',
          required: true,
        },
        {
          id: EMPLOYER_BRAND_PROFILE_FIELDS.areaOfFocus,
          label: 'Area of focus',
          placeholder: 'Engineering talent, US market, EVP refresh',
          helpText: 'Optional lens to bias the profile request.',
        },
        {
          id: EMPLOYER_BRAND_PROFILE_FIELDS.workflowNotes,
          label: 'Workflow notes',
          type: 'textarea',
          placeholder: 'Constraints, timing, delivery intent, or any placeholders to preserve.',
          helpText: 'Optional notes carried into the queued request for downstream work.',
        },
      ],
      aliases: ['employer brand profile', 'profile kilos'],
      command: {
        label: 'run employer-brand-profile-kilos',
        usage: 'run employer-brand-profile-kilos',
        examples: ['run employer-brand-profile-kilos', 'profile kilos'],
      },
      formatCommandText(input: WorkflowInvocationInput) {
        const client = readInputField(input, EMPLOYER_BRAND_PROFILE_FIELDS.clientCompanyName) || 'unknown-client';
        return `run employer-brand-profile-kilos client="${client}"`;
      },
      async run(input: WorkflowInvocationInput) {
        const clientCompanyName = readInputField(input, EMPLOYER_BRAND_PROFILE_FIELDS.clientCompanyName);
        if (!clientCompanyName) {
          return {
            summary: 'Employer Brand Profile (KILOS) needs a client company name.',
            lines: ['Open the workflow modal and provide the client company name.'],
          };
        }

        const areaOfFocus = readInputField(input, EMPLOYER_BRAND_PROFILE_FIELDS.areaOfFocus);
        const workflowNotes = readInputField(input, EMPLOYER_BRAND_PROFILE_FIELDS.workflowNotes);
        const request = {
          framework: 'KILOS',
          clientCompanyName,
          areaOfFocus: areaOfFocus || null,
          workflowNotes: workflowNotes || null,
          downstreamWorkflow: 'employer-brand-profile-intake',
          downstreamHandoff: 'employer-brand-artifact-collection-planner',
        };

        const lines = [
          `Client: ${clientCompanyName}`,
          areaOfFocus ? `Area of focus: ${areaOfFocus}` : 'Area of focus: none provided',
          'Workflow queued. The requester should receive a Slack update in the original thread or DM when work is completed.',
          'Downstream canonical flow: employer-brand-profile-intake -> employer-brand-artifact-collection-planner',
        ];
        if (workflowNotes) lines.push(`Notes captured: ${workflowNotes}`);

        return queuedWorkflowResult({
          summary: `Employer Brand Profile (KILOS) request queued for ${clientCompanyName}.`,
          lines,
          json: request,
          metadata: {
            queueType: 'workflow-launch',
            framework: 'KILOS',
            request,
            notificationMode: 'reply-when-complete',
          },
        });
      },
    },
    {
      id: 'employer-brand-competitor-audit-kilos',
      title: 'Employer Brand Competitor Comparative Audit (KILOS)',
      description: 'Queue a KILOS comparative audit for one client and a competitor set, then notify the requester in Slack with the completed output link.',
      surface: 'workflows',
      availability: 'ready',
      group: 'launch',
      registrySource: 'built-in',
      requiresInput: true,
      submitLabel: 'Queue',
      inputFields: [
        {
          id: EMPLOYER_BRAND_AUDIT_FIELDS.clientCompanyName,
          label: 'Client company name',
          placeholder: 'Acme Corp',
          helpText: 'The client brand to compare against competitors.',
          required: true,
        },
        {
          id: EMPLOYER_BRAND_AUDIT_FIELDS.competitorCompanyNames,
          label: 'Competitors',
          type: 'textarea',
          placeholder: 'Globex\nInitech\nUmbrella',
          helpText: 'Required. Enter one competitor per line.',
          required: true,
        },
        {
          id: EMPLOYER_BRAND_AUDIT_FIELDS.areaOfFocus,
          label: 'Area of focus',
          placeholder: 'Careers site messaging, early talent, EMEA engineering',
          helpText: 'Optional lens to bias the comparison.',
        },
        {
          id: EMPLOYER_BRAND_AUDIT_FIELDS.workflowNotes,
          label: 'Workflow notes',
          type: 'textarea',
          placeholder: 'Known constraints, request owner notes, evidence caveats, or extra fields to preserve.',
          helpText: 'Optional notes carried forward for the eventual audit worker.',
        },
      ],
      aliases: ['employer brand competitor audit', 'comparative audit kilos', 'competitor audit kilos'],
      command: {
        label: 'run employer-brand-competitor-audit-kilos',
        usage: 'run employer-brand-competitor-audit-kilos',
        examples: ['run employer-brand-competitor-audit-kilos', 'competitor audit kilos'],
      },
      formatCommandText(input: WorkflowInvocationInput) {
        const client = readInputField(input, EMPLOYER_BRAND_AUDIT_FIELDS.clientCompanyName) || 'unknown-client';
        const competitors = parseCompanyList(readInputField(input, EMPLOYER_BRAND_AUDIT_FIELDS.competitorCompanyNames));
        return `run employer-brand-competitor-audit-kilos client="${client}" competitors="${competitors.join(', ')}"`;
      },
      async run(input: WorkflowInvocationInput) {
        const clientCompanyName = readInputField(input, EMPLOYER_BRAND_AUDIT_FIELDS.clientCompanyName);
        const competitors = parseCompanyList(readInputField(input, EMPLOYER_BRAND_AUDIT_FIELDS.competitorCompanyNames));

        if (!clientCompanyName) {
          return {
            summary: 'Employer Brand Competitor Comparative Audit (KILOS) needs a client company name.',
            lines: ['Open the workflow modal and provide the client company name.'],
          };
        }
        if (competitors.length === 0) {
          return {
            summary: 'Employer Brand Competitor Comparative Audit (KILOS) needs at least one competitor.',
            lines: ['Open the workflow modal and enter one competitor per line.'],
          };
        }

        const areaOfFocus = readInputField(input, EMPLOYER_BRAND_AUDIT_FIELDS.areaOfFocus);
        const workflowNotes = readInputField(input, EMPLOYER_BRAND_AUDIT_FIELDS.workflowNotes);
        const request = {
          framework: 'KILOS',
          clientCompanyName,
          competitors,
          areaOfFocus: areaOfFocus || null,
          workflowNotes: workflowNotes || null,
          downstreamWorkflow: 'employer-brand-competitor-comparison',
          prerequisiteFlows: ['employer-brand-profile-intake', 'employer-brand-profile-synthesis'],
        };

        const lines = [
          `Client: ${clientCompanyName}`,
          `Competitors: ${competitors.join(', ')}`,
          areaOfFocus ? `Area of focus: ${areaOfFocus}` : 'Area of focus: none provided',
          'Workflow queued. The requester should receive a Slack update with the finished audit link when work is completed.',
          'Downstream canonical flow: employer-brand-profile-intake -> employer-brand-profile-synthesis -> employer-brand-competitor-comparison',
        ];
        if (workflowNotes) lines.push(`Notes captured: ${workflowNotes}`);

        return queuedWorkflowResult({
          summary: `Employer Brand Competitor Comparative Audit (KILOS) queued for ${clientCompanyName} vs ${competitors.length} competitor${competitors.length === 1 ? '' : 's'}.`,
          lines,
          json: request,
          metadata: {
            queueType: 'workflow-launch',
            framework: 'KILOS',
            request,
            notificationMode: 'reply-when-complete',
          },
        });
      },
    },
  ];
}

function buildComingSoonWorkflowCatalog(wikiWorkflows: WikiIndexEntry[]): IntegrationWorkflowDefinition[] {
  return wikiWorkflows
    .map((entry) => ({
      id: entry.plugin ?? entry.name,
      title: humanizeWorkflowName(entry.plugin ?? entry.name),
      description: entry.description
        ?? `Workflow plugin discovered at ${entry.path ?? 'unknown path'}.`,
      surface: 'workflows' as const,
      availability: 'coming-soon' as const,
      group: 'discovery' as const,
      registrySource: 'wiki' as const,
      command: {
        label: `run ${entry.plugin ?? entry.name}`,
        usage: `run ${entry.plugin ?? entry.name}`,
        examples: [`run ${entry.plugin ?? entry.name}`],
      },
      async run() {
        return {
          summary: `${humanizeWorkflowName(entry.plugin ?? entry.name)} is visible in the live workflow registry but is not wired to a structured Slack launch form yet.`,
          lines: [
            entry.description ?? 'No workflow description is available yet.',
            entry.path ? `Path: ${entry.path}` : 'Path: unknown',
            'This entry was picked up from the live `aos wiki` workflow index without a rebuild.',
          ],
          json: entry,
        };
      },
    }))
    .filter((workflow) => !READY_WORKFLOW_IDS.has(workflow.id))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function mergeWorkflowCatalog(wikiIndex: WikiIndexEntry[]) {
  const ready = buildReadyWorkflowCatalog(wikiIndex);
  const comingSoon = buildComingSoonWorkflowCatalog(wikiIndex.filter((entry) => entry.type === 'workflow'));
  return [...ready, ...comingSoon];
}

export async function loadLiveWorkflowCatalog(repoRoot: string): Promise<IntegrationWorkflowDefinition[]> {
  const wikiIndex = await loadWikiIndex(repoRoot);
  return mergeWorkflowCatalog(wikiIndex);
}

export function buildPilotWorkflowCatalog(): IntegrationWorkflowDefinition[] {
  return mergeWorkflowCatalog([]);
}

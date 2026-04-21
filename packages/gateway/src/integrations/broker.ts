import type {
  BrokerCommandResponse,
  IntegrationArtifactLink,
  IntegrationJobCompletionRequest,
  IntegrationJobFailureRequest,
  IntegrationProviderNotifier,
  InboundIntegrationMessage,
  IntegrationBrokerSnapshot,
  IntegrationProviderDescriptor,
  WikiBrowserAction,
  WikiBrowserModel,
  WikiBrowserState,
  WikiIndexEntry,
  WorkflowInvocationInput,
  WorkflowLaunchRequest,
  IntegrationWorkflowDefinition,
  IntegrationWorkflowDescriptor,
  IntegrationSurfaceDescriptor,
  WorkflowRunResult,
} from './types.js';
import type { CoordinationDB, IntegrationJob } from '../db.js';
import {
  buildWikiBrowserModel,
  defaultWikiBrowserState,
  reduceWikiBrowserState,
} from './wiki-browser.js';

interface IntegrationBrokerOptions {
  db: CoordinationDB;
  repoRoot: string;
  brokerUrl: string;
  label?: string;
  surfaces: IntegrationSurfaceDescriptor[];
  providers: IntegrationProviderDescriptor[];
  workflows: IntegrationWorkflowDefinition[];
  workflowRegistryLoader?: (repoRoot: string) => Promise<IntegrationWorkflowDefinition[]>;
  workflowRefreshMs?: number;
  wikiIndexLoader?: (repoRoot: string) => Promise<WikiIndexEntry[]>;
  wikiRefreshMs?: number;
}

interface ParsedCommand {
  kind: 'help' | 'jobs' | 'run' | 'unknown';
  workflowId?: string;
  input?: string;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function mergeMetadata(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
) {
  if (!current && !patch) return undefined;
  return {
    ...(current ?? {}),
    ...(patch ?? {}),
  };
}

function formatWorkflowList(workflows: IntegrationWorkflowDescriptor[]) {
  const ready = workflows.filter((workflow) => workflow.availability !== 'coming-soon');
  const comingSoon = workflows.filter((workflow) => workflow.availability === 'coming-soon');
  const groupedReady = new Map<string, IntegrationWorkflowDescriptor[]>();
  for (const workflow of ready) {
    const key = workflow.group ?? 'workflows';
    const group = groupedReady.get(key) ?? [];
    group.push(workflow);
    groupedReady.set(key, group);
  }

  const lines = ['AOS command surface'];
  for (const [group, entries] of groupedReady.entries()) {
    lines.push('');
    lines.push(group === 'quick-actions'
      ? 'Quick actions'
      : group === 'research'
        ? 'Research'
        : group === 'launch'
          ? 'Launch-ready workflows'
          : group === 'feedback'
            ? 'Feedback'
            : 'Discovery');
    lines.push(...entries.map((workflow) => `- ${workflow.command.usage} - ${workflow.description}`));
  }

  lines.push('');
  lines.push('Jobs');
  lines.push(`- jobs - recent workflow runs`);
  if (comingSoon.length > 0) {
    lines.push('');
    lines.push(`Coming soon (${comingSoon.length})`);
    lines.push(...comingSoon.slice(0, 6).map((workflow) => `- ${workflow.title} - ${workflow.description}`));
  }

  lines.push('');
  lines.push('The registry is live. New wiki workflows can appear here without rebuilding the broker.');

  return lines.join('\n');
}

function uniqueNormalizedEntries(values: string[]) {
  return [...new Set(values.map((value) => normalizeText(value).toLowerCase()).filter(Boolean))];
}

function formatJobList(jobs: IntegrationJob[]) {
  if (jobs.length === 0) {
    return 'No broker jobs recorded yet. Run `status`, `features`, `workflows`, or `wiki <query>` to seed the queue.';
  }
  return [
    'Recent jobs',
    ...jobs.map((job) => {
      const label = job.workflowTitle ?? job.workflowId ?? 'unknown';
      const detail = job.summary ?? job.errorText ?? job.commandText;
      return `- [${job.status}] ${label} via ${job.provider} by ${job.requester ?? 'unknown'} - ${detail}`;
    }),
  ].join('\n');
}

function formatWorkflowResult(result: WorkflowRunResult, jobId: string) {
  const lines = [result.summary];
  if (result.lines && result.lines.length > 0) {
    lines.push(...result.lines.map((line) => `- ${line}`));
  }
  lines.push(`job ${jobId}`);
  return lines.join('\n');
}

function formatArtifactLink(link: IntegrationArtifactLink) {
  return `${link.label}: ${link.url}`;
}

export class IntegrationBroker {
  private readonly db: CoordinationDB;
  private readonly repoRoot: string;
  private workflows: IntegrationWorkflowDefinition[];
  private workflowById: Map<string, IntegrationWorkflowDefinition>;
  private readonly surfaces: IntegrationSurfaceDescriptor[];
  private providerDescriptors: IntegrationProviderDescriptor[];
  private brokerUrl: string;
  private readonly label: string;
  private readonly notifiers = new Map<string, IntegrationProviderNotifier>();
  private readonly workflowRegistryLoader?: (repoRoot: string) => Promise<IntegrationWorkflowDefinition[]>;
  private readonly workflowRefreshMs: number;
  private readonly wikiIndexLoader?: (repoRoot: string) => Promise<WikiIndexEntry[]>;
  private readonly wikiRefreshMs: number;
  private lastWorkflowRefreshAt = 0;
  private workflowRefreshInFlight: Promise<void> | null = null;
  private wikiIndex: WikiIndexEntry[] = [];
  private lastWikiRefreshAt = 0;
  private wikiRefreshInFlight: Promise<void> | null = null;

  constructor(options: IntegrationBrokerOptions) {
    this.db = options.db;
    this.repoRoot = options.repoRoot;
    this.surfaces = options.surfaces;
    this.providerDescriptors = options.providers;
    this.workflows = [];
    this.workflowById = new Map();
    this.brokerUrl = options.brokerUrl;
    this.label = options.label ?? 'AOS Integration Broker';
    this.workflowRegistryLoader = options.workflowRegistryLoader;
    this.workflowRefreshMs = options.workflowRefreshMs ?? 5_000;
    this.wikiIndexLoader = options.wikiIndexLoader;
    this.wikiRefreshMs = options.wikiRefreshMs ?? 5_000;
    this.setWorkflows(options.workflows);
  }

  setBrokerUrl(url: string) {
    // The HTTP server binds after broker construction in tests and the standalone
    // daemon, so the advertised URL is mutable.
    this.brokerUrl = url;
  }

  upsertProviderDescriptor(descriptor: IntegrationProviderDescriptor) {
    const next = this.providerDescriptors.filter((entry) => entry.id !== descriptor.id);
    next.push(descriptor);
    next.sort((left, right) => left.label.localeCompare(right.label));
    this.providerDescriptors = next;
  }

  registerNotifier(provider: string, notifier: IntegrationProviderNotifier | null) {
    if (!notifier) {
      this.notifiers.delete(provider);
      return;
    }
    this.notifiers.set(provider, notifier);
  }

  listWorkflows(): IntegrationWorkflowDescriptor[] {
    return this.workflows.map(({ run: _run, formatCommandText: _formatCommandText, ...descriptor }) => descriptor);
  }

  async getWorkflowCatalog(): Promise<IntegrationWorkflowDescriptor[]> {
    await this.refreshWorkflows();
    return this.listWorkflows();
  }

  async getWorkflowDefinition(id: string): Promise<IntegrationWorkflowDefinition | null> {
    await this.refreshWorkflows();
    return this.workflowById.get(id) ?? null;
  }

  async getWikiIndex(): Promise<WikiIndexEntry[]> {
    await this.refreshWikiIndex();
    return [...this.wikiIndex];
  }

  async getWikiBrowserModel(provider: string, requester: string): Promise<WikiBrowserModel> {
    await this.refreshWikiIndex();
    const state = await this.getWikiBrowserState(provider, requester);
    return buildWikiBrowserModel(this.wikiIndex, state);
  }

  async applyWikiBrowserAction(
    provider: string,
    requester: string,
    action: WikiBrowserAction,
  ): Promise<WikiBrowserModel> {
    await this.refreshWikiIndex();
    const current = await this.getWikiBrowserState(provider, requester);
    const next = reduceWikiBrowserState(current, action);
    const model = buildWikiBrowserModel(this.wikiIndex, next);
    await this.setWikiBrowserState(provider, requester, model.state);
    return model;
  }

  async listJobs(limit = 20): Promise<IntegrationJob[]> {
    return this.db.listIntegrationJobs({ limit });
  }

  async getSnapshot(limit = 20): Promise<IntegrationBrokerSnapshot> {
    const workflows = await this.getWorkflowCatalog();
    return {
      schema: 'aos-integration-broker-snapshot',
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      broker: {
        label: this.label,
        url: this.brokerUrl,
      },
      surfaces: this.surfaces,
      providers: [...this.providerDescriptors].sort((left, right) => left.label.localeCompare(right.label)),
      workflows,
      jobs: await this.listJobs(limit),
    };
  }

  async handleMessage(message: InboundIntegrationMessage): Promise<BrokerCommandResponse> {
    await this.refreshWorkflows();
    const parsed = this.parseCommand(message.text);
    if (parsed.kind === 'help') {
      return {
        kind: 'reply',
        text: formatWorkflowList(this.listWorkflows()),
      };
    }

    if (parsed.kind === 'jobs') {
      const jobs = await this.listJobs(8);
      return {
        kind: 'reply',
        text: formatJobList(jobs),
      };
    }

    if (parsed.kind === 'unknown') {
      return {
        kind: 'reply',
        text: `Unknown command "${normalizeText(message.text)}".\n\n${formatWorkflowList(this.listWorkflows())}`,
      };
    }

    const workflow = parsed.workflowId ? this.workflowById.get(parsed.workflowId) : null;
    if (!workflow) {
      return {
        kind: 'reply',
        text: `Unknown command "${normalizeText(message.text)}".\n\n${formatWorkflowList(this.listWorkflows())}`,
      };
    }

    return this.executeWorkflow({
      provider: message.provider,
      requester: message.requester,
      channel: message.channel,
      thread: message.thread,
      workflow,
      commandText: normalizeText(message.text),
      input: {
        text: parsed.input ?? '',
        source: 'text',
      },
    });
  }

  async launchWorkflow(request: WorkflowLaunchRequest): Promise<BrokerCommandResponse> {
    await this.refreshWorkflows();
    const workflow = this.workflowById.get(request.workflowId);
    if (!workflow) {
      return {
        kind: 'reply',
        text: `Unknown workflow "${request.workflowId}".`,
      };
    }

    const input = request.input ?? { source: 'api' };
    const commandText = normalizeText(
      workflow.formatCommandText?.(input)
        ?? (input.text ? `${workflow.command.label} ${input.text}` : workflow.command.label),
    );

    return this.executeWorkflow({
      provider: request.provider,
      requester: request.requester,
      channel: request.channel,
      thread: request.thread,
      workflow,
      commandText,
      input,
    });
  }

  async completeJob(id: string, request: IntegrationJobCompletionRequest): Promise<IntegrationJob> {
    const current = await this.db.getIntegrationJob(id);
    if (!current) throw new Error(`Integration job "${id}" not found`);

    const lines = [...(request.lines ?? [])];
    if (request.artifactLink) lines.push(formatArtifactLink(request.artifactLink));
    const metadata = mergeMetadata(current.metadata, mergeMetadata(request.metadata, request.artifactLink ? {
      artifactLink: request.artifactLink,
    } : undefined));

    const updated = await this.db.updateIntegrationJob(id, {
      status: 'succeeded',
      summary: request.summary,
      resultText: lines.length > 0 ? lines.join('\n') : current.resultText ?? null,
      resultJson: request.resultJson ?? current.resultJson,
      errorText: null,
      metadata,
      completedAt: new Date().toISOString(),
    });

    if (request.notifyRequester !== false) {
      await this.notifyRequester(updated, [
        `${updated.workflowTitle ?? updated.workflowId ?? 'Workflow'} completed.`,
        request.summary,
        ...lines,
        `job ${updated.id}`,
      ].join('\n'));
    }

    return updated;
  }

  async failJob(id: string, request: IntegrationJobFailureRequest): Promise<IntegrationJob> {
    const current = await this.db.getIntegrationJob(id);
    if (!current) throw new Error(`Integration job "${id}" not found`);

    const lines = request.lines ?? [];
    const metadata = mergeMetadata(current.metadata, request.metadata);
    const summary = request.summary ?? 'Workflow execution failed.';

    const updated = await this.db.updateIntegrationJob(id, {
      status: 'failed',
      summary,
      resultText: lines.length > 0 ? lines.join('\n') : current.resultText ?? null,
      errorText: request.errorText,
      metadata,
      completedAt: new Date().toISOString(),
    });

    if (request.notifyRequester !== false) {
      await this.notifyRequester(updated, [
        `${updated.workflowTitle ?? updated.workflowId ?? 'Workflow'} failed.`,
        summary,
        ...lines,
        request.errorText,
        `job ${updated.id}`,
      ].join('\n'));
    }

    return updated;
  }

  private async executeWorkflow(options: {
    provider: string;
    requester: string;
    channel?: string;
    thread?: string;
    workflow: IntegrationWorkflowDefinition;
    commandText: string;
    input: WorkflowInvocationInput;
  }): Promise<BrokerCommandResponse> {
    const job = await this.db.createIntegrationJob({
      provider: options.provider,
      workflowId: options.workflow.id,
      workflowTitle: options.workflow.title,
      surface: options.workflow.surface,
      requester: options.requester,
      channel: options.channel,
      thread: options.thread,
      commandText: options.commandText,
      status: 'running',
      startedAt: new Date().toISOString(),
      metadata: {
        provider: options.provider,
        requester: options.requester,
        workflowGroup: options.workflow.group,
        workflowAvailability: options.workflow.availability ?? 'ready',
        workflowInput: options.input.fields ?? undefined,
      },
    });

    try {
      const result = await options.workflow.run(options.input, { repoRoot: this.repoRoot });
      const status = result.status ?? 'succeeded';
      const metadata = mergeMetadata(job.metadata, result.metadata);
      const updated = await this.db.updateIntegrationJob(job.id, {
        status,
        summary: result.summary,
        resultText: result.lines?.join('\n') ?? null,
        resultJson: result.json,
        metadata,
        completedAt: status === 'succeeded' || status === 'failed' ? new Date().toISOString() : null,
      });
      return {
        kind: 'job',
        job: updated,
        text: formatWorkflowResult(result, updated.id),
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const updated = await this.db.updateIntegrationJob(job.id, {
        status: 'failed',
        summary: 'Workflow execution failed.',
        errorText: messageText,
        completedAt: new Date().toISOString(),
      });
      return {
        kind: 'job',
        job: updated,
        text: `Workflow failed.\n- ${messageText}\njob ${updated.id}`,
      };
    }
  }

  private async notifyRequester(job: IntegrationJob, text: string) {
    const notifier = this.notifiers.get(job.provider);
    if (!notifier) return;
    await notifier.notifyJobNotification({
      job,
      text,
    });
  }

  private parseCommand(rawText: string): ParsedCommand {
    const text = normalizeText(rawText);
    const lower = text.toLowerCase();

    if (!text || lower === 'help' || lower === 'menu' || lower === '?') {
      return { kind: 'help' };
    }

    if (lower === 'jobs' || lower === 'job status' || lower === String(this.workflows.length + 1)) {
      return { kind: 'jobs' };
    }

    const genericRun = text.match(/^run\s+([a-z0-9-]+)(?:\s+(.+))?$/i);
    if (genericRun) {
      return {
        kind: 'run',
        workflowId: genericRun[1].toLowerCase(),
        input: genericRun[2]?.trim() ?? '',
      };
    }

    const numbered = text.match(/^(\d+)(?:\s+(.+))?$/);
    if (numbered) {
      const index = Number(numbered[1]);
      if (Number.isFinite(index) && index >= 1 && index <= this.workflows.length) {
        const workflow = this.workflows[index - 1];
        return { kind: 'run', workflowId: workflow.id, input: numbered[2]?.trim() ?? '' };
      }
      if (index === this.workflows.length + 1) {
        return { kind: 'jobs' };
      }
    }

    for (const workflow of this.workflows) {
      const candidates = uniqueNormalizedEntries([
        workflow.command.label,
        ...(workflow.aliases ?? []),
      ]);

      for (const candidate of candidates) {
        if (lower === candidate) {
          return { kind: 'run', workflowId: workflow.id, input: '' };
        }

        if (!candidate.startsWith('run ') && lower.startsWith(`${candidate} `)) {
          return {
            kind: 'run',
            workflowId: workflow.id,
            input: text.slice(candidate.length).trim(),
          };
        }
      }
    }

    return { kind: 'unknown' };
  }

  private setWorkflows(workflows: IntegrationWorkflowDefinition[]) {
    this.workflows = workflows;
    this.workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  }

  private wikiBrowserStateKey(provider: string, requester: string) {
    return `integration/wiki-browser/${provider}/${requester}`;
  }

  private async getWikiBrowserState(provider: string, requester: string): Promise<WikiBrowserState> {
    const key = this.wikiBrowserStateKey(provider, requester);
    const [entry] = await this.db.getState(key);
    if (!entry?.value || typeof entry.value !== 'object') {
      return defaultWikiBrowserState();
    }
    const raw = entry.value as Partial<WikiBrowserState>;
    return {
      root: raw.root ?? 'types',
      branch: typeof raw.branch === 'string' ? raw.branch : undefined,
      entryPath: typeof raw.entryPath === 'string' ? raw.entryPath : undefined,
      page: typeof raw.page === 'number' ? raw.page : 0,
    };
  }

  private async setWikiBrowserState(provider: string, requester: string, state: WikiBrowserState) {
    await this.db.setState(this.wikiBrowserStateKey(provider, requester), state);
  }

  private async refreshWorkflows(force = false) {
    if (!this.workflowRegistryLoader) return;
    const stale = Date.now() - this.lastWorkflowRefreshAt >= this.workflowRefreshMs;
    if (!force && !stale && this.workflows.length > 0) return;
    if (this.workflowRefreshInFlight) {
      await this.workflowRefreshInFlight;
      return;
    }

    this.workflowRefreshInFlight = (async () => {
      try {
        const workflows = await this.workflowRegistryLoader!(this.repoRoot);
        this.setWorkflows(workflows);
        this.lastWorkflowRefreshAt = Date.now();
      } catch (error) {
        console.error('[integration-broker] failed to refresh workflow registry', error);
        this.lastWorkflowRefreshAt = Date.now();
      } finally {
        this.workflowRefreshInFlight = null;
      }
    })();

    await this.workflowRefreshInFlight;
  }

  private async refreshWikiIndex(force = false) {
    if (!this.wikiIndexLoader) return;
    const stale = Date.now() - this.lastWikiRefreshAt >= this.wikiRefreshMs;
    if (!force && !stale && this.wikiIndex.length > 0) return;
    if (this.wikiRefreshInFlight) {
      await this.wikiRefreshInFlight;
      return;
    }

    this.wikiRefreshInFlight = (async () => {
      try {
        this.wikiIndex = await this.wikiIndexLoader!(this.repoRoot);
        this.lastWikiRefreshAt = Date.now();
      } catch (error) {
        console.error('[integration-broker] failed to refresh wiki index', error);
        this.lastWikiRefreshAt = Date.now();
      } finally {
        this.wikiRefreshInFlight = null;
      }
    })();

    await this.wikiRefreshInFlight;
  }
}

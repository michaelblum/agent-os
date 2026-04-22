import type {
  BrokerCommandResponse,
  IntegrationBrokerSnapshot,
  IntegrationWorkflowDescriptor,
  WikiBrowserModel,
  WorkflowInputFieldDescriptor,
  WorkflowInputFieldOptionDescriptor,
} from '../types.js';

const MAX_SECTION_TEXT = 2800;
const MAX_HOME_ACTIVE_JOBS = 4;
const MAX_HOME_JOBS = 6;
const MAX_HOME_READY_WORKFLOWS = 6;
const MAX_HOME_COMING_SOON = 6;
const MAX_WORKFLOW_OPTIONS = 25;
const MAX_SELECT_OPTIONS = 100;

export const SLACK_ACTION_IDS = {
  commandStatus: 'aos_command_status',
  commandFeatures: 'aos_command_features',
  commandJobs: 'aos_command_jobs',
  workflow: 'aos_workflow',
  workflowPicker: 'aos_workflow_picker',
  wikiRootTypes: 'aos_wiki_root_types',
  wikiRootTags: 'aos_wiki_root_tags',
  wikiRootPlugins: 'aos_wiki_root_plugins',
  wikiOpenBranch: 'aos_wiki_open_branch',
  wikiOpenEntry: 'aos_wiki_open_entry',
  wikiBackToRoot: 'aos_wiki_back_root',
  wikiBackToBranch: 'aos_wiki_back_branch',
  wikiPrevPage: 'aos_wiki_prev_page',
  wikiNextPage: 'aos_wiki_next_page',
  wikiOpenPage: 'aos_wiki_open_page',
};

export const SLACK_VIEW_IDS = {
  workflowInput: 'aos_workflow_input',
  workflowResult: 'aos_workflow_result',
  wikiPage: 'aos_wiki_page',
};

export interface WikiResultEntry {
  name: string;
  path: string;
  type?: string;
  description?: string;
}

export interface SlackWorkflowModalMetadata {
  workflowId: string;
  source: 'message' | 'home' | 'command';
  channel?: string;
  thread?: string;
  userId?: string;
}

function plainText(text: string, emoji = true) {
  return {
    type: 'plain_text',
    text: text.slice(0, 75),
    emoji,
  };
}

function mrkdwn(text: string) {
  return {
    type: 'mrkdwn',
    text,
  };
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function header(text: string) {
  return {
    type: 'header',
    text: plainText(text, false),
  };
}

function divider() {
  return { type: 'divider' };
}

function chunkText(text: string, limit = MAX_SECTION_TEXT) {
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit && current) {
      chunks.push(current);
      current = line;
      continue;
    }
    if (next.length > limit) {
      chunks.push(truncate(next, limit));
      current = '';
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function slackFieldBlockId(fieldId: string) {
  return `aos_workflow_field_${fieldId}`.slice(0, 255);
}

export function slackFieldActionId(fieldId: string) {
  return `aos_workflow_value_${fieldId}`.slice(0, 255);
}

function button(actionId: string, text: string, value: string, style?: 'primary' | 'danger') {
  const payload: Record<string, unknown> = {
    type: 'button',
    text: plainText(text),
    action_id: actionId,
    value,
  };
  if (style) payload.style = style;
  return payload;
}

function workflowButton(text: string, workflowId: string, style?: 'primary' | 'danger') {
  const payload: Record<string, unknown> = {
    type: 'button',
    text: plainText(text),
    action_id: SLACK_ACTION_IDS.workflow,
    value: workflowId,
  };
  if (style) payload.style = style;
  return payload;
}

function sectionButton(actionId: string, text: string, value: string, style?: 'primary' | 'danger') {
  const payload: Record<string, unknown> = {
    type: 'button',
    text: plainText(text),
    action_id: actionId,
    value,
  };
  if (style) payload.style = style;
  return payload;
}

function actionRow(elements: Record<string, unknown>[]) {
  return {
    type: 'actions',
    elements,
  };
}

function workflowOption(workflow: IntegrationWorkflowDescriptor) {
  return {
    text: plainText(workflow.title),
    description: plainText(truncate(workflow.description, 75), false),
    value: workflow.id,
  };
}

function fieldOption(option: WorkflowInputFieldOptionDescriptor) {
  const payload: Record<string, unknown> = {
    text: plainText(truncate(option.label, 75), false),
    value: option.value,
  };
  if (option.description) payload.description = plainText(truncate(option.description, 75), false);
  return payload;
}

function workflowBuckets(workflows: IntegrationWorkflowDescriptor[]) {
  const ready = workflows.filter((workflow) => workflow.availability !== 'coming-soon');
  const comingSoon = workflows.filter((workflow) => workflow.availability === 'coming-soon');
  return {
    ready,
    comingSoon,
    launch: ready.filter((workflow) => workflow.group === 'launch'),
  };
}

function wikiRootActionId(root: WikiBrowserModel['state']['root']) {
  if (root === 'types') return SLACK_ACTION_IDS.wikiRootTypes;
  if (root === 'tags') return SLACK_ACTION_IDS.wikiRootTags;
  return SLACK_ACTION_IDS.wikiRootPlugins;
}

function quickActionBlocks() {
  return [
    header('Quick Actions'),
    {
      type: 'section',
      text: mrkdwn('Fast checks for whether the local broker is healthy and what has happened recently.'),
    },
    actionRow([
      button(SLACK_ACTION_IDS.commandStatus, 'Status', 'status', 'primary'),
      button(SLACK_ACTION_IDS.commandJobs, 'Jobs', 'jobs'),
      button(SLACK_ACTION_IDS.commandFeatures, 'Features', 'features'),
    ]),
  ];
}

function discoveryBlocks(workflows: IntegrationWorkflowDescriptor[]) {
  const { comingSoon } = workflowBuckets(workflows);
  return [
    header('Research'),
    {
      type: 'section',
      text: mrkdwn(`Use the wiki and live registry to understand what this system knows and what workflows exist. ${comingSoon.length > 0 ? `*${comingSoon.length}* coming-soon workflow${comingSoon.length === 1 ? '' : 's'} currently visible.` : ''}`),
    },
    actionRow([
      workflowButton('Wiki Search', 'wiki-search', 'primary'),
      workflowButton('Workflow Catalog', 'workflow-catalog'),
      workflowButton('Coming Soon', 'coming-soon'),
    ]),
  ];
}

function feedbackBlocks() {
  return [
    header('Feedback'),
    {
      type: 'section',
      text: mrkdwn('Collect feature requests and bug reports as queued jobs so the requester can get a Slack follow-up later.'),
    },
    actionRow([
      workflowButton('Feature Request', 'feature-request'),
      workflowButton('Report a Bug', 'bug-report'),
    ]),
  ];
}

function workflowPicker(workflows: IntegrationWorkflowDescriptor[]) {
  const { launch } = workflowBuckets(workflows);
  if (launch.length === 0) {
    return {
      type: 'section',
      text: mrkdwn('*Launch-ready workflows*\nNo structured launch workflows are registered right now.'),
    };
  }

  return {
    type: 'section',
    text: mrkdwn('*Launch-ready workflows*\nStart a structured workflow from Slack. Input-heavy flows open a form automatically.'),
    accessory: {
      type: 'static_select',
      action_id: SLACK_ACTION_IDS.workflowPicker,
      placeholder: plainText('Choose a workflow'),
      options: launch.slice(0, MAX_WORKFLOW_OPTIONS).map(workflowOption),
    },
  };
}

function footerContext() {
  return {
    type: 'context',
    elements: [
      mrkdwn('The workflow list is live. New wiki workflows can appear without rebuilding the broker. DM `menu` or mention the app in-channel to open the same controls in conversation.'),
    ],
  };
}

function onboardingBlocks() {
  return [
    header('Start Here'),
    {
      type: 'section',
      text: mrkdwn([
        '*What this app is*',
        'Agent-Notifier is the Slack front door for the local agent-os broker: it can show runtime state, browse wiki knowledge, launch structured workflows, and collect feedback.',
        '',
        '*What to do first*',
        '1. Run *Status* to confirm the broker is live.',
        '2. Use the *Wiki Browser* below or *Wiki Search* to learn the available concepts, entities, and workflows.',
        '3. Use *Launch-ready workflows* when you want the system to start real work.',
        '',
        '*Common outcomes*',
        '- Start an employer-brand workflow',
        '- Explore what Sigil / agent-os knows',
        '- Report a bug or request a feature',
      ].join('\n')),
    },
  ];
}

function rootDescription(model: WikiBrowserModel) {
  return model.roots.find((root) => root.id === model.state.root)?.description ?? '';
}

function currentBranchLabel(model: WikiBrowserModel) {
  return model.activeBranch?.label ?? (model.state.branch ? model.state.branch : rootDescription(model));
}

function formatWikiEntrySummary(entry: NonNullable<WikiBrowserModel['selectedEntry']>) {
  const lines = [
    `*${entry.name}*`,
    entry.description ? truncate(entry.description, 220) : 'No description available.',
    `*Type:* ${entry.type ?? 'unknown'}`,
    `*Path:* \`${entry.path ?? 'unknown'}\``,
    `*Source:* ${entry.plugin ? humanizePlugin(entry.plugin) : 'Core wiki'}`,
  ];

  if (entry.tags && entry.tags.length > 0) {
    lines.push(`*Tags:* ${entry.tags.join(', ')}`);
  }

  return lines.join('\n');
}

function humanizePlugin(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function wikiBrowserBlocks(model: WikiBrowserModel) {
  const blocks: Record<string, unknown>[] = [
    header('Wiki Browser'),
    {
      type: 'section',
      text: mrkdwn(model.selectedEntry
        ? `Browse the live wiki index from App Home. *${model.totalEntries}* entr${model.totalEntries === 1 ? 'y' : 'ies'} in *${currentBranchLabel(model)}*.`
        : model.state.branch
          ? `Browse the live wiki index from App Home. *${model.totalEntries}* entr${model.totalEntries === 1 ? 'y' : 'ies'} in *${currentBranchLabel(model)}*.`
          : `Browse the live wiki index from App Home. ${rootDescription(model)}`),
    },
    actionRow([
      button(
        SLACK_ACTION_IDS.wikiRootTypes,
        'Types',
        'types',
        model.state.root === 'types' ? 'primary' : undefined,
      ),
      button(
        SLACK_ACTION_IDS.wikiRootTags,
        'Tags',
        'tags',
        model.state.root === 'tags' ? 'primary' : undefined,
      ),
      button(
        SLACK_ACTION_IDS.wikiRootPlugins,
        'Plugins',
        'plugins',
        model.state.root === 'plugins' ? 'primary' : undefined,
      ),
    ]),
    {
      type: 'context',
      elements: [
        mrkdwn(`Path: ${model.breadcrumbs.map((crumb) => crumb.label).join(' -> ')}`),
      ],
    },
  ];

  if (!model.state.branch) {
    for (const branch of model.branches) {
      blocks.push({
        type: 'section',
        text: mrkdwn(`*${branch.label}*\n${branch.description}`),
        accessory: sectionButton(SLACK_ACTION_IDS.wikiOpenBranch, 'Expand', branch.id),
      });
    }
  } else if (model.selectedEntry) {
    blocks.push(actionRow([
      button(SLACK_ACTION_IDS.wikiBackToBranch, 'Back To Entries', 'back'),
      workflowButton('Wiki Search', 'wiki-search'),
    ]));
    blocks.push({
      type: 'section',
      text: mrkdwn(formatWikiEntrySummary(model.selectedEntry)),
    });
  } else {
    blocks.push(actionRow([
      button(SLACK_ACTION_IDS.wikiBackToRoot, 'Back To Branches', 'back'),
      workflowButton('Wiki Search', 'wiki-search'),
    ]));
    for (const entry of model.entries) {
      const detail = [
        `*${entry.name}*`,
        entry.description ? truncate(entry.description, 140) : 'No description available.',
        [entry.type ?? 'unknown', entry.plugin ? humanizePlugin(entry.plugin) : 'core'].join(' • '),
      ].join('\n');

      blocks.push({
        type: 'section',
        text: mrkdwn(detail),
        accessory: sectionButton(
          SLACK_ACTION_IDS.wikiOpenEntry,
          'Open',
          entry.path ?? entry.name,
        ),
      });
    }
  }

  if (model.hasPrevPage || model.hasNextPage) {
    const elements: Record<string, unknown>[] = [];
    if (model.hasPrevPage) {
      elements.push(button(SLACK_ACTION_IDS.wikiPrevPage, 'Previous', 'prev'));
    }
    if (model.state.branch) {
      elements.push(button(SLACK_ACTION_IDS.wikiBackToRoot, 'Branches', 'back'));
    }
    if (model.hasNextPage) {
      elements.push(button(SLACK_ACTION_IDS.wikiNextPage, 'Next', 'next'));
    }
    blocks.push(actionRow(elements));
  }

  return blocks;
}

function formatProvider(provider: IntegrationBrokerSnapshot['providers'][number]) {
  const icon = provider.status === 'ready'
    ? ':large_green_circle:'
    : provider.status === 'planned'
      ? ':white_circle:'
      : provider.status === 'error'
        ? ':red_circle:'
        : ':black_circle:';
  const notes = provider.notes?.[0] ? ` — ${provider.notes[0]}` : '';
  return `${icon} *${provider.label}* — ${provider.status}${notes}`;
}

function formatJobStatus(status: IntegrationBrokerSnapshot['jobs'][number]['status']) {
  if (status === 'running') return ':large_blue_circle:';
  if (status === 'queued') return ':hourglass_flowing_sand:';
  if (status === 'succeeded') return ':white_check_mark:';
  return ':x:';
}

function jobArtifactLink(job: IntegrationBrokerSnapshot['jobs'][number]) {
  const raw = job.metadata && typeof job.metadata === 'object'
    ? (job.metadata as Record<string, unknown>).artifactLink
    : undefined;
  if (!raw || typeof raw !== 'object') return null;
  const url = typeof (raw as Record<string, unknown>).url === 'string'
    ? (raw as Record<string, unknown>).url
    : null;
  if (!url) return null;
  const label = typeof (raw as Record<string, unknown>).label === 'string'
    ? (raw as Record<string, unknown>).label
    : 'Open result';
  return `<${url}|${label}>`;
}

function isActiveLaunchJob(job: IntegrationBrokerSnapshot['jobs'][number]) {
  if (job.status !== 'queued' && job.status !== 'running') return false;
  const metadata = job.metadata && typeof job.metadata === 'object'
    ? job.metadata as Record<string, unknown>
    : null;
  return metadata?.queueType === 'workflow-launch' || metadata?.workflowGroup === 'launch';
}

function formatJob(job: IntegrationBrokerSnapshot['jobs'][number]) {
  const label = job.workflowTitle ?? job.workflowId ?? job.commandText;
  const detail = job.summary ?? job.errorText ?? job.commandText;
  const artifactLink = jobArtifactLink(job);
  return `${formatJobStatus(job.status)} *${label}* — ${job.status} — ${detail}${artifactLink ? ` — ${artifactLink}` : ''}`;
}

function formatWorkflow(workflow: IntegrationWorkflowDescriptor) {
  const availability = workflow.availability === 'coming-soon' ? 'coming soon' : 'ready';
  return `• *${workflow.title}* — \`${workflow.command.usage}\` — ${availability}`;
}

export function workflowCommandText(workflow: IntegrationWorkflowDescriptor, input = '') {
  const trimmed = input.trim();
  return trimmed ? `${workflow.command.label} ${trimmed}` : workflow.command.label;
}

function inputFieldBlock(field: WorkflowInputFieldDescriptor, initialValue = '') {
  const label = plainText(truncate(field.label, 48), false);
  const hint = field.helpText ? plainText(truncate(field.helpText, 150), false) : undefined;

  if (field.type === 'select' && field.dynamicOptionsSource === 'wiki-index') {
    return {
      type: 'input',
      block_id: slackFieldBlockId(field.id),
      optional: field.required !== true,
      label,
      hint,
      element: {
        type: 'external_select',
        action_id: slackFieldActionId(field.id),
        min_query_length: 0,
        placeholder: plainText(field.placeholder ? truncate(field.placeholder, 75) : 'Type to search', false),
      },
    };
  }

  if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
    const options = field.options.slice(0, MAX_SELECT_OPTIONS).map(fieldOption);
    const initialOption = options.find((option) => option.value === initialValue);
    return {
      type: 'input',
      block_id: slackFieldBlockId(field.id),
      optional: field.required !== true,
      label,
      hint,
      element: {
        type: 'static_select',
        action_id: slackFieldActionId(field.id),
        placeholder: plainText(field.placeholder ? truncate(field.placeholder, 75) : 'Choose an option', false),
        options,
        initial_option: initialOption,
      },
    };
  }

  const isMultiline = field.type === 'textarea';
  return {
    type: 'input',
    block_id: slackFieldBlockId(field.id),
    optional: field.required !== true,
    label,
    hint,
    element: {
      type: 'plain_text_input',
      action_id: slackFieldActionId(field.id),
      multiline: isMultiline,
      initial_value: initialValue,
      placeholder: field.placeholder ? plainText(truncate(field.placeholder, 150), false) : undefined,
    },
  };
}

function controlBlocks(workflows: IntegrationWorkflowDescriptor[]) {
  const { ready, comingSoon } = workflowBuckets(workflows);
  const readyCount = ready.length;
  const comingSoonCount = comingSoon.length;

  return [
    header('Agent-Notifier'),
    {
      type: 'section',
      text: mrkdwn(`Use this Slack surface to explore the wiki, check broker health, launch workflows, and leave feedback. *${readyCount}* workflow${readyCount === 1 ? '' : 's'} are ready now; *${comingSoonCount}* more are visible in the live registry.`),
    },
    divider(),
    ...onboardingBlocks(),
    divider(),
    ...quickActionBlocks(),
    divider(),
    ...discoveryBlocks(workflows),
    divider(),
    workflowPicker(workflows),
    divider(),
    ...feedbackBlocks(),
    footerContext(),
  ];
}

export function buildSlackControlBlocks(workflows: IntegrationWorkflowDescriptor[]) {
  return controlBlocks(workflows);
}

export function buildSlackResponseBlocks(
  response: BrokerCommandResponse,
  workflows: IntegrationWorkflowDescriptor[],
) {
  const title = response.kind === 'job'
    ? (response.job?.workflowTitle ?? 'Workflow result')
    : 'AOS reply';
  const blocks: Record<string, unknown>[] = [
    header(title),
  ];

  for (const chunk of chunkText(response.text)) {
    blocks.push({
      type: 'section',
      text: mrkdwn(chunk),
    });
  }

  blocks.push(divider());
  blocks.push(...controlBlocks(workflows));
  return blocks;
}

export function buildSlackHomeView(
  snapshot: IntegrationBrokerSnapshot,
  options: { recentResult?: BrokerCommandResponse; wikiBrowser?: WikiBrowserModel } = {},
) {
  const { ready, comingSoon } = workflowBuckets(snapshot.workflows);
  const activeLaunches = snapshot.jobs.filter(isActiveLaunchJob).slice(0, MAX_HOME_ACTIVE_JOBS);
  const recentJobs = snapshot.jobs
    .filter((job) => !activeLaunches.some((active) => active.id === job.id))
    .slice(0, MAX_HOME_JOBS);
  const blocks: Record<string, unknown>[] = [
    header('Agent-Notifier Home'),
    {
      type: 'section',
      text: mrkdwn(`Welcome to Agent-Notifier. This is the persistent Slack surface for browsing knowledge, launching workflows, and checking broker health.\n*Ready now:* ${ready.length} • *Coming soon:* ${comingSoon.length}`),
    },
  ];

  if (options.recentResult) {
    blocks.push(divider());
    blocks.push({
      type: 'section',
      text: mrkdwn(`*Latest result*\n${truncate(options.recentResult.text, MAX_SECTION_TEXT)}`),
    });
  }

  blocks.push(
    divider(),
    ...onboardingBlocks(),
    divider(),
    ...quickActionBlocks(),
    divider(),
    ...discoveryBlocks(snapshot.workflows),
    divider(),
    ...(options.wikiBrowser ? wikiBrowserBlocks(options.wikiBrowser) : []),
    divider(),
    workflowPicker(snapshot.workflows),
    divider(),
    ...feedbackBlocks(),
  );

  blocks.push(divider());
  blocks.push({
    type: 'section',
    text: mrkdwn([
      '*Providers*',
      ...snapshot.providers.map(formatProvider),
    ].join('\n')),
  });

  blocks.push({
    type: 'section',
    text: mrkdwn([
      '*Ready now*',
      ...ready.slice(0, MAX_HOME_READY_WORKFLOWS).map(formatWorkflow),
    ].join('\n')),
  });

  if (comingSoon.length > 0) {
    blocks.push({
      type: 'section',
      text: mrkdwn([
        '*Coming soon*',
        ...comingSoon.slice(0, MAX_HOME_COMING_SOON).map(formatWorkflow),
      ].join('\n')),
    });
  }

  if (activeLaunches.length > 0) {
    blocks.push({
      type: 'section',
      text: mrkdwn([
        '*Active launches*',
        ...activeLaunches.map(formatJob),
      ].join('\n')),
    });
  }

  blocks.push({
    type: 'section',
    text: mrkdwn([
      '*Recent jobs*',
      ...(recentJobs.length > 0
        ? recentJobs.map(formatJob)
        : ['No completed or non-launch jobs yet.']),
    ].join('\n')),
  });

  blocks.push({
    type: 'context',
    elements: [
      mrkdwn(`Broker: ${snapshot.broker.url} • Updated ${snapshot.generated_at}`),
    ],
  });

  return {
    type: 'home',
    blocks,
  };
}

export function buildWorkflowLoadingModal(
  workflow: IntegrationWorkflowDescriptor,
  metadata: SlackWorkflowModalMetadata,
) {
  return {
    type: 'modal',
    callback_id: SLACK_VIEW_IDS.workflowResult,
    private_metadata: JSON.stringify(metadata),
    title: plainText(truncate(workflow.title, 24)),
    close: plainText('Close'),
    blocks: [
      {
        type: 'section',
        text: mrkdwn(`:hourglass_flowing_sand: Running *${workflow.title}*…`),
      },
    ],
  };
}

export function buildWorkflowResultModal(
  workflow: IntegrationWorkflowDescriptor,
  responseText: string,
  metadata: SlackWorkflowModalMetadata,
  options: { wikiEntries?: WikiResultEntry[]; summary?: string } = {},
) {
  const blocks: Record<string, unknown>[] = [];
  const entries = options.wikiEntries ?? [];

  if (entries.length > 0) {
    const summary = options.summary?.trim();
    if (summary) {
      blocks.push({
        type: 'section',
        text: mrkdwn(summary),
      });
    }
    for (const entry of entries) {
      const detail = [
        `*${entry.name}*${entry.type ? ` — _${entry.type}_` : ''}`,
        entry.description ? truncate(entry.description, 220) : 'No description available.',
        `\`${entry.path}\``,
      ].join('\n');
      blocks.push({
        type: 'section',
        text: mrkdwn(detail),
        accessory: sectionButton(
          SLACK_ACTION_IDS.wikiOpenPage,
          'Open',
          entry.path,
        ),
      });
    }
  } else {
    const body = responseText.trim() || 'Workflow completed with no output.';
    for (const chunk of chunkText(body)) {
      blocks.push({
        type: 'section',
        text: mrkdwn(chunk),
      });
    }
    if (blocks.length === 0) {
      blocks.push({
        type: 'section',
        text: mrkdwn(body),
      });
    }
  }

  blocks.push(divider());
  blocks.push(actionRow([
    workflowButton(`Run ${workflow.title} again`, workflow.id, 'primary'),
  ]));

  return {
    type: 'modal',
    callback_id: SLACK_VIEW_IDS.workflowResult,
    private_metadata: JSON.stringify(metadata),
    title: plainText(truncate(workflow.title, 24)),
    close: plainText('Close'),
    blocks,
  };
}

export function buildWikiPageModal(args: {
  name?: string;
  path: string;
  body: string;
  backLabel?: string;
}) {
  const titleText = args.name ?? args.path.split('/').pop() ?? 'Wiki Page';
  const body = args.body.trim() || 'This page is empty.';
  const blocks: Record<string, unknown>[] = [
    {
      type: 'context',
      elements: [mrkdwn(`Path: \`${args.path}\` — close this view to return to search results.`)],
    },
  ];
  for (const chunk of chunkText(body)) {
    blocks.push({
      type: 'section',
      text: mrkdwn(chunk),
    });
  }
  blocks.push(divider());
  blocks.push({
    type: 'context',
    elements: [mrkdwn('Hover the text above and click _Copy_ to copy.')],
  });

  return {
    type: 'modal',
    callback_id: SLACK_VIEW_IDS.wikiPage,
    title: plainText(truncate(titleText, 24)),
    close: plainText(truncate(args.backLabel ?? '← Back to results', 24)),
    blocks,
  };
}

export function buildWorkflowInputModal(
  workflow: IntegrationWorkflowDescriptor,
  metadata: SlackWorkflowModalMetadata,
  initialValues: Record<string, string> = {},
) {
  const inputFields = workflow.inputFields && workflow.inputFields.length > 0
    ? workflow.inputFields
    : [
        {
          id: 'input',
          label: workflow.command.usage,
          placeholder: workflow.command.examples[0] ?? workflow.command.usage,
          helpText: workflow.description,
          required: true,
        },
      ];

  return {
    type: 'modal',
    callback_id: SLACK_VIEW_IDS.workflowInput,
    private_metadata: JSON.stringify(metadata),
    title: plainText(truncate(workflow.title, 24)),
    submit: plainText(truncate(workflow.submitLabel ?? 'Run', 24)),
    close: plainText('Cancel'),
    blocks: [
      ...inputFields.map((field) => inputFieldBlock(field, initialValues[field.id] ?? '')),
      {
        type: 'context',
        elements: [
          mrkdwn(workflow.description),
        ],
      },
    ],
  };
}

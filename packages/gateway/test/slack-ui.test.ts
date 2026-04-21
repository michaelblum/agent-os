import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BrokerCommandResponse, IntegrationBrokerSnapshot, IntegrationWorkflowDescriptor } from '../src/integrations/types.js';
import {
  buildSlackControlBlocks,
  buildSlackHomeView,
  buildSlackResponseBlocks,
  buildWorkflowInputModal,
  slackFieldActionId,
  slackFieldBlockId,
  SLACK_ACTION_IDS,
  SLACK_VIEW_IDS,
  workflowCommandText,
} from '../src/integrations/providers/slack-ui.js';

const workflows: IntegrationWorkflowDescriptor[] = [
  {
    id: 'wiki-search',
    title: 'Fuzzy Search Wiki',
    description: 'Search the local wiki index.',
    surface: 'workflows',
    availability: 'ready',
    group: 'research',
    requiresInput: true,
    submitLabel: 'Search',
    inputFields: [
      {
        id: 'query',
        label: 'Search query',
        placeholder: 'sigil',
        required: true,
      },
      {
        id: 'indexedEntry',
        label: 'Quick jump to a known entry',
        type: 'select',
        dynamicOptionsSource: 'wiki-index',
      },
    ],
    aliases: ['wiki'],
    command: {
      label: 'wiki',
      usage: 'wiki <query>',
      examples: ['wiki sigil'],
    },
  },
  {
    id: 'dev-status',
    title: 'Dev Status',
    description: 'Report runtime state.',
    surface: 'jobs',
    availability: 'ready',
    group: 'quick-actions',
    command: {
      label: 'status',
      usage: 'status',
      examples: ['status'],
    },
  },
  {
    id: 'employer-brand-profile-kilos',
    title: 'Employer Brand Profile (KILOS)',
    description: 'Queue a structured employer-brand workflow.',
    surface: 'workflows',
    availability: 'ready',
    group: 'launch',
    requiresInput: true,
    inputFields: [
      {
        id: 'clientCompanyName',
        label: 'Client company name',
        required: true,
      },
    ],
    command: {
      label: 'run employer-brand-profile-kilos',
      usage: 'run employer-brand-profile-kilos',
      examples: ['run employer-brand-profile-kilos'],
    },
  },
  {
    id: 'future-workflow',
    title: 'Future Workflow',
    description: 'Visible from the live registry, not wired yet.',
    surface: 'workflows',
    availability: 'coming-soon',
    group: 'discovery',
    command: {
      label: 'run future-workflow',
      usage: 'run future-workflow',
      examples: ['run future-workflow'],
    },
  },
];

describe('slack-ui helpers', () => {
  it('builds control blocks with quick actions and workflow picker', () => {
    const blocks = buildSlackControlBlocks(workflows) as Array<Record<string, any>>;
    assert.equal(blocks[0]?.type, 'header');
    assert.ok(blocks.some((block) => block.type === 'actions'));
    const picker = blocks.find((block) => block.type === 'section' && block.accessory?.action_id === SLACK_ACTION_IDS.workflowPicker);
    assert.ok(picker);
    assert.equal(picker?.accessory?.options?.length, 1);
  });

  it('builds response blocks with command actions', () => {
    const response: BrokerCommandResponse = {
      kind: 'job',
      text: 'Current repo/runtime status.\n- branch main',
      job: {
        id: 'job_123',
        provider: 'slack',
        commandText: 'status',
        status: 'succeeded',
        createdAt: '2026-04-21T00:00:00Z',
        updatedAt: '2026-04-21T00:00:00Z',
      },
    };
    const blocks = buildSlackResponseBlocks(response, workflows) as Array<Record<string, any>>;
    assert.equal(blocks[0]?.type, 'header');
    assert.ok(blocks.some((block) => block.type === 'actions'));
    assert.ok(blocks.some((block) => block.type === 'divider'));
  });

  it('builds a modal for input workflows', () => {
    const view = buildWorkflowInputModal(workflows[0], {
      workflowId: 'wiki-search',
      source: 'message',
      channel: 'C123',
      thread: '123.456',
      userId: 'U123',
    }, { query: 'sigil' }) as Record<string, any>;

    assert.equal(view.callback_id, SLACK_VIEW_IDS.workflowInput);
    assert.match(view.private_metadata, /wiki-search/);
    assert.equal(view.blocks[0]?.block_id, slackFieldBlockId('query'));
    assert.equal(view.blocks[0]?.element?.action_id, slackFieldActionId('query'));
    assert.equal(view.blocks[0]?.element?.initial_value, 'sigil');
    assert.equal(view.blocks[1]?.element?.type, 'external_select');
    assert.equal(view.submit?.text, 'Search');
  });

  it('builds an app home view from the provider-neutral snapshot', () => {
    const snapshot: IntegrationBrokerSnapshot = {
      schema: 'aos-integration-broker-snapshot',
      version: '1.0.0',
      generated_at: '2026-04-21T00:00:00Z',
      broker: {
        label: 'AOS Integration Broker',
        url: 'http://127.0.0.1:47231',
      },
      surfaces: [
        { id: 'jobs', label: 'Jobs', description: 'Recent jobs.' },
        { id: 'workflows', label: 'Workflows', description: 'Workflow catalog.' },
        { id: 'integrations', label: 'Integrations', description: 'Providers.' },
        { id: 'activity', label: 'Activity', description: 'Operator actions.' },
      ],
      providers: [
        {
          id: 'slack',
          kind: 'slack',
          label: 'Slack',
          status: 'ready',
          enabled: true,
          configured: true,
          capabilities: ['dm', 'app-home'],
          notes: ['Socket Mode connected.'],
        },
      ],
      workflows,
      jobs: [
        {
          id: 'job_launch',
          provider: 'slack',
          workflowId: 'employer-brand-profile-kilos',
          workflowTitle: 'Employer Brand Profile (KILOS)',
          commandText: 'run employer-brand-profile-kilos',
          status: 'queued',
          summary: 'Employer Brand Profile (KILOS) request queued for Acme.',
          createdAt: '2026-04-21T00:00:00Z',
          updatedAt: '2026-04-21T00:00:00Z',
          metadata: {
            queueType: 'workflow-launch',
          },
        },
        {
          id: 'job_123',
          provider: 'slack',
          workflowId: 'dev-status',
          workflowTitle: 'Dev Status',
          commandText: 'status',
          status: 'succeeded',
          summary: 'Current repo/runtime status.',
          createdAt: '2026-04-21T00:00:00Z',
          updatedAt: '2026-04-21T00:00:01Z',
        },
      ],
    };

    const view = buildSlackHomeView(snapshot, {
      recentResult: {
        kind: 'reply',
        text: '6 wiki matches for "kilos".',
      },
      wikiBrowser: {
        state: { root: 'types', page: 0 },
        roots: [
          { id: 'types', label: 'Types', branchCount: 3, entryCount: 12, description: '12 entries across 3 types.' },
          { id: 'tags', label: 'Tags', branchCount: 8, entryCount: 12, description: '8 tags across 12 entries.' },
          { id: 'plugins', label: 'Plugins', branchCount: 2, entryCount: 12, description: '2 plugin buckets across 12 entries.' },
        ],
        breadcrumbs: [
          { label: 'Types', state: { root: 'types', page: 0 } },
        ],
        branches: [
          { id: 'concept', label: 'Concept', count: 6, description: '6 concept entries' },
          { id: 'entity', label: 'Entity', count: 4, description: '4 entity entries' },
        ],
        entries: [],
        totalEntries: 12,
        totalBranchCount: 3,
        hasPrevPage: false,
        hasNextPage: false,
        page: 0,
        pageSize: 12,
      },
    }) as Record<string, any>;
    assert.equal(view.type, 'home');
    assert.ok(Array.isArray(view.blocks));
    assert.ok(view.blocks.some((block: any) => block.type === 'section'));
    assert.ok(view.blocks.some((block: any) => block.type === 'actions'));
    assert.ok(view.blocks.some((block: any) => block.type === 'header' && block.text?.text === 'Wiki Browser'));
    const latestResult = view.blocks.find((block: any) => block.type === 'section' && block.text?.text?.includes('*Latest result*'));
    assert.ok(latestResult);
    const activeLaunches = view.blocks.find((block: any) => block.type === 'section' && block.text?.text?.includes('*Active launches*'));
    assert.ok(activeLaunches);
    assert.match(activeLaunches?.text?.text ?? '', /Employer Brand Profile \(KILOS\)/);
  });

  it('reconstructs workflow commands from descriptor labels', () => {
    assert.equal(workflowCommandText(workflows[0], 'sigil'), 'wiki sigil');
    assert.equal(workflowCommandText(workflows[1]), 'status');
  });
});

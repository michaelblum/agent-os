import type { App, AppOptions, SlackEventMiddlewareArgs } from '@slack/bolt';
import type { IntegrationBroker } from '../broker.js';
import type { BrokerCommandResponse, IntegrationProviderDescriptor, IntegrationWorkflowDefinition, IntegrationWorkflowDescriptor } from '../types.js';
import {
  buildSlackControlBlocks,
  buildSlackHomeView,
  buildSlackResponseBlocks,
  buildWorkflowInputModal,
  SLACK_ACTION_IDS,
  SLACK_VIEW_IDS,
  slackFieldActionId,
  slackFieldBlockId,
  workflowCommandText,
  type SlackWorkflowModalMetadata,
} from './slack-ui.js';

interface SlackProviderOptions {
  broker: IntegrationBroker;
}

interface SlackMessageTarget {
  channel?: string;
  thread?: string;
  userId?: string;
  source: 'message' | 'home' | 'command';
}

const MAX_EXTERNAL_SELECT_OPTIONS = 100;

function cleanSlackText(text: string) {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

function isMenuText(text: string) {
  const normalized = text.trim().toLowerCase();
  return !normalized || normalized === 'help' || normalized === 'menu' || normalized === '?';
}

function plainText(text: string, emoji = false) {
  return {
    type: 'plain_text',
    text: text.slice(0, 75),
    emoji,
  };
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export class SlackIntegrationProvider {
  private readonly broker: IntegrationBroker;
  private readonly slashCommand: string;
  private app: App | null = null;
  private descriptor: IntegrationProviderDescriptor;

  constructor(options: SlackProviderOptions) {
    this.broker = options.broker;
    this.slashCommand = process.env.AOS_SLACK_COMMAND?.trim() || '/aos';
    this.descriptor = {
      id: 'slack',
      kind: 'slack',
      label: 'Slack',
      status: 'disabled',
      enabled: false,
      configured: false,
      capabilities: ['dm', 'mentions', 'threads', 'socket-mode', 'block-kit', 'modals', 'app-home'],
      notes: ['Set AOS_SLACK_BOT_TOKEN and AOS_SLACK_APP_TOKEN to start the Socket Mode adapter.'],
    };
  }

  describe() {
    return this.descriptor;
  }

  async start() {
    const botToken = process.env.AOS_SLACK_BOT_TOKEN;
    const appToken = process.env.AOS_SLACK_APP_TOKEN;
    const signingSecret = process.env.AOS_SLACK_SIGNING_SECRET;

    if (!botToken || !appToken) {
      this.descriptor = {
        ...this.descriptor,
        status: 'disabled',
        enabled: false,
        configured: false,
      };
      this.broker.upsertProviderDescriptor(this.descriptor);
      return false;
    }

    try {
      const { App } = await import('@slack/bolt');
      const options: AppOptions = {
        token: botToken,
        appToken,
        socketMode: true,
      };
      if (signingSecret) options.signingSecret = signingSecret;
      this.app = new App(options);

      this.app.event('app_mention', async (args) => {
        await this.handleMention(args);
      });

      this.app.event('app_home_opened', async ({ event }) => {
        await this.publishHome(event.user);
      });

      this.app.message(async ({ message, client }) => {
        const typed = message as {
          subtype?: string;
          bot_id?: string;
          channel_type?: string;
          thread_ts?: string;
          ts: string;
          user?: string;
          text?: string;
          channel: string;
        };
        if (typed.subtype || typed.bot_id) return;
        if (typed.channel_type !== 'im') return;
        await this.handleCommandMessage({
          client,
          requester: typed.user ?? 'unknown-slack-user',
          text: cleanSlackText(typed.text ?? ''),
          target: {
            channel: typed.channel,
            thread: typed.thread_ts ?? typed.ts,
            userId: typed.user,
            source: 'message',
          },
        });
      });

      this.app.command(this.slashCommand, async ({ ack, client, command }) => {
        await ack();
        const text = command.text?.trim() || 'menu';
        const response = await this.broker.handleMessage({
          provider: 'slack',
          requester: command.user_id,
          text,
          channel: command.channel_id,
        });
        const blocks = this.buildResponseBlocks(text, response);
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: response.text,
          blocks: blocks as any,
        });
        await this.publishHome(command.user_id, response);
      });

      for (const actionId of [
        SLACK_ACTION_IDS.commandStatus,
        SLACK_ACTION_IDS.commandFeatures,
        SLACK_ACTION_IDS.commandJobs,
      ]) {
        this.app.action(actionId, async (args: any) => {
          await args.ack();
          await this.handleCommandAction(args);
        });
      }

      this.app.action(SLACK_ACTION_IDS.workflow, async (args: any) => {
        await args.ack();
        await this.handleWorkflowAction(args, args.action?.value);
      });

      this.app.action(SLACK_ACTION_IDS.workflowPicker, async (args: any) => {
        await args.ack();
        const workflowId = args.action?.selected_option?.value;
        await this.handleWorkflowAction(args, workflowId);
      });

      for (const actionId of [
        SLACK_ACTION_IDS.wikiRootTypes,
        SLACK_ACTION_IDS.wikiRootTags,
        SLACK_ACTION_IDS.wikiRootPlugins,
      ]) {
        this.app.action(actionId, async (args: any) => {
          await args.ack();
          await this.handleWikiRootAction(args, String(args.action?.value ?? ''));
        });
      }

      for (const actionId of [
        SLACK_ACTION_IDS.wikiOpenBranch,
        SLACK_ACTION_IDS.wikiOpenEntry,
        SLACK_ACTION_IDS.wikiBackToRoot,
        SLACK_ACTION_IDS.wikiBackToBranch,
        SLACK_ACTION_IDS.wikiPrevPage,
        SLACK_ACTION_IDS.wikiNextPage,
      ]) {
        this.app.action(actionId, async (args: any) => {
          await args.ack();
          await this.handleWikiNavigationAction(args);
        });
      }

      this.app.view(SLACK_VIEW_IDS.workflowInput, async (args: any) => {
        await this.handleWorkflowModalSubmission(args);
      });

      this.app.options(slackFieldActionId('indexedEntry'), async (args: any) => {
        await this.handleWikiIndexOptions(args);
      });

      await this.app.start();
      this.broker.registerNotifier('slack', {
        notifyJobNotification: async (notification) => {
          await this.notifyRequester(notification.job, notification.text);
        },
      });
      this.descriptor = {
        ...this.descriptor,
        status: 'ready',
        enabled: true,
        configured: true,
        notes: [
          `Socket Mode connected. The broker listens for app mentions and direct messages. Use \`menu\` or ${this.slashCommand} for controls.`,
          'App Home publishes provider health, workflows, and recent jobs.',
        ],
      };
      this.broker.upsertProviderDescriptor(this.descriptor);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.descriptor = {
        ...this.descriptor,
        status: 'error',
        enabled: false,
        configured: true,
        notes: [message],
      };
      this.broker.upsertProviderDescriptor(this.descriptor);
      return false;
    }
  }

  async stop() {
    this.broker.registerNotifier('slack', null);
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }

  private listWorkflows() {
    return this.broker.listWorkflows();
  }

  private async findWorkflow(id: string): Promise<IntegrationWorkflowDefinition | null> {
    return this.broker.getWorkflowDefinition(id);
  }

  private buildResponseBlocks(text: string, response: BrokerCommandResponse) {
    return isMenuText(text)
      ? buildSlackControlBlocks(this.listWorkflows())
      : buildSlackResponseBlocks(response, this.listWorkflows());
  }

  private async publishHome(userId: string, recentResult?: BrokerCommandResponse) {
    if (!this.app) return;
    const [snapshot, wikiBrowser] = await Promise.all([
      this.broker.getSnapshot(8),
      this.broker.getWikiBrowserModel('slack', userId),
    ]);
    try {
      await this.app.client.views.publish({
        user_id: userId,
        view: buildSlackHomeView(snapshot, { recentResult, wikiBrowser }) as any,
      });
    } catch (error) {
      console.error('[slack] failed to publish App Home', error);
    }
  }

  private async handleCommandMessage(options: {
    client: App['client'];
    requester: string;
    text: string;
    target: SlackMessageTarget;
  }) {
    const response = await this.broker.handleMessage({
      provider: 'slack',
      requester: options.requester,
      text: options.text,
      channel: options.target.channel,
      thread: options.target.thread,
    });

    if (!options.target.channel) {
      if (options.target.userId) await this.publishHome(options.target.userId, response);
      return response;
    }

    await this.postMessageWithFallback(options.client, {
      channel: options.target.channel,
      thread_ts: options.target.thread,
      text: response.text,
      blocks: this.buildResponseBlocks(options.text, response) as any,
    });

    if (options.target.userId) {
      await this.publishHome(options.target.userId, response);
    }
    return response;
  }

  private async handleCommandAction(args: any) {
    const value = typeof args.action?.value === 'string' ? args.action.value : '';
    if (!value) return;

    const response = await this.broker.handleMessage({
      provider: 'slack',
      requester: args.body?.user?.id ?? 'unknown-slack-user',
      text: value,
      channel: args.body?.channel?.id,
      thread: args.body?.message?.thread_ts ?? args.body?.message?.ts,
    });

    await this.deliverInteractiveResponse(args, value, response);
  }

  private async handleWorkflowAction(args: any, workflowId: string | undefined) {
    if (!workflowId) return;
    const workflow = await this.findWorkflow(workflowId);
    if (!workflow) return;

    if (workflow.requiresInput) {
      await this.openWorkflowModal(args, workflow);
      return;
    }

    const response = await this.broker.launchWorkflow({
      provider: 'slack',
      requester: args.body?.user?.id ?? 'unknown-slack-user',
      channel: args.body?.channel?.id,
      thread: args.body?.message?.thread_ts ?? args.body?.message?.ts,
      workflowId: workflow.id,
      input: {
        source: 'modal',
      },
    });

    await this.deliverInteractiveResponse(args, workflow.command.label, response);
  }

  private async handleWikiRootAction(args: any, root: string) {
    const userId = args.body?.user?.id;
    if (!userId || !['types', 'tags', 'plugins'].includes(root)) return;
    await this.broker.applyWikiBrowserAction('slack', userId, {
      type: 'set-root',
      root: root as 'types' | 'tags' | 'plugins',
    });
    await this.publishHome(userId);
  }

  private async handleWikiNavigationAction(args: any) {
    const userId = args.body?.user?.id;
    if (!userId) return;

    const actionId = args.action?.action_id;
    const value = typeof args.action?.value === 'string' ? args.action.value : '';
    if (!actionId) return;

    if (actionId === SLACK_ACTION_IDS.wikiOpenBranch && value) {
      await this.broker.applyWikiBrowserAction('slack', userId, {
        type: 'open-branch',
        branch: value,
      });
      await this.publishHome(userId);
      return;
    }

    if (actionId === SLACK_ACTION_IDS.wikiOpenEntry && value) {
      await this.broker.applyWikiBrowserAction('slack', userId, {
        type: 'open-entry',
        entryPath: value,
      });
      await this.publishHome(userId);
      return;
    }

    if (actionId === SLACK_ACTION_IDS.wikiBackToRoot) {
      await this.broker.applyWikiBrowserAction('slack', userId, { type: 'back-to-root' });
      await this.publishHome(userId);
      return;
    }

    if (actionId === SLACK_ACTION_IDS.wikiBackToBranch) {
      await this.broker.applyWikiBrowserAction('slack', userId, { type: 'back-to-branch' });
      await this.publishHome(userId);
      return;
    }

    if (actionId === SLACK_ACTION_IDS.wikiPrevPage) {
      await this.broker.applyWikiBrowserAction('slack', userId, { type: 'prev-page' });
      await this.publishHome(userId);
      return;
    }

    if (actionId === SLACK_ACTION_IDS.wikiNextPage) {
      await this.broker.applyWikiBrowserAction('slack', userId, { type: 'next-page' });
      await this.publishHome(userId);
    }
  }

  private async openWorkflowModal(args: any, workflow: IntegrationWorkflowDescriptor) {
    const metadata: SlackWorkflowModalMetadata = {
      workflowId: workflow.id,
      source: this.detectActionSource(args.body),
      channel: args.body?.channel?.id,
      thread: args.body?.message?.thread_ts ?? args.body?.message?.ts,
      userId: args.body?.user?.id,
    };

    await args.client.views.open({
      trigger_id: args.body.trigger_id,
      view: buildWorkflowInputModal(workflow, metadata) as any,
    });
  }

  private async handleWorkflowModalSubmission(args: any) {
    const metadata = this.parseWorkflowMetadata(args.view?.private_metadata);
    if (!metadata) {
      await args.ack();
      return;
    }
    const workflow = await this.findWorkflow(metadata.workflowId);
    if (!workflow) {
      await args.ack();
      return;
    }

    const fields = Object.fromEntries(
      (workflow.inputFields ?? []).map((field) => {
        const fieldState = args.view?.state?.values?.[slackFieldBlockId(field.id)]?.[slackFieldActionId(field.id)];
        const rawValue = field.type === 'select'
          ? fieldState?.selected_option?.value
          : fieldState?.value;
        const value = String(rawValue ?? '').trim();
        return [field.id, value];
      }),
    );

    const input = {
      source: 'modal' as const,
      fields,
      text: workflow.inputFields?.length === 1 ? Object.values(fields)[0] : '',
    };
    const validation = workflow.validateInput?.(input);
    if (validation?.fieldErrors && Object.keys(validation.fieldErrors).length > 0) {
      await args.ack({
        response_action: 'errors',
        errors: Object.fromEntries(
          Object.entries(validation.fieldErrors).map(([fieldId, message]) => [slackFieldBlockId(fieldId), message]),
        ),
      });
      return;
    }

    await args.ack();

    const response = await this.broker.launchWorkflow({
      provider: 'slack',
      requester: metadata.userId ?? args.body?.user?.id ?? 'unknown-slack-user',
      channel: metadata.channel,
      thread: metadata.thread,
      workflowId: workflow.id,
      input,
    });

    if (metadata.source === 'home' || !metadata.channel) {
      if (metadata.userId) await this.publishHome(metadata.userId, response);
      return;
    }

    await this.postMessageWithFallback(args.client, {
      channel: metadata.channel,
      thread_ts: metadata.thread,
      text: response.text,
      blocks: buildSlackResponseBlocks(response, this.listWorkflows()) as any,
    });

    if (metadata.userId) {
      await this.publishHome(metadata.userId, response);
    }
  }

  private async handleWikiIndexOptions(args: any) {
    const query = String(args.options?.value ?? args.body?.value ?? '').trim().toLowerCase();
    const index = await this.broker.getWikiIndex();
    const matches = index
      .filter((entry) => {
        if (!query) return true;
        const haystack = [
          entry.name,
          entry.description ?? '',
          entry.path ?? '',
          entry.type ?? '',
          entry.plugin ?? '',
          ...(entry.tags ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, MAX_EXTERNAL_SELECT_OPTIONS)
      .map((entry) => ({
        text: plainText(truncate(entry.name, 75)),
        value: entry.name,
        description: plainText(truncate([entry.type, entry.path].filter(Boolean).join(' • ') || 'wiki entry', 75)),
      }));

    await args.ack({ options: matches });
  }

  private async deliverInteractiveResponse(args: any, commandText: string, response: BrokerCommandResponse) {
    const source = this.detectActionSource(args.body);
    const userId = args.body?.user?.id;

    if (source === 'home') {
      if (userId) await this.publishHome(userId, response);
      return;
    }

    const channel = args.body?.channel?.id;
    if (!channel) {
      if (userId) await this.publishHome(userId, response);
      return;
    }

    const thread = args.body?.message?.thread_ts ?? args.body?.message?.ts;
    await this.postMessageWithFallback(args.client, {
      channel,
      thread_ts: thread,
      text: response.text,
      blocks: this.buildResponseBlocks(commandText, response) as any,
    });

    if (userId) {
      await this.publishHome(userId, response);
    }
  }

  private detectActionSource(body: any): SlackWorkflowModalMetadata['source'] {
    if (body?.view?.type === 'home' || body?.container?.type === 'view') return 'home';
    if (body?.command) return 'command';
    return 'message';
  }

  private parseWorkflowMetadata(raw: string | undefined): SlackWorkflowModalMetadata | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SlackWorkflowModalMetadata;
    } catch {
      return null;
    }
  }

  private async postMessageWithFallback(
    client: App['client'],
    payload: {
      channel: string;
      text: string;
      thread_ts?: string;
      blocks?: any;
    },
  ) {
    try {
      await client.chat.postMessage(payload as any);
    } catch (error) {
      console.error('[slack] failed to post blocks, retrying with plain text only', error);
      await client.chat.postMessage({
        channel: payload.channel,
        thread_ts: payload.thread_ts,
        text: payload.text,
      });
    }
  }

  private async notifyRequester(job: NonNullable<BrokerCommandResponse['job']>, text: string) {
    if (!this.app) return;
    const channel = job.channel ?? await this.openRequesterDm(job.requester);
    if (!channel) return;

    await this.postMessageWithFallback(this.app.client, {
      channel,
      thread_ts: job.channel ? job.thread : undefined,
      text,
      blocks: buildSlackResponseBlocks({
        kind: 'job',
        job,
        text,
      }, this.listWorkflows()) as any,
    });

    if (job.requester) {
      await this.publishHome(job.requester);
    }
  }

  private async openRequesterDm(userId: string | undefined) {
    if (!this.app || !userId) return undefined;
    try {
      const response = await this.app.client.conversations.open({
        users: userId,
      });
      return response.channel?.id;
    } catch (error) {
      console.error('[slack] failed to open DM for requester notification', error);
      return undefined;
    }
  }

  private async handleMention(
    args: SlackEventMiddlewareArgs<'app_mention'> & { client: App['client'] },
  ) {
    const text = cleanSlackText(args.event.text ?? '');
    const thread = args.event.thread_ts ?? args.event.ts;
    await this.handleCommandMessage({
      client: args.client,
      requester: args.event.user ?? 'unknown-slack-user',
      text,
      target: {
        channel: args.event.channel,
        thread,
        userId: args.event.user,
        source: 'message',
      },
    });
  }
}

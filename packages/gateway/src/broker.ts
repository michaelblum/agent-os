import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoordinationDB } from './db.js';
import { loadGatewayEnv } from './env.js';
import { IntegrationBroker } from './integrations/broker.js';
import {
  buildPilotWorkflowCatalog,
  buildProviderCatalog,
  DEFAULT_SURFACES,
  loadLiveWorkflowCatalog,
  loadWikiIndex,
} from './integrations/catalog.js';
import { startIntegrationHttpServer } from './integrations/http-api.js';
import { SlackIntegrationProvider } from './integrations/providers/slack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const repoRoot = resolve(__dirname, '..', '..', '..');

loadGatewayEnv(packageRoot);

const STATE_DIR = join(process.env.HOME ?? '.', '.config', 'aos-gateway');
mkdirSync(STATE_DIR, { recursive: true });

const DB_PATH = join(STATE_DIR, 'gateway.db');

const db = new CoordinationDB(DB_PATH);
const broker = new IntegrationBroker({
  db,
  repoRoot,
  brokerUrl: 'http://127.0.0.1:47231',
  surfaces: DEFAULT_SURFACES,
  providers: buildProviderCatalog({
    slackConfigured: Boolean(process.env.AOS_SLACK_BOT_TOKEN && process.env.AOS_SLACK_APP_TOKEN),
    slackEnabled: false,
  }),
  workflows: buildPilotWorkflowCatalog(),
  workflowRegistryLoader: loadLiveWorkflowCatalog,
  wikiIndexLoader: loadWikiIndex,
});
const slackProvider = new SlackIntegrationProvider({ broker });

async function main() {
  const requestedPort = Number(process.env.AOS_INTEGRATION_HTTP_PORT ?? '47231');
  const http = await startIntegrationHttpServer({
    broker,
    host: '127.0.0.1',
    port: Number.isFinite(requestedPort) ? requestedPort : 47231,
  });
  broker.setBrokerUrl(http.url);

  await slackProvider.start();

  console.error(`aos integration broker listening on ${http.url}`);

  const shutdown = async () => {
    await slackProvider.stop();
    await new Promise<void>((resolveClose, rejectClose) => {
      http.server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    }).catch(() => undefined);
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

await main();

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
import { createLogger } from './logger.js';
import { detectMode } from './mode.js';
import { migrateFromEnv } from './migrate.js';
import { brokerPaths } from './paths.js';
import { acquirePidLock, PeerAliveError, type PidLock } from './singleton.js';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), '..');
const repoRoot = resolve(dirname(scriptPath), '..', '..', '..');

loadGatewayEnv(packageRoot);

const mode = detectMode(scriptPath);
const paths = brokerPaths(mode);

const migrateResult = migrateFromEnv({ env: process.env, target: paths.stateDir });
mkdirSync(paths.stateDir, { recursive: true });

const logger = createLogger({ logPath: paths.logPath });
logger.info('broker starting', {
  role: 'broker',
  mode,
  stateDir: paths.stateDir,
  pidPath: paths.pidPath,
  logPath: paths.logPath,
  migrate: migrateResult,
});

let pidLock: PidLock | undefined;
try {
  pidLock = acquirePidLock(paths.pidPath);
} catch (err: any) {
  if (err instanceof PeerAliveError) {
    logger.error('peer broker alive, exiting', { message: err.message });
  } else {
    logger.error('failed to acquire pidfile', { message: err.message });
  }
  logger.close();
  process.exit(1);
}

const db = new CoordinationDB(paths.dbPath);
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

  logger.info('integration broker listening', { url: http.url });

  const shutdown = async () => {
    await slackProvider.stop();
    await new Promise<void>((resolveClose, rejectClose) => {
      http.server.close((error) => {
        if (error) { rejectClose(error); return; }
        resolveClose();
      });
    }).catch(() => undefined);
    db.close();
    try { pidLock?.release(); } catch {}
    try { logger.close(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

await main();

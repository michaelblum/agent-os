import { join } from 'node:path';
import { stateRoot, type RuntimeMode } from './mode.js';

export interface GatewayCommonPaths {
  stateDir: string;
  dbPath: string;
  scriptsDir: string;
}

export interface McpPaths extends GatewayCommonPaths {
  socketPath: string;
  pidPath: string;
  logPath: string;
}

export interface BrokerPaths extends GatewayCommonPaths {
  pidPath: string;
  logPath: string;
}

export function commonPaths(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): GatewayCommonPaths {
  const stateDir = join(stateRoot(env), mode, 'gateway');
  return {
    stateDir,
    dbPath: join(stateDir, 'gateway.db'),
    scriptsDir: join(stateDir, 'scripts'),
  };
}

export function mcpPaths(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): McpPaths {
  const common = commonPaths(mode, env);
  return {
    ...common,
    socketPath: join(common.stateDir, 'sdk.sock'),
    pidPath: join(common.stateDir, 'gateway.pid'),
    logPath: join(common.stateDir, 'gateway.log'),
  };
}

export function brokerPaths(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): BrokerPaths {
  const common = commonPaths(mode, env);
  return {
    ...common,
    pidPath: join(common.stateDir, 'broker.pid'),
    logPath: join(common.stateDir, 'broker.log'),
  };
}

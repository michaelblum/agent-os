import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import type { IntegrationBroker } from './broker.js';
import type { InboundIntegrationMessage, WorkflowInvocationInput } from './types.js';

interface IntegrationHttpServerOptions {
  broker: IntegrationBroker;
  host?: string;
  port?: number;
}

const AOS_SURFACE_ORIGINS = new Set([
  'aos://sigil',
  'aos://toolkit',
]);

function loopbackHost(value: string): boolean {
  return value === 'localhost'
    || value === '127.0.0.1'
    || value === '::1'
    || value === '[::1]';
}

function requestHost(req: IncomingMessage): URL | null {
  const host = req.headers.host;
  if (typeof host !== 'string' || !host.trim()) return null;
  try {
    return new URL(`http://${host}`);
  } catch {
    return null;
  }
}

function allowedCorsOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin.trim()) return null;
  if (AOS_SURFACE_ORIGINS.has(origin)) return origin;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  const host = requestHost(req);
  if (!host) return null;
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (!loopbackHost(parsed.hostname) || !loopbackHost(host.hostname)) return null;
  return parsed.port === host.port ? origin : null;
}

function rejectDisallowedOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin.trim()) return false;
  if (allowedCorsOrigin(req)) return false;
  res.writeHead(403, {
    'content-type': 'application/json; charset=utf-8',
    vary: 'origin',
  });
  res.end(JSON.stringify({ error: 'origin_not_allowed' }, null, 2));
  return true;
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = allowedCorsOrigin(req);
  if (!origin) return { vary: 'origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

function json(req: IncomingMessage, res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export async function startIntegrationHttpServer(
  options: IntegrationHttpServerOptions,
): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) {
      json(req, res, 400, { error: 'missing_request_url' });
      return;
    }

    if (rejectDisallowedOrigin(req, res)) return;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
      });
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '20'), 200));

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        json(req, res, 200, { status: 'ok', broker: 'integration' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/integrations/snapshot') {
        json(req, res, 200, await options.broker.getSnapshot(limit));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/integrations/providers') {
        const snapshot = await options.broker.getSnapshot(1);
        json(req, res, 200, snapshot.providers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/integrations/workflows') {
        json(req, res, 200, await options.broker.getWorkflowCatalog());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/integrations/jobs') {
        json(req, res, 200, await options.broker.listJobs(limit));
        return;
      }

      const workflowLaunchMatch = url.pathname.match(/^\/api\/integrations\/workflows\/([^/]+)\/launch$/);
      if (req.method === 'POST' && workflowLaunchMatch) {
        const body = await readBody(req);
        const input: WorkflowInvocationInput = {
          text: typeof body.text === 'string' ? body.text : '',
          fields: body.fields && typeof body.fields === 'object' ? body.fields as Record<string, string> : undefined,
          source: 'api',
        };
        json(req, res, 200, await options.broker.launchWorkflow({
          provider: typeof body.provider === 'string' ? body.provider : 'slack',
          requester: typeof body.requester === 'string' ? body.requester : 'local-operator',
          workflowId: decodeURIComponent(workflowLaunchMatch[1]),
          channel: typeof body.channel === 'string' ? body.channel : 'local',
          thread: typeof body.thread === 'string' ? body.thread : undefined,
          input,
        }));
        return;
      }

      const jobCompleteMatch = url.pathname.match(/^\/api\/integrations\/jobs\/([^/]+)\/complete$/);
      if (req.method === 'POST' && jobCompleteMatch) {
        const body = await readBody(req);
        json(req, res, 200, await options.broker.completeJob(decodeURIComponent(jobCompleteMatch[1]), {
          summary: typeof body.summary === 'string' ? body.summary : 'Workflow completed.',
          lines: Array.isArray(body.lines) ? body.lines.filter((line: unknown): line is string => typeof line === 'string') : undefined,
          resultJson: body.resultJson,
          metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : undefined,
          artifactLink: body.artifactLink && typeof body.artifactLink === 'object' && typeof body.artifactLink.url === 'string'
            ? {
                label: typeof body.artifactLink.label === 'string' ? body.artifactLink.label : 'Open result',
                url: body.artifactLink.url,
              }
            : undefined,
          notifyRequester: body.notifyRequester !== false,
        }));
        return;
      }

      const jobStartMatch = url.pathname.match(/^\/api\/integrations\/jobs\/([^/]+)\/start$/);
      if (req.method === 'POST' && jobStartMatch) {
        const body = await readBody(req);
        json(req, res, 200, await options.broker.startJob(decodeURIComponent(jobStartMatch[1]), {
          summary: typeof body.summary === 'string' ? body.summary : undefined,
          metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : undefined,
          notifyRequester: body.notifyRequester === true,
        }));
        return;
      }

      const jobFailMatch = url.pathname.match(/^\/api\/integrations\/jobs\/([^/]+)\/fail$/);
      if (req.method === 'POST' && jobFailMatch) {
        const body = await readBody(req);
        json(req, res, 200, await options.broker.failJob(decodeURIComponent(jobFailMatch[1]), {
          errorText: typeof body.errorText === 'string' ? body.errorText : 'Workflow failed.',
          summary: typeof body.summary === 'string' ? body.summary : undefined,
          lines: Array.isArray(body.lines) ? body.lines.filter((line: unknown): line is string => typeof line === 'string') : undefined,
          metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : undefined,
          notifyRequester: body.notifyRequester !== false,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/integrations/simulate') {
        const body = await readBody(req);
        const message: InboundIntegrationMessage = {
          provider: typeof body.provider === 'string' ? body.provider : 'slack',
          requester: typeof body.requester === 'string' ? body.requester : 'local-operator',
          text: typeof body.text === 'string' ? body.text : '',
          channel: typeof body.channel === 'string' ? body.channel : 'local',
          thread: typeof body.thread === 'string' ? body.thread : undefined,
        };
        json(req, res, 200, await options.broker.handleMessage(message));
        return;
      }
    } catch (error) {
      const status = typeof error === 'object' && error && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      const message = error instanceof Error ? error.message : String(error);
      json(req, res, status, { error: message });
      return;
    }

    json(req, res, 404, { error: 'not_found', path: url.pathname });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 47231, options.host ?? '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://${address.address === '::' ? '127.0.0.1' : address.address}:${address.port}`,
  };
}

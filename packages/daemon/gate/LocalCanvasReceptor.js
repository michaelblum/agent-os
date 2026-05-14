import { spawn } from 'node:child_process';
import { GateReceptor } from './GateReceptor.js';

const DEFAULT_POLL_MS = 400;

function requestParam(request) {
  return Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
}

function defaultCanvasClient({ aosPath = './aos' } = {}) {
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(aosPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${aosPath} ${args.join(' ')} exited ${code}`));
    });
  });

  return {
    async createCanvas(request) {
      const url = `aos://toolkit/components/decision-gate/index.html?requestB64=${encodeURIComponent(requestParam(request))}`;
      await run(['show', 'create', '--id', request.id, '--url', url, '--interactive', '--focus']);
      return request.id;
    },
    async evalCanvas(canvasId, expression) {
      return run(['show', 'eval', '--id', String(canvasId), '--js', expression]);
    },
    async removeCanvas(canvasId) {
      await run(['show', 'remove', '--id', String(canvasId)]);
    },
  };
}

function parseGateResult(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = String(raw).trim();
  if (!text || text === 'undefined') return undefined;
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed === 'object' && 'result' in parsed) return parseGateResult(parsed.result);
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
}

export class LocalCanvasReceptor extends GateReceptor {
  constructor({
    canvasClient = defaultCanvasClient(),
    pollMs = DEFAULT_POLL_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    ...callbacks
  } = {}) {
    super(callbacks);
    this.canvasClient = canvasClient;
    this.pollMs = pollMs;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
  }

  async present(gateRequest) {
    const canvasId = await this.canvasClient.createCanvas(gateRequest);
    const handle = { id: gateRequest.id, canvasId, poller: null, closed: false };
    const expression = 'window.__gateResult';

    const poll = async () => {
      if (handle.closed) return;
      try {
        const raw = await this.canvasClient.evalCanvas(canvasId, expression);
        const value = parseGateResult(raw);
        if (value !== undefined) {
          handle.closed = true;
          this.clearIntervalFn(handle.poller);
          handle.poller = null;
          this.resolve(gateRequest.id, value);
        }
      } catch (error) {
        handle.closed = true;
        this.clearIntervalFn(handle.poller);
        handle.poller = null;
        this.reject(gateRequest.id, error);
      }
    };

    handle.poller = this.setIntervalFn(poll, this.pollMs);
    poll();
    return handle;
  }

  async dismiss(handle) {
    if (!handle) return;
    handle.closed = true;
    if (handle.poller) {
      this.clearIntervalFn(handle.poller);
      handle.poller = null;
    }
    if (handle.canvasId !== undefined && handle.canvasId !== null) {
      await this.canvasClient.removeCanvas(handle.canvasId);
    }
  }
}

export { defaultCanvasClient, parseGateResult };

// packages/host/test/tool-registry.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tool-registry.ts';
import type { ToolDefinition, ToolExecutor } from '../src/types.ts';

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes input back',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  permissions: { default: 'allow' },
};

const dangerousTool: ToolDefinition = {
  name: 'danger',
  description: 'A dangerous tool',
  inputSchema: { type: 'object', properties: {} },
  permissions: { default: 'deny', dangerous: true },
};

const echoExecutor: ToolExecutor = async (input) => {
  const { text } = input as { text: string };
  return { content: text };
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool', () => {
    registry.register(echoTool, echoExecutor);
    const tool = registry.get('echo');
    assert.ok(tool);
    assert.equal(tool.definition.name, 'echo');
  });

  it('lists all registered tools', () => {
    registry.register(echoTool, echoExecutor);
    registry.register(dangerousTool, echoExecutor);
    const tools = registry.list();
    assert.equal(tools.length, 2);
  });

  it('returns definitions for provider (tool list for API call)', () => {
    registry.register(echoTool, echoExecutor);
    registry.register(dangerousTool, echoExecutor);
    const defs = registry.getDefinitions();
    assert.equal(defs.length, 2);
    assert.ok(defs.every(d => 'name' in d && 'inputSchema' in d));
  });

  it('rejects duplicate registration', () => {
    registry.register(echoTool, echoExecutor);
    assert.throws(() => registry.register(echoTool, echoExecutor), /already registered/);
  });

  it('checks permission — allow', () => {
    registry.register(echoTool, echoExecutor);
    const decision = registry.checkPermission('echo');
    assert.equal(decision, 'allow');
  });

  it('checks permission — deny', () => {
    registry.register(dangerousTool, echoExecutor);
    const decision = registry.checkPermission('danger');
    assert.equal(decision, 'deny');
  });

  it('checks permission — unknown tool returns deny', () => {
    const decision = registry.checkPermission('nonexistent');
    assert.equal(decision, 'deny');
  });

  it('applies overrides', () => {
    registry.register(dangerousTool, echoExecutor);
    registry.addOverride({ tool: 'danger', decision: 'allow', scope: 'session' });
    const decision = registry.checkPermission('danger');
    assert.equal(decision, 'allow');
  });

  it('override with glob pattern', () => {
    registry.register({ ...dangerousTool, name: 'fs.read' }, echoExecutor);
    registry.register({ ...dangerousTool, name: 'fs.write' }, echoExecutor);
    registry.addOverride({ tool: 'fs.*', decision: 'allow', scope: 'session' });
    assert.equal(registry.checkPermission('fs.read'), 'allow');
    assert.equal(registry.checkPermission('fs.write'), 'allow');
  });
});

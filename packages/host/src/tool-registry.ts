// packages/host/src/tool-registry.ts
import type {
  ToolDefinition, ToolExecutor, RegisteredTool, PermissionOverride,
} from './types.ts';

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private overrides: PermissionOverride[] = [];

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' already registered`);
    }
    this.tools.set(definition.name, { definition, executor });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.list().map(t => t.definition);
  }

  checkPermission(toolName: string): 'allow' | 'deny' | 'ask' {
    // Check overrides first (last match wins)
    for (let i = this.overrides.length - 1; i >= 0; i--) {
      const override = this.overrides[i];
      if (this.matchGlob(override.tool, toolName)) {
        return override.decision;
      }
    }

    // Fall back to tool's default permission
    const tool = this.tools.get(toolName);
    if (!tool) return 'deny';
    return tool.definition.permissions?.default ?? 'allow';
  }

  addOverride(override: PermissionOverride): void {
    this.overrides.push(override);
  }

  clearSessionOverrides(): void {
    this.overrides = this.overrides.filter(o => o.scope !== 'session');
  }

  private matchGlob(pattern: string, name: string): boolean {
    if (pattern === name) return true;
    if (!pattern.includes('*')) return false;
    const regex = new RegExp(
      '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    return regex.test(name);
  }
}

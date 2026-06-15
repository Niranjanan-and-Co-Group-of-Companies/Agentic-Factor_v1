export interface ToolExecutionContext {
  tenantId: string;
  missionId: string;
  agentId: string;
  toolName: string;
  args: Record<string, any>;
}

export interface ToolRegistry {
  [name: string]: (context: ToolExecutionContext) => Promise<any>;
}

const registry: ToolRegistry = {};

export function registerTool(name: string, fn: (context: ToolExecutionContext) => Promise<any>) {
  registry[name] = fn;
}

export async function executeTool(context: ToolExecutionContext): Promise<any> {
  const { toolName } = context;
  const toolFn = registry[toolName];
  if (!toolFn) {
    throw new Error(`Tool ${toolName} is not registered in the tool registry.`);
  }

  try {
    return await toolFn(context);
  } catch (error) {
    console.error(`[ToolExecutionError] ${toolName}:`, error);
    return { error: (error as Error).message };
  }
}

// Side-effect imports — each file calls registerTool() on load
import './email';
import './search';
import './hunter';

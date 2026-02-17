import registry from './tooling-registry.json' with { type: 'json' };

export type ToolingRegistry = {
  tool_context_version?: number;
  tool_name_aliases?: Record<string, string>;
};

const TOOLING_REGISTRY = registry as ToolingRegistry;

export default TOOLING_REGISTRY;

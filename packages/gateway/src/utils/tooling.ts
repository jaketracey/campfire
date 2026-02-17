import registry from '../../../shared/src/tooling/tooling-registry.json' with { type: 'json' };
import { logger } from '../observability/logger.js';

type ToolingRegistry = {
  tool_context_version?: number;
  tool_name_aliases?: Record<string, string>;
};

type RecordObject = Record<string, unknown>;

const TOOLING_REGISTRY = registry as ToolingRegistry;
const TOOL_NAME_ALIASES = TOOLING_REGISTRY.tool_name_aliases ?? {};
type ToolingStatus = 'requested' | 'running' | 'succeeded' | 'failed' | 'cancelled';
const KNOWN_STATUSES = ['requested', 'running', 'succeeded', 'failed', 'cancelled'] as const;

const KNOWN_STATUSES_SET = new Set(KNOWN_STATUSES);

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return new Date().toISOString();
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  return toStringOrUndefined(value) || undefined;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function toAttemptCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.trunc(value);
}

function normalizeStatus(value: unknown): ToolingStatus {
  const normalized = toStringOrUndefined(value)?.toLowerCase();
  if (normalized && KNOWN_STATUSES_SET.has(normalized as ToolingStatus)) {
    return normalized as ToolingStatus;
  }
  return 'requested';
}

/**
 * Canonicalized tool names from the shared tooling registry.
 */
export function normalizeToolName(value: string): string {
  const normalized = value.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

/**
 * De-dupe and normalize an iterable of tool names.
 */
export function normalizeToolNames(values: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== 'string') {
      continue;
    }
    names.add(normalizeToolName(value));
  }
  return Array.from(names);
}

export interface CompanionToolCallArtifact {
  [key: string]: unknown;
  tool_call_id: string;
  id: string;
  name: string;
  status: ToolingStatus;
  arguments: RecordObject;
  attempt_count: number;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  error?: string;
  metadata?: RecordObject;
}

export interface CompanionToolResultArtifact {
  [key: string]: unknown;
  tool_call_id: string;
  name: string;
  status: ToolingStatus;
  success: boolean;
  output: unknown;
  error?: string;
  duration_ms: number;
  cost_usd: number;
  attempt_count: number;
  started_at?: string;
  ended_at?: string;
  created_at: string;
  metadata: RecordObject;
}

export interface CompanionToolContextMetadata {
  tool_context_version: number;
  tool_calls: CompanionToolCallArtifact[];
  tool_results: CompanionToolResultArtifact[];
  tooling_unavailable_reason?: string;
  tools_invoked: string[];
  generated_image_url?: string;
}

const TOOL_CONTEXT_VERSION = TOOLING_REGISTRY.tool_context_version;
const DEFAULT_TOOL_CONTEXT_VERSION: number = typeof TOOL_CONTEXT_VERSION === 'number' && Number.isFinite(TOOL_CONTEXT_VERSION)
  ? TOOL_CONTEXT_VERSION
  : 1;

/**
 * Convert a raw object into a validated tool-call artifact.
 */
export function normalizeToolCallArtifact(value: unknown): CompanionToolCallArtifact | null {
  const data = toRecord(value);
  const toolCallId = toStringOrUndefined(data.tool_call_id) || toStringOrUndefined(data.id);
  if (!toolCallId) {
    return null;
  }

  const name = toStringOrUndefined(data.name);
  if (!name) {
    return null;
  }

  return {
    tool_call_id: toolCallId,
    id: toolCallId,
    name: normalizeToolName(name),
    status: normalizeStatus(data.status),
    arguments: toRecord(data.arguments),
    attempt_count: toAttemptCount(data.attempt_count),
    created_at: toIsoString(data.created_at),
    started_at: normalizeTimestamp(data.started_at),
    ended_at: normalizeTimestamp(data.ended_at),
    error: toStringOrUndefined(data.error),
    metadata: toRecord(data.metadata),
  };
}

/**
 * Convert a raw object into a validated tool-result artifact.
 */
export function normalizeToolResultArtifact(value: unknown): CompanionToolResultArtifact | null {
  const data = toRecord(value);
  const toolCallId = toStringOrUndefined(data.tool_call_id) || toStringOrUndefined(data.id);
  if (!toolCallId) {
    return null;
  }

  const name = toStringOrUndefined(data.name);
  if (!name) {
    return null;
  }

  const status = normalizeStatus(data.status);
  const success = typeof data.success === 'boolean' ? data.success : status === 'succeeded';
  const artifact: CompanionToolResultArtifact = {
    tool_call_id: toolCallId,
    name: normalizeToolName(name),
    status,
    success,
    output: data.output,
    error: toStringOrUndefined(data.error),
    duration_ms: toFiniteNumber(data.duration_ms, 0),
    cost_usd: toFiniteNumber(data.cost_usd, 0),
    attempt_count: toAttemptCount(data.attempt_count),
    started_at: normalizeTimestamp(data.started_at),
    ended_at: normalizeTimestamp(data.ended_at),
    created_at: toIsoString(data.created_at),
    metadata: toRecord(data.metadata),
  };

  if (artifact.status === 'requested' && artifact.success) {
    artifact.status = 'succeeded';
  }

  return artifact;
}

/**
 * Normalize and validate tool-context metadata.
 */
export function normalizeToolContextMetadata(value: unknown): CompanionToolContextMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      tool_context_version: DEFAULT_TOOL_CONTEXT_VERSION,
      tool_calls: [],
      tool_results: [],
      tools_invoked: [],
    };
  }

  const data = value as RecordObject;
  const versionValue = toFiniteNumber(data.tool_context_version, DEFAULT_TOOL_CONTEXT_VERSION);
  const toolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls.map(normalizeToolCallArtifact).filter((call): call is CompanionToolCallArtifact => call !== null)
    : [];
  const toolResults = Array.isArray(data.tool_results)
    ? data.tool_results.map(normalizeToolResultArtifact).filter((result): result is CompanionToolResultArtifact => result !== null)
    : [];
  const toolsInvoked = normalizeToolNames(Array.isArray(data.tools_invoked) ? data.tools_invoked : []);
  const normalizedTools = toRecord(data.tool_calls);
  const generatedImageUrl = toStringOrUndefined(data.generated_image_url)
    ?? toStringOrUndefined((data as RecordObject).generatedImageUrl);

  if (normalizedTools !== data && (toolCalls.length > 0 || toolResults.length > 0)) {
    // This path exists for side-effectful diagnostics only.
  }

  if (toolCalls.length !== (Array.isArray(data.tool_calls) ? data.tool_calls.length : 0)
    || toolResults.length !== (Array.isArray(data.tool_results) ? data.tool_results.length : 0)) {
    logger.warn(
      {
        toolCallsReceived: Array.isArray(data.tool_calls) ? data.tool_calls.length : 0,
        toolCallsNormalized: toolCalls.length,
        toolResultsReceived: Array.isArray(data.tool_results) ? data.tool_results.length : 0,
        toolResultsNormalized: toolResults.length,
      },
      'Filtered malformed tool artifacts from tool context metadata'
    );
  }

  return {
    tool_context_version: versionValue || DEFAULT_TOOL_CONTEXT_VERSION,
    tool_calls: toolCalls,
    tool_results: toolResults,
    tooling_unavailable_reason: toStringOrUndefined(data.tooling_unavailable_reason),
    tools_invoked: toolsInvoked.length > 0 ? toolsInvoked : normalizeToolNames(toolCalls.map(c => c.name)),
    generated_image_url: generatedImageUrl,
  };
}

/**
 * Build tool metadata payload for turn persistence.
 */
export function buildToolContextMetadata(
  toolCalls: unknown[] | undefined = [],
  toolResults: unknown[] | undefined = [],
  toolingUnavailableReason?: string,
  generatedImageUrl?: string,
): CompanionToolContextMetadata {
  const normalized = normalizeToolContextMetadata({
    tool_context_version: DEFAULT_TOOL_CONTEXT_VERSION,
    tool_calls: toolCalls,
    tool_results: toolResults,
    tooling_unavailable_reason: toolingUnavailableReason,
    generated_image_url: generatedImageUrl,
  });

  if (!normalized.tooling_unavailable_reason && toolingUnavailableReason) {
    normalized.tooling_unavailable_reason = toolingUnavailableReason;
  }

  return normalized;
}

export { TOOLING_REGISTRY as SHARED_TOOLING_REGISTRY, DEFAULT_TOOL_CONTEXT_VERSION as TOOL_CONTEXT_SCHEMA_VERSION };

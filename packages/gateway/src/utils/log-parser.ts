/**
 * Log parsing utilities for normalizing logs from different services.
 * Supports Pino (gateway/workers) and structlog (orchestrator) formats.
 */

import { randomUUID } from 'node:crypto';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type ServiceName = 'gateway' | 'web' | 'orchestrator' | 'workers';

export interface NormalizedLogEntry {
  id: string;
  timestamp: Date;
  service: ServiceName;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  raw: string;
}

// Pino uses numeric levels
const PINO_LEVEL_MAP: Record<number, LogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

// structlog uses string levels
const STRUCTLOG_LEVEL_MAP: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  critical: 'fatal',
  fatal: 'fatal',
};

// Log level priority for filtering
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * Parse a Pino JSON log line (gateway/workers)
 * Format: {"level":30,"time":"2024-01-01T12:00:00.000Z","msg":"...","pid":1,...}
 */
export function parsePinoLog(line: string, service: ServiceName): NormalizedLogEntry | null {
  try {
    const parsed = JSON.parse(line);

    // Extract level - can be numeric or string label
    let level: LogLevel = 'info';
    if (typeof parsed.level === 'number') {
      level = PINO_LEVEL_MAP[parsed.level] ?? 'info';
    } else if (typeof parsed.level === 'string') {
      level = (STRUCTLOG_LEVEL_MAP[parsed.level.toLowerCase()] ?? 'info');
    }

    // Extract timestamp
    let timestamp: Date;
    if (parsed.time) {
      // Pino isoTime format
      timestamp = new Date(parsed.time);
    } else if (parsed.timestamp) {
      timestamp = new Date(parsed.timestamp);
    } else {
      timestamp = new Date();
    }

    // Extract message
    const message = parsed.msg ?? parsed.message ?? '';

    // Build context from remaining fields
    const { level: _l, time: _t, timestamp: _ts, msg: _m, message: _msg, pid: _p, hostname: _h, ...context } = parsed;

    return {
      id: randomUUID(),
      timestamp,
      service,
      level,
      message,
      context,
      raw: line,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a structlog JSON log line (orchestrator)
 * Format: {"event":"...","level":"info","timestamp":"2024-01-01T12:00:00.000Z",...}
 */
export function parseStructLog(line: string, service: ServiceName = 'orchestrator'): NormalizedLogEntry | null {
  try {
    const parsed = JSON.parse(line);

    // Extract level
    const levelStr = String(parsed.level ?? 'info').toLowerCase();
    const level = STRUCTLOG_LEVEL_MAP[levelStr] ?? 'info';

    // Extract timestamp
    let timestamp: Date;
    if (parsed.timestamp) {
      timestamp = new Date(parsed.timestamp);
    } else {
      timestamp = new Date();
    }

    // Extract message - structlog uses 'event' field
    const message = parsed.event ?? parsed.msg ?? parsed.message ?? '';

    // Build context from remaining fields
    const { event: _e, level: _l, timestamp: _t, msg: _m, message: _msg, ...context } = parsed;

    return {
      id: randomUUID(),
      timestamp,
      service,
      level,
      message,
      context,
      raw: line,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a log line from Next.js/web service
 * These are typically plain text or prefixed with log level
 */
export function parseNextLog(line: string): NormalizedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try to parse as JSON first (Next.js can output JSON in some configs)
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsePinoLog(trimmed, 'web');
    }
  } catch {
    // Not JSON, continue with plain text parsing
  }

  // Detect log level from common patterns
  let level: LogLevel = 'info';
  let message = trimmed;

  const levelPatterns: Array<{ pattern: RegExp; level: LogLevel }> = [
    { pattern: /^\[?error\]?:?\s*/i, level: 'error' },
    { pattern: /^\[?warn(?:ing)?\]?:?\s*/i, level: 'warn' },
    { pattern: /^\[?debug\]?:?\s*/i, level: 'debug' },
    { pattern: /^\[?info\]?:?\s*/i, level: 'info' },
    { pattern: /^error:\s*/i, level: 'error' },
    { pattern: /^warn:\s*/i, level: 'warn' },
  ];

  for (const { pattern, level: l } of levelPatterns) {
    if (pattern.test(trimmed)) {
      level = l;
      message = trimmed.replace(pattern, '');
      break;
    }
  }

  return {
    id: randomUUID(),
    timestamp: new Date(),
    service: 'web',
    level,
    message,
    context: {},
    raw: line,
  };
}

/**
 * Auto-detect and parse a log line based on service
 */
export function parseLogLine(line: string, service: ServiceName): NormalizedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Skip common Docker/container prefixes and ANSI codes
  const cleaned = trimmed
    .replace(/^\x1b\[[0-9;]*m/g, '') // Remove leading ANSI codes
    .replace(/\x1b\[[0-9;]*m/g, ''); // Remove all ANSI codes

  switch (service) {
    case 'gateway':
    case 'workers':
      return parsePinoLog(cleaned, service);
    case 'orchestrator':
      return parseStructLog(cleaned, service);
    case 'web':
      return parseNextLog(cleaned);
    default:
      // Try JSON first, fall back to plain text
      const jsonResult = parsePinoLog(cleaned, service);
      if (jsonResult) return jsonResult;
      return parseNextLog(cleaned);
  }
}

/**
 * Filter logs by minimum level
 */
export function filterByLevel(logs: NormalizedLogEntry[], minLevel: LogLevel): NormalizedLogEntry[] {
  const minPriority = LOG_LEVEL_PRIORITY[minLevel];
  return logs.filter(log => LOG_LEVEL_PRIORITY[log.level] >= minPriority);
}

/**
 * Filter logs by search query (case-insensitive)
 */
export function filterBySearch(logs: NormalizedLogEntry[], query: string): NormalizedLogEntry[] {
  if (!query.trim()) return logs;

  const lowerQuery = query.toLowerCase();
  return logs.filter(log => {
    // Search in message
    if (log.message.toLowerCase().includes(lowerQuery)) return true;

    // Search in context values
    const contextStr = JSON.stringify(log.context).toLowerCase();
    if (contextStr.includes(lowerQuery)) return true;

    return false;
  });
}

/**
 * Sort logs by timestamp (newest first or oldest first)
 */
export function sortLogs(logs: NormalizedLogEntry[], order: 'asc' | 'desc' = 'desc'): NormalizedLogEntry[] {
  return [...logs].sort((a, b) => {
    const diff = a.timestamp.getTime() - b.timestamp.getTime();
    return order === 'asc' ? diff : -diff;
  });
}

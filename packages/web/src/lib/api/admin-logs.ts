/**
 * Admin Logs API
 * Fetch and stream Docker container logs.
 */

import { get } from './client';
import { getAccessToken } from '@/stores/auth-store';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type ServiceName = 'gateway' | 'web' | 'orchestrator' | 'workers';

export interface LogEntry {
  id: string;
  timestamp: string;
  service: ServiceName;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
}

export interface LogsResponse {
  success: boolean;
  data: {
    logs: LogEntry[];
    meta: {
      totalCount: number;
      returnedCount: number;
      services: ServiceName[];
      oldestTimestamp: string | null;
    };
  };
}

export interface LogsStatusResponse {
  success: boolean;
  data: {
    dockerAvailable: boolean;
    services: ServiceName[];
  };
}

export interface GetLogsOptions {
  services?: ServiceName[];
  level?: LogLevel;
  search?: string;
  limit?: number;
  since?: string;
}

// ============================================================================
// REST API
// ============================================================================

/**
 * Get historical logs
 */
export async function getAdminLogs(options: GetLogsOptions = {}): Promise<LogsResponse> {
  // Build query string manually to support array params
  const searchParams = new URLSearchParams();

  if (options.services && options.services.length > 0) {
    for (const service of options.services) {
      searchParams.append('services[]', service);
    }
  }
  if (options.level) {
    searchParams.append('level', options.level);
  }
  if (options.search) {
    searchParams.append('search', options.search);
  }
  if (options.limit) {
    searchParams.append('limit', options.limit.toString());
  }
  if (options.since) {
    searchParams.append('since', options.since);
  }

  const queryString = searchParams.toString();
  const endpoint = queryString ? `/admin/logs?${queryString}` : '/admin/logs';
  return get(endpoint);
}

/**
 * Check Docker availability
 */
export async function getLogsStatus(): Promise<LogsStatusResponse> {
  return get('/admin/logs/status');
}

// ============================================================================
// WebSocket Client
// ============================================================================

export type LogStreamMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'subscribed'
  | 'unsubscribed'
  | 'log'
  | 'error'
  | 'ping'
  | 'pong';

export interface LogStreamMessage {
  type: LogStreamMessageType;
  entry?: LogEntry;
  services?: ServiceName[];
  level?: LogLevel;
  search?: string | null;
  message?: string;
  service?: ServiceName;
}

export interface LogStreamOptions {
  services?: ServiceName[];
  level?: LogLevel;
  search?: string;
  onLog: (entry: LogEntry) => void;
  onError?: (message: string, service?: ServiceName) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

function getLogsWebSocketUrl(): string {
  // If gateway URL is set, derive WebSocket URL from it
  if (process.env.NEXT_PUBLIC_GATEWAY_URL) {
    const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL;
    return gatewayUrl.replace(/^http/, 'ws') + '/api/v1/admin/logs/stream';
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:3002/api/v1/admin/logs/stream';
  }

  const { protocol, hostname } = window.location;

  // If accessing via localhost, connect to gateway directly
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'ws://localhost:3002/api/v1/admin/logs/stream';
  }

  // External access: use same host (nginx proxies)
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/api/v1/admin/logs/stream`;
}

export class LogStreamClient {
  private ws: WebSocket | null = null;
  private options: LogStreamOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private isManualClose = false;

  constructor(options: LogStreamOptions) {
    this.options = options;
  }

  /**
   * Connect to the log stream
   */
  connect(): void {
    this.isManualClose = false;
    this.options.onStatusChange?.('connecting');

    const token = getAccessToken();
    if (!token) {
      this.options.onError?.('Not authenticated');
      this.options.onStatusChange?.('error');
      return;
    }

    const url = `${getLogsWebSocketUrl()}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.options.onStatusChange?.('connected');

      // Subscribe to logs
      this.subscribe();

      // Start ping interval
      this.pingInterval = setInterval(() => {
        this.send({ type: 'ping' });
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const message: LogStreamMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse log stream message:', error);
      }
    };

    this.ws.onerror = () => {
      this.options.onStatusChange?.('error');
    };

    this.ws.onclose = () => {
      this.cleanup();
      this.options.onStatusChange?.('disconnected');

      // Attempt reconnect if not manual close
      if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectTimeout = setTimeout(() => this.connect(), delay);
      }
    };
  }

  /**
   * Disconnect from the log stream
   */
  disconnect(): void {
    this.isManualClose = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Update subscription (services, level, search)
   */
  updateSubscription(options: Partial<Pick<LogStreamOptions, 'services' | 'level' | 'search'>>): void {
    if (options.services !== undefined) {
      this.options.services = options.services;
    }
    if (options.level !== undefined) {
      this.options.level = options.level;
    }
    if (options.search !== undefined) {
      this.options.search = options.search;
    }

    // Re-subscribe with new options
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe();
    }
  }

  private subscribe(): void {
    this.send({
      type: 'subscribe',
      services: this.options.services ?? ['gateway', 'web', 'orchestrator', 'workers'],
      level: this.options.level ?? 'info',
      search: this.options.search,
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: LogStreamMessage): void {
    switch (message.type) {
      case 'log':
        if (message.entry) {
          this.options.onLog(message.entry);
        }
        break;
      case 'error':
        this.options.onError?.(message.message ?? 'Unknown error', message.service);
        break;
      case 'subscribed':
        // Subscription confirmed
        break;
      case 'pong':
        // Heartbeat response
        break;
    }
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

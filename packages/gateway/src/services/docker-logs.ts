/**
 * Docker Logs Service
 * Fetches and streams logs from Docker containers.
 */

import Docker from 'dockerode';
import { Readable } from 'node:stream';
import {
  type LogLevel,
  type NormalizedLogEntry,
  type ServiceName,
  parseLogLine,
  filterByLevel,
  filterBySearch,
  sortLogs,
  LOG_LEVEL_PRIORITY,
} from '../utils/log-parser.js';
import { logger } from '../observability/logger.js';

// Container name mapping
const CONTAINER_NAMES: Record<ServiceName, string> = {
  gateway: 'campfire-gateway',
  web: 'campfire-web',
  orchestrator: 'campfire-orchestrator',
  workers: 'campfire-workers',
};

// Valid service names
export const VALID_SERVICES: ServiceName[] = ['gateway', 'web', 'orchestrator', 'workers'];

export interface GetLogsOptions {
  services: ServiceName[];
  level?: LogLevel;
  search?: string;
  limit?: number;
  since?: Date;
}

export interface StreamLogsOptions {
  services: ServiceName[];
  level?: LogLevel;
  search?: string;
  onLog: (entry: NormalizedLogEntry) => void;
  onError?: (service: ServiceName, error: Error) => void;
  signal?: AbortSignal;
}

export interface LogsResult {
  logs: NormalizedLogEntry[];
  meta: {
    totalCount: number;
    returnedCount: number;
    services: ServiceName[];
    oldestTimestamp: string | null;
  };
}

class DockerLogsService {
  private docker: Docker;
  private isAvailable: boolean | null = null;

  constructor() {
    // Connect to Docker socket
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * Check if Docker is available
   */
  async checkAvailability(): Promise<boolean> {
    if (this.isAvailable !== null) {
      return this.isAvailable;
    }

    try {
      await this.docker.ping();
      this.isAvailable = true;
      logger.info('Docker socket connected successfully');
      return true;
    } catch (error) {
      this.isAvailable = false;
      logger.warn({ error }, 'Docker socket not available - log streaming will be disabled');
      return false;
    }
  }

  /**
   * Get container by service name
   */
  private async getContainer(service: ServiceName): Promise<Docker.Container | null> {
    const containerName = CONTAINER_NAMES[service];

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { name: [containerName] },
      });

      if (containers.length === 0) {
        return null;
      }

      // Find exact match (Docker prefixes with /)
      const match = containers.find(
        c => c.Names.some(n => n === `/${containerName}` || n === containerName)
      );

      if (!match) {
        return null;
      }

      return this.docker.getContainer(match.Id);
    } catch (error) {
      logger.debug({ error, service, containerName }, 'Failed to find container');
      return null;
    }
  }

  /**
   * Fetch historical logs from containers
   */
  async getHistoricalLogs(options: GetLogsOptions): Promise<LogsResult> {
    const { services, level = 'info', search, limit = 500, since } = options;

    const isAvailable = await this.checkAvailability();
    if (!isAvailable) {
      return {
        logs: [],
        meta: {
          totalCount: 0,
          returnedCount: 0,
          services,
          oldestTimestamp: null,
        },
      };
    }

    const allLogs: NormalizedLogEntry[] = [];
    const activeServices: ServiceName[] = [];

    // Fetch logs from each service in parallel
    await Promise.all(
      services.map(async service => {
        try {
          const container = await this.getContainer(service);
          if (!container) {
            logger.debug({ service }, 'Container not found');
            return;
          }

          activeServices.push(service);

          // Get container logs (follow: false returns Buffer)
          const logBuffer = await container.logs({
            stdout: true,
            stderr: true,
            timestamps: true,
            tail: limit,
            follow: false,
            ...(since && { since: Math.floor(since.getTime() / 1000) }),
          });

          // Parse logs
          const lines = this.parseDockerLogBuffer(logBuffer);
          for (const line of lines) {
            const parsed = parseLogLine(line, service);
            if (parsed) {
              allLogs.push(parsed);
            }
          }
        } catch (error) {
          logger.warn({ error, service }, 'Failed to fetch logs from container');
        }
      })
    );

    // Apply filters
    let filteredLogs = filterByLevel(allLogs, level);
    if (search) {
      filteredLogs = filterBySearch(filteredLogs, search);
    }

    // Sort by timestamp (newest first)
    const sortedLogs = sortLogs(filteredLogs, 'desc');

    // Limit results
    const limitedLogs = sortedLogs.slice(0, limit);

    return {
      logs: limitedLogs,
      meta: {
        totalCount: filteredLogs.length,
        returnedCount: limitedLogs.length,
        services: activeServices,
        oldestTimestamp: limitedLogs.length > 0
          ? limitedLogs[limitedLogs.length - 1].timestamp.toISOString()
          : null,
      },
    };
  }

  /**
   * Stream live logs from containers
   */
  async streamLogs(options: StreamLogsOptions): Promise<void> {
    const { services, level = 'info', search, onLog, onError, signal } = options;

    const isAvailable = await this.checkAvailability();
    if (!isAvailable) {
      if (onError) {
        onError('gateway', new Error('Docker socket not available'));
      }
      return;
    }

    const minPriority = LOG_LEVEL_PRIORITY[level];
    const streams: Readable[] = [];

    // Start streaming from each service
    await Promise.all(
      services.map(async service => {
        try {
          const container = await this.getContainer(service);
          if (!container) {
            logger.debug({ service }, 'Container not found for streaming');
            return;
          }

          // follow: true returns a ReadableStream
          const logStream = await container.logs({
            stdout: true,
            stderr: true,
            follow: true,
            timestamps: true,
            tail: 0, // Only new logs
          }) as unknown as Readable;

          streams.push(logStream);

          // Handle log lines
          let buffer = '';

          logStream.on('data', (chunk: Buffer) => {
            // Docker multiplexes stdout/stderr with 8-byte header
            const lines = this.parseDockerLogBuffer(chunk);

            for (const line of lines) {
              buffer += line;

              // Check for complete lines
              while (buffer.includes('\n')) {
                const newlineIndex = buffer.indexOf('\n');
                const completeLine = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (completeLine.trim()) {
                  const parsed = parseLogLine(completeLine, service);
                  if (parsed) {
                    // Apply filters
                    if (LOG_LEVEL_PRIORITY[parsed.level] >= minPriority) {
                      if (!search || this.matchesSearch(parsed, search)) {
                        onLog(parsed);
                      }
                    }
                  }
                }
              }
            }
          });

          logStream.on('error', (error: Error) => {
            logger.warn({ error, service }, 'Log stream error');
            if (onError) {
              onError(service, error);
            }
          });

          // Clean up on abort
          signal?.addEventListener('abort', () => {
            logStream.destroy();
          });
        } catch (error) {
          logger.warn({ error, service }, 'Failed to start log stream');
          if (onError) {
            onError(service, error as Error);
          }
        }
      })
    );

    // Clean up all streams on abort
    signal?.addEventListener('abort', () => {
      for (const stream of streams) {
        stream.destroy();
      }
    });
  }

  /**
   * Parse Docker log buffer (handles multiplexed stdout/stderr)
   */
  private parseDockerLogBuffer(buffer: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      // Docker log stream has 8-byte header for each frame
      // Byte 0: stream type (1 = stdout, 2 = stderr)
      // Bytes 4-7: frame size (big-endian uint32)
      if (offset + 8 > buffer.length) {
        // Not enough data for header, treat rest as plain text
        const remaining = buffer.slice(offset).toString('utf-8');
        lines.push(...remaining.split('\n'));
        break;
      }

      // Check if this looks like a Docker multiplexed header
      const streamType = buffer[offset];
      if (streamType === 1 || streamType === 2) {
        const frameSize = buffer.readUInt32BE(offset + 4);

        if (offset + 8 + frameSize <= buffer.length && frameSize > 0 && frameSize < 1000000) {
          // Valid multiplexed frame
          const frameData = buffer.slice(offset + 8, offset + 8 + frameSize).toString('utf-8');
          lines.push(...frameData.split('\n'));
          offset += 8 + frameSize;
          continue;
        }
      }

      // Not a valid header, treat as plain text
      const remaining = buffer.slice(offset).toString('utf-8');
      lines.push(...remaining.split('\n'));
      break;
    }

    return lines.filter(line => line.trim());
  }

  /**
   * Convert stream to buffer
   */
  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Check if log entry matches search query
   */
  private matchesSearch(entry: NormalizedLogEntry, query: string): boolean {
    const lowerQuery = query.toLowerCase();
    if (entry.message.toLowerCase().includes(lowerQuery)) return true;
    const contextStr = JSON.stringify(entry.context).toLowerCase();
    return contextStr.includes(lowerQuery);
  }
}

// Singleton instance
let dockerLogsService: DockerLogsService | null = null;

export function getDockerLogsService(): DockerLogsService {
  if (!dockerLogsService) {
    dockerLogsService = new DockerLogsService();
  }
  return dockerLogsService;
}

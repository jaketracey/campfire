'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw,
  AlertCircle,
  Terminal,
  Play,
  Pause,
  Trash2,
  Download,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  getAdminLogs,
  getLogsStatus,
  LogStreamClient,
  type LogEntry,
  type LogLevel,
  type ServiceName,
} from '@/lib/api/admin-logs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SERVICES: ServiceName[] = ['gateway', 'web', 'orchestrator', 'workers'];
const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: 'text-zinc-500',
  debug: 'text-blue-400',
  info: 'text-green-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  fatal: 'text-red-600 font-bold',
};

const LEVEL_BG_COLORS: Record<LogLevel, string> = {
  trace: 'bg-zinc-500/10',
  debug: 'bg-blue-500/10',
  info: 'bg-green-500/10',
  warn: 'bg-yellow-500/10',
  error: 'bg-red-500/10',
  fatal: 'bg-red-600/20',
};

const SERVICE_COLORS: Record<ServiceName, string> = {
  gateway: 'bg-purple-500/20 text-purple-400',
  web: 'bg-blue-500/20 text-blue-400',
  orchestrator: 'bg-green-500/20 text-green-400',
  workers: 'bg-orange-500/20 text-orange-400',
};

export default function AdminLogsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedServices, setSelectedServices] = useState<ServiceName[]>(SERVICES);
  const [selectedLevel, setSelectedLevel] = useState<LogLevel>('info');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [autoScroll, setAutoScroll] = useState(true);

  const logStreamRef = useRef<LogStreamClient | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Check Docker status and fetch initial logs
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);

      const [statusRes, logsRes] = await Promise.all([
        getLogsStatus(),
        getAdminLogs({
          services: selectedServices,
          level: selectedLevel,
          search: debouncedSearch || undefined,
          limit: 500,
        }),
      ]);

      setDockerAvailable(statusRes.data.dockerAvailable);
      setLogs(logsRes.data.logs);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedServices, selectedLevel, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Start/stop streaming
  const toggleStreaming = useCallback(() => {
    if (isStreaming) {
      logStreamRef.current?.disconnect();
      logStreamRef.current = null;
      setIsStreaming(false);
      setStreamStatus('disconnected');
    } else {
      const client = new LogStreamClient({
        services: selectedServices,
        level: selectedLevel,
        search: debouncedSearch || undefined,
        onLog: (entry) => {
          setLogs((prev) => {
            // Keep only last 1000 logs
            const newLogs = [...prev, entry];
            if (newLogs.length > 1000) {
              return newLogs.slice(-1000);
            }
            return newLogs;
          });
        },
        onError: (message, service) => {
          console.error('Log stream error:', message, service);
        },
        onStatusChange: (status) => {
          setStreamStatus(status);
          if (status === 'disconnected' || status === 'error') {
            setIsStreaming(false);
          }
        },
      });
      client.connect();
      logStreamRef.current = client;
      setIsStreaming(true);
    }
  }, [isStreaming, selectedServices, selectedLevel, debouncedSearch]);

  // Update stream subscription when filters change
  useEffect(() => {
    if (logStreamRef.current && isStreaming) {
      logStreamRef.current.updateSubscription({
        services: selectedServices,
        level: selectedLevel,
        search: debouncedSearch || undefined,
      });
    }
  }, [selectedServices, selectedLevel, debouncedSearch, isStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      logStreamRef.current?.disconnect();
    };
  }, []);

  // Toggle service selection
  const toggleService = (service: ServiceName) => {
    setSelectedServices((prev) => {
      if (prev.includes(service)) {
        return prev.filter((s) => s !== service);
      }
      return [...prev, service];
    });
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
  };

  // Export logs
  const exportLogs = () => {
    const content = logs
      .map((log) => `[${log.timestamp}] [${log.service}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campfire-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="h-6 w-6 text-zinc-400" />
          <h1 className="text-2xl font-semibold text-zinc-100">System Logs</h1>
          {dockerAvailable === false && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Docker Unavailable
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Stream status indicator */}
          <div className="flex items-center gap-2 text-sm">
            {streamStatus === 'connected' ? (
              <Wifi className="h-4 w-4 text-green-400" />
            ) : streamStatus === 'connecting' ? (
              <Wifi className="h-4 w-4 text-yellow-400 animate-pulse" />
            ) : (
              <WifiOff className="h-4 w-4 text-zinc-500" />
            )}
            <span className={cn(
              streamStatus === 'connected' && 'text-green-400',
              streamStatus === 'connecting' && 'text-yellow-400',
              (streamStatus === 'disconnected' || streamStatus === 'error') && 'text-zinc-500',
            )}>
              {streamStatus === 'connected' ? 'Live' : streamStatus === 'connecting' ? 'Connecting...' : 'Offline'}
            </span>
          </div>
          <Button
            variant={isStreaming ? 'destructive' : 'default'}
            size="sm"
            onClick={toggleStreaming}
            disabled={dockerAvailable === false}
          >
            {isStreaming ? (
              <>
                <Pause className="h-4 w-4 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" />
                Stream
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Service filters */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Services:</span>
              <div className="flex gap-1">
                {SERVICES.map((service) => (
                  <button
                    key={service}
                    onClick={() => toggleService(service)}
                    className={cn(
                      'px-2 py-1 text-xs rounded-md transition-colors',
                      selectedServices.includes(service)
                        ? SERVICE_COLORS[service]
                        : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700',
                    )}
                  >
                    {service}
                  </button>
                ))}
              </div>
            </div>

            {/* Level filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Level:</span>
              <select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value as LogLevel)}
                className="bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}+
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px] max-w-md">
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAutoScroll(!autoScroll)}
                className={cn(autoScroll && 'bg-zinc-800')}
              >
                Auto-scroll: {autoScroll ? 'On' : 'Off'}
              </Button>
              <Button variant="ghost" size="sm" onClick={exportLogs} disabled={logs.length === 0}>
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={clearLogs} disabled={logs.length === 0}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log viewer */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-zinc-400">
              {logs.length} entries
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div
            ref={logsContainerRef}
            className="h-[600px] overflow-y-auto font-mono text-xs bg-zinc-950 rounded-lg p-2"
            onMouseEnter={() => setAutoScroll(false)}
            onMouseLeave={() => setAutoScroll(true)}
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                Loading logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                <Terminal className="h-8 w-8 mb-2" />
                <p>No logs found</p>
                {dockerAvailable === false && (
                  <p className="text-sm mt-1">Docker socket is not available</p>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={cn(
                      'flex items-start gap-2 py-0.5 px-1 rounded hover:bg-zinc-800/50',
                      LEVEL_BG_COLORS[log.level],
                    )}
                  >
                    <span className="text-zinc-500 shrink-0 w-24">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span className={cn('shrink-0 w-20', SERVICE_COLORS[log.service].split(' ')[1])}>
                      [{log.service}]
                    </span>
                    <span className={cn('shrink-0 w-12 uppercase', LEVEL_COLORS[log.level])}>
                      {log.level}
                    </span>
                    <span className="text-zinc-200 break-all">
                      {log.message}
                      {Object.keys(log.context).length > 0 && (
                        <span className="text-zinc-500 ml-2">
                          {JSON.stringify(log.context)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

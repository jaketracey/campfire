'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Brain, Activity, MessageSquare, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  getSessionDebugInfo,
  getKGSummary,
  getContextDebugInfo,
  type SessionDebugInfo,
  type KGSummaryResponse,
  type ContextDebugInfo,
} from '@/lib/api';

interface DebugPanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  refreshTrigger?: number;
}

export function DebugPanel({ sessionId, isOpen, onClose, refreshTrigger = 0 }: DebugPanelProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [debugInfo, setDebugInfo] = useState<SessionDebugInfo | null>(null);
  const [kgSummary, setKgSummary] = useState<KGSummaryResponse | null>(null);
  const [contextInfo, setContextInfo] = useState<ContextDebugInfo | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchDebugInfo = useCallback(async () => {
    setLoading((prev) => ({ ...prev, overview: true }));
    setError(null);
    try {
      const data = await getSessionDebugInfo(sessionId);
      setDebugInfo(data);
    } catch (err) {
      setError('Failed to load debug info');
      console.error(err);
    } finally {
      setLoading((prev) => ({ ...prev, overview: false }));
    }
  }, [sessionId]);

  const fetchKGSummary = useCallback(async () => {
    setLoading((prev) => ({ ...prev, kg: true }));
    try {
      const data = await getKGSummary(sessionId);
      setKgSummary(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading((prev) => ({ ...prev, kg: false }));
    }
  }, [sessionId]);

  const fetchContextInfo = useCallback(async () => {
    setLoading((prev) => ({ ...prev, context: true }));
    try {
      const data = await getContextDebugInfo(sessionId);
      setContextInfo(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading((prev) => ({ ...prev, context: false }));
    }
  }, [sessionId]);

  useEffect(() => {
    if (isOpen) {
      fetchDebugInfo();
    }
  }, [isOpen, fetchDebugInfo]);

  useEffect(() => {
    if (isOpen && activeTab === 'kg' && !kgSummary) {
      fetchKGSummary();
    }
  }, [isOpen, activeTab, kgSummary, fetchKGSummary]);

  useEffect(() => {
    if (isOpen && activeTab === 'context' && !contextInfo) {
      fetchContextInfo();
    }
  }, [isOpen, activeTab, contextInfo, fetchContextInfo]);

  // Auto-refresh when messages are sent/received (refreshTrigger changes)
  useEffect(() => {
    if (isOpen && refreshTrigger > 0) {
      fetchDebugInfo();
      // Also refresh context if that tab is active
      if (activeTab === 'context') {
        fetchContextInfo();
      }
    }
  }, [refreshTrigger, isOpen, activeTab, fetchDebugInfo, fetchContextInfo]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 w-[480px] max-h-[600px] z-50 shadow-2xl rounded-lg border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Debug Panel</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              fetchDebugInfo();
              if (kgSummary) fetchKGSummary();
              if (contextInfo) fetchContextInfo();
            }}
            disabled={loading.overview}
          >
            <RefreshCw className={`h-4 w-4 ${loading.overview ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="p-3">
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="overview" className="text-xs gap-1">
            <Activity className="h-3 w-3" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="kg" className="text-xs gap-1">
            <Brain className="h-3 w-3" />
            KG
          </TabsTrigger>
          <TabsTrigger value="events" className="text-xs gap-1">
            <MessageSquare className="h-3 w-3" />
            Events
          </TabsTrigger>
          <TabsTrigger value="context" className="text-xs gap-1">
            <Database className="h-3 w-3" />
            Context
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <ScrollArea className="h-[450px]">
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 rounded mb-3">
                {error}
              </div>
            )}
            {loading.overview && !debugInfo ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                Loading...
              </div>
            ) : debugInfo ? (
              <div className="space-y-4">
                {/* Session Info */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Session
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Status:</span>{' '}
                      <span
                        className={
                          debugInfo.session.status === 'active'
                            ? 'text-green-600'
                            : 'text-gray-500'
                        }
                      >
                        {debugInfo.session.status}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Turns:</span>{' '}
                      {debugInfo.session.turnCount}
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Started:</span>{' '}
                      {new Date(debugInfo.session.startedAt).toLocaleString()}
                    </div>
                  </div>
                </Card>

                {/* Metrics */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Performance Metrics
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Avg Latency:</span>{' '}
                      <span className="font-mono">{debugInfo.metrics.avgLatencyMs}ms</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Latency:</span>{' '}
                      <span className="font-mono">{debugInfo.metrics.totalLatencyMs}ms</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Input Tokens:</span>{' '}
                      <span className="font-mono">
                        {debugInfo.metrics.totalInputTokens.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Output Tokens:</span>{' '}
                      <span className="font-mono">
                        {debugInfo.metrics.totalOutputTokens.toLocaleString()}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Total Cost:</span>{' '}
                      <span className="font-mono text-green-600">
                        ${debugInfo.metrics.totalCostUsd}
                      </span>
                    </div>
                  </div>
                </Card>

                {/* Turn Metrics */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Recent Turns
                  </h3>
                  <div className="space-y-2">
                    {debugInfo.turns.slice(0, 5).map((turn) => (
                      <div
                        key={turn.id}
                        className="flex items-center justify-between text-xs p-2 bg-muted/50 rounded"
                      >
                        <span className="font-mono">Turn #{turn.turnNumber}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {turn.latencyMs}ms
                          </span>
                          <span className="text-muted-foreground">
                            {(turn.inputTokens || 0) + (turn.outputTokens || 0)} tok
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            ) : null}
          </ScrollArea>
        </TabsContent>

        {/* Knowledge Graph Tab */}
        <TabsContent value="kg">
          <ScrollArea className="h-[450px]">
            {loading.kg ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                Generating KG summary...
              </div>
            ) : kgSummary ? (
              <div className="space-y-4">
                {/* Stats */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Graph Statistics
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Entities:</span>{' '}
                      <span className="font-mono">{kgSummary.stats.entityCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Relationships:</span>{' '}
                      <span className="font-mono">{kgSummary.stats.edgeCount}</span>
                    </div>
                  </div>
                  {kgSummary.stats.entityTypes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {kgSummary.stats.entityTypes.map((et) => (
                        <span
                          key={et.entityType}
                          className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded"
                        >
                          {et.entityType}: {et.count}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>

                {/* LLM Summary */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    AI Summary
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{kgSummary.summary}</p>
                  {kgSummary.llmError && (
                    <p className="text-xs text-amber-600 mt-2">{kgSummary.llmError}</p>
                  )}
                </Card>

                {/* Sample Edges */}
                {kgSummary.stats.sampleEdges.length > 0 && (
                  <Card className="p-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                      Sample Relationships
                    </h3>
                    <div className="space-y-1">
                      {kgSummary.stats.sampleEdges.slice(0, 8).map((edge, i) => (
                        <div
                          key={i}
                          className="text-xs p-1.5 bg-muted/50 rounded flex items-center gap-1"
                        >
                          <span className="font-medium">{edge.source}</span>
                          <span className="text-muted-foreground">--[{edge.relation}]--&gt;</span>
                          <span className="font-medium">{edge.target}</span>
                          <span className="ml-auto text-muted-foreground">
                            {(edge.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                Click to load KG summary
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events">
          <ScrollArea className="h-[450px]">
            {debugInfo ? (
              <div className="space-y-4">
                {/* Event Type Counts */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Event Types
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(debugInfo.events.typeCounts).map(([type, count]) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded"
                      >
                        {type}: {count}
                      </span>
                    ))}
                  </div>
                </Card>

                {/* Recent Events */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Recent Events ({debugInfo.events.totalCount})
                  </h3>
                  <div className="space-y-1">
                    {debugInfo.events.recent.map((event, i) => (
                      <div
                        key={i}
                        className="text-xs p-2 bg-muted/50 rounded"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-medium">{event.type}</span>
                          <span className="text-muted-foreground">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {event.payload && Object.keys(event.payload).length > 0 && (
                          <pre className="text-[10px] text-muted-foreground overflow-x-auto">
                            {JSON.stringify(event.payload, null, 2).slice(0, 200)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                Loading events...
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Context Tab */}
        <TabsContent value="context">
          <ScrollArea className="h-[450px]">
            {loading.context ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                Loading context...
              </div>
            ) : contextInfo ? (
              <div className="space-y-4">
                {/* Context Stats */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Context Window
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Max Turns:</span>{' '}
                      <span className="font-mono">{contextInfo.maxContextTurns}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Current:</span>{' '}
                      <span className="font-mono">{contextInfo.currentContextTurns}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Est. Tokens:</span>{' '}
                      <span className="font-mono">
                        ~{contextInfo.estimatedContextTokens.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </Card>

                {/* Context Turns */}
                <Card className="p-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Context Turns
                  </h3>
                  <div className="space-y-2">
                    {contextInfo.turns.map((turn) => (
                      <div
                        key={turn.turnNumber}
                        className="text-xs p-2 bg-muted/50 rounded space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium">
                            Turn #{turn.turnNumber}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(turn.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        {turn.userMessage && (
                          <div className="pl-2 border-l-2 border-blue-300">
                            <span className="text-blue-600 font-medium">User:</span>{' '}
                            <span className="text-muted-foreground">
                              {turn.userMessage.slice(0, 100)}
                              {turn.userMessage.length > 100 ? '...' : ''}
                            </span>
                          </div>
                        )}
                        {turn.agentMessage && (
                          <div className="pl-2 border-l-2 border-green-300">
                            <span className="text-green-600 font-medium">Agent:</span>{' '}
                            <span className="text-muted-foreground">
                              {turn.agentMessage.slice(0, 100)}
                              {turn.agentMessage.length > 100 ? '...' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                Click to load context
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

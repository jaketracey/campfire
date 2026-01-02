'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle, CheckCircle2, Clock, PlayCircle, RefreshCw, ArrowLeft, XCircle } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  listTestRuns,
  triggerTestRun,
  type TestRun,
  type TestRunType,
  type TestRunStatus,
} from '@/lib/api/orchestration';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export default function TestRunsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<TestRunStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<TestRunType | 'all'>('all');
  const [isRunningTest, setIsRunningTest] = useState(false);

  const limit = 20;

  const fetchTestRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listTestRuns({
        limit,
        offset,
        status: statusFilter === 'all' ? undefined : statusFilter,
        runType: typeFilter === 'all' ? undefined : typeFilter,
      });
      setTestRuns(response.data.runs);
      setHasMore(response.data.hasMore);
    } catch (error) {
      console.error('Failed to fetch test runs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [offset, statusFilter, typeFilter]);

  useEffect(() => {
    fetchTestRuns();
  }, [fetchTestRuns]);

  const handleRunTests = async (runType: TestRunType) => {
    setIsRunningTest(true);
    try {
      await triggerTestRun(runType);
      setTimeout(() => {
        fetchTestRuns();
        setIsRunningTest(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to trigger test run:', error);
      setIsRunningTest(false);
    }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusIcon = (run: TestRun) => {
    if (run.status === 'completed' && run.failed === 0) {
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    }
    if (run.status === 'completed') {
      return <AlertCircle className="h-5 w-5 text-amber-500" />;
    }
    if (run.status === 'running') {
      return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />;
    }
    if (run.status === 'failed') {
      return <XCircle className="h-5 w-5 text-red-500" />;
    }
    return <Clock className="h-5 w-5 text-gray-500" />;
  };

  const getStatusBadge = (status: TestRunStatus) => {
    const variants: Record<TestRunStatus, { className: string; label: string }> = {
      pending: { className: 'bg-gray-500/10 text-gray-400', label: 'Pending' },
      running: { className: 'bg-blue-500/10 text-blue-500', label: 'Running' },
      completed: { className: 'bg-green-500/10 text-green-500', label: 'Completed' },
      failed: { className: 'bg-red-500/10 text-red-500', label: 'Failed' },
      cancelled: { className: 'bg-gray-500/10 text-gray-400', label: 'Cancelled' },
    };
    const { className, label } = variants[status];
    return <Badge className={className}>{label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={'/admin/orchestration' as Route}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Test Runs</h1>
          <p className="text-gray-400 text-sm mt-1">
            View and manage orchestration test runs
          </p>
        </div>
        <Button
          onClick={() => handleRunTests('all')}
          disabled={isRunningTest}
          className="gap-2 bg-campfire-600 hover:bg-campfire-700"
        >
          <PlayCircle className="h-4 w-4" />
          {isRunningTest ? 'Running...' : 'Run All Tests'}
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-4">
          <div className="flex gap-4 items-center">
            <div className="flex-1 flex gap-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Status</label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v as TestRunStatus | 'all');
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-40 bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Type</label>
                <Select
                  value={typeFilter}
                  onValueChange={(v) => {
                    setTypeFilter(v as TestRunType | 'all');
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-40 bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="routing">Routing</SelectItem>
                    <SelectItem value="memory">Memory</SelectItem>
                    <SelectItem value="integration">Integration</SelectItem>
                    <SelectItem value="performance">Performance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchTestRuns()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Test Runs List */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <RefreshCw className="h-8 w-8 text-gray-500 animate-spin mx-auto" />
              <p className="text-gray-500 mt-2">Loading test runs...</p>
            </div>
          ) : testRuns.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="h-12 w-12 text-gray-600 mx-auto" />
              <p className="text-gray-500 mt-2">No test runs found</p>
              <Button
                onClick={() => handleRunTests('all')}
                className="mt-4 gap-2"
                disabled={isRunningTest}
              >
                <PlayCircle className="h-4 w-4" />
                Run Tests
              </Button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Status
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Type
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Results
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Duration
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Created
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {testRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run)}
                        {getStatusBadge(run.status)}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-white capitalize font-medium">
                        {run.runType}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">{run.passed}</span>
                        <span className="text-gray-600">/</span>
                        <span className="text-white">{run.totalTests}</span>
                        {run.failed > 0 && (
                          <span className="text-red-500 text-sm">
                            ({run.failed} failed)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-gray-400">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="p-4 text-gray-400 text-sm">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="p-4">
                      <Link href={`/admin/orchestration/tests/${run.id}` as Route}>
                        <Button variant="ghost" size="sm">
                          View Details
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {(testRuns.length > 0 || offset > 0) && (
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            Previous
          </Button>
          <span className="text-gray-400 text-sm">
            Showing {offset + 1} - {offset + testRuns.length}
          </span>
          <Button
            variant="outline"
            onClick={() => setOffset(offset + limit)}
            disabled={!hasMore}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

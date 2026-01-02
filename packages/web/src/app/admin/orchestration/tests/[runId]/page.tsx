'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  getTestRun,
  type TestRunWithResults,
  type TestResult,
  type TestResultStatus,
} from '@/lib/api/orchestration';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TestRunDetailPageProps {
  params: Promise<{ runId: string }>;
}

export default function TestRunDetailPage({ params }: TestRunDetailPageProps) {
  const { runId } = use(params);
  const [isLoading, setIsLoading] = useState(true);
  const [testRun, setTestRun] = useState<TestRunWithResults | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const fetchTestRun = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getTestRun(runId, true);
      setTestRun(response.data);
    } catch (error) {
      console.error('Failed to fetch test run:', error);
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchTestRun();
  }, [fetchTestRun]);

  // Auto-refresh if running
  useEffect(() => {
    if (testRun?.status === 'running') {
      const interval = setInterval(fetchTestRun, 2000);
      return () => clearInterval(interval);
    }
  }, [testRun?.status, fetchTestRun]);

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusIcon = (status: TestResultStatus) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'skipped':
        return <Clock className="h-4 w-4 text-gray-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: TestResultStatus) => {
    const variants: Record<TestResultStatus, { className: string; label: string }> = {
      passed: { className: 'bg-green-500/10 text-green-500', label: 'Passed' },
      failed: { className: 'bg-red-500/10 text-red-500', label: 'Failed' },
      skipped: { className: 'bg-gray-500/10 text-gray-400', label: 'Skipped' },
      error: { className: 'bg-amber-500/10 text-amber-500', label: 'Error' },
    };
    const { className, label } = variants[status];
    return <Badge className={className}>{label}</Badge>;
  };

  const filteredResults = selectedCategory
    ? testRun?.results?.filter((r) => r.testCategory === selectedCategory)
    : testRun?.results;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={'/admin/orchestration/tests' as Route}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-white">Test Run Details</h1>
        </div>
        <div className="flex items-center justify-center p-12">
          <RefreshCw className="h-8 w-8 text-gray-500 animate-spin" />
        </div>
      </div>
    );
  }

  if (!testRun) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={'/admin/orchestration/tests' as Route}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-white">Test Run Not Found</h1>
        </div>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-8 text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <p className="text-gray-400 mt-4">
              The test run could not be found.
            </p>
            <Link href={'/admin/orchestration/tests' as Route}>
              <Button className="mt-4">Back to Test Runs</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={'/admin/orchestration/tests' as Route}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white capitalize">
            {testRun.runType} Test Run
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Started {new Date(testRun.createdAt).toLocaleString()}
          </p>
        </div>
        {testRun.status === 'running' && (
          <Badge className="bg-blue-500/10 text-blue-500 gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-4">
            <p className="text-sm text-gray-400">Total Tests</p>
            <p className="text-2xl font-bold text-white">{testRun.totalTests}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="p-4">
            <p className="text-sm text-green-400">Passed</p>
            <p className="text-2xl font-bold text-green-500">{testRun.passed}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="p-4">
            <p className="text-sm text-red-400">Failed</p>
            <p className="text-2xl font-bold text-red-500">{testRun.failed}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-4">
            <p className="text-sm text-gray-400">Duration</p>
            <p className="text-2xl font-bold text-white">
              {formatDuration(testRun.durationMs)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      {testRun.categoryBreakdown && testRun.categoryBreakdown.length > 0 && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white">By Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={selectedCategory === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  selectedCategory === null && 'bg-campfire-600 hover:bg-campfire-700'
                )}
              >
                All ({testRun.results?.length || 0})
              </Button>
              {testRun.categoryBreakdown.map((cat) => (
                <Button
                  key={cat.category}
                  variant={selectedCategory === cat.category ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(cat.category)}
                  className={cn(
                    'gap-2',
                    selectedCategory === cat.category && 'bg-campfire-600 hover:bg-campfire-700'
                  )}
                >
                  <span className="capitalize">{cat.category}</span>
                  <span className="text-green-500">{cat.passed}</span>
                  {cat.failed > 0 && (
                    <span className="text-red-500">{cat.failed}</span>
                  )}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Message */}
      {testRun.errorMessage && (
        <Card className="bg-red-500/5 border-red-500/20">
          <CardHeader>
            <CardTitle className="text-lg text-red-500 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono">
              {testRun.errorMessage}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Test Results */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">
            Test Results
            {selectedCategory && (
              <span className="text-gray-400 font-normal ml-2">
                - {selectedCategory}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!filteredResults || filteredResults.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="h-12 w-12 text-gray-600 mx-auto" />
              <p className="text-gray-500 mt-2">
                {testRun.status === 'running'
                  ? 'Tests are running...'
                  : 'No test results available'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Status
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Test Name
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Category
                  </th>
                  <th className="text-left text-sm font-medium text-gray-400 p-4">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((result) => (
                  <tr
                    key={result.id}
                    className={cn(
                      'border-b border-white/5',
                      result.status === 'failed' && 'bg-red-500/5'
                    )}
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(result.status)}
                        {getStatusBadge(result.status)}
                      </div>
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="text-white font-mono text-sm">
                          {result.testName}
                        </p>
                        {result.errorMessage && (
                          <p className="text-red-400 text-xs mt-1 max-w-lg truncate">
                            {result.errorMessage}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-gray-400 capitalize">
                        {result.testCategory}
                      </span>
                    </td>
                    <td className="p-4 text-gray-400">
                      {formatDuration(result.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

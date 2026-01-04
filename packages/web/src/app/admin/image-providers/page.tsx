'use client';

import { useEffect, useState, useCallback } from 'react';
import { Image, Plus, RefreshCw, CheckCircle2, AlertCircle, Zap, Settings2 } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  listImageProviders,
  testImageProviderConnection,
  type ImageProvider,
} from '@/lib/api/image-providers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function ImageProvidersPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [providers, setProviders] = useState<ImageProvider[]>([]);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs: number | null; error: string | null }>>({});

  const fetchData = useCallback(async () => {
    try {
      const response = await listImageProviders();
      setProviders(response.providers);
    } catch (error) {
      console.error('Failed to fetch image providers:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      const result = await testImageProviderConnection(providerId);
      setTestResults((prev) => ({
        ...prev,
        [providerId]: result,
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { success: false, latencyMs: null, error: 'Failed to test connection' },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const getHealthStatus = (provider: ImageProvider) => {
    // ComfyUI is a local provider that doesn't need API keys
    const isLocalProvider = provider.provider === 'comfyui';

    // If no API key configured and not a local provider, can't determine health status
    if (!provider.hasApiKey && !isLocalProvider) {
      return 'not_configured';
    }
    const testResult = testResults[provider.id];
    if (testResult) {
      return testResult.success ? 'online' : 'offline';
    }
    if (provider.health) {
      return provider.health.isAvailable ? 'online' : 'offline';
    }
    return 'unknown';
  };

  const getHealthBadge = (provider: ImageProvider) => {
    const status = getHealthStatus(provider);
    const testResult = testResults[provider.id];

    switch (status) {
      case 'online':
        return (
          <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30">
            Online
            {testResult?.latencyMs && <span className="ml-1">({testResult.latencyMs}ms)</span>}
          </Badge>
        );
      case 'offline':
        return (
          <Badge variant="destructive">
            Offline
          </Badge>
        );
      case 'not_configured':
        return (
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-500">
            Not Configured
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="bg-gray-500/20 text-gray-400">
            Unknown
          </Badge>
        );
    }
  };

  const getProviderIcon = (providerType: string) => {
    switch (providerType) {
      case 'comfyui':
        return 'ComfyUI';
      case 'fal':
        return 'FAL.ai';
      default:
        return providerType;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Image Providers</h1>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-white/[0.02] border-white/5">
              <CardContent className="p-6">
                <div className="animate-pulse h-24 bg-white/5 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const enabledProviders = providers.filter((p) => p.isEnabled).length;
  const configuredProviders = providers.filter((p) => p.hasApiKey || p.provider === 'comfyui').length;
  const healthyProviders = providers.filter((p) =>
    (p.hasApiKey || p.provider === 'comfyui') && p.health?.isAvailable
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Image Providers</h1>
          <p className="text-gray-400 text-sm mt-1">
            Configure image generation providers (ComfyUI, FAL.ai)
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Link href={'/admin/image-providers/new' as Route}>
            <Button size="sm" className="gap-2 bg-campfire-600 hover:bg-campfire-700">
              <Plus className="h-4 w-4" />
              Add Provider
            </Button>
          </Link>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <Image className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Providers</p>
                <p className="text-lg font-semibold text-white">{providers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Enabled</p>
                <p className="text-lg font-semibold text-white">{enabledProviders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Configured</p>
                <p className="text-lg font-semibold text-white">{configuredProviders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                healthyProviders > 0 ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
              )}>
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Healthy</p>
                <p className="text-lg font-semibold text-white">{healthyProviders}/{providers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider List */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Image className="h-5 w-5 text-purple-500" />
            Image Provider Configurations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No image providers configured yet. Add a provider to get started.
            </p>
          ) : (
            <div className="space-y-4">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className={cn(
                    'p-4 rounded-lg border transition-colors',
                    provider.isEnabled
                      ? 'bg-white/[0.02] border-white/10 hover:border-white/20'
                      : 'bg-white/[0.01] border-white/5 opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-3 rounded-lg",
                        provider.isEnabled ? "bg-purple-500/10" : "bg-gray-500/10"
                      )}>
                        <Image className={cn(
                          "h-6 w-6",
                          provider.isEnabled ? "text-purple-500" : "text-gray-500"
                        )} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-white">{provider.displayName}</h3>
                          {!provider.isEnabled && (
                            <Badge variant="secondary" className="text-xs">Disabled</Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-400">{getProviderIcon(provider.provider)}</p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                          <span>{provider.modelCount} model{provider.modelCount !== 1 ? 's' : ''}</span>
                          {provider.rateLimitRpm && (
                            <span>{provider.rateLimitRpm} RPM</span>
                          )}
                          {provider.hasApiKey ? (
                            <span className="text-green-500">API key configured</span>
                          ) : provider.provider === 'comfyui' ? (
                            <span className="text-blue-500">Local provider</span>
                          ) : (
                            <span className="text-amber-500">No API key</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getHealthBadge(provider)}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(provider.id)}
                        disabled={testingProvider === provider.id || (!provider.hasApiKey && provider.provider !== 'comfyui')}
                        className="gap-2"
                      >
                        {testingProvider === provider.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                        Test
                      </Button>

                      <Link href={`/admin/image-providers/${provider.id}` as Route}>
                        <Button variant="outline" size="sm" className="gap-2">
                          <Settings2 className="h-4 w-4" />
                          Configure
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Show error message if test failed */}
                  {testResults[provider.id]?.error && (
                    <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{testResults[provider.id].error}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Related Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Link href={'/admin/image-routing' as Route}>
              <Button variant="outline" className="gap-2">
                <Settings2 className="h-4 w-4" />
                Image Routing Rules
              </Button>
            </Link>
            <Link href={'/admin/providers' as Route}>
              <Button variant="outline" className="gap-2">
                <Settings2 className="h-4 w-4" />
                Text Providers
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

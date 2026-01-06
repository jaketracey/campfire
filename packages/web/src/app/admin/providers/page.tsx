'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Server, Image, Video, Plus, RefreshCw, CheckCircle2, AlertCircle, Zap, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  listProviders,
  updateProvider,
  deleteProvider,
  testProviderConnection,
  type Provider,
} from '@/lib/api/providers';
import {
  listImageProviders,
  updateImageProvider,
  deleteImageProvider,
  testImageProviderConnection,
  type ImageProvider,
} from '@/lib/api/image-providers';
import {
  listVideoProviders,
  updateVideoProvider,
  deleteVideoProvider,
  testVideoProviderConnection,
  type VideoProvider,
} from '@/lib/api/video-providers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type ProviderKind = 'text' | 'image' | 'video';

type ConnectionTestResult = {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
};

type ProviderHealth = {
  isAvailable: boolean;
  avgLatencyMs: number | null;
} | null;

type ProviderBase = {
  id: string;
  provider: string;
  displayName: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  rateLimitRpm: number | null;
  modelCount: number;
  health: ProviderHealth;
};

type ProviderTabConfig = {
  kind: ProviderKind;
  title: string;
  description: string;
  icon: typeof Server;
  iconClasses: {
    overviewBg: string;
    overviewText: string;
    listIconText: string;
    listIconBg: string;
  };
  addHref: Route;
  configureHref: (id: string) => Route;
  routingHref: Route;
  routingLabel: string;
  isLocalProvider: (provider: ProviderBase) => boolean;
  providerTypeLabel: (providerType: string) => string;
};

const normalizeProviderTab = (tab: string | null): ProviderKind => {
  if (tab === 'image' || tab === 'video' || tab === 'text') return tab;
  return 'text';
};

const PROVIDER_TABS: Record<ProviderKind, ProviderTabConfig> = {
  text: {
    kind: 'text',
    title: 'Text Providers',
    description: 'Configure AI text providers and API keys',
    icon: Server,
    iconClasses: {
      overviewBg: 'bg-blue-500/10',
      overviewText: 'text-blue-500',
      listIconText: 'text-blue-500',
      listIconBg: 'bg-blue-500/10',
    },
    addHref: '/admin/providers/new' as Route,
    configureHref: (id: string) => `/admin/providers/${id}` as Route,
    routingHref: '/admin/routing' as Route,
    routingLabel: 'Text Routing Rules',
    isLocalProvider: (provider) => provider.provider === 'ollama',
    providerTypeLabel: (providerType) => providerType,
  },
  image: {
    kind: 'image',
    title: 'Image Providers',
    description: 'Configure image generation providers (ComfyUI, FAL.ai)',
    icon: Image,
    iconClasses: {
      overviewBg: 'bg-purple-500/10',
      overviewText: 'text-purple-500',
      listIconText: 'text-purple-500',
      listIconBg: 'bg-purple-500/10',
    },
    addHref: '/admin/image-providers/new' as Route,
    configureHref: (id: string) => `/admin/image-providers/${id}` as Route,
    routingHref: '/admin/routing?tab=image' as Route,
    routingLabel: 'Image Routing Rules',
    isLocalProvider: (provider) => provider.provider === 'comfyui',
    providerTypeLabel: (providerType) => {
      switch (providerType) {
        case 'comfyui':
          return 'ComfyUI';
        case 'fal':
          return 'FAL.ai';
        default:
          return providerType;
      }
    },
  },
  video: {
    kind: 'video',
    title: 'Video Providers',
    description: 'Configure video generation providers (FAL.ai)',
    icon: Video,
    iconClasses: {
      overviewBg: 'bg-blue-500/10',
      overviewText: 'text-blue-500',
      listIconText: 'text-blue-500',
      listIconBg: 'bg-blue-500/10',
    },
    addHref: '/admin/video-providers/new' as Route,
    configureHref: (id: string) => `/admin/video-providers/${id}` as Route,
    routingHref: '/admin/routing?tab=video' as Route,
    routingLabel: 'Video Routing Rules',
    isLocalProvider: () => false,
    providerTypeLabel: (providerType) => {
      switch (providerType) {
        case 'fal_video':
          return 'FAL.ai';
        case 'replicate_video':
          return 'Replicate';
        case 'runway':
          return 'Runway';
        default:
          return providerType;
      }
    },
  },
};

function ProviderTabContent({
  config,
  providers,
  loading,
  onRefresh,
  onTestConnection,
  onToggleEnabled,
  onDeleteProvider,
  testingProviderId,
  testResults,
}: {
  config: ProviderTabConfig;
  providers: ProviderBase[];
  loading: boolean;
  onRefresh: () => void;
  onTestConnection: (providerId: string) => Promise<void>;
  onToggleEnabled: (providerId: string, isEnabled: boolean) => Promise<void>;
  onDeleteProvider: (providerId: string) => Promise<void>;
  testingProviderId: string | null;
  testResults: Record<string, ConnectionTestResult>;
}) {
  const Icon = config.icon;
  const [updatingProviderId, setUpdatingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [actionErrorByProviderId, setActionErrorByProviderId] = useState<Record<string, string>>({});

  const canTest = (provider: ProviderBase) => provider.hasApiKey || config.isLocalProvider(provider);

  const getHealthStatus = (provider: ProviderBase) => {
    if (!canTest(provider)) return 'not_configured';
    const testResult = testResults[provider.id];
    if (testResult) return testResult.success ? 'online' : 'offline';
    if (provider.health) return provider.health.isAvailable ? 'online' : 'offline';
    return 'unknown';
  };

  const getHealthBadge = (provider: ProviderBase) => {
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
        return <Badge variant="destructive">Offline</Badge>;
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

  const handleToggleEnabled = async (providerId: string, isEnabled: boolean) => {
    setActionErrorByProviderId((prev) => {
      if (!prev[providerId]) return prev;
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setUpdatingProviderId(providerId);
    try {
      await onToggleEnabled(providerId, isEnabled);
    } catch (e) {
      setActionErrorByProviderId((prev) => ({
        ...prev,
        [providerId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setUpdatingProviderId((prev) => (prev === providerId ? null : prev));
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    setActionErrorByProviderId((prev) => {
      if (!prev[providerId]) return prev;
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setDeletingProviderId(providerId);
    try {
      await onDeleteProvider(providerId);
    } catch (e) {
      setActionErrorByProviderId((prev) => ({
        ...prev,
        [providerId]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setDeletingProviderId((prev) => (prev === providerId ? null : prev));
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">{config.title}</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="bg-white/[0.02] border-white/5">
              <CardContent className="p-6">
                <div className="animate-pulse h-16 bg-white/5 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="animate-pulse h-64 bg-white/5 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const enabledProviders = providers.filter((p) => p.isEnabled).length;
  const configuredProviders = providers.filter((p) => canTest(p)).length;
  const healthyProviders = providers.filter((p) => canTest(p) && p.health?.isAvailable).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{config.title}</h2>
          <p className="text-gray-400 text-sm mt-1">{config.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Link href={config.addHref}>
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
              <div className={cn('p-2 rounded-lg', config.iconClasses.overviewBg, config.iconClasses.overviewText)}>
                <Icon className="h-5 w-5" />
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
              <div
                className={cn(
                  'p-2 rounded-lg',
                  healthyProviders > 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                )}
              >
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Healthy</p>
                <p className="text-lg font-semibold text-white">
                  {healthyProviders}/{providers.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider List */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Icon className={cn('h-5 w-5', config.iconClasses.listIconText)} />
            Provider Configurations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No providers configured yet. Add a provider to get started.
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
                      <div
                        className={cn(
                          'p-3 rounded-lg',
                          provider.isEnabled ? config.iconClasses.listIconBg : 'bg-gray-500/10'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-6 w-6',
                            provider.isEnabled ? config.iconClasses.listIconText : 'text-gray-500'
                          )}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-white">{provider.displayName}</h3>
                          {!provider.isEnabled && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                        </div>
                        <p className={cn('text-sm text-gray-400', config.kind === 'text' && 'capitalize')}>
                          {config.providerTypeLabel(provider.provider)}
                        </p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                          <span>
                            {provider.modelCount} model{provider.modelCount !== 1 ? 's' : ''}
                          </span>
                          {provider.rateLimitRpm && <span>{provider.rateLimitRpm} RPM</span>}
                          {provider.hasApiKey ? (
                            <span className="text-green-500">API key configured</span>
                          ) : config.isLocalProvider(provider) ? (
                            <span className="text-blue-500">Local provider</span>
                          ) : (
                            <span className="text-amber-500">No API key</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1">
                        <span className="text-xs text-gray-400">Enabled</span>
                        <Switch
                          checked={provider.isEnabled}
                          onCheckedChange={(checked) => handleToggleEnabled(provider.id, checked)}
                          disabled={updatingProviderId === provider.id || deletingProviderId === provider.id}
                        />
                      </div>

                      {getHealthBadge(provider)}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onTestConnection(provider.id)}
                        disabled={testingProviderId === provider.id || !canTest(provider)}
                        className="gap-2"
                      >
                        {testingProviderId === provider.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                        Test
                      </Button>

                      <Link href={config.configureHref(provider.id)}>
                        <Button variant="outline" size="sm" className="gap-2">
                          <Settings2 className="h-4 w-4" />
                          Configure
                        </Button>
                      </Link>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:text-red-300"
                            disabled={provider.isEnabled || deletingProviderId === provider.id}
                            title={provider.isEnabled ? 'Disable this provider to delete it' : 'Delete provider'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Provider</AlertDialogTitle>
                            <AlertDialogDescription>
                              Delete <span className="font-medium">{provider.displayName}</span>? This removes the provider
                              configuration and all related models and routing rules.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteProvider(provider.id)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {testResults[provider.id]?.error && (
                    <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{testResults[provider.id].error}</p>
                    </div>
                  )}

                  {actionErrorByProviderId[provider.id] && (
                    <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20">
                      <p className="text-sm text-red-400">{actionErrorByProviderId[provider.id]}</p>
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
          <Link href={config.routingHref}>
            <Button variant="outline" className="gap-2">
              <Settings2 className="h-4 w-4" />
              {config.routingLabel}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProvidersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<ProviderKind>(() => normalizeProviderTab(tabParam));

  const [loading, setLoading] = useState<Record<ProviderKind, boolean>>({
    text: true,
    image: true,
    video: true,
  });

  const [textProviders, setTextProviders] = useState<Provider[]>([]);
  const [imageProviders, setImageProviders] = useState<ImageProvider[]>([]);
  const [videoProviders, setVideoProviders] = useState<VideoProvider[]>([]);

  const [testingProviderId, setTestingProviderId] = useState<Record<ProviderKind, string | null>>({
    text: null,
    image: null,
    video: null,
  });

  const [testResults, setTestResults] = useState<Record<ProviderKind, Record<string, ConnectionTestResult>>>({
    text: {},
    image: {},
    video: {},
  });

  const fetchAll = useCallback(async () => {
    setLoading({ text: true, image: true, video: true });
    const results = await Promise.allSettled([
      listProviders(),
      listImageProviders(),
      listVideoProviders(),
    ]);

    const [text, image, video] = results;

    if (text.status === 'fulfilled') setTextProviders(text.value.providers);
    else console.error('Failed to fetch text providers:', text.reason);

    if (image.status === 'fulfilled') setImageProviders(image.value.providers);
    else console.error('Failed to fetch image providers:', image.reason);

    if (video.status === 'fulfilled') setVideoProviders(video.value.providers);
    else console.error('Failed to fetch video providers:', video.reason);

    setLoading({ text: false, image: false, video: false });
  }, []);

  const refreshKind = useCallback(async (kind: ProviderKind) => {
    setLoading((prev) => ({ ...prev, [kind]: true }));
    try {
      if (kind === 'text') {
        const response = await listProviders();
        setTextProviders(response.providers);
        return;
      }
      if (kind === 'image') {
        const response = await listImageProviders();
        setImageProviders(response.providers);
        return;
      }
      const response = await listVideoProviders();
      setVideoProviders(response.providers);
    } catch (error) {
      console.error(`Failed to refresh ${kind} providers:`, error);
    } finally {
      setLoading((prev) => ({ ...prev, [kind]: false }));
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    setActiveTab(normalizeProviderTab(tabParam));
  }, [tabParam]);

  const onTabChange = (value: string) => {
    const nextTab = normalizeProviderTab(value);
    setActiveTab(nextTab);

    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === 'text') params.delete('tab');
    else params.set('tab', nextTab);
    const query = params.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Route);
  };

  const handleTestConnection = useCallback(async (kind: ProviderKind, providerId: string) => {
    setTestingProviderId((prev) => ({ ...prev, [kind]: providerId }));
    try {
      const result =
        kind === 'text'
          ? await testProviderConnection(providerId)
          : kind === 'image'
            ? await testImageProviderConnection(providerId)
            : await testVideoProviderConnection(providerId);

      setTestResults((prev) => ({
        ...prev,
        [kind]: {
          ...prev[kind],
          [providerId]: result,
        },
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [kind]: {
          ...prev[kind],
          [providerId]: { success: false, latencyMs: null, error: 'Failed to test connection' },
        },
      }));
    } finally {
      setTestingProviderId((prev) => ({ ...prev, [kind]: null }));
    }
  }, []);

  const handleToggleEnabled = useCallback(async (kind: ProviderKind, providerId: string, isEnabled: boolean) => {
    if (kind === 'text') {
      const updated = await updateProvider(providerId, { isEnabled });
      setTextProviders((prev) => prev.map((p) => (p.id === providerId ? updated : p)));
      return;
    }
    if (kind === 'image') {
      const updated = await updateImageProvider(providerId, { isEnabled });
      setImageProviders((prev) => prev.map((p) => (p.id === providerId ? updated : p)));
      return;
    }
    const updated = await updateVideoProvider(providerId, { isEnabled });
    setVideoProviders((prev) => prev.map((p) => (p.id === providerId ? updated : p)));
  }, []);

  const handleDeleteProvider = useCallback(async (kind: ProviderKind, providerId: string) => {
    if (kind === 'text') {
      const provider = textProviders.find((p) => p.id === providerId);
      if (provider?.isEnabled) throw new Error('Disable this provider before deleting it.');
      await deleteProvider(providerId);
      setTextProviders((prev) => prev.filter((p) => p.id !== providerId));
      setTestResults((prev) => {
        const next = { ...prev, text: { ...prev.text } };
        delete next.text[providerId];
        return next;
      });
      return;
    }
    if (kind === 'image') {
      const provider = imageProviders.find((p) => p.id === providerId);
      if (provider?.isEnabled) throw new Error('Disable this provider before deleting it.');
      await deleteImageProvider(providerId);
      setImageProviders((prev) => prev.filter((p) => p.id !== providerId));
      setTestResults((prev) => {
        const next = { ...prev, image: { ...prev.image } };
        delete next.image[providerId];
        return next;
      });
      return;
    }
    const provider = videoProviders.find((p) => p.id === providerId);
    if (provider?.isEnabled) throw new Error('Disable this provider before deleting it.');
    await deleteVideoProvider(providerId);
    setVideoProviders((prev) => prev.filter((p) => p.id !== providerId));
    setTestResults((prev) => {
      const next = { ...prev, video: { ...prev.video } };
      delete next.video[providerId];
      return next;
    });
  }, [imageProviders, textProviders, videoProviders]);

  const tabCounts = useMemo(() => {
    const getCount = (kind: ProviderKind) => (loading[kind] ? null : kind === 'text' ? textProviders.length : kind === 'image' ? imageProviders.length : videoProviders.length);
    return {
      text: getCount('text'),
      image: getCount('image'),
      video: getCount('video'),
    };
  }, [imageProviders.length, loading, textProviders.length, videoProviders.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers</h1>
          <p className="text-gray-400 text-sm mt-1">
            Configure providers for text, image, and video inference
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 gap-1 md:gap-2 bg-white/5 border border-white/10 h-12 md:h-14 p-1">
          <TabsTrigger value="text" className="gap-2 md:gap-3 px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base data-[state=inactive]:hover:bg-white/5 data-[state=inactive]:hover:text-white">
            <Server className="h-5 w-5 md:h-6 md:w-6" />
            Text
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300 text-xs md:text-sm">
              {tabCounts.text ?? '-'}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="image" className="gap-2 md:gap-3 px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base data-[state=inactive]:hover:bg-white/5 data-[state=inactive]:hover:text-white">
            <Image className="h-5 w-5 md:h-6 md:w-6" />
            Image
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300 text-xs md:text-sm">
              {tabCounts.image ?? '-'}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="video" className="gap-2 md:gap-3 px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base data-[state=inactive]:hover:bg-white/5 data-[state=inactive]:hover:text-white">
            <Video className="h-5 w-5 md:h-6 md:w-6" />
            Video
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300 text-xs md:text-sm">
              {tabCounts.video ?? '-'}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <ProviderTabContent
            config={PROVIDER_TABS.text}
            providers={textProviders as unknown as ProviderBase[]}
            loading={loading.text}
            onRefresh={() => refreshKind('text')}
            onTestConnection={(providerId) => handleTestConnection('text', providerId)}
            onToggleEnabled={(providerId, enabled) => handleToggleEnabled('text', providerId, enabled)}
            onDeleteProvider={(providerId) => handleDeleteProvider('text', providerId)}
            testingProviderId={testingProviderId.text}
            testResults={testResults.text}
          />
        </TabsContent>

        <TabsContent value="image">
          <ProviderTabContent
            config={PROVIDER_TABS.image}
            providers={imageProviders as unknown as ProviderBase[]}
            loading={loading.image}
            onRefresh={() => refreshKind('image')}
            onTestConnection={(providerId) => handleTestConnection('image', providerId)}
            onToggleEnabled={(providerId, enabled) => handleToggleEnabled('image', providerId, enabled)}
            onDeleteProvider={(providerId) => handleDeleteProvider('image', providerId)}
            testingProviderId={testingProviderId.image}
            testResults={testResults.image}
          />
        </TabsContent>

        <TabsContent value="video">
          <ProviderTabContent
            config={PROVIDER_TABS.video}
            providers={videoProviders as unknown as ProviderBase[]}
            loading={loading.video}
            onRefresh={() => refreshKind('video')}
            onTestConnection={(providerId) => handleTestConnection('video', providerId)}
            onToggleEnabled={(providerId, enabled) => handleToggleEnabled('video', providerId, enabled)}
            onDeleteProvider={(providerId) => handleDeleteProvider('video', providerId)}
            testingProviderId={testingProviderId.video}
            testResults={testResults.video}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

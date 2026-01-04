'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Image,
  ArrowLeft,
  Save,
  RefreshCw,
  Zap,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  getImageProvider,
  updateImageProvider,
  deleteImageProvider,
  testImageProviderConnection,
  createImageModel,
  updateImageModel,
  deleteImageModel,
  IMAGE_CAPABILITY_LABELS,
  type ImageProviderWithModels,
  type ImageModel,
  type UpdateImageProviderInput,
  type CreateImageModelInput,
  type UpdateImageModelInput,
  type ImageModelCapability,
} from '@/lib/api/image-providers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const CAPABILITY_OPTIONS: { value: ImageModelCapability; label: string; description: string }[] = [
  { value: 'nsfw', label: 'NSFW', description: 'Can generate adult content' },
  { value: 'ip_adapter', label: 'IP-Adapter', description: 'Supports reference image guidance' },
  { value: 'inpainting', label: 'Inpainting', description: 'Can edit parts of images' },
  { value: 'controlnet', label: 'ControlNet', description: 'Supports pose/edge control' },
];

export default function ImageProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.providerId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs: number | null; error: string | null } | null>(null);
  const [provider, setProvider] = useState<ImageProviderWithModels | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [isEnabled, setIsEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [rateLimitRpm, setRateLimitRpm] = useState<number | ''>('');
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState<number | ''>(10);
  const [priority, setPriority] = useState<number | ''>(0);

  // Model dialog state
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ImageModel | null>(null);
  const [modelForm, setModelForm] = useState<{
    modelId: string;
    displayName: string;
    isEnabled: boolean;
    maxResolutionWidth: number | '';
    maxResolutionHeight: number | '';
    costPerImage: number | '';
    avgGenerationTime: number | '';
    capabilities: ImageModelCapability[];
  }>({
    modelId: '',
    displayName: '',
    isEnabled: true,
    maxResolutionWidth: 1024,
    maxResolutionHeight: 1024,
    costPerImage: '',
    avgGenerationTime: '',
    capabilities: [],
  });

  const fetchData = useCallback(async () => {
    try {
      const data = await getImageProvider(providerId);
      setProvider(data);
      setDisplayName(data.displayName);
      setIsEnabled(data.isEnabled);
      setApiBaseUrl(data.apiBaseUrl || '');
      setRateLimitRpm(data.rateLimitRpm ?? '');
      setMaxConcurrentRequests(data.maxConcurrentRequests);
      setPriority(data.priority);
    } catch (error) {
      console.error('Failed to fetch image provider:', error);
    } finally {
      setIsLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const input: UpdateImageProviderInput = {
        displayName,
        isEnabled,
        apiBaseUrl: apiBaseUrl || null,
        rateLimitRpm: rateLimitRpm === '' ? null : rateLimitRpm,
        maxConcurrentRequests: maxConcurrentRequests === '' ? 10 : maxConcurrentRequests,
        priority: priority === '' ? 0 : priority,
      };

      if (apiKey) {
        input.apiKey = apiKey;
      }

      await updateImageProvider(providerId, input);
      setApiKey(''); // Clear after saving
      await fetchData();
    } catch (error) {
      console.error('Failed to save image provider:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testImageProviderConnection(providerId);
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, latencyMs: null, error: 'Failed to test connection' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteImageProvider(providerId);
      router.push('/admin/image-providers' as Route);
    } catch (error) {
      console.error('Failed to delete image provider:', error);
    }
  };

  const resetModelForm = () => {
    setModelForm({
      modelId: '',
      displayName: '',
      isEnabled: true,
      maxResolutionWidth: 1024,
      maxResolutionHeight: 1024,
      costPerImage: '',
      avgGenerationTime: '',
      capabilities: [],
    });
    setEditingModel(null);
  };

  const openModelDialog = (model?: ImageModel) => {
    if (model) {
      setEditingModel(model);
      setModelForm({
        modelId: model.modelId,
        displayName: model.displayName,
        isEnabled: model.isEnabled,
        maxResolutionWidth: model.maxResolution?.[0] ?? 1024,
        maxResolutionHeight: model.maxResolution?.[1] ?? 1024,
        costPerImage: model.costPerImage ?? '',
        avgGenerationTime: model.avgGenerationTime ?? '',
        capabilities: model.capabilities,
      });
    } else {
      resetModelForm();
    }
    setIsModelDialogOpen(true);
  };

  const handleSaveModel = async () => {
    try {
      const maxResolution: [number, number] | null =
        modelForm.maxResolutionWidth && modelForm.maxResolutionHeight
          ? [modelForm.maxResolutionWidth as number, modelForm.maxResolutionHeight as number]
          : null;

      if (editingModel) {
        const input: UpdateImageModelInput = {
          displayName: modelForm.displayName,
          isEnabled: modelForm.isEnabled,
          maxResolution,
          costPerImage: modelForm.costPerImage === '' ? null : modelForm.costPerImage,
          avgGenerationTime: modelForm.avgGenerationTime === '' ? null : modelForm.avgGenerationTime,
          capabilities: modelForm.capabilities,
        };
        await updateImageModel(editingModel.id, input);
      } else {
        const input: CreateImageModelInput = {
          modelId: modelForm.modelId,
          displayName: modelForm.displayName,
          isEnabled: modelForm.isEnabled,
          maxResolution,
          costPerImage: modelForm.costPerImage === '' ? null : modelForm.costPerImage,
          avgGenerationTime: modelForm.avgGenerationTime === '' ? null : modelForm.avgGenerationTime,
          capabilities: modelForm.capabilities,
        };
        await createImageModel(providerId, input);
      }
      setIsModelDialogOpen(false);
      resetModelForm();
      await fetchData();
    } catch (error) {
      console.error('Failed to save image model:', error);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await deleteImageModel(modelId);
      await fetchData();
    } catch (error) {
      console.error('Failed to delete image model:', error);
    }
  };

  const toggleCapability = (capability: ImageModelCapability) => {
    setModelForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability],
    }));
  };

  const getCapabilityColor = (capability: ImageModelCapability) => {
    switch (capability) {
      case 'nsfw':
        return 'bg-red-500/20 text-red-400';
      case 'ip_adapter':
        return 'bg-blue-500/20 text-blue-400';
      case 'inpainting':
        return 'bg-green-500/20 text-green-400';
      case 'controlnet':
        return 'bg-purple-500/20 text-purple-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={'/admin/image-providers' as Route}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-white">Loading...</h1>
        </div>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="animate-pulse h-64 bg-white/5 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={'/admin/image-providers' as Route}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-white">Provider Not Found</h1>
        </div>
      </div>
    );
  }

  const isLocalProvider = provider.provider === 'comfyui';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={'/admin/image-providers' as Route}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">{provider.displayName}</h1>
            <p className="text-gray-400 text-sm capitalize">{provider.provider}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting || (!provider.hasApiKey && !isLocalProvider)}
            className="gap-2"
          >
            {isTesting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Test Connection
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="gap-2 bg-campfire-600 hover:bg-campfire-700"
          >
            {isSaving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Test Result */}
      {testResult && (
        <Card className={cn(
          'border',
          testResult.success
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-red-500/5 border-red-500/20'
        )}>
          <CardContent className="p-4 flex items-center gap-3">
            {testResult.success ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-green-400">
                  Connection successful{testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-red-500" />
                <span className="text-red-400">{testResult.error || 'Connection failed'}</span>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Provider Settings */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Image className="h-5 w-5 text-purple-500" />
              Provider Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="isEnabled">Enabled</Label>
              <Switch
                id="isEnabled"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-white/5 border-white/10"
              />
            </div>

            {!isLocalProvider && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">
                  API Key
                  {provider.hasApiKey && (
                    <span className="ml-2 text-xs text-green-500">(configured)</span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider.hasApiKey ? 'Enter new key to update' : 'Enter API key'}
                    className="bg-white/5 border-white/10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="apiBaseUrl">
                {isLocalProvider ? 'Base URL' : 'API Base URL (optional)'}
              </Label>
              <Input
                id="apiBaseUrl"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder={isLocalProvider ? 'http://localhost:8188' : 'Leave empty for default'}
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rateLimitRpm">Rate Limit (RPM)</Label>
                <Input
                  id="rateLimitRpm"
                  type="number"
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(e.target.value === '' ? '' : parseInt(e.target.value))}
                  placeholder="Requests/min"
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxConcurrent">Max Concurrent</Label>
                <Input
                  id="maxConcurrent"
                  type="number"
                  value={maxConcurrentRequests}
                  onChange={(e) => setMaxConcurrentRequests(e.target.value === '' ? '' : parseInt(e.target.value))}
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority (lower = higher)</Label>
              <Input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="bg-white/5 border-white/10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="bg-red-500/5 border-red-500/20">
          <CardHeader>
            <CardTitle className="text-lg text-red-400">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-400 mb-4">
              Deleting this provider will remove all associated models and routing rules.
              This action cannot be undone.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete Provider
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Image Provider</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete {provider.displayName}? This will remove
                    all {provider.models.length} models and any routing rules using this provider.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>

      {/* Models */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg text-white">Image Models</CardTitle>
          <Dialog open={isModelDialogOpen} onOpenChange={setIsModelDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={() => openModelDialog()}>
                <Plus className="h-4 w-4" />
                Add Model
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingModel ? 'Edit Image Model' : 'Add Image Model'}</DialogTitle>
                <DialogDescription>
                  {editingModel
                    ? 'Update model configuration and capabilities.'
                    : 'Add a new image model to this provider.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="modelId">Model ID</Label>
                  <Input
                    id="modelId"
                    value={modelForm.modelId}
                    onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })}
                    placeholder="e.g., epicrealism-xl, flux-1.1-pro"
                    disabled={!!editingModel}
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="modelDisplayName">Display Name</Label>
                  <Input
                    id="modelDisplayName"
                    value={modelForm.displayName}
                    onChange={(e) => setModelForm({ ...modelForm, displayName: e.target.value })}
                    placeholder="e.g., EpicRealism XL, Flux 1.1 Pro"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="modelEnabled">Enabled</Label>
                  <Switch
                    id="modelEnabled"
                    checked={modelForm.isEnabled}
                    onCheckedChange={(checked) => setModelForm({ ...modelForm, isEnabled: checked })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="maxResWidth">Max Width (px)</Label>
                    <Input
                      id="maxResWidth"
                      type="number"
                      value={modelForm.maxResolutionWidth}
                      onChange={(e) => setModelForm({ ...modelForm, maxResolutionWidth: e.target.value === '' ? '' : parseInt(e.target.value) })}
                      placeholder="1024"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxResHeight">Max Height (px)</Label>
                    <Input
                      id="maxResHeight"
                      type="number"
                      value={modelForm.maxResolutionHeight}
                      onChange={(e) => setModelForm({ ...modelForm, maxResolutionHeight: e.target.value === '' ? '' : parseInt(e.target.value) })}
                      placeholder="1024"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="costPerImage">Cost per Image ($)</Label>
                    <Input
                      id="costPerImage"
                      type="number"
                      step="0.001"
                      value={modelForm.costPerImage}
                      onChange={(e) => setModelForm({ ...modelForm, costPerImage: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      placeholder="0.05"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="avgGenTime">Avg Gen Time (sec)</Label>
                    <Input
                      id="avgGenTime"
                      type="number"
                      step="0.1"
                      value={modelForm.avgGenerationTime}
                      onChange={(e) => setModelForm({ ...modelForm, avgGenerationTime: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      placeholder="5.0"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Capabilities</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {CAPABILITY_OPTIONS.map((cap) => (
                      <div
                        key={cap.value}
                        onClick={() => toggleCapability(cap.value)}
                        className={cn(
                          'p-3 rounded-lg border cursor-pointer transition-colors',
                          modelForm.capabilities.includes(cap.value)
                            ? 'border-campfire-500 bg-campfire-500/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Badge className={getCapabilityColor(cap.value)}>
                            {cap.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{cap.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsModelDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveModel} className="bg-campfire-600 hover:bg-campfire-700">
                  {editingModel ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {provider.models.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No models configured. Add a model to enable image generation.
            </p>
          ) : (
            <div className="space-y-3">
              {provider.models.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    'p-4 rounded-lg border',
                    model.isEnabled
                      ? 'bg-white/[0.02] border-white/10'
                      : 'bg-white/[0.01] border-white/5 opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-white">{model.displayName}</h4>
                        {!model.isEnabled && (
                          <Badge variant="secondary" className="text-xs">Disabled</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 font-mono">{model.modelId}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        {model.maxResolution && (
                          <span>{model.maxResolution[0]}x{model.maxResolution[1]}</span>
                        )}
                        {model.costPerImage != null && (
                          <span>${model.costPerImage.toFixed(3)}/img</span>
                        )}
                        {model.avgGenerationTime != null && (
                          <span>~{model.avgGenerationTime}s</span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-2">
                        {model.capabilities.map((cap) => (
                          <Badge
                            key={cap}
                            className={cn('text-xs', getCapabilityColor(cap))}
                          >
                            {IMAGE_CAPABILITY_LABELS[cap]}
                          </Badge>
                        ))}
                        {model.capabilities.length === 0 && (
                          <span className="text-xs text-gray-600">No special capabilities</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openModelDialog(model)}
                      >
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Image Model</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete {model.displayName}? Any routing rules
                              using this model will need to be updated.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteModel(model.id)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

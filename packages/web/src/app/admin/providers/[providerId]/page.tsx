'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Server,
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
  getProvider,
  updateProvider,
  deleteProvider,
  testProviderConnection,
  createModel,
  updateModel,
  deleteModel,
  type ProviderWithModels,
  type Model,
  type UpdateProviderInput,
  type CreateModelInput,
  type UpdateModelInput,
  type ModelCapability,
} from '@/lib/api/providers';
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

const CAPABILITY_OPTIONS: { value: ModelCapability; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'vision', label: 'Vision' },
  { value: 'function_calling', label: 'Function Calling' },
  { value: 'streaming', label: 'Streaming' },
  { value: 'json_mode', label: 'JSON Mode' },
];

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.providerId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs: number | null; error: string | null } | null>(null);
  const [provider, setProvider] = useState<ProviderWithModels | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [isEnabled, setIsEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [rateLimitRpm, setRateLimitRpm] = useState<number | ''>('');
  const [rateLimitTpm, setRateLimitTpm] = useState<number | ''>('');
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState<number | ''>(10);
  const [priority, setPriority] = useState<number | ''>(0);

  // Model dialog state
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [modelForm, setModelForm] = useState<{
    modelId: string;
    displayName: string;
    isEnabled: boolean;
    contextWindow: number | '';
    maxOutputTokens: number | '';
    inputCostPerMillion: number | '';
    outputCostPerMillion: number | '';
    capabilities: ModelCapability[];
  }>({
    modelId: '',
    displayName: '',
    isEnabled: true,
    contextWindow: '',
    maxOutputTokens: '',
    inputCostPerMillion: '',
    outputCostPerMillion: '',
    capabilities: ['chat', 'streaming'],
  });

  const fetchData = useCallback(async () => {
    try {
      const data = await getProvider(providerId);
      setProvider(data);
      setDisplayName(data.displayName);
      setIsEnabled(data.isEnabled);
      setApiBaseUrl(data.apiBaseUrl || '');
      setRateLimitRpm(data.rateLimitRpm ?? '');
      setRateLimitTpm(data.rateLimitTpm ?? '');
      setMaxConcurrentRequests(data.maxConcurrentRequests);
      setPriority(data.priority);
    } catch (error) {
      console.error('Failed to fetch provider:', error);
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
      const input: UpdateProviderInput = {
        displayName,
        isEnabled,
        apiBaseUrl: apiBaseUrl || null,
        rateLimitRpm: rateLimitRpm === '' ? null : rateLimitRpm,
        rateLimitTpm: rateLimitTpm === '' ? null : rateLimitTpm,
        maxConcurrentRequests: maxConcurrentRequests === '' ? 10 : maxConcurrentRequests,
        priority: priority === '' ? 0 : priority,
      };

      if (apiKey) {
        input.apiKey = apiKey;
      }

      await updateProvider(providerId, input);
      setApiKey(''); // Clear after saving
      await fetchData();
    } catch (error) {
      console.error('Failed to save provider:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testProviderConnection(providerId);
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, latencyMs: null, error: 'Failed to test connection' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProvider(providerId);
      router.push('/admin/providers' as Route);
    } catch (error) {
      console.error('Failed to delete provider:', error);
    }
  };

  const resetModelForm = () => {
    setModelForm({
      modelId: '',
      displayName: '',
      isEnabled: true,
      contextWindow: '',
      maxOutputTokens: '',
      inputCostPerMillion: '',
      outputCostPerMillion: '',
      capabilities: ['chat', 'streaming'],
    });
    setEditingModel(null);
  };

  const openModelDialog = (model?: Model) => {
    if (model) {
      setEditingModel(model);
      setModelForm({
        modelId: model.modelId,
        displayName: model.displayName,
        isEnabled: model.isEnabled,
        contextWindow: model.contextWindow ?? '',
        maxOutputTokens: model.maxOutputTokens ?? '',
        inputCostPerMillion: model.inputCostPerMillion ?? '',
        outputCostPerMillion: model.outputCostPerMillion ?? '',
        capabilities: model.capabilities,
      });
    } else {
      resetModelForm();
    }
    setIsModelDialogOpen(true);
  };

  const handleSaveModel = async () => {
    try {
      if (editingModel) {
        const input: UpdateModelInput = {
          displayName: modelForm.displayName,
          isEnabled: modelForm.isEnabled,
          contextWindow: modelForm.contextWindow === '' ? null : modelForm.contextWindow,
          maxOutputTokens: modelForm.maxOutputTokens === '' ? null : modelForm.maxOutputTokens,
          inputCostPerMillion: modelForm.inputCostPerMillion === '' ? null : modelForm.inputCostPerMillion,
          outputCostPerMillion: modelForm.outputCostPerMillion === '' ? null : modelForm.outputCostPerMillion,
          capabilities: modelForm.capabilities,
        };
        await updateModel(editingModel.id, input);
      } else {
        const input: CreateModelInput = {
          modelId: modelForm.modelId,
          displayName: modelForm.displayName,
          isEnabled: modelForm.isEnabled,
          contextWindow: modelForm.contextWindow === '' ? null : modelForm.contextWindow,
          maxOutputTokens: modelForm.maxOutputTokens === '' ? null : modelForm.maxOutputTokens,
          inputCostPerMillion: modelForm.inputCostPerMillion === '' ? null : modelForm.inputCostPerMillion,
          outputCostPerMillion: modelForm.outputCostPerMillion === '' ? null : modelForm.outputCostPerMillion,
          capabilities: modelForm.capabilities,
        };
        await createModel(providerId, input);
      }
      setIsModelDialogOpen(false);
      resetModelForm();
      await fetchData();
    } catch (error) {
      console.error('Failed to save model:', error);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await deleteModel(modelId);
      await fetchData();
    } catch (error) {
      console.error('Failed to delete model:', error);
    }
  };

  const toggleCapability = (capability: ModelCapability) => {
    setModelForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability],
    }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={'/admin/providers' as Route}>
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
          <Link href={'/admin/providers' as Route}>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={'/admin/providers' as Route}>
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
            disabled={isTesting || !provider.hasApiKey}
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
              <Server className="h-5 w-5 text-blue-500" />
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

            <div className="space-y-2">
              <Label htmlFor="apiBaseUrl">API Base URL (optional)</Label>
              <Input
                id="apiBaseUrl"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="Leave empty for default"
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
                <Label htmlFor="rateLimitTpm">Rate Limit (TPM)</Label>
                <Input
                  id="rateLimitTpm"
                  type="number"
                  value={rateLimitTpm}
                  onChange={(e) => setRateLimitTpm(e.target.value === '' ? '' : parseInt(e.target.value))}
                  placeholder="Tokens/min"
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                  <AlertDialogTitle>Delete Provider</AlertDialogTitle>
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
          <CardTitle className="text-lg text-white">Models</CardTitle>
          <Dialog open={isModelDialogOpen} onOpenChange={setIsModelDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={() => openModelDialog()}>
                <Plus className="h-4 w-4" />
                Add Model
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingModel ? 'Edit Model' : 'Add Model'}</DialogTitle>
                <DialogDescription>
                  {editingModel
                    ? 'Update model configuration and pricing.'
                    : 'Add a new model to this provider.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="modelId">Model ID</Label>
                  <Input
                    id="modelId"
                    value={modelForm.modelId}
                    onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })}
                    placeholder="e.g., gpt-4o, claude-3-opus"
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
                    placeholder="e.g., GPT-4o, Claude 3 Opus"
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
                    <Label htmlFor="contextWindow">Context Window</Label>
                    <Input
                      id="contextWindow"
                      type="number"
                      value={modelForm.contextWindow}
                      onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value === '' ? '' : parseInt(e.target.value) })}
                      placeholder="e.g., 128000"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxOutput">Max Output Tokens</Label>
                    <Input
                      id="maxOutput"
                      type="number"
                      value={modelForm.maxOutputTokens}
                      onChange={(e) => setModelForm({ ...modelForm, maxOutputTokens: e.target.value === '' ? '' : parseInt(e.target.value) })}
                      placeholder="e.g., 4096"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="inputCost">Input Cost ($/1M tokens)</Label>
                    <Input
                      id="inputCost"
                      type="number"
                      step="0.01"
                      value={modelForm.inputCostPerMillion}
                      onChange={(e) => setModelForm({ ...modelForm, inputCostPerMillion: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      placeholder="e.g., 2.50"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="outputCost">Output Cost ($/1M tokens)</Label>
                    <Input
                      id="outputCost"
                      type="number"
                      step="0.01"
                      value={modelForm.outputCostPerMillion}
                      onChange={(e) => setModelForm({ ...modelForm, outputCostPerMillion: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      placeholder="e.g., 10.00"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Capabilities</Label>
                  <div className="flex flex-wrap gap-2">
                    {CAPABILITY_OPTIONS.map((cap) => (
                      <Badge
                        key={cap.value}
                        variant={modelForm.capabilities.includes(cap.value) ? 'default' : 'secondary'}
                        className={cn(
                          'cursor-pointer',
                          modelForm.capabilities.includes(cap.value)
                            ? 'bg-campfire-500/20 text-campfire-500 hover:bg-campfire-500/30'
                            : 'bg-white/5 text-gray-400 hover:bg-white/10'
                        )}
                        onClick={() => toggleCapability(cap.value)}
                      >
                        {cap.label}
                      </Badge>
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
              No models configured. Add a model to enable routing.
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
                        {model.contextWindow && (
                          <span>{model.contextWindow.toLocaleString()} ctx</span>
                        )}
                        {model.inputCostPerMillion != null && (
                          <span>${model.inputCostPerMillion}/M in</span>
                        )}
                        {model.outputCostPerMillion != null && (
                          <span>${model.outputCostPerMillion}/M out</span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-2">
                        {model.capabilities.map((cap) => (
                          <Badge
                            key={cap}
                            variant="secondary"
                            className="text-xs bg-white/5 text-gray-400"
                          >
                            {cap.replace('_', ' ')}
                          </Badge>
                        ))}
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
                            <AlertDialogTitle>Delete Model</AlertDialogTitle>
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

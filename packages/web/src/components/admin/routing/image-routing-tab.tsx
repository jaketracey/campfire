'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  GitBranch,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Settings2,
  Zap,
  Image,
} from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  listImageRoutingRules,
  listImageModels,
  listImageProviders,
  createImageRoutingRule,
  updateImageRoutingRule,
  deleteImageRoutingRule,
  syncImageConfig,
  IMAGE_USE_CASE_TYPES,
  IMAGE_USE_CASE_LABELS,
  IMAGE_USE_CASE_DESCRIPTIONS,
  IMAGE_CAPABILITY_LABELS,
  type ImageUseCaseType,
  type ImageRoutingRule,
  type ImageModelWithProvider,
  type ImageProvider,
  type CreateImageRoutingRuleInput,
  type UpdateImageRoutingRuleInput,
  type ImageSyncResult,
  type ImageModelCapability,
} from '@/lib/api/image-providers';
import { ImageModelSelector } from '@/components/admin/image-model-selector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Slider } from '@/components/ui/slider';
import { PromptTemplatesPanel } from '@/components/admin/prompt-templates/prompt-templates-panel';

export function ImageRoutingTab() {
  const [isLoading, setIsLoading] = useState(true);
  const [rules, setRules] = useState<ImageRoutingRule[]>([]);
  const [models, setModels] = useState<ImageModelWithProvider[]>([]);
  const [providers, setProviders] = useState<ImageProvider[]>([]);
  const [activeTab, setActiveTab] = useState<ImageUseCaseType>('image_generation');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<ImageSyncResult | null>(null);

  // Rule dialog state
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ImageRoutingRule | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    useCase: ImageUseCaseType;
    tier: number;
    modelConfigId: string;
    weight: number;
    isEnabled: boolean;
    maxRetries: number;
    timeoutMs: number;
  }>({
    useCase: 'image_generation',
    tier: 1,
    modelConfigId: '',
    weight: 100,
    isEnabled: true,
    maxRetries: 2,
    timeoutMs: 60000,
  });

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, modelsRes, providersRes] = await Promise.all([
        listImageRoutingRules(),
        listImageModels(),
        listImageProviders({ isEnabled: true }),
      ]);
      setRules(rulesRes.rules);
      setModels(modelsRes.models);
      setProviders(providersRes.providers);
    } catch (error) {
      console.error('Failed to fetch image routing data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getRulesForUseCase = (useCase: ImageUseCaseType) => {
    return rules
      .filter((r) => r.useCase === useCase)
      .sort((a, b) => a.tier - b.tier || b.weight - a.weight);
  };

  const getTierRules = (useCase: ImageUseCaseType, tier: number) => {
    return rules
      .filter((r) => r.useCase === useCase && r.tier === tier)
      .sort((a, b) => b.weight - a.weight);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncImageConfig();
      setSyncResult(result);
      if (result.success) {
        await fetchData();
      }
    } catch (error) {
      setSyncResult({ success: false, synced: { providers: 0, models: 0, rules: 0 }, error: 'Failed to sync with orchestrator' });
    } finally {
      setIsSyncing(false);
    }
  };

  const resetRuleForm = () => {
    setRuleForm({
      useCase: activeTab,
      tier: 1,
      modelConfigId: '',
      weight: 100,
      isEnabled: true,
      maxRetries: 2,
      timeoutMs: 60000,
    });
    setEditingRule(null);
  };

  const openRuleDialog = (rule?: ImageRoutingRule) => {
    if (rule) {
      setEditingRule(rule);
      setRuleForm({
        useCase: rule.useCase,
        tier: rule.tier,
        modelConfigId: rule.modelConfigId,
        weight: rule.weight,
        isEnabled: rule.isEnabled,
        maxRetries: rule.maxRetries,
        timeoutMs: rule.timeoutMs,
      });
    } else {
      resetRuleForm();
      setRuleForm((prev) => ({ ...prev, useCase: activeTab }));
    }
    setIsRuleDialogOpen(true);
  };

  const handleSaveRule = async () => {
    try {
      if (editingRule) {
        const input: UpdateImageRoutingRuleInput = {
          tier: ruleForm.tier,
          weight: ruleForm.weight,
          isEnabled: ruleForm.isEnabled,
          maxRetries: ruleForm.maxRetries,
          timeoutMs: ruleForm.timeoutMs,
        };
        await updateImageRoutingRule(editingRule.id, input);
      } else {
        const input: CreateImageRoutingRuleInput = {
          useCase: ruleForm.useCase,
          tier: ruleForm.tier,
          modelConfigId: ruleForm.modelConfigId,
          weight: ruleForm.weight,
          isEnabled: ruleForm.isEnabled,
          maxRetries: ruleForm.maxRetries,
          timeoutMs: ruleForm.timeoutMs,
        };
        await createImageRoutingRule(input);
      }
      setIsRuleDialogOpen(false);
      resetRuleForm();
      await fetchData();
    } catch (error) {
      console.error('Failed to save image routing rule:', error);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteImageRoutingRule(ruleId);
      await fetchData();
    } catch (error) {
      console.error('Failed to delete image routing rule:', error);
    }
  };

  const handleToggleRule = async (rule: ImageRoutingRule) => {
    try {
      await updateImageRoutingRule(rule.id, { isEnabled: !rule.isEnabled });
      await fetchData();
    } catch (error) {
      console.error('Failed to toggle image routing rule:', error);
    }
  };

  const getUseCaseIcon = (useCase: ImageUseCaseType) => {
    switch (useCase) {
      case 'image_generation':
        return '🎨';
      case 'image_anchor':
        return '🎯';
      case 'image_variation':
        return '🔄';
      case 'gift_image':
        return '🎁';
      default:
        return '📷';
    }
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
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Image Routing</h2>
        </div>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="animate-pulse h-64 bg-white/5 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const useCasesWithRules = new Set(rules.map((r) => r.useCase));
  const unconfiguredUseCases = IMAGE_USE_CASE_TYPES.filter((uc) => !useCasesWithRules.has(uc));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Image Routing Configuration</h2>
          <p className="text-gray-400 text-sm mt-1">
            Configure model routing for different image generation use cases
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={'/admin/providers?tab=image' as Route}>
            <Button variant="outline" size="sm" className="gap-2">
              <Image className="h-4 w-4" />
              Image Providers
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="gap-2 bg-campfire-600 hover:bg-campfire-700"
          >
            {isSyncing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Sync to Orchestrator
          </Button>
        </div>
      </div>

      {/* Sync Result */}
      {syncResult && (
        <Card className={cn(
          'border',
          syncResult.success
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-red-500/5 border-red-500/20'
        )}>
          <CardContent className="p-4 flex items-center gap-3">
            {syncResult.success ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-green-400">
                  Configuration synced: {syncResult.synced.providers} providers, {syncResult.synced.models} models, {syncResult.synced.rules} rules
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-red-500" />
                <span className="text-red-400">{syncResult.error}</span>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Unconfigured Use Cases Warning */}
      {unconfiguredUseCases.length > 0 && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <p className="font-medium text-amber-400">Unconfigured Use Cases</p>
                <p className="text-sm text-gray-400 mt-1">
                  The following image use cases have no routing rules configured:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {unconfiguredUseCases.map((uc) => (
                    <Badge key={uc} variant="secondary" className="bg-amber-500/10 text-amber-400">
                      {IMAGE_USE_CASE_LABELS[uc]}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Use Case Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ImageUseCaseType)}>
        <TabsList className="bg-white/5 border border-white/10 p-1 flex-wrap h-auto">
          {IMAGE_USE_CASE_TYPES.map((useCase) => {
            const hasRules = useCasesWithRules.has(useCase);
            return (
              <TabsTrigger
                key={useCase}
                value={useCase}
                className={cn(
                  'gap-2 data-[state=active]:bg-campfire-500/20 data-[state=active]:text-campfire-500',
                  !hasRules && 'opacity-50'
                )}
              >
                <span>{getUseCaseIcon(useCase)}</span>
                {IMAGE_USE_CASE_LABELS[useCase]}
                {hasRules && (
                  <Badge variant="secondary" className="ml-1 text-xs bg-white/10">
                    {getRulesForUseCase(useCase).length}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {IMAGE_USE_CASE_TYPES.map((useCase) => (
          <TabsContent key={useCase} value={useCase} className="mt-6">
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg text-white flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-purple-500" />
                    {IMAGE_USE_CASE_LABELS[useCase]} Routing
                  </CardTitle>
                  <p className="text-sm text-gray-400 mt-1">
                    {IMAGE_USE_CASE_DESCRIPTIONS[useCase]}
                  </p>
                </div>
                <Button size="sm" className="gap-2" onClick={() => openRuleDialog()}>
                  <Plus className="h-4 w-4" />
                  Add Rule
                </Button>
              </CardHeader>
              <CardContent>
                {getRulesForUseCase(useCase).length === 0 ? (
                  <div className="text-center py-12">
                    <GitBranch className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400 mb-4">
                      No routing rules configured for {IMAGE_USE_CASE_LABELS[useCase]}.
                    </p>
                    <Button onClick={() => openRuleDialog()} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add First Rule
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Tier 1: Primary */}
                    <ImageTierSection
                      tier={1}
                      label="Primary"
                      description="First choice for image requests"
                      rules={getTierRules(useCase, 1)}
                      onEdit={openRuleDialog}
                      onDelete={handleDeleteRule}
                      onToggle={handleToggleRule}
                      getCapabilityColor={getCapabilityColor}
                    />

                    {/* Arrow between tiers */}
                    {getTierRules(useCase, 2).length > 0 && (
                      <div className="flex items-center justify-center gap-2 text-gray-500">
                        <div className="h-px w-16 bg-gray-700" />
                        <ChevronRight className="h-4 w-4" />
                        <span className="text-xs">Fallback</span>
                        <ChevronRight className="h-4 w-4" />
                        <div className="h-px w-16 bg-gray-700" />
                      </div>
                    )}

                    {/* Tier 2: Secondary */}
                    {getTierRules(useCase, 2).length > 0 && (
                      <ImageTierSection
                        tier={2}
                        label="Secondary"
                        description="Fallback if primary fails"
                        rules={getTierRules(useCase, 2)}
                        onEdit={openRuleDialog}
                        onDelete={handleDeleteRule}
                        onToggle={handleToggleRule}
                        getCapabilityColor={getCapabilityColor}
                      />
                    )}

                    {/* Arrow between tiers */}
                    {getTierRules(useCase, 3).length > 0 && (
                      <div className="flex items-center justify-center gap-2 text-gray-500">
                        <div className="h-px w-16 bg-gray-700" />
                        <ChevronRight className="h-4 w-4" />
                        <span className="text-xs">Fallback</span>
                        <ChevronRight className="h-4 w-4" />
                        <div className="h-px w-16 bg-gray-700" />
                      </div>
                    )}

                    {/* Tier 3: Tertiary */}
                    {getTierRules(useCase, 3).length > 0 && (
                      <ImageTierSection
                        tier={3}
                        label="Tertiary"
                        description="Last resort fallback"
                        rules={getTierRules(useCase, 3)}
                        onEdit={openRuleDialog}
                        onDelete={handleDeleteRule}
                        onToggle={handleToggleRule}
                        getCapabilityColor={getCapabilityColor}
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Rule Dialog */}
      <Dialog open={isRuleDialogOpen} onOpenChange={setIsRuleDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Image Routing Rule' : 'Add Image Routing Rule'}</DialogTitle>
            <DialogDescription>
              {editingRule
                ? 'Update the routing rule configuration.'
                : 'Add a new routing rule for this image use case.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editingRule && (
              <ImageModelSelector
                providers={providers}
                models={models}
                value={ruleForm.modelConfigId}
                onChange={(v) => setRuleForm({ ...ruleForm, modelConfigId: v })}
                onModelAdded={fetchData}
              />
            )}

            <div className="space-y-2">
              <Label>Tier</Label>
              <Select
                value={ruleForm.tier.toString()}
                onValueChange={(v) => setRuleForm({ ...ruleForm, tier: parseInt(v) })}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tier 1 (Primary)</SelectItem>
                  <SelectItem value="2">Tier 2 (Secondary)</SelectItem>
                  <SelectItem value="3">Tier 3 (Tertiary)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Weight</Label>
                <span className="text-sm text-gray-400">{ruleForm.weight}%</span>
              </div>
              <Slider
                value={[ruleForm.weight]}
                onValueChange={([v]) => setRuleForm({ ...ruleForm, weight: v })}
                min={0}
                max={100}
                step={5}
                className="py-2"
              />
              <p className="text-xs text-gray-500">
                Higher weight = more traffic within the tier
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch
                checked={ruleForm.isEnabled}
                onCheckedChange={(checked) => setRuleForm({ ...ruleForm, isEnabled: checked })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max Retries</Label>
                <Input
                  type="number"
                  value={ruleForm.maxRetries}
                  onChange={(e) => setRuleForm({ ...ruleForm, maxRetries: parseInt(e.target.value) || 0 })}
                  min={0}
                  max={5}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  value={ruleForm.timeoutMs}
                  onChange={(e) => setRuleForm({ ...ruleForm, timeoutMs: parseInt(e.target.value) || 60000 })}
                  min={5000}
                  max={300000}
                  step={1000}
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRuleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveRule}
              disabled={!editingRule && !ruleForm.modelConfigId}
              className="bg-campfire-600 hover:bg-campfire-700"
            >
              {editingRule ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Image Tier Section Component
function ImageTierSection({
  tier,
  label,
  description,
  rules,
  onEdit,
  onDelete,
  onToggle,
  getCapabilityColor,
}: {
  tier: number;
  label: string;
  description: string;
  rules: ImageRoutingRule[];
  onEdit: (rule: ImageRoutingRule) => void;
  onDelete: (id: string) => void;
  onToggle: (rule: ImageRoutingRule) => void;
  getCapabilityColor: (cap: ImageModelCapability) => string;
}) {
  const totalWeight = rules.filter((r) => r.isEnabled).reduce((sum, r) => sum + r.weight, 0);

  return (
    <div className={cn(
      'p-4 rounded-lg border',
      tier === 1 ? 'bg-green-500/5 border-green-500/20' :
      tier === 2 ? 'bg-amber-500/5 border-amber-500/20' :
      'bg-red-500/5 border-red-500/20'
    )}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className={cn(
            'font-medium',
            tier === 1 ? 'text-green-400' :
            tier === 2 ? 'text-amber-400' :
            'text-red-400'
          )}>
            {label}
          </h4>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
        <Badge variant="secondary" className="bg-white/10">
          {rules.length} model{rules.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="space-y-2">
        {rules.map((rule) => {
          const percentage = totalWeight > 0 && rule.isEnabled
            ? Math.round((rule.weight / totalWeight) * 100)
            : 0;

          return (
            <div
              key={rule.id}
              className={cn(
                'p-3 rounded-lg bg-white/[0.03] border border-white/5',
                !rule.isEnabled && 'opacity-50'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={rule.isEnabled}
                    onCheckedChange={() => onToggle(rule)}
                    className="scale-75"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white">
                        {rule.model?.displayName || 'Unknown Model'}
                      </p>
                      {rule.model?.capabilities && rule.model.capabilities.length > 0 && (
                        <div className="flex gap-1">
                          {rule.model.capabilities.map((cap) => (
                            <Badge key={cap} className={cn('text-xs', getCapabilityColor(cap))}>
                              {IMAGE_CAPABILITY_LABELS[cap]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="capitalize">{rule.model?.provider}</span>
                      <span>-</span>
                      <span>{rule.maxRetries} retries</span>
                      <span>-</span>
                      <span>{(rule.timeoutMs / 1000).toFixed(0)}s timeout</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {rule.isEnabled && (
                    <div className="text-right">
                      <p className="text-sm font-medium text-white">{percentage}%</p>
                      <p className="text-xs text-gray-500">weight: {rule.weight}</p>
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(rule)}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Image Routing Rule</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this routing rule for {rule.model?.displayName}?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onDelete(rule.id)}
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
          );
        })}
      </div>

      <PromptTemplatesPanel adminArea="image_routing" title="Image Routing Prompts" />
    </div>
  );
}

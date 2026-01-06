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
  Video,
} from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  listVideoRoutingRules,
  listVideoModels,
  listVideoProviders,
  createVideoRoutingRule,
  updateVideoRoutingRule,
  deleteVideoRoutingRule,
  syncVideoConfig,
  VIDEO_USE_CASE_TYPES,
  VIDEO_USE_CASE_LABELS,
  VIDEO_USE_CASE_DESCRIPTIONS,
  VIDEO_CAPABILITY_LABELS,
  type VideoUseCaseType,
  type VideoRoutingRule,
  type VideoModelWithProvider,
  type VideoProvider,
  type CreateVideoRoutingRuleInput,
  type UpdateVideoRoutingRuleInput,
  type VideoSyncResult,
  type VideoModelCapability,
} from '@/lib/api/video-providers';
import { VideoModelSelector } from '@/components/admin/video-model-selector';
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

export function VideoRoutingTab() {
  const [isLoading, setIsLoading] = useState(true);
  const [rules, setRules] = useState<VideoRoutingRule[]>([]);
  const [models, setModels] = useState<VideoModelWithProvider[]>([]);
  const [providers, setProviders] = useState<VideoProvider[]>([]);
  const [activeTab, setActiveTab] = useState<VideoUseCaseType>('video_generation');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<VideoSyncResult | null>(null);

  // Rule dialog state
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<VideoRoutingRule | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    useCase: VideoUseCaseType;
    tier: number;
    modelConfigId: string;
    weight: number;
    isEnabled: boolean;
    maxRetries: number;
    timeoutMs: number;
  }>({
    useCase: 'video_generation',
    tier: 1,
    modelConfigId: '',
    weight: 100,
    isEnabled: true,
    maxRetries: 2,
    timeoutMs: 300000,
  });

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, modelsRes, providersRes] = await Promise.all([
        listVideoRoutingRules(),
        listVideoModels(),
        listVideoProviders({ isEnabled: true }),
      ]);
      setRules(rulesRes.rules);
      setModels(modelsRes.models);
      setProviders(providersRes.providers);
    } catch (error) {
      console.error('Failed to fetch video routing data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getRulesForUseCase = (useCase: VideoUseCaseType) => {
    return rules
      .filter((r) => r.useCase === useCase)
      .sort((a, b) => a.tier - b.tier || b.weight - a.weight);
  };

  const getTierRules = (useCase: VideoUseCaseType, tier: number) => {
    return rules
      .filter((r) => r.useCase === useCase && r.tier === tier)
      .sort((a, b) => b.weight - a.weight);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncVideoConfig();
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
      timeoutMs: 300000,
    });
    setEditingRule(null);
  };

  const openRuleDialog = (rule?: VideoRoutingRule) => {
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
        const input: UpdateVideoRoutingRuleInput = {
          tier: ruleForm.tier,
          weight: ruleForm.weight,
          isEnabled: ruleForm.isEnabled,
          maxRetries: ruleForm.maxRetries,
          timeoutMs: ruleForm.timeoutMs,
        };
        await updateVideoRoutingRule(editingRule.id, input);
      } else {
        const input: CreateVideoRoutingRuleInput = {
          useCase: ruleForm.useCase,
          tier: ruleForm.tier,
          modelConfigId: ruleForm.modelConfigId,
          weight: ruleForm.weight,
          isEnabled: ruleForm.isEnabled,
          maxRetries: ruleForm.maxRetries,
          timeoutMs: ruleForm.timeoutMs,
        };
        await createVideoRoutingRule(input);
      }
      setIsRuleDialogOpen(false);
      resetRuleForm();
      await fetchData();
    } catch (error) {
      console.error('Failed to save video routing rule:', error);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteVideoRoutingRule(ruleId);
      await fetchData();
    } catch (error) {
      console.error('Failed to delete video routing rule:', error);
    }
  };

  const handleToggleRule = async (rule: VideoRoutingRule) => {
    try {
      await updateVideoRoutingRule(rule.id, { isEnabled: !rule.isEnabled });
      await fetchData();
    } catch (error) {
      console.error('Failed to toggle video routing rule:', error);
    }
  };

  const getUseCaseIcon = (useCase: VideoUseCaseType) => {
    switch (useCase) {
      case 'video_generation':
        return '🎬';
      case 'video_from_image':
        return '🖼️';
      case 'video_lip_sync':
        return '🎤';
      case 'video_motion_brush':
        return '🖌️';
      default:
        return '📹';
    }
  };

  const getCapabilityColor = (capability: VideoModelCapability) => {
    switch (capability) {
      case 'image_to_video':
        return 'bg-blue-500/20 text-blue-400';
      case 'lip_sync':
        return 'bg-green-500/20 text-green-400';
      case 'motion_brush':
        return 'bg-purple-500/20 text-purple-400';
      case 'camera_control':
        return 'bg-amber-500/20 text-amber-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Video Routing</h2>
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
  const unconfiguredUseCases = VIDEO_USE_CASE_TYPES.filter((uc) => !useCasesWithRules.has(uc));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Video Routing Configuration</h2>
          <p className="text-gray-400 text-sm mt-1">
            Configure model routing for different video generation use cases
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={'/admin/providers?tab=video' as Route}>
            <Button variant="outline" size="sm" className="gap-2">
              <Video className="h-4 w-4" />
              Video Providers
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
                  The following video use cases have no routing rules configured:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {unconfiguredUseCases.map((uc) => (
                    <Badge key={uc} variant="secondary" className="bg-amber-500/10 text-amber-400">
                      {VIDEO_USE_CASE_LABELS[uc]}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Use Case Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as VideoUseCaseType)}>
        <TabsList className="bg-white/5 border border-white/10 p-1 flex-wrap h-auto">
          {VIDEO_USE_CASE_TYPES.map((useCase) => {
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
                {VIDEO_USE_CASE_LABELS[useCase]}
                {hasRules && (
                  <Badge variant="secondary" className="ml-1 text-xs bg-white/10">
                    {getRulesForUseCase(useCase).length}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {VIDEO_USE_CASE_TYPES.map((useCase) => (
          <TabsContent key={useCase} value={useCase} className="mt-6">
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg text-white flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-blue-500" />
                    {VIDEO_USE_CASE_LABELS[useCase]} Routing
                  </CardTitle>
                  <p className="text-sm text-gray-400 mt-1">
                    {VIDEO_USE_CASE_DESCRIPTIONS[useCase]}
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
                      No routing rules configured for {VIDEO_USE_CASE_LABELS[useCase]}.
                    </p>
                    <Button onClick={() => openRuleDialog()} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add First Rule
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Tier 1: Primary */}
                    <VideoTierSection
                      tier={1}
                      label="Primary"
                      description="First choice for video requests"
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
                      <VideoTierSection
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
                      <VideoTierSection
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

      <PromptTemplatesPanel adminArea="video_routing" title="Video Routing Prompts" />

      {/* Rule Dialog */}
      <Dialog open={isRuleDialogOpen} onOpenChange={setIsRuleDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Video Routing Rule' : 'Add Video Routing Rule'}</DialogTitle>
            <DialogDescription>
              {editingRule
                ? 'Update the routing rule configuration.'
                : 'Add a new routing rule for this video use case.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editingRule && (
              <VideoModelSelector
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
                  onChange={(e) => setRuleForm({ ...ruleForm, timeoutMs: parseInt(e.target.value) || 300000 })}
                  min={30000}
                  max={600000}
                  step={10000}
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

// Video Tier Section Component
function VideoTierSection({
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
  rules: VideoRoutingRule[];
  onEdit: (rule: VideoRoutingRule) => void;
  onDelete: (id: string) => void;
  onToggle: (rule: VideoRoutingRule) => void;
  getCapabilityColor: (cap: VideoModelCapability) => string;
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
                              {VIDEO_CAPABILITY_LABELS[cap]}
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
                        <AlertDialogTitle>Delete Video Routing Rule</AlertDialogTitle>
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
    </div>
  );
}

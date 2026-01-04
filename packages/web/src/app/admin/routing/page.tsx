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
} from 'lucide-react';
import {
  listRoutingRules,
  listModels,
  listProviders,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  validateConfiguration,
  syncWithOrchestrator,
  USE_CASE_TYPES,
  USE_CASE_LABELS,
  type UseCaseType,
  type RoutingRule,
  type ModelWithProvider,
  type Provider,
  type CreateRoutingRuleInput,
  type UpdateRoutingRuleInput,
  type ValidationResult,
} from '@/lib/api/providers';
import { ModelSelector } from '@/components/admin/model-selector';
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

export default function RoutingPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [models, setModels] = useState<ModelWithProvider[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeTab, setActiveTab] = useState<UseCaseType>('chat_simple');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Rule dialog state
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    useCase: UseCaseType;
    tier: number;
    modelConfigId: string;
    weight: number;
    isEnabled: boolean;
    maxRetries: number;
    timeoutMs: number;
  }>({
    useCase: 'chat_simple',
    tier: 1,
    modelConfigId: '',
    weight: 100,
    isEnabled: true,
    maxRetries: 2,
    timeoutMs: 30000,
  });

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, modelsRes, providersRes] = await Promise.all([
        listRoutingRules(),
        listModels({ isEnabled: true }),
        listProviders({ isEnabled: true }),
      ]);
      setRules(rulesRes.rules);
      setModels(modelsRes.models);
      setProviders(providersRes.providers);
    } catch (error) {
      console.error('Failed to fetch routing data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getRulesForUseCase = (useCase: UseCaseType) => {
    return rules
      .filter((r) => r.useCase === useCase)
      .sort((a, b) => a.tier - b.tier || b.weight - a.weight);
  };

  const getTierRules = (useCase: UseCaseType, tier: number) => {
    return rules
      .filter((r) => r.useCase === useCase && r.tier === tier)
      .sort((a, b) => b.weight - a.weight);
  };

  const handleValidate = async () => {
    setIsValidating(true);
    try {
      const result = await validateConfiguration();
      setValidation(result);
    } catch (error) {
      console.error('Failed to validate:', error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncWithOrchestrator();
      setSyncResult({ success: result.success, error: result.error || undefined });
      if (result.success) {
        await fetchData();
      }
    } catch (error) {
      setSyncResult({ success: false, error: 'Failed to sync with orchestrator' });
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
      timeoutMs: 30000,
    });
    setEditingRule(null);
  };

  const openRuleDialog = (rule?: RoutingRule) => {
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
        const input: UpdateRoutingRuleInput = {
          tier: ruleForm.tier,
          weight: ruleForm.weight,
          isEnabled: ruleForm.isEnabled,
          maxRetries: ruleForm.maxRetries,
          timeoutMs: ruleForm.timeoutMs,
        };
        await updateRoutingRule(editingRule.id, input);
      } else {
        const input: CreateRoutingRuleInput = {
          useCase: ruleForm.useCase,
          tier: ruleForm.tier,
          modelConfigId: ruleForm.modelConfigId,
          weight: ruleForm.weight,
          isEnabled: ruleForm.isEnabled,
          maxRetries: ruleForm.maxRetries,
          timeoutMs: ruleForm.timeoutMs,
        };
        await createRoutingRule(input);
      }
      setIsRuleDialogOpen(false);
      resetRuleForm();
      await fetchData();
    } catch (error) {
      console.error('Failed to save rule:', error);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteRoutingRule(ruleId);
      await fetchData();
    } catch (error) {
      console.error('Failed to delete rule:', error);
    }
  };

  const handleToggleRule = async (rule: RoutingRule) => {
    try {
      await updateRoutingRule(rule.id, { isEnabled: !rule.isEnabled });
      await fetchData();
    } catch (error) {
      console.error('Failed to toggle rule:', error);
    }
  };

  const getUseCaseIcon = (useCase: UseCaseType) => {
    if (useCase.startsWith('chat')) return '💬';
    if (useCase.includes('memory') || useCase.includes('summarization') || useCase.includes('compression')) return '🧠';
    if (useCase.includes('safety') || useCase.includes('moderation')) return '🛡️';
    return '⚡';
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Routing</h1>
        </div>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="p-6">
            <div className="animate-pulse h-64 bg-white/5 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const enabledModels = models.filter((m) => m.isEnabled && m.providerIsEnabled);
  const useCasesWithRules = new Set(rules.map((r) => r.useCase));
  const unconfiguredUseCases = USE_CASE_TYPES.filter((uc) => !useCasesWithRules.has(uc));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Routing Configuration</h1>
          <p className="text-gray-400 text-sm mt-1">
            Configure model routing for different use cases
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={isValidating}
            className="gap-2"
          >
            {isValidating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Validate
          </Button>
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

      {/* Validation Results */}
      {validation && (
        <Card className={cn(
          'border',
          validation.valid
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-amber-500/5 border-amber-500/20'
        )}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {validation.valid ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={cn(
                  'font-medium',
                  validation.valid ? 'text-green-400' : 'text-amber-400'
                )}>
                  {validation.valid ? 'Configuration is valid' : 'Configuration has issues'}
                </p>
                {validation.errors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {validation.errors.map((err, i) => (
                      <li key={i} className="text-sm text-red-400">• {err}</li>
                    ))}
                  </ul>
                )}
                {validation.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {validation.warnings.map((warn, i) => (
                      <li key={i} className="text-sm text-amber-400">• {warn}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                <span className="text-green-400">Configuration synced to orchestrator</span>
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
                  The following use cases have no routing rules configured:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {unconfiguredUseCases.map((uc) => (
                    <Badge key={uc} variant="secondary" className="bg-amber-500/10 text-amber-400">
                      {USE_CASE_LABELS[uc]}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Use Case Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as UseCaseType)}>
        <TabsList className="bg-white/5 border border-white/10 p-1 flex-wrap h-auto">
          {USE_CASE_TYPES.map((useCase) => {
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
                {USE_CASE_LABELS[useCase]}
                {hasRules && (
                  <Badge variant="secondary" className="ml-1 text-xs bg-white/10">
                    {getRulesForUseCase(useCase).length}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {USE_CASE_TYPES.map((useCase) => (
          <TabsContent key={useCase} value={useCase} className="mt-6">
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-purple-500" />
                  {USE_CASE_LABELS[useCase]} Routing
                </CardTitle>
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
                      No routing rules configured for {USE_CASE_LABELS[useCase]}.
                    </p>
                    <Button onClick={() => openRuleDialog()} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add First Rule
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Tier 1: Primary */}
                    <TierSection
                      tier={1}
                      label="Primary"
                      description="First choice for requests"
                      rules={getTierRules(useCase, 1)}
                      onEdit={openRuleDialog}
                      onDelete={handleDeleteRule}
                      onToggle={handleToggleRule}
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
                      <TierSection
                        tier={2}
                        label="Secondary"
                        description="Fallback if primary fails"
                        rules={getTierRules(useCase, 2)}
                        onEdit={openRuleDialog}
                        onDelete={handleDeleteRule}
                        onToggle={handleToggleRule}
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
                      <TierSection
                        tier={3}
                        label="Tertiary"
                        description="Last resort fallback"
                        rules={getTierRules(useCase, 3)}
                        onEdit={openRuleDialog}
                        onDelete={handleDeleteRule}
                        onToggle={handleToggleRule}
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
            <DialogTitle>{editingRule ? 'Edit Routing Rule' : 'Add Routing Rule'}</DialogTitle>
            <DialogDescription>
              {editingRule
                ? 'Update the routing rule configuration.'
                : 'Add a new routing rule for this use case.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editingRule && (
              <ModelSelector
                providers={providers}
                models={enabledModels}
                value={ruleForm.modelConfigId}
                onChange={(v) => setRuleForm({ ...ruleForm, modelConfigId: v })}
                onModelAdded={fetchData}
                isLoading={isLoading}
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
                  onChange={(e) => setRuleForm({ ...ruleForm, timeoutMs: parseInt(e.target.value) || 30000 })}
                  min={1000}
                  max={120000}
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

// Tier Section Component
function TierSection({
  tier,
  label,
  description,
  rules,
  onEdit,
  onDelete,
  onToggle,
}: {
  tier: number;
  label: string;
  description: string;
  rules: RoutingRule[];
  onEdit: (rule: RoutingRule) => void;
  onDelete: (id: string) => void;
  onToggle: (rule: RoutingRule) => void;
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
                    <p className="font-medium text-white">
                      {rule.model?.displayName || 'Unknown Model'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="capitalize">{rule.model?.provider}</span>
                      <span>•</span>
                      <span>{rule.maxRetries} retries</span>
                      <span>•</span>
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
                        <AlertDialogTitle>Delete Rule</AlertDialogTitle>
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

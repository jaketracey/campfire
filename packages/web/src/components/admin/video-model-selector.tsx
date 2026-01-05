'use client';

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  createVideoModel,
  type VideoProvider,
  type VideoModelWithProvider,
  type VideoModelCapability,
} from '@/lib/api/video-providers';

// Registry of available FAL video models that can be added
interface DiscoverableVideoModel {
  modelId: string;
  displayName: string;
  provider: 'fal_video' | 'replicate_video' | 'runway';
  tier: 'fast' | 'standard' | 'quality';
  maxDurationSeconds: number;
  costPerSecond: number;
  capabilities: VideoModelCapability[];
  tags: string[];
}

const DISCOVERABLE_VIDEO_MODELS: DiscoverableVideoModel[] = [
  // Kling Models
  {
    modelId: 'fal/kling-video/v1.6/pro/text-to-video',
    displayName: 'Kling 1.6 Pro (Text)',
    provider: 'fal_video',
    tier: 'quality',
    maxDurationSeconds: 10,
    costPerSecond: 0.065,
    capabilities: [],
    tags: ['quality', 'text-to-video'],
  },
  {
    modelId: 'fal/kling-video/v1.6/pro/image-to-video',
    displayName: 'Kling 1.6 Pro (Image)',
    provider: 'fal_video',
    tier: 'quality',
    maxDurationSeconds: 10,
    costPerSecond: 0.065,
    capabilities: ['image_to_video'],
    tags: ['quality', 'image-to-video'],
  },
  {
    modelId: 'fal/kling-video/v1.6/pro/lip-sync',
    displayName: 'Kling 1.6 Pro Lip Sync',
    provider: 'fal_video',
    tier: 'quality',
    maxDurationSeconds: 10,
    costPerSecond: 0.08,
    capabilities: ['image_to_video', 'lip_sync'],
    tags: ['lip-sync', 'audio'],
  },
  // Minimax Models
  {
    modelId: 'fal/minimax/video-01',
    displayName: 'Minimax Video-01',
    provider: 'fal_video',
    tier: 'standard',
    maxDurationSeconds: 6,
    costPerSecond: 0.04,
    capabilities: ['image_to_video'],
    tags: ['balanced', 'fast'],
  },
  {
    modelId: 'fal/minimax/video-01-live',
    displayName: 'Minimax Video-01 Live',
    provider: 'fal_video',
    tier: 'fast',
    maxDurationSeconds: 6,
    costPerSecond: 0.05,
    capabilities: ['image_to_video'],
    tags: ['fast', 'live'],
  },
  // Luma Models
  {
    modelId: 'fal/luma-dream-machine',
    displayName: 'Luma Dream Machine',
    provider: 'fal_video',
    tier: 'standard',
    maxDurationSeconds: 5,
    costPerSecond: 0.032,
    capabilities: ['image_to_video'],
    tags: ['dreamy', 'artistic'],
  },
  // Runway Models
  {
    modelId: 'fal/runway-gen3/turbo/image-to-video',
    displayName: 'Runway Gen-3 Turbo',
    provider: 'fal_video',
    tier: 'fast',
    maxDurationSeconds: 10,
    costPerSecond: 0.05,
    capabilities: ['image_to_video'],
    tags: ['fast', 'runway'],
  },
  // Hunyuan Models
  {
    modelId: 'fal/hunyuan-video',
    displayName: 'Hunyuan Video',
    provider: 'fal_video',
    tier: 'quality',
    maxDurationSeconds: 5,
    costPerSecond: 0.045,
    capabilities: ['image_to_video'],
    tags: ['quality', 'hunyuan'],
  },
  // Veo Models
  {
    modelId: 'fal/veo-2',
    displayName: 'Veo 2 (Google)',
    provider: 'fal_video',
    tier: 'quality',
    maxDurationSeconds: 8,
    costPerSecond: 0.07,
    capabilities: ['image_to_video', 'camera_control'],
    tags: ['quality', 'google', 'camera-control'],
  },
];

interface VideoModelSelectorProps {
  providers: VideoProvider[];
  models: VideoModelWithProvider[];
  value: string;
  onChange: (modelConfigId: string) => void;
  onModelAdded?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function VideoModelSelector({
  providers,
  models,
  value,
  onChange,
  onModelAdded,
  disabled = false,
  isLoading = false,
}: VideoModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [search, setSearch] = useState('');
  const [isAddingModel, setIsAddingModel] = useState(false);

  // Get enabled providers
  const availableProviders = useMemo(() => {
    return providers.filter((p) => p.isEnabled);
  }, [providers]);

  // Filter configured models by selected provider
  const filteredModels = useMemo(() => {
    let result = models.filter((m) => m.isEnabled && m.providerIsEnabled);
    if (selectedProvider) {
      result = result.filter((m) => m.provider === selectedProvider);
    }
    return result;
  }, [models, selectedProvider]);

  // Get discoverable models that aren't already configured for the selected provider
  const unconfiguredModels = useMemo(() => {
    if (!selectedProvider) return [];

    const configuredModelIds = new Set(
      models.filter((m) => m.provider === selectedProvider).map((m) => m.modelId)
    );

    return DISCOVERABLE_VIDEO_MODELS.filter(
      (m) => m.provider === selectedProvider && !configuredModelIds.has(m.modelId)
    );
  }, [selectedProvider, models]);

  // Get selected model for display
  const selectedModel = useMemo(() => {
    return models.find((m) => m.id === value);
  }, [models, value]);

  // Auto-select provider when a model is selected
  useEffect(() => {
    if (selectedModel && !selectedProvider) {
      setSelectedProvider(selectedModel.provider);
    }
  }, [selectedModel, selectedProvider]);

  // Group configured models by provider
  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, VideoModelWithProvider[]> = {};
    filteredModels.forEach((model) => {
      const provider = model.providerDisplayName || model.provider;
      if (!grouped[provider]) {
        grouped[provider] = [];
      }
      grouped[provider].push(model);
    });
    return grouped;
  }, [filteredModels]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
  };

  const handleAddAndSelect = async (discovered: DiscoverableVideoModel) => {
    const provider = providers.find((p) => p.provider === selectedProvider);
    if (!provider) return;

    setIsAddingModel(true);
    try {
      const newModel = await createVideoModel(provider.id, {
        modelId: discovered.modelId,
        displayName: discovered.displayName,
        isEnabled: true,
        maxDurationSeconds: discovered.maxDurationSeconds,
        costPerSecond: discovered.costPerSecond,
        capabilities: discovered.capabilities,
      });

      // Notify parent to refresh models list
      onModelAdded?.();

      // Select the newly created model
      onChange(newModel.id);
      setOpen(false);
    } catch (error) {
      console.error('Failed to add video model:', error);
    } finally {
      setIsAddingModel(false);
    }
  };

  const getCapabilityColor = (cap: VideoModelCapability) => {
    switch (cap) {
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

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'fast':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'standard':
        return 'bg-blue-500/20 text-blue-400';
      case 'quality':
        return 'bg-purple-500/20 text-purple-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="space-y-3">
      {/* Provider Filter */}
      <div className="space-y-2">
        <Label className="text-sm text-gray-400">Provider</Label>
        <Select
          value={selectedProvider || '__all__'}
          onValueChange={(v) => setSelectedProvider(v === '__all__' ? '' : v)}
          disabled={disabled}
        >
          <SelectTrigger className="bg-white/5 border-white/10">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All providers</SelectItem>
            {availableProviders.map((provider) => (
              <SelectItem key={provider.id} value={provider.provider}>
                {provider.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model Selector with Search */}
      <div className="space-y-2">
        <Label className="text-sm text-gray-400">Model</Label>
        <Popover open={open} onOpenChange={setOpen} modal={false}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled || isLoading || isAddingModel}
              className="w-full justify-between bg-white/5 border-white/10 hover:bg-white/10"
            >
              {isLoading || isAddingModel ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isAddingModel ? 'Adding model...' : 'Loading models...'}
                </span>
              ) : selectedModel ? (
                <span className="flex items-center gap-2">
                  <span>{selectedModel.displayName}</span>
                  <span className="text-xs text-gray-500">
                    ({selectedModel.providerDisplayName || selectedModel.provider})
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select a model...</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[500px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search models..."
                value={search}
                onValueChange={setSearch}
              />
              <div
                className="h-[350px] overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.2) transparent',
                }}
                onWheel={(e) => e.stopPropagation()}
              >
                <CommandList className="max-h-none">
                  {filteredModels.length === 0 && unconfiguredModels.length === 0 && (
                    <CommandEmpty>
                      {selectedProvider
                        ? 'No models available for this provider.'
                        : 'Select a provider to see available models.'}
                    </CommandEmpty>
                  )}

                  {/* Configured Models */}
                  {Object.entries(modelsByProvider).map(([providerName, providerModels]) => {
                    const searchFiltered = providerModels.filter(
                      (m) =>
                        m.displayName.toLowerCase().includes(search.toLowerCase()) ||
                        m.modelId.toLowerCase().includes(search.toLowerCase())
                    );

                    if (searchFiltered.length === 0) return null;

                    return (
                      <CommandGroup key={providerName} heading={`${providerName} (Configured)`}>
                        {searchFiltered.map((model) => (
                          <CommandItem
                            key={model.id}
                            value={model.id}
                            onSelect={handleSelect}
                            className="cursor-pointer"
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                value === model.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <div className="flex flex-col flex-1">
                              <div className="flex items-center gap-2">
                                <span>{model.displayName}</span>
                                {model.capabilities.map((cap) => (
                                  <Badge key={cap} className={cn('text-[10px] px-1 py-0', getCapabilityColor(cap))}>
                                    {cap.replace('_', '-')}
                                  </Badge>
                                ))}
                              </div>
                              <span className="text-xs text-gray-500">
                                {model.modelId}
                                {model.costPerSecond && ` • $${model.costPerSecond.toFixed(3)}/sec`}
                                {model.maxDurationSeconds && ` • max ${model.maxDurationSeconds}s`}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    );
                  })}

                  {/* Unconfigured (Discoverable) Models */}
                  {unconfiguredModels.length > 0 && (
                    <>
                      {filteredModels.length > 0 && <CommandSeparator />}
                      <CommandGroup
                        heading={
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Available models (click to add)
                          </span>
                        }
                      >
                        {unconfiguredModels
                          .filter(
                            (m) =>
                              m.displayName.toLowerCase().includes(search.toLowerCase()) ||
                              m.modelId.toLowerCase().includes(search.toLowerCase()) ||
                              m.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
                          )
                          .map((model) => (
                            <CommandItem
                              key={model.modelId}
                              value={model.modelId}
                              onSelect={() => handleAddAndSelect(model)}
                              className="cursor-pointer"
                            >
                              <Plus className="mr-2 h-4 w-4 text-campfire-500" />
                              <div className="flex flex-col flex-1">
                                <div className="flex items-center gap-2">
                                  <span>{model.displayName}</span>
                                  <Badge className={cn('text-[10px] px-1 py-0', getTierColor(model.tier))}>
                                    {model.tier}
                                  </Badge>
                                  {model.capabilities.map((cap) => (
                                    <Badge key={cap} className={cn('text-[10px] px-1 py-0', getCapabilityColor(cap))}>
                                      {cap.replace('_', '-')}
                                    </Badge>
                                  ))}
                                </div>
                                <span className="text-xs text-gray-500">
                                  {model.modelId} • ${model.costPerSecond.toFixed(3)}/sec • max {model.maxDurationSeconds}s
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </div>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

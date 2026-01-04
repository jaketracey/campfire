'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  listImageProviders,
  createImageModel,
  type ImageProvider,
  type ImageModelWithProvider,
  type ImageModelCapability,
} from '@/lib/api/image-providers';

// Registry of available FAL models that can be added
// This mirrors the IMAGE_MODEL_REGISTRY in the orchestrator
interface DiscoverableImageModel {
  modelId: string;
  displayName: string;
  provider: 'fal' | 'comfyui' | 'replicate';
  tier: 'fast' | 'standard' | 'quality';
  maxResolution: [number, number];
  costPerImage: number;
  avgGenerationTime: number;
  capabilities: ImageModelCapability[];
  tags: string[];
}

const DISCOVERABLE_IMAGE_MODELS: DiscoverableImageModel[] = [
  // FLUX 1.x Series
  {
    modelId: 'fal/flux-schnell',
    displayName: 'Flux Schnell (Fast)',
    provider: 'fal',
    tier: 'fast',
    maxResolution: [1024, 1024],
    costPerImage: 0.003,
    avgGenerationTime: 2.0,
    capabilities: [],
    tags: ['fast', 'cheap'],
  },
  {
    modelId: 'fal/flux-dev',
    displayName: 'Flux Dev',
    provider: 'fal',
    tier: 'standard',
    maxResolution: [1024, 1536],
    costPerImage: 0.025,
    avgGenerationTime: 5.0,
    capabilities: [],
    tags: ['balanced'],
  },
  {
    modelId: 'fal/flux-1.1-pro',
    displayName: 'Flux 1.1 Pro',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1024, 1536],
    costPerImage: 0.04,
    avgGenerationTime: 10.0,
    capabilities: ['ip_adapter'],
    tags: ['quality', 'ip-adapter'],
  },
  // FLUX 2 Series
  {
    modelId: 'fal/flux-2-flash',
    displayName: 'Flux 2 Flash (Ultra-Fast)',
    provider: 'fal',
    tier: 'fast',
    maxResolution: [1024, 1536],
    costPerImage: 0.006,
    avgGenerationTime: 1.5,
    capabilities: [],
    tags: ['ultrafast', 'flux2'],
  },
  {
    modelId: 'fal/flux-2-turbo',
    displayName: 'Flux 2 Turbo (Fast)',
    provider: 'fal',
    tier: 'fast',
    maxResolution: [1024, 1536],
    costPerImage: 0.01,
    avgGenerationTime: 2.5,
    capabilities: [],
    tags: ['fast', 'flux2'],
  },
  {
    modelId: 'fal/flux-2-flex',
    displayName: 'Flux 2 Flex (Configurable)',
    provider: 'fal',
    tier: 'standard',
    maxResolution: [1024, 1536],
    costPerImage: 0.02,
    avgGenerationTime: 4.0,
    capabilities: [],
    tags: ['flexible', 'flux2'],
  },
  {
    modelId: 'fal/flux-2-max',
    displayName: 'Flux 2 Max (Premium)',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1536, 2048],
    costPerImage: 0.08,
    avgGenerationTime: 12.0,
    capabilities: ['ip_adapter'],
    tags: ['premium', 'flux2'],
  },
  // FLUX Kontext (Editing)
  {
    modelId: 'fal/flux-kontext-pro',
    displayName: 'Flux Kontext Pro (Edit)',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1024, 1536],
    costPerImage: 0.05,
    avgGenerationTime: 8.0,
    capabilities: ['ip_adapter', 'inpainting'],
    tags: ['editing', 'kontext'],
  },
  {
    modelId: 'fal/flux-kontext-max',
    displayName: 'Flux Kontext Max (Premium Edit)',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1536, 2048],
    costPerImage: 0.08,
    avgGenerationTime: 12.0,
    capabilities: ['ip_adapter', 'inpainting'],
    tags: ['editing', 'premium', 'kontext'],
  },
  {
    modelId: 'fal/flux-kontext-lora',
    displayName: 'Flux Kontext LoRA',
    provider: 'fal',
    tier: 'standard',
    maxResolution: [1024, 1536],
    costPerImage: 0.025,
    avgGenerationTime: 5.0,
    capabilities: ['ip_adapter', 'inpainting'],
    tags: ['lora', 'editing'],
  },
  {
    modelId: 'fal/flux-lora',
    displayName: 'Flux Dev LoRA',
    provider: 'fal',
    tier: 'standard',
    maxResolution: [1024, 1536],
    costPerImage: 0.03,
    avgGenerationTime: 6.0,
    capabilities: ['ip_adapter'],
    tags: ['lora', 'customizable'],
  },
  // Other FAL Models
  {
    modelId: 'fal/dreamina-v3.1',
    displayName: 'Bytedance Dreamina 3.1',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1024, 1536],
    costPerImage: 0.02,
    avgGenerationTime: 8.0,
    capabilities: [],
    tags: ['photorealistic', 'portrait'],
  },
  {
    modelId: 'fal/seedream-4.5',
    displayName: 'Seedream 4.5 (Bytedance)',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1024, 1536],
    costPerImage: 0.025,
    avgGenerationTime: 6.0,
    capabilities: [],
    tags: ['photorealistic', 'portrait'],
  },
  {
    modelId: 'fal/recraft-v3',
    displayName: 'Recraft V3',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [1024, 1536],
    costPerImage: 0.04,
    avgGenerationTime: 8.0,
    capabilities: [],
    tags: ['typography', 'vector', 'brand'],
  },
  {
    modelId: 'fal/z-image-turbo',
    displayName: 'Z-Image Turbo (Super Fast)',
    provider: 'fal',
    tier: 'fast',
    maxResolution: [1024, 1024],
    costPerImage: 0.004,
    avgGenerationTime: 1.5,
    capabilities: ['inpainting', 'controlnet'],
    tags: ['ultrafast', 'cheap'],
  },
  {
    modelId: 'fal/qwen-image-2512',
    displayName: 'Qwen Image 2512',
    provider: 'fal',
    tier: 'quality',
    maxResolution: [2512, 2512],
    costPerImage: 0.03,
    avgGenerationTime: 8.0,
    capabilities: [],
    tags: ['high-res', 'typography'],
  },
  {
    modelId: 'fal/longcat-image',
    displayName: 'LongCat Image',
    provider: 'fal',
    tier: 'standard',
    maxResolution: [1024, 1536],
    costPerImage: 0.015,
    avgGenerationTime: 4.0,
    capabilities: [],
    tags: ['multilingual', 'photorealism'],
  },
];

interface ImageModelSelectorProps {
  providers: ImageProvider[];
  models: ImageModelWithProvider[];
  value: string;
  onChange: (modelConfigId: string) => void;
  onModelAdded?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function ImageModelSelector({
  providers,
  models,
  value,
  onChange,
  onModelAdded,
  disabled = false,
  isLoading = false,
}: ImageModelSelectorProps) {
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

    return DISCOVERABLE_IMAGE_MODELS.filter(
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
    const grouped: Record<string, ImageModelWithProvider[]> = {};
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

  const handleAddAndSelect = async (discovered: DiscoverableImageModel) => {
    const provider = providers.find((p) => p.provider === selectedProvider);
    if (!provider) return;

    setIsAddingModel(true);
    try {
      const newModel = await createImageModel(provider.id, {
        modelId: discovered.modelId,
        displayName: discovered.displayName,
        isEnabled: true,
        maxResolution: discovered.maxResolution,
        costPerImage: discovered.costPerImage,
        avgGenerationTime: discovered.avgGenerationTime,
        capabilities: discovered.capabilities,
      });

      // Notify parent to refresh models list
      onModelAdded?.();

      // Select the newly created model
      onChange(newModel.id);
      setOpen(false);
    } catch (error) {
      console.error('Failed to add image model:', error);
    } finally {
      setIsAddingModel(false);
    }
  };

  const getCapabilityColor = (cap: ImageModelCapability) => {
    switch (cap) {
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
                                {model.costPerImage && ` • $${model.costPerImage.toFixed(3)}/image`}
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
                                  {model.modelId} • ${model.costPerImage.toFixed(3)}/image • ~{model.avgGenerationTime}s
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

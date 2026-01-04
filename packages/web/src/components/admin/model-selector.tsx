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
import {
  discoverProviderModels,
  createModel,
  type ModelWithProvider,
  type Provider,
  type DiscoveredModel,
} from '@/lib/api/providers';

interface ModelSelectorProps {
  providers: Provider[];
  models: ModelWithProvider[];
  value: string;
  onChange: (modelConfigId: string) => void;
  onModelAdded?: () => void; // Callback to refresh models after adding
  disabled?: boolean;
  isLoading?: boolean;
}

// Cache for discovered models (5 minute TTL)
const discoveryCache = new Map<string, { models: DiscoveredModel[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function ModelSelector({
  providers,
  models,
  value,
  onChange,
  onModelAdded,
  disabled = false,
  isLoading = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [search, setSearch] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const lastFetchedProvider = useRef<string>('');

  // Get all providers (not just ones with configured models)
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

  // Get discovered models that aren't already configured
  const unconfiguredModels = useMemo(() => {
    const configuredModelIds = new Set(filteredModels.map((m) => m.modelId));
    return discoveredModels.filter((m) => !configuredModelIds.has(m.modelId));
  }, [discoveredModels, filteredModels]);

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

  // Fetch discovered models when provider changes
  const fetchDiscoveredModels = useCallback(async (providerId: string) => {
    if (!providerId || lastFetchedProvider.current === providerId) return;

    // Check cache first
    const cached = discoveryCache.get(providerId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setDiscoveredModels(cached.models);
      lastFetchedProvider.current = providerId;
      return;
    }

    setIsDiscovering(true);
    try {
      const result = await discoverProviderModels(providerId);
      if (result.success) {
        setDiscoveredModels(result.models);
        discoveryCache.set(providerId, { models: result.models, timestamp: Date.now() });
      } else {
        console.error('Failed to discover models:', result.error);
        setDiscoveredModels([]);
      }
      lastFetchedProvider.current = providerId;
    } catch (error) {
      console.error('Failed to discover models:', error);
      setDiscoveredModels([]);
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  // Fetch models when provider is selected
  useEffect(() => {
    if (selectedProvider) {
      const provider = providers.find((p) => p.provider === selectedProvider);
      if (provider) {
        fetchDiscoveredModels(provider.id);
      }
    } else {
      setDiscoveredModels([]);
      lastFetchedProvider.current = '';
    }
  }, [selectedProvider, providers, fetchDiscoveredModels]);

  // Group configured models by provider for display
  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, ModelWithProvider[]> = {};
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

  const handleAddAndSelect = async (discovered: DiscoveredModel) => {
    const provider = providers.find((p) => p.provider === selectedProvider);
    if (!provider) return;

    setIsAddingModel(true);
    try {
      const newModel = await createModel(provider.id, {
        modelId: discovered.modelId,
        displayName: discovered.displayName,
        isEnabled: true,
        contextWindow: discovered.contextWindow,
        maxOutputTokens: discovered.maxOutputTokens,
        inputCostPerMillion: discovered.inputCostPerMillion,
        outputCostPerMillion: discovered.outputCostPerMillion,
        capabilities: discovered.capabilities as ('chat' | 'vision' | 'function_calling' | 'streaming' | 'json_mode')[] | undefined,
      });

      // Notify parent to refresh models list
      onModelAdded?.();

      // Select the newly created model
      onChange(newModel.id);
      setOpen(false);
    } catch (error) {
      console.error('Failed to add model:', error);
    } finally {
      setIsAddingModel(false);
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
          <PopoverContent className="w-[450px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search models..."
                value={search}
                onValueChange={setSearch}
              />
              <div
                className="h-[300px] overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.2) transparent',
                }}
                onWheel={(e) => e.stopPropagation()}
              >
                <CommandList className="max-h-none">
                {isDiscovering && (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Discovering available models...
                  </div>
                )}

                {!isDiscovering && filteredModels.length === 0 && unconfiguredModels.length === 0 && (
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
                            <span>{model.displayName}</span>
                            <span className="text-xs text-gray-500">
                              {model.modelId}
                              {model.contextWindow && ` • ${(model.contextWindow / 1000).toFixed(0)}k context`}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}

                {/* Unconfigured (Discovered) Models */}
                {unconfiguredModels.length > 0 && (
                  <>
                    {filteredModels.length > 0 && <CommandSeparator />}
                    <CommandGroup heading={
                      <span className="flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Available from API (click to add)
                      </span>
                    }>
                      {unconfiguredModels
                        .filter(
                          (m) =>
                            m.displayName.toLowerCase().includes(search.toLowerCase()) ||
                            m.modelId.toLowerCase().includes(search.toLowerCase())
                        )
                        .slice(0, 20) // Limit to avoid overwhelming the UI
                        .map((model) => (
                          <CommandItem
                            key={model.modelId}
                            value={model.modelId}
                            onSelect={() => handleAddAndSelect(model)}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4 text-campfire-500" />
                            <div className="flex flex-col flex-1">
                              <span>{model.displayName}</span>
                              <span className="text-xs text-gray-500">
                                {model.modelId}
                                {model.contextWindow && ` • ${(model.contextWindow / 1000).toFixed(0)}k context`}
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

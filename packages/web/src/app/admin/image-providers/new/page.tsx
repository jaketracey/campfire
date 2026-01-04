'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Image, ArrowLeft, Save, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { createImageProvider, type CreateImageProviderInput } from '@/lib/api/image-providers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const IMAGE_PROVIDER_OPTIONS = [
  { value: 'fal', label: 'FAL.ai' },
  { value: 'replicate', label: 'Replicate' },
  { value: 'comfyui', label: 'ComfyUI (Local)' },
  { value: 'stability', label: 'Stability AI' },
  { value: 'openai', label: 'OpenAI (DALL-E)' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'leonardo', label: 'Leonardo.ai' },
];

export default function NewImageProviderPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [provider, setProvider] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [rateLimitRpm, setRateLimitRpm] = useState<number | ''>('');
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState<number | ''>(10);
  const [priority, setPriority] = useState<number | ''>(0);

  const isLocalProvider = provider === 'comfyui';

  const handleProviderChange = (value: string) => {
    setProvider(value);
    const option = IMAGE_PROVIDER_OPTIONS.find((o) => o.value === value);
    if (option && !displayName) {
      setDisplayName(option.label);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const input: CreateImageProviderInput = {
        provider,
        displayName,
        isEnabled,
        apiBaseUrl: apiBaseUrl || undefined,
        rateLimitRpm: rateLimitRpm === '' ? undefined : rateLimitRpm,
        maxConcurrentRequests: maxConcurrentRequests === '' ? 10 : maxConcurrentRequests,
        priority: priority === '' ? 0 : priority,
      };

      if (apiKey) {
        input.apiKey = apiKey;
      }

      const result = await createImageProvider(input);
      router.push(`/admin/image-providers/${result.id}` as Route);
    } catch (err) {
      console.error('Failed to create image provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to create image provider');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={'/admin/image-providers' as Route}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Add Image Provider</h1>
          <p className="text-gray-400 text-sm">Configure a new image generation provider</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="bg-white/[0.02] border-white/5 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Image className="h-5 w-5 text-purple-500" />
              Provider Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="provider">Provider Type</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., FAL.ai Dreamina"
                className="bg-white/5 border-white/10"
                required
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="isEnabled">Enabled</Label>
              <Switch
                id="isEnabled"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
            </div>

            {!isLocalProvider && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter API key"
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
                <p className="text-xs text-gray-500">
                  API key will be encrypted before storage
                </p>
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
                placeholder={isLocalProvider ? 'http://localhost:8188' : 'Leave empty for default endpoint'}
                className="bg-white/5 border-white/10"
              />
              <p className="text-xs text-gray-500">
                {isLocalProvider
                  ? 'URL of your local ComfyUI instance'
                  : 'Override the default API endpoint (useful for proxies)'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rateLimitRpm">Rate Limit (requests/min)</Label>
                <Input
                  id="rateLimitRpm"
                  type="number"
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(e.target.value === '' ? '' : parseInt(e.target.value))}
                  placeholder="Leave empty for no limit"
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxConcurrent">Max Concurrent Requests</Label>
                <Input
                  id="maxConcurrent"
                  type="number"
                  value={maxConcurrentRequests}
                  onChange={(e) => setMaxConcurrentRequests(e.target.value === '' ? '' : parseInt(e.target.value))}
                  placeholder="10"
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority (lower = higher priority)</Label>
              <Input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value === '' ? '' : parseInt(e.target.value))}
                placeholder="0"
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Link href={'/admin/image-providers' as Route}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={isSaving || !provider || !displayName}
                className="gap-2 bg-campfire-600 hover:bg-campfire-700"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Creating...' : 'Create Provider'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

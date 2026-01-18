'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { Route } from 'next';
import {
  ArrowLeft,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
  Clock,
  Settings2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  getInfluencerModel,
  getLoraDownloadUrl,
  generateSample,
  listSamples,
  getSample,
  deleteSample,
  type InfluencerModelWithImages,
  type InfluencerModelSample,
} from '@/lib/api/influencer-models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

const STATUS_COLORS = {
  pending: 'bg-gray-500',
  generating: 'bg-yellow-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

const STATUS_LABELS = {
  pending: 'Pending',
  generating: 'Generating',
  completed: 'Completed',
  failed: 'Failed',
};

export default function AdminInfluencerModelPage() {
  const router = useRouter();
  const params = useParams();
  const modelId = params.id as string;

  const [model, setModel] = useState<InfluencerModelWithImages | null>(null);
  const [samples, setSamples] = useState<InfluencerModelSample[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Generation form state
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [loraScale, setLoraScale] = useState(1.0);
  const [numSteps, setNumSteps] = useState(28);
  const [seed, setSeed] = useState<string>('');
  const [width, setWidth] = useState(768);
  const [height, setHeight] = useState(1024);

  // Polling for sample status
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Load model and samples
  useEffect(() => {
    loadData();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [modelId]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [modelData, samplesData] = await Promise.all([
        getInfluencerModel(modelId),
        listSamples(modelId),
      ]);
      setModel(modelData);
      setSamples(samplesData.samples);

      // Start polling if there are pending/generating samples
      const hasPending = samplesData.samples.some(
        (s) => s.status === 'pending' || s.status === 'generating'
      );
      if (hasPending) {
        startPolling();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model');
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const { samples: updatedSamples } = await listSamples(modelId);
        setSamples(updatedSamples);

        // Stop polling if no more pending samples
        const hasPending = updatedSamples.some(
          (s) => s.status === 'pending' || s.status === 'generating'
        );
        if (!hasPending && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);
  }, [modelId]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      const newSample = await generateSample(modelId, {
        prompt: prompt.trim(),
        negative_prompt: negativePrompt.trim() || undefined,
        guidance_scale: guidanceScale,
        lora_scale: loraScale,
        num_inference_steps: numSteps,
        seed: seed ? parseInt(seed, 10) : undefined,
        width,
        height,
      });

      setSamples((prev) => [newSample, ...prev]);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate sample');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteSample = async (sampleId: string) => {
    if (!confirm('Delete this sample?')) return;

    try {
      await deleteSample(modelId, sampleId);
      setSamples((prev) => prev.filter((s) => s.id !== sampleId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sample');
    }
  };

  const handleDownloadLora = async () => {
    try {
      const url = await getLoraDownloadUrl(modelId);
      if (url) {
        window.open(url, '_blank');
      }
    } catch (err) {
      setError('Failed to get download URL');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-campfire-500" />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <p className="text-white">Model not found</p>
        <Button
          variant="outline"
          onClick={() => router.push('/admin/influencer' as Route)}
          className="mt-4 border-white/10"
        >
          Back to Models
        </Button>
      </div>
    );
  }

  const isReady = model.status === 'ready';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/admin/influencer' as Route)}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">{model.name}</h1>
            <p className="text-gray-400 text-sm">
              Trigger word: <span className="font-mono text-campfire-500">{model.triggerWord}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {model.hasLora && (
            <Button
              variant="outline"
              onClick={handleDownloadLora}
              className="border-white/10"
            >
              <Download className="h-4 w-4 mr-2" />
              Download LoRA
            </Button>
          )}
        </div>
      </div>

      {/* Model Info */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Status</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  model.status === 'ready'
                    ? 'bg-green-500'
                    : model.status === 'training'
                    ? 'bg-yellow-500'
                    : model.status === 'failed'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
                )}
              />
              <span className="text-white capitalize">{model.status}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Training Images</p>
            <p className="text-white text-lg font-medium mt-1">{model.imageCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Training Steps</p>
            <p className="text-white text-lg font-medium mt-1">{model.trainingSteps}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Type</p>
            <p className="text-white text-lg font-medium mt-1">
              {model.isStyle ? 'Style' : 'Subject'}
            </p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Sample Generation */}
      {isReady ? (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-campfire-500" />
              Generate Sample Images
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prompt" className="text-white">
                Prompt
              </Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`A portrait photo of ${model.triggerWord}, professional lighting...`}
                className="bg-white/5 border-white/10 min-h-[80px]"
              />
              <p className="text-xs text-gray-500">
                The trigger word <span className="font-mono text-campfire-500">{model.triggerWord}</span> will be automatically appended
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="negativePrompt" className="text-white">
                Negative Prompt (optional)
              </Label>
              <Textarea
                id="negativePrompt"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="blurry, low quality, distorted..."
                className="bg-white/5 border-white/10 min-h-[60px]"
              />
            </div>

            {/* Advanced Settings Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <Settings2 className="h-4 w-4" />
              Advanced Settings
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {/* Advanced Settings */}
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-6 p-4 rounded-lg bg-white/[0.02]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-white text-sm">Guidance Scale</Label>
                    <span className="text-sm text-gray-400">{guidanceScale.toFixed(1)}</span>
                  </div>
                  <Slider
                    value={[guidanceScale]}
                    onValueChange={([v]) => setGuidanceScale(v)}
                    min={1}
                    max={20}
                    step={0.5}
                    className="w-full"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-white text-sm">LoRA Scale</Label>
                    <span className="text-sm text-gray-400">{loraScale.toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[loraScale]}
                    onValueChange={([v]) => setLoraScale(v)}
                    min={0}
                    max={1.5}
                    step={0.05}
                    className="w-full"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-white text-sm">Inference Steps</Label>
                    <span className="text-sm text-gray-400">{numSteps}</span>
                  </div>
                  <Slider
                    value={[numSteps]}
                    onValueChange={([v]) => setNumSteps(v)}
                    min={10}
                    max={50}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seed" className="text-white text-sm">
                    Seed (optional)
                  </Label>
                  <Input
                    id="seed"
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    placeholder="Random"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="width" className="text-white text-sm">
                    Width
                  </Label>
                  <Input
                    id="width"
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(parseInt(e.target.value) || 768)}
                    min={256}
                    max={1536}
                    step={64}
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="height" className="text-white text-sm">
                    Height
                  </Label>
                  <Input
                    id="height"
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(parseInt(e.target.value) || 1024)}
                    min={256}
                    max={1536}
                    step={64}
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="bg-campfire-500 hover:bg-campfire-600"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Generate Sample
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Model Not Ready</h3>
            <p className="text-gray-400">
              {model.status === 'training'
                ? 'Training is in progress. Samples can be generated once training completes.'
                : model.status === 'failed'
                ? 'Training failed. Please check the error and try again.'
                : 'This model needs to complete training before samples can be generated.'}
            </p>
            {model.status !== 'training' && (
              <Button
                onClick={() => router.push(`/admin/influencer/create?id=${modelId}` as Route)}
                className="mt-4 bg-campfire-500 hover:bg-campfire-600"
              >
                Continue Setup
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Samples Gallery */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-white">Generated Samples</CardTitle>
          {samples.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadData}
              className="text-gray-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {samples.length === 0 ? (
            <div className="py-12 text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-gray-600 mb-4" />
              <p className="text-gray-400">No samples generated yet</p>
              <p className="text-sm text-gray-500">
                Generate samples above to test your LoRA model
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {samples.map((sample) => (
                <div
                  key={sample.id}
                  className="relative group rounded-xl overflow-hidden bg-white/[0.02] border border-white/5"
                >
                  {/* Image or Placeholder */}
                  <div className="aspect-[3/4] relative">
                    {sample.status === 'completed' && sample.imageUrl ? (
                      <img
                        src={sample.imageUrl}
                        alt={sample.prompt}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-white/[0.02]">
                        {sample.status === 'pending' && (
                          <>
                            <Clock className="h-8 w-8 text-gray-500 mb-2" />
                            <p className="text-sm text-gray-500">Queued</p>
                          </>
                        )}
                        {sample.status === 'generating' && (
                          <>
                            <Loader2 className="h-8 w-8 text-campfire-500 animate-spin mb-2" />
                            <p className="text-sm text-gray-400">Generating...</p>
                          </>
                        )}
                        {sample.status === 'failed' && (
                          <>
                            <AlertCircle className="h-8 w-8 text-red-500 mb-2" />
                            <p className="text-sm text-red-400">Failed</p>
                            {sample.errorMessage && (
                              <p className="text-xs text-gray-500 px-4 text-center mt-1">
                                {sample.errorMessage}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Status Badge */}
                    <div className="absolute top-2 left-2">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-xs font-medium text-white',
                          STATUS_COLORS[sample.status]
                        )}
                      >
                        {STATUS_LABELS[sample.status]}
                      </span>
                    </div>

                    {/* Delete Button */}
                    <button
                      onClick={() => handleDeleteSample(sample.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                    >
                      <Trash2 className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Sample Info */}
                  <div className="p-3 border-t border-white/5">
                    <p className="text-sm text-white line-clamp-2 mb-1">{sample.prompt}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>CFG: {sample.guidanceScale}</span>
                      <span>LoRA: {sample.loraScale}</span>
                      <span>Steps: {sample.numInferenceSteps}</span>
                      {sample.seed && <span>Seed: {sample.seed}</span>}
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

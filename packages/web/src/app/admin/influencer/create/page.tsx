'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  X,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Image as ImageIcon,
} from 'lucide-react';
import {
  createInfluencerModel,
  getInfluencerModel,
  uploadImageToS3,
  removeModelImage,
  startTraining,
  checkTrainingStatus,
  type InfluencerModelWithImages,
} from '@/lib/api/influencer-models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const MIN_IMAGES = 15;
const MAX_IMAGES = 25;

type Step = 'config' | 'upload' | 'train';

interface UploadingFile {
  file: File;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  s3Key?: string;
  error?: string;
}

export default function AdminInfluencerCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingId = searchParams.get('id');

  const [currentStep, setCurrentStep] = useState<Step>('config');
  const [isLoading, setIsLoading] = useState(!!existingId);
  const [error, setError] = useState<string | null>(null);

  // Config state
  const [name, setName] = useState('');
  const [triggerWord, setTriggerWord] = useState('');
  const [trainingSteps, setTrainingSteps] = useState(1000);
  const [isStyle, setIsStyle] = useState(false);

  // Model state
  const [model, setModel] = useState<InfluencerModelWithImages | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, UploadingFile>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Training state
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Load existing model if ID provided
  useEffect(() => {
    if (existingId) {
      loadModel(existingId);
    }
  }, [existingId]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const loadModel = async (id: string) => {
    try {
      setIsLoading(true);
      const data = await getInfluencerModel(id);
      setModel(data);
      setName(data.name);
      setTriggerWord(data.triggerWord);
      setTrainingSteps(data.trainingSteps);
      setIsStyle(data.isStyle);

      // Determine current step based on status
      if (data.status === 'training' || data.status === 'downloading') {
        setCurrentStep('train');
        setIsTraining(true);
        startPolling(id);
      } else if (data.imageCount >= MIN_IMAGES) {
        setCurrentStep('train');
      } else if (data.imageCount > 0) {
        setCurrentStep('upload');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateModel = async () => {
    if (!name.trim() || !triggerWord.trim()) {
      setError('Name and trigger word are required');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const newModel = await createInfluencerModel({
        name: name.trim(),
        trigger_word: triggerWord.trim().toLowerCase(),
        training_steps: trainingSteps,
        is_style: isStyle,
      });
      setModel({
        ...newModel,
        imageUrls: [],
      });
      setCurrentStep('upload');
      // Update URL with model ID
      router.replace(`/admin/influencer/create?id=${newModel.id}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create model');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!model) return;

      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      await uploadFiles(files);
    },
    [model]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!model || !e.target.files) return;
    const files = Array.from(e.target.files);
    await uploadFiles(files);
    e.target.value = '';
  };

  const uploadFiles = async (files: File[]) => {
    if (!model) return;

    const currentImageCount = model.imageUrls.length;
    const remainingSlots = MAX_IMAGES - currentImageCount;
    const filesToUpload = files.slice(0, remainingSlots);

    for (const file of filesToUpload) {
      const fileId = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => {
        const next = new Map(prev);
        next.set(fileId, { file, progress: 0, status: 'uploading' });
        return next;
      });

      try {
        const { s3Key } = await uploadImageToS3(model.id, file, (progress) => {
          setUploadingFiles((prev) => {
            const next = new Map(prev);
            const existing = next.get(fileId);
            if (existing) {
              next.set(fileId, { ...existing, progress });
            }
            return next;
          });
        });

        setUploadingFiles((prev) => {
          const next = new Map(prev);
          next.set(fileId, { file, progress: 100, status: 'done', s3Key });
          return next;
        });

        // Refresh model to get updated image list
        const updated = await getInfluencerModel(model.id);
        setModel(updated);
      } catch (err) {
        setUploadingFiles((prev) => {
          const next = new Map(prev);
          next.set(fileId, {
            file,
            progress: 0,
            status: 'error',
            error: err instanceof Error ? err.message : 'Upload failed',
          });
          return next;
        });
      }
    }

    // Clear completed uploads after a delay
    setTimeout(() => {
      setUploadingFiles((prev) => {
        const next = new Map(prev);
        for (const [key, value] of next) {
          if (value.status === 'done') {
            next.delete(key);
          }
        }
        return next;
      });
    }, 2000);
  };

  const handleRemoveImage = async (s3Key: string) => {
    if (!model) return;
    try {
      const updated = await removeModelImage(model.id, s3Key);
      setModel({
        ...updated,
        imageUrls: model.imageUrls.filter((img) => img.s3Key !== s3Key),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove image');
    }
  };

  const handleStartTraining = async () => {
    if (!model) return;

    try {
      setIsLoading(true);
      setError(null);
      const updated = await startTraining(model.id);
      setModel({ ...model, ...updated });
      setIsTraining(true);
      setCurrentStep('train');
      startPolling(model.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training');
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = (modelId: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    let pollCount = 0;
    pollingRef.current = setInterval(async () => {
      try {
        const updated = await checkTrainingStatus(modelId);
        setModel((prev) => (prev ? { ...prev, ...updated } : null));

        // Simulate progress (FAL doesn't give real progress)
        pollCount++;
        const estimatedProgress = Math.min(95, pollCount * 2);
        setTrainingProgress(estimatedProgress);

        if (updated.status === 'ready' || updated.status === 'failed') {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setIsTraining(false);
          setTrainingProgress(100);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 5000);
  };

  const canProceedToUpload = name.trim() && triggerWord.trim();
  const canProceedToTrain = model && model.imageCount >= MIN_IMAGES;
  const canStartTraining = model && model.imageCount >= MIN_IMAGES && !isTraining;

  if (isLoading && !model) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-campfire-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
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
          <h1 className="text-2xl font-bold text-white">
            {model ? `Training: ${model.name}` : 'Train New Model'}
          </h1>
          <p className="text-gray-400 text-sm">
            Create a custom LoRA model for an influencer persona
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {(['config', 'upload', 'train'] as Step[]).map((step, i) => (
          <div key={step} className="flex items-center">
            <div
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium',
                currentStep === step
                  ? 'bg-campfire-500 text-white'
                  : step === 'config' ||
                    (step === 'upload' && model) ||
                    (step === 'train' && canProceedToTrain)
                  ? 'bg-white/20 text-white'
                  : 'bg-white/5 text-gray-500'
              )}
            >
              {i + 1}
            </div>
            <span
              className={cn(
                'ml-2 text-sm',
                currentStep === step ? 'text-white' : 'text-gray-500'
              )}
            >
              {step === 'config' && 'Configure'}
              {step === 'upload' && 'Upload Images'}
              {step === 'train' && 'Train'}
            </span>
            {i < 2 && <div className="w-12 h-px bg-white/10 mx-4" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Configure */}
      {currentStep === 'config' && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white">Model Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-white">
                  Model Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Sarah Johnson"
                  className="bg-white/5 border-white/10"
                />
                <p className="text-xs text-gray-500">A descriptive name for this model</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="triggerWord" className="text-white">
                  Trigger Word
                </Label>
                <Input
                  id="triggerWord"
                  value={triggerWord}
                  onChange={(e) => setTriggerWord(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g., sarahj"
                  className="bg-white/5 border-white/10 font-mono"
                />
                <p className="text-xs text-gray-500">
                  Unique token to invoke this LoRA (lowercase, no spaces)
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="steps" className="text-white">
                  Training Steps
                </Label>
                <Input
                  id="steps"
                  type="number"
                  value={trainingSteps}
                  onChange={(e) => setTrainingSteps(parseInt(e.target.value) || 1000)}
                  min={100}
                  max={5000}
                  className="bg-white/5 border-white/10"
                />
                <p className="text-xs text-gray-500">More steps = better quality but longer training</p>
              </div>
              <div className="space-y-2">
                <Label className="text-white">Model Type</Label>
                <div className="flex items-center space-x-2 pt-2">
                  <Switch
                    id="isStyle"
                    checked={isStyle}
                    onCheckedChange={setIsStyle}
                  />
                  <Label htmlFor="isStyle" className="text-gray-400">
                    Style LoRA (vs Person/Subject)
                  </Label>
                </div>
                <p className="text-xs text-gray-500">
                  Enable if training on art style rather than a person
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleCreateModel}
                disabled={!canProceedToUpload || isLoading}
                className="bg-campfire-500 hover:bg-campfire-600"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Continue to Upload
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Upload Images */}
      {currentStep === 'upload' && model && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span>Upload Training Images</span>
              <span className="text-sm font-normal text-gray-400">
                {model.imageCount} / {MAX_IMAGES} images
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Requirements */}
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <h4 className="text-blue-400 font-medium mb-2">Image Requirements</h4>
              <ul className="text-sm text-gray-400 space-y-1">
                <li>- Upload {MIN_IMAGES}-{MAX_IMAGES} high-quality images</li>
                <li>- Use clear, well-lit photos with the subject clearly visible</li>
                <li>- Include variety: different angles, expressions, outfits</li>
                <li>- Supported formats: JPEG, PNG, WebP</li>
              </ul>
            </div>

            {/* Drop Zone */}
            <div
              onDrop={handleFileDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                model.imageCount >= MAX_IMAGES
                  ? 'border-gray-700 bg-gray-900/50 cursor-not-allowed'
                  : 'border-white/20 hover:border-campfire-500 hover:bg-white/[0.02]'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={model.imageCount >= MAX_IMAGES}
              />
              <Upload className="h-12 w-12 mx-auto text-gray-500 mb-4" />
              {model.imageCount >= MAX_IMAGES ? (
                <p className="text-gray-500">Maximum images reached</p>
              ) : (
                <>
                  <p className="text-white mb-1">Drop images here or click to browse</p>
                  <p className="text-sm text-gray-500">
                    {MAX_IMAGES - model.imageCount} slots remaining
                  </p>
                </>
              )}
            </div>

            {/* Upload Progress */}
            {uploadingFiles.size > 0 && (
              <div className="space-y-2">
                {Array.from(uploadingFiles.entries()).map(([id, upload]) => (
                  <div
                    key={id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03]"
                  >
                    <ImageIcon className="h-5 w-5 text-gray-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{upload.file.name}</p>
                      {upload.status === 'uploading' && (
                        <Progress value={upload.progress} className="h-1 mt-1" />
                      )}
                      {upload.status === 'error' && (
                        <p className="text-xs text-red-400 mt-1">{upload.error}</p>
                      )}
                    </div>
                    {upload.status === 'done' && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {upload.status === 'uploading' && (
                      <Loader2 className="h-5 w-5 text-campfire-500 animate-spin" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Image Grid */}
            {model.imageUrls.length > 0 && (
              <div className="grid grid-cols-5 gap-4">
                {model.imageUrls.map((img) => (
                  <div key={img.s3Key} className="relative group aspect-square">
                    <img
                      src={img.url}
                      alt="Training image"
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      onClick={() => handleRemoveImage(img.s3Key)}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('config')}
                className="border-white/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep('train')}
                disabled={!canProceedToTrain}
                className="bg-campfire-500 hover:bg-campfire-600"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Continue to Training
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Train */}
      {currentStep === 'train' && model && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white">Training</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-white/[0.03]">
                <p className="text-sm text-gray-500">Model</p>
                <p className="text-white font-medium">{model.name}</p>
              </div>
              <div className="p-4 rounded-lg bg-white/[0.03]">
                <p className="text-sm text-gray-500">Trigger Word</p>
                <p className="text-white font-mono">{model.triggerWord}</p>
              </div>
              <div className="p-4 rounded-lg bg-white/[0.03]">
                <p className="text-sm text-gray-500">Training Images</p>
                <p className="text-white">{model.imageCount}</p>
              </div>
            </div>

            {/* Training Status */}
            {model.status === 'ready' ? (
              <div className="p-6 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Training Complete!</h3>
                <p className="text-gray-400 mb-4">
                  Your LoRA model is ready to use. Use the trigger word{' '}
                  <span className="font-mono text-campfire-500">{model.triggerWord}</span> in
                  your prompts.
                </p>
                <Button
                  onClick={() => router.push('/admin/influencer' as Route)}
                  className="bg-campfire-500 hover:bg-campfire-600"
                >
                  View All Models
                </Button>
              </div>
            ) : model.status === 'failed' ? (
              <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Training Failed</h3>
                <p className="text-gray-400 mb-2">{model.statusMessage || 'An error occurred during training.'}</p>
                <p className="text-sm text-gray-500">
                  You can try again with different images or contact support.
                </p>
              </div>
            ) : isTraining ? (
              <div className="p-6 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-center">
                <Sparkles className="h-12 w-12 mx-auto text-yellow-500 mb-4 animate-pulse" />
                <h3 className="text-xl font-bold text-white mb-2">Training in Progress</h3>
                <p className="text-gray-400 mb-4">
                  This typically takes 5-10 minutes. You can leave this page and check back later.
                </p>
                <div className="max-w-md mx-auto">
                  <Progress value={trainingProgress} className="h-2 mb-2" />
                  <p className="text-sm text-gray-500">
                    {model.status === 'downloading' ? 'Downloading weights...' : 'Training model...'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-white/[0.03] text-center">
                <Sparkles className="h-12 w-12 mx-auto text-campfire-500 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Ready to Train</h3>
                <p className="text-gray-400 mb-4">
                  {model.imageCount} images uploaded and ready. Click below to start training.
                </p>
                <Button
                  onClick={handleStartTraining}
                  disabled={!canStartTraining || isLoading}
                  className="bg-campfire-500 hover:bg-campfire-600"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Start Training
                </Button>
              </div>
            )}

            {/* Back button */}
            {!isTraining && model.status !== 'ready' && model.status !== 'failed' && (
              <div className="flex justify-start">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep('upload')}
                  className="border-white/10"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Images
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

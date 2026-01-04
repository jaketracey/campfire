'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Save,
  Loader2,
  Play,
  Volume2,
  Upload,
  Wand2,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Combine,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  getCreative,
  createCreative,
  updateCreative,
  generateVideo,
  generateVoiceover,
  getGenerationStatus,
  uploadCombinedVideo,
  listVideoModels,
  publishToGoogle,
  publishToFacebook,
  type AdCreative,
  type VideoModel,
  type AdCreativeStatus,
} from '@/lib/api/creatives';
import { get } from '@/lib/api/client';

interface CreativeEditorProps {
  creativeId: string | null;
  isNew: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface Voice {
  id: string;
  name: string;
  description: string;
  gender: 'feminine' | 'masculine' | 'neutral';
}

const statusColors: Record<AdCreativeStatus, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  generating_video: 'bg-blue-500/20 text-blue-400',
  generating_voiceover: 'bg-purple-500/20 text-purple-400',
  ready: 'bg-green-500/20 text-green-400',
  published: 'bg-campfire-500/20 text-campfire-400',
  failed: 'bg-red-500/20 text-red-400',
};

const statusLabels: Record<AdCreativeStatus, string> = {
  draft: 'Draft',
  generating_video: 'Generating Video...',
  generating_voiceover: 'Generating Voiceover...',
  ready: 'Ready',
  published: 'Published',
  failed: 'Failed',
};

export function CreativeEditor({
  creativeId,
  isNew,
  onClose,
  onSave,
}: CreativeEditorProps) {
  const { toast } = useToast();
  const [creative, setCreative] = useState<AdCreative | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoDuration, setVideoDuration] = useState(5);
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>('');
  const [scriptText, setScriptText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');

  // Video models and voices
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [defaultVideoModel, setDefaultVideoModel] = useState<string>('');
  const [voices, setVoices] = useState<Voice[]>([]);

  // Generation state
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
  const [isCombining, setIsCombining] = useState(false);
  const [isPublishing, setIsPublishing] = useState<'google' | 'facebook' | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Load video models and voices
  useEffect(() => {
    async function loadOptions() {
      try {
        const [modelsRes, voicesRes] = await Promise.all([
          listVideoModels(),
          get('/voice/list') as Promise<{ success: boolean; data?: { voices: Voice[] } }>,
        ]);

        if (modelsRes.success && modelsRes.data) {
          setVideoModels(modelsRes.data.models);
          setDefaultVideoModel(modelsRes.data.defaultModel);
          if (!selectedVideoModel) {
            setSelectedVideoModel(modelsRes.data.defaultModel);
          }
        }

        if (voicesRes.success && voicesRes.data) {
          setVoices(voicesRes.data.voices);
        }
      } catch (error) {
        console.error('Failed to load options:', error);
      }
    }
    loadOptions();
  }, []);

  // Load creative data
  useEffect(() => {
    if (creativeId && !isNew) {
      fetchCreative();
    } else {
      resetForm();
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [creativeId, isNew]);

  const resetForm = () => {
    setCreative(null);
    setName('');
    setDescription('');
    setSourceImageUrl('');
    setVideoPrompt('');
    setVideoDuration(5);
    setSelectedVideoModel(defaultVideoModel);
    setScriptText('');
    setSelectedVoiceId('');
  };

  const fetchCreative = async () => {
    if (!creativeId) return;
    try {
      setIsLoading(true);
      const res = await getCreative(creativeId);
      if (res.success && res.data) {
        const c = res.data;
        setCreative(c);
        setName(c.name);
        setDescription(c.description || '');
        setSourceImageUrl(c.source_image_url || '');
        setVideoPrompt(c.video_prompt || '');
        setVideoDuration(c.video_duration_seconds || 5);
        setSelectedVideoModel(c.video_model_id || defaultVideoModel);
        setScriptText(c.script_text || '');
        setSelectedVoiceId(c.voice_id || '');

        // Start polling if generating
        if (c.status === 'generating_video' || c.status === 'generating_voiceover') {
          startPolling();
        }
      }
    } catch (error) {
      console.error('Failed to fetch creative:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    pollingRef.current = setInterval(async () => {
      if (!creativeId) return;

      try {
        const res = await getGenerationStatus(creativeId);
        if (res.success && res.data) {
          const { status } = res.data;

          // Update creative state
          setCreative((prev) =>
            prev
              ? {
                  ...prev,
                  status,
                  video_url: res.data!.videoUrl,
                  voiceover_url: res.data!.voiceoverUrl,
                  final_video_url: res.data!.finalVideoUrl,
                  generation_error: res.data!.generationError,
                }
              : null
          );

          // Stop polling if done
          if (status === 'ready' || status === 'failed' || status === 'published') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            setIsGeneratingVideo(false);
            setIsGeneratingVoiceover(false);

            if (status === 'failed') {
              toast({
                title: 'Generation Failed',
                description: res.data.generationError || 'An error occurred during generation.',
                variant: 'destructive',
              });
            } else if (status === 'ready') {
              toast({
                title: 'Generation Complete',
                description: 'Your creative is ready!',
              });
            }
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 3000);
  }, [creativeId, toast]);

  const handleSave = async () => {
    if (!name.trim()) return;

    try {
      setIsSaving(true);
      const data = {
        name,
        description: description || undefined,
        sourceImageUrl: sourceImageUrl || undefined,
        videoPrompt: videoPrompt || undefined,
        videoDurationSeconds: videoDuration,
        videoModelId: selectedVideoModel || undefined,
        scriptText: scriptText || undefined,
        voiceId: selectedVoiceId || undefined,
      };

      if (isNew) {
        const res = await createCreative(data);
        if (res.success && res.data) {
          toast({ title: 'Creative Created', description: 'Your creative has been saved.' });
          onSave();
          onClose();
        }
      } else if (creativeId) {
        const res = await updateCreative(creativeId, data);
        if (res.success) {
          toast({ title: 'Creative Updated', description: 'Changes have been saved.' });
          onSave();
          fetchCreative();
        }
      }
    } catch (error) {
      console.error('Failed to save creative:', error);
      toast({
        title: 'Save Failed',
        description: 'Failed to save creative. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!creativeId || !sourceImageUrl) {
      toast({
        title: 'Missing Source Image',
        description: 'Please provide a source image URL first.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsGeneratingVideo(true);
      const res = await generateVideo(creativeId, {
        videoModelId: selectedVideoModel,
        videoPrompt,
        sourceImageUrl,
        durationSeconds: videoDuration,
      });

      if (res.success) {
        toast({ title: 'Video Generation Started', description: 'This may take a few minutes...' });
        startPolling();
      } else {
        throw new Error(res.error || 'Failed to start video generation');
      }
    } catch (error) {
      console.error('Failed to generate video:', error);
      setIsGeneratingVideo(false);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Failed to start video generation.',
        variant: 'destructive',
      });
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!creativeId || !scriptText) {
      toast({
        title: 'Missing Script',
        description: 'Please enter a script for the voiceover.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsGeneratingVoiceover(true);
      const res = await generateVoiceover(creativeId, {
        voiceId: selectedVoiceId || undefined,
        scriptText,
      });

      if (res.success) {
        toast({ title: 'Voiceover Generation Started', description: 'Generating audio...' });
        startPolling();
      } else {
        throw new Error(res.error || 'Failed to start voiceover generation');
      }
    } catch (error) {
      console.error('Failed to generate voiceover:', error);
      setIsGeneratingVoiceover(false);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Failed to start voiceover generation.',
        variant: 'destructive',
      });
    }
  };

  const handleCombine = async () => {
    if (!creative?.video_url || !creative?.voiceover_url) {
      toast({
        title: 'Missing Assets',
        description: 'Both video and voiceover must be generated first.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsCombining(true);

      // Import the AV combiner dynamically
      const { combineVideoAndAudio, uploadCombinedToS3 } = await import('@/lib/av-combiner');

      toast({ title: 'Combining Media', description: 'Merging video and audio...' });

      // Combine video and audio client-side
      const combinedBlob = await combineVideoAndAudio(creative.video_url, creative.voiceover_url);

      toast({ title: 'Uploading', description: 'Uploading combined video...' });

      // Upload to S3
      const uploadResult = await uploadCombinedToS3(combinedBlob, creative.id);

      // Update the creative with the final URL
      const res = await uploadCombinedVideo(creative.id, {
        finalVideoUrl: uploadResult.url,
        finalVideoS3Key: uploadResult.s3Key,
        fileSizeBytes: combinedBlob.size,
        durationMs: (creative.video_duration_seconds || 5) * 1000,
      });

      if (res.success) {
        toast({ title: 'Success', description: 'Video and audio combined successfully!' });
        fetchCreative();
      }
    } catch (error) {
      console.error('Failed to combine:', error);
      toast({
        title: 'Combine Failed',
        description: error instanceof Error ? error.message : 'Failed to combine video and audio.',
        variant: 'destructive',
      });
    } finally {
      setIsCombining(false);
    }
  };

  const handlePublish = async (platform: 'google' | 'facebook') => {
    if (!creativeId || !creative?.final_video_url) {
      toast({
        title: 'Not Ready',
        description: 'Please combine video and audio first.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsPublishing(platform);
      const res =
        platform === 'google'
          ? await publishToGoogle(creativeId)
          : await publishToFacebook(creativeId);

      if (res.success) {
        toast({
          title: 'Published',
          description: `Creative published to ${platform === 'google' ? 'Google' : 'Facebook'} Ads.`,
        });
        fetchCreative();
      } else {
        throw new Error(res.error || 'Failed to publish');
      }
    } catch (error) {
      console.error('Failed to publish:', error);
      toast({
        title: 'Publish Failed',
        description: error instanceof Error ? error.message : 'Failed to publish creative.',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(null);
    }
  };

  const isGenerating = creative?.status === 'generating_video' || creative?.status === 'generating_voiceover';
  const hasVideo = !!creative?.video_url;
  const hasVoiceover = !!creative?.voiceover_url;
  const hasFinal = !!creative?.final_video_url;

  if (isLoading) {
    return (
      <Card className="h-full bg-white/[0.02] border-white/5">
        <CardContent className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-white/[0.02] border-white/5 flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <CardTitle className="text-lg">
            {isNew ? 'New Creative' : creative?.name || 'Edit Creative'}
          </CardTitle>
          {creative && (
            <Badge className={cn('text-xs', statusColors[creative.status])}>
              {statusLabels[creative.status]}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="gap-2">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="gap-2 bg-campfire-500 hover:bg-campfire-600"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto py-6 space-y-8">
        {/* Basic Info */}
        <section className="space-y-4">
          <h4 className="text-sm font-medium text-white">Basic Info</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Creative name"
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="bg-white/5 border-white/10"
              />
            </div>
          </div>
        </section>

        {/* Video Section */}
        <section className="space-y-4">
          <h4 className="text-sm font-medium text-white flex items-center gap-2">
            <Play className="h-4 w-4" />
            Video Generation
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="source-image">Source Image URL *</Label>
              <div className="flex gap-2">
                <Input
                  id="source-image"
                  value={sourceImageUrl}
                  onChange={(e) => setSourceImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="bg-white/5 border-white/10"
                />
                <Button variant="outline" size="icon" className="shrink-0">
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Video Model</Label>
              <Select value={selectedVideoModel} onValueChange={setSelectedVideoModel}>
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Select model..." />
                </SelectTrigger>
                <SelectContent>
                  {videoModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center justify-between w-full gap-4">
                        <span>{model.display_name}</span>
                        <span className="text-xs text-gray-500">
                          ${(model.cost_per_second_cents / 100).toFixed(2)}/s
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="video-prompt">Motion Prompt</Label>
              <Textarea
                id="video-prompt"
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder="Describe the motion and animation..."
                rows={3}
                className="bg-white/5 border-white/10 resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>Duration</Label>
              <Select
                value={String(videoDuration)}
                onValueChange={(v) => setVideoDuration(Number(v))}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 seconds</SelectItem>
                  <SelectItem value="10">10 seconds</SelectItem>
                  <SelectItem value="15">15 seconds</SelectItem>
                </SelectContent>
              </Select>

              <Button
                onClick={handleGenerateVideo}
                disabled={!creativeId || !sourceImageUrl || isGenerating || isGeneratingVideo}
                className="w-full mt-2 gap-2"
              >
                {isGeneratingVideo || creative?.status === 'generating_video' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Generate Video
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Preview images/video */}
          <div className="flex gap-4">
            {sourceImageUrl && (
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Source</Label>
                <div className="w-40 aspect-[9/16] rounded overflow-hidden bg-black/20">
                  <img src={sourceImageUrl} alt="Source" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
            {creative?.video_url && (
              <div className="space-y-2">
                <Label className="text-xs text-gray-500 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  Generated Video
                </Label>
                <div className="w-40 aspect-[9/16] rounded overflow-hidden bg-black/20">
                  <video
                    src={creative.video_url}
                    controls
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Audio Section */}
        <section className="space-y-4">
          <h4 className="text-sm font-medium text-white flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            Voiceover
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="script">Script</Label>
              <Textarea
                id="script"
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder="Enter the voiceover script..."
                rows={4}
                className="bg-white/5 border-white/10 resize-none"
              />
              <p className="text-xs text-gray-500">{scriptText.length} characters</p>
            </div>

            <div className="space-y-2">
              <Label>Voice</Label>
              <Select value={selectedVoiceId} onValueChange={setSelectedVoiceId}>
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Select voice..." />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      <div className="flex flex-col">
                        <span>{voice.name}</span>
                        <span className="text-xs text-gray-500">{voice.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                onClick={handleGenerateVoiceover}
                disabled={!creativeId || !scriptText || isGenerating || isGeneratingVoiceover}
                className="w-full mt-2 gap-2"
                variant="outline"
              >
                {isGeneratingVoiceover || creative?.status === 'generating_voiceover' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Generate Voiceover
                  </>
                )}
              </Button>
            </div>
          </div>

          {creative?.voiceover_url && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                Generated Voiceover
              </Label>
              <audio src={creative.voiceover_url} controls className="w-full max-w-sm" />
            </div>
          )}
        </section>

        {/* Combine & Publish */}
        {creative && !isNew && (
          <section className="space-y-4">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Combine & Publish
            </h4>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleCombine}
                disabled={!hasVideo || !hasVoiceover || isCombining || isGenerating}
                className="gap-2"
                variant="outline"
              >
                {isCombining ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Combining...
                  </>
                ) : (
                  <>
                    <Combine className="h-4 w-4" />
                    Combine Video + Audio
                  </>
                )}
              </Button>

              <Button
                onClick={() => handlePublish('google')}
                disabled={!hasFinal || isPublishing !== null}
                className="gap-2 bg-blue-600 hover:bg-blue-700"
              >
                {isPublishing === 'google' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Publish to Google
              </Button>

              <Button
                onClick={() => handlePublish('facebook')}
                disabled={!hasFinal || isPublishing !== null}
                className="gap-2 bg-[#1877F2] hover:bg-[#166FE5]"
              >
                {isPublishing === 'facebook' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Publish to Facebook
              </Button>
            </div>

            {creative.final_video_url && (
              <div className="space-y-2">
                <Label className="text-xs text-gray-500 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  Final Creative
                </Label>
                <div className="w-48 aspect-[9/16] rounded overflow-hidden bg-black/20">
                  <video
                    src={creative.final_video_url}
                    controls
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}

            {creative.generation_error && (
              <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{creative.generation_error}</p>
              </div>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

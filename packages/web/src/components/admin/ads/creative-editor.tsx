'use client';

import { useState, useEffect } from 'react';
import { X, Save, Loader2, Play, Volume2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  getCreative,
  createCreative,
  updateCreative,
  type AdCreative,
} from '@/lib/api/creatives';

interface CreativeEditorProps {
  creativeId: string | null;
  isNew: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function CreativeEditor({
  creativeId,
  isNew,
  onClose,
  onSave,
}: CreativeEditorProps) {
  const [creative, setCreative] = useState<AdCreative | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [videoPrompt, setVideoPrompt] = useState('');
  const [scriptText, setScriptText] = useState('');

  useEffect(() => {
    if (creativeId && !isNew) {
      fetchCreative();
    } else {
      // Reset for new creative
      setCreative(null);
      setName('');
      setDescription('');
      setVideoPrompt('');
      setScriptText('');
    }
  }, [creativeId, isNew]);

  const fetchCreative = async () => {
    if (!creativeId) return;
    try {
      setIsLoading(true);
      const res = await getCreative(creativeId);
      if (res.success && res.data) {
        setCreative(res.data);
        setName(res.data.name);
        setDescription(res.data.description || '');
        setVideoPrompt(res.data.video_prompt || '');
        setScriptText(res.data.script_text || '');
      }
    } catch (error) {
      console.error('Failed to fetch creative:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      if (isNew) {
        await createCreative({
          name,
          description: description || undefined,
          videoPrompt: videoPrompt || undefined,
          scriptText: scriptText || undefined,
        });
      } else if (creativeId) {
        await updateCreative(creativeId, {
          name,
          description: description || undefined,
          videoPrompt: videoPrompt || undefined,
          scriptText: scriptText || undefined,
        });
      }
      onSave();
      if (isNew) {
        onClose();
      }
    } catch (error) {
      console.error('Failed to save creative:', error);
    } finally {
      setIsSaving(false);
    }
  };

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
        <CardTitle className="text-lg">
          {isNew ? 'New Creative' : creative?.name || 'Edit Creative'}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="gap-2 bg-campfire-500 hover:bg-campfire-600"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto py-6 space-y-6">
        {/* Basic Info */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
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
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="bg-white/5 border-white/10 resize-none"
            />
          </div>
        </div>

        {/* Video Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
            <Play className="h-4 w-4" />
            Video
          </h4>

          <div className="space-y-2">
            <Label htmlFor="video-prompt">Motion Prompt</Label>
            <Textarea
              id="video-prompt"
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              placeholder="Describe the motion and animation you want..."
              rows={3}
              className="bg-white/5 border-white/10 resize-none"
            />
          </div>

          {creative?.source_image_url && (
            <div className="space-y-2">
              <Label>Source Image</Label>
              <div className="aspect-video rounded overflow-hidden bg-black/20 max-w-sm">
                <img
                  src={creative.source_image_url}
                  alt="Source"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          {creative?.video_url && (
            <div className="space-y-2">
              <Label>Generated Video</Label>
              <div className="aspect-video rounded overflow-hidden bg-black/20 max-w-sm">
                <video
                  src={creative.video_url}
                  controls
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}
        </div>

        {/* Audio Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            Voiceover
          </h4>

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
          </div>

          {creative?.voiceover_url && (
            <div className="space-y-2">
              <Label>Generated Voiceover</Label>
              <audio src={creative.voiceover_url} controls className="w-full max-w-sm" />
            </div>
          )}
        </div>

        {/* Final Output */}
        {creative?.final_video_url && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Final Creative
            </h4>
            <div className="aspect-video rounded overflow-hidden bg-black/20 max-w-md">
              <video
                src={creative.final_video_url}
                controls
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

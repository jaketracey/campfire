'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { updateCompanionPersonality, type Companion } from '@/lib/api/companions';

const PERSONALITY_SLIDERS = [
  { key: 'warmth', label: 'Warmth', low: 'Reserved', high: 'Affectionate' },
  { key: 'energy', label: 'Energy', low: 'Calm', high: 'Energetic' },
  { key: 'humor', label: 'Humor', low: 'Serious', high: 'Playful' },
  { key: 'formality', label: 'Formality', low: 'Casual', high: 'Formal' },
  { key: 'assertiveness', label: 'Assertiveness', low: 'Passive', high: 'Assertive' },
  { key: 'openness', label: 'Openness', low: 'Private', high: 'Open' },
  { key: 'empathy', label: 'Empathy', low: 'Analytical', high: 'Empathetic' },
  { key: 'spontaneity', label: 'Spontaneity', low: 'Structured', high: 'Spontaneous' },
  { key: 'optimism', label: 'Optimism', low: 'Realistic', high: 'Optimistic' },
  { key: 'directness', label: 'Directness', low: 'Subtle', high: 'Direct' },
] as const;

type TraitKey = (typeof PERSONALITY_SLIDERS)[number]['key'];

interface PersonalityModalProps {
  companion: Companion | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedCompanion: Companion, traits: Record<string, number>) => void;
}

export function PersonalityModal({ companion, isOpen, onClose, onSave }: PersonalityModalProps) {
  const [traits, setTraits] = useState<Record<TraitKey, number>>({
    warmth: 50,
    energy: 50,
    humor: 50,
    formality: 50,
    assertiveness: 50,
    openness: 50,
    empathy: 50,
    spontaneity: 50,
    optimism: 50,
    directness: 50,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Initialize traits from companion spec when modal opens
  useEffect(() => {
    if (isOpen && companion?.spec?.personality?.traits) {
      const specTraits = companion.spec.personality.traits as Record<string, number>;
      setTraits((prev) => ({
        ...prev,
        warmth: Math.round((specTraits.warmth ?? 0.5) * 100),
        energy: Math.round((specTraits.energy ?? 0.5) * 100),
        humor: Math.round((specTraits.humor ?? specTraits.playfulness ?? 0.5) * 100),
        formality: Math.round((specTraits.formality ?? 0.5) * 100),
        assertiveness: Math.round((specTraits.assertiveness ?? 0.5) * 100),
        openness: Math.round((specTraits.openness ?? 0.5) * 100),
        empathy: Math.round((specTraits.empathy ?? 0.5) * 100),
        spontaneity: Math.round((specTraits.spontaneity ?? 0.5) * 100),
        optimism: Math.round((specTraits.optimism ?? 0.5) * 100),
        directness: Math.round((specTraits.directness ?? 0.5) * 100),
      }));
    }
  }, [isOpen, companion]);

  const handleSliderChange = (key: TraitKey) => (value: number[]) => {
    setTraits((prev) => ({ ...prev, [key]: value[0] }));
  };

  const handleSave = async () => {
    if (!companion) return;

    setIsSaving(true);
    try {
      // Convert to 0-1 scale for backend
      const normalizedTraits: Record<string, number> = {};
      for (const [key, value] of Object.entries(traits)) {
        normalizedTraits[key] = value / 100;
      }

      const updated = await updateCompanionPersonality(companion.id, normalizedTraits);
      onSave(updated, traits);
      onClose();
    } catch (error) {
      console.error('Failed to save personality:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Personality Settings</DialogTitle>
          <DialogDescription>
            Adjust your companion&apos;s personality traits. Changes will take effect immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-6 pr-2">
          {PERSONALITY_SLIDERS.map((slider) => (
            <div key={slider.key} className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-medium">{slider.label}</Label>
                <span className="text-sm text-muted-foreground font-mono">
                  {traits[slider.key]}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 text-right">
                  {slider.low}
                </span>
                <Slider
                  value={[traits[slider.key]]}
                  onValueChange={handleSliderChange(slider.key)}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-20">
                  {slider.high}
                </span>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

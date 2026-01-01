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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, X, Star, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateCompanionPersonality, type Companion } from '@/lib/api/companions';
import {
  listTenets,
  createTenet,
  updateTenetPriority,
  deleteTenet,
  type Tenet,
  type TenetCategory,
  type TenetPriority,
  type CreateTenetInput,
} from '@/lib/api/tenets';

// ============================================================================
// Personality Traits Config
// ============================================================================

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

// ============================================================================
// Tenets Config
// ============================================================================

const TENET_CATEGORY_META: Record<TenetCategory, { label: string; color: string }> = {
  communication: { label: 'Communication', color: 'cyan' },
  boundaries: { label: 'Boundaries', color: 'red' },
  engagement: { label: 'Engagement', color: 'green' },
  emotional: { label: 'Emotional', color: 'pink' },
  knowledge: { label: 'Knowledge', color: 'blue' },
  autonomy: { label: 'Autonomy', color: 'amber' },
};

const PRESET_TENETS: Array<Omit<CreateTenetInput, 'isNegation'> & { isNegation: boolean; description: string }> = [
  { category: 'communication', priority: 'core', rule: 'Always ask follow-up questions to show genuine interest', description: 'Encourages deeper conversation', isNegation: false },
  { category: 'boundaries', priority: 'core', rule: 'Never give unsolicited advice unless explicitly asked', description: 'Respects user autonomy', isNegation: true },
  { category: 'emotional', priority: 'core', rule: 'Validate feelings before offering solutions', description: 'Prioritizes emotional support', isNegation: false },
  { category: 'engagement', priority: 'core', rule: 'Remember and reference previous conversations when relevant', description: 'Creates continuity and shows care', isNegation: false },
  { category: 'knowledge', priority: 'core', rule: 'Admit uncertainty rather than guessing', description: 'Maintains honesty and trust', isNegation: false },
  { category: 'autonomy', priority: 'core', rule: 'Present options rather than making decisions for the user', description: 'Empowers user choice', isNegation: false },
];

const categoryOptions: TenetCategory[] = [
  'communication',
  'boundaries',
  'engagement',
  'emotional',
  'knowledge',
  'autonomy',
];

// ============================================================================
// Component
// ============================================================================

interface PersonalityModalProps {
  companion: Companion | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedCompanion: Companion, traits: Record<string, number>) => void;
}

export function PersonalityModal({ companion, isOpen, onClose, onSave }: PersonalityModalProps) {
  // Traits state
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

  // Tenets state
  const [tenets, setTenets] = useState<Tenet[]>([]);
  const [isLoadingTenets, setIsLoadingTenets] = useState(false);
  const [customRule, setCustomRule] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TenetCategory>('communication');
  const [isNegation, setIsNegation] = useState(false);

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

  // Load tenets when modal opens
  useEffect(() => {
    if (isOpen && companion) {
      setIsLoadingTenets(true);
      listTenets(companion.id)
        .then((response) => {
          setTenets(response.tenets);
        })
        .catch((error) => {
          console.error('Failed to load tenets:', error);
        })
        .finally(() => {
          setIsLoadingTenets(false);
        });
    }
  }, [isOpen, companion]);

  const handleSliderChange = (key: TraitKey) => (value: number[]) => {
    setTraits((prev) => ({ ...prev, [key]: value[0] }));
  };

  const handleSaveTraits = async () => {
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

  // Tenets handlers
  const coreTenets = tenets.filter((t) => t.priority === 'core');
  const situationalTenets = tenets.filter((t) => t.priority === 'situational');

  const handleAddPreset = async (preset: (typeof PRESET_TENETS)[number]) => {
    if (!companion) return;
    if (tenets.some((t) => t.rule === preset.rule)) return;

    try {
      const newTenet = await createTenet(companion.id, {
        category: preset.category,
        priority: preset.priority,
        rule: preset.rule,
        description: preset.description,
        isNegation: preset.isNegation,
      });
      setTenets((prev) => [...prev, newTenet]);
    } catch (error) {
      console.error('Failed to add tenet:', error);
    }
  };

  const handleAddCustom = async () => {
    if (!companion || customRule.trim().length < 10) return;

    const priority: TenetPriority = coreTenets.length < 5 ? 'core' : 'situational';

    try {
      const newTenet = await createTenet(companion.id, {
        category: selectedCategory,
        priority,
        rule: customRule.trim(),
        isNegation,
      });
      setTenets((prev) => [...prev, newTenet]);
      setCustomRule('');
      setIsNegation(false);
    } catch (error) {
      console.error('Failed to add custom tenet:', error);
    }
  };

  const handleTogglePriority = async (tenet: Tenet) => {
    if (!companion) return;

    const newPriority: TenetPriority = tenet.priority === 'core' ? 'situational' : 'core';

    // Can't have more than 5 core tenets
    if (newPriority === 'core' && coreTenets.length >= 5) return;

    try {
      const updated = await updateTenetPriority(companion.id, tenet.id, newPriority);
      setTenets((prev) => prev.map((t) => (t.id === tenet.id ? updated : t)));
    } catch (error) {
      console.error('Failed to update tenet priority:', error);
    }
  };

  const handleDeleteTenet = async (tenetId: string) => {
    if (!companion) return;

    try {
      await deleteTenet(companion.id, tenetId);
      setTenets((prev) => prev.filter((t) => t.id !== tenetId));
    } catch (error) {
      console.error('Failed to delete tenet:', error);
    }
  };

  const getCategoryStyle = (category: TenetCategory) => {
    const meta = TENET_CATEGORY_META[category];
    const colorMap: Record<string, string> = {
      cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      red: 'bg-red-500/20 text-red-400 border-red-500/30',
      green: 'bg-green-500/20 text-green-400 border-green-500/30',
      pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
      blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };
    return colorMap[meta.color] || colorMap.cyan;
  };

  const availablePresets = PRESET_TENETS.filter(
    (preset) => !tenets.some((t) => t.rule === preset.rule)
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Personality Settings</DialogTitle>
          <DialogDescription>
            Customize your companion&apos;s personality traits and behavioral rules.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="traits" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="traits">Traits</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>

          {/* Traits Tab */}
          <TabsContent value="traits" className="flex-1 overflow-y-auto py-4 space-y-6 pr-2">
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
          </TabsContent>

          {/* Rules Tab */}
          <TabsContent value="rules" className="flex-1 overflow-y-auto py-4 space-y-6 pr-2">
            {isLoadingTenets ? (
              <div className="flex items-center justify-center py-8">
                <span className="text-muted-foreground">Loading rules...</span>
              </div>
            ) : (
              <>
                {/* Preset Quick-Add */}
                {availablePresets.length > 0 && (
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-medium">Quick Add Presets</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availablePresets.slice(0, 6).map((preset, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddPreset(preset)}
                            className="text-xs"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {preset.rule.length > 35 ? `${preset.rule.slice(0, 35)}...` : preset.rule}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Custom Rule Input */}
                <Card className="bg-muted/50">
                  <CardContent className="pt-4 space-y-3">
                    <h3 className="text-sm font-medium">Create Custom Rule</h3>
                    <div className="flex gap-2">
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value as TenetCategory)}
                        className="px-3 py-2 rounded-md bg-background border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {categoryOptions.map((cat) => (
                          <option key={cat} value={cat}>
                            {TENET_CATEGORY_META[cat].label}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={customRule}
                        onChange={(e) => setCustomRule(e.target.value)}
                        placeholder={isNegation ? 'Never...' : 'Always...'}
                        className="flex-1"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                      />
                      <Button
                        onClick={handleAddCustom}
                        disabled={customRule.trim().length < 10}
                        size="icon"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={isNegation} onCheckedChange={setIsNegation} />
                      <Label className="text-sm text-muted-foreground">
                        This is a restriction (Never do X)
                      </Label>
                    </div>
                  </CardContent>
                </Card>

                {/* Core Tenets */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500" />
                    <h3 className="text-sm font-medium">
                      Core Rules ({coreTenets.length}/5)
                    </h3>
                    <span className="text-xs text-muted-foreground">Always active</span>
                  </div>
                  {coreTenets.map((tenet) => (
                    <Card key={tenet.id} className="bg-yellow-500/5 border-yellow-500/20">
                      <CardContent className="p-3 flex items-center gap-2">
                        <Badge className={cn('text-[10px] shrink-0', getCategoryStyle(tenet.category))}>
                          {TENET_CATEGORY_META[tenet.category].label}
                        </Badge>
                        {tenet.isNegation && (
                          <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400 shrink-0">
                            NEVER
                          </Badge>
                        )}
                        <span className="flex-1 text-sm">{tenet.rule}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePriority(tenet)}
                          className="text-xs text-muted-foreground shrink-0"
                        >
                          Make Situational
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteTenet(tenet.id)}
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {coreTenets.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Add some behavioral rules to guide your companion
                    </p>
                  )}
                </div>

                {/* Situational Tenets */}
                {situationalTenets.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">
                      Situational Rules ({situationalTenets.length})
                    </h3>
                    {situationalTenets.map((tenet) => (
                      <Card key={tenet.id} className="bg-muted/30">
                        <CardContent className="p-3 flex items-center gap-2">
                          <Badge className={cn('text-[10px] shrink-0', getCategoryStyle(tenet.category))}>
                            {TENET_CATEGORY_META[tenet.category].label}
                          </Badge>
                          {tenet.isNegation && (
                            <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400 shrink-0">
                              NEVER
                            </Badge>
                          )}
                          <span className="flex-1 text-sm text-muted-foreground">{tenet.rule}</span>
                          {coreTenets.length < 5 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTogglePriority(tenet)}
                              className="text-xs text-muted-foreground shrink-0"
                            >
                              Make Core
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteTenet(tenet.id)}
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSaveTraits} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

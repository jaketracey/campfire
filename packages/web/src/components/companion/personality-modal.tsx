'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, X, Star, Sparkles, Check, Wand2, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  updateCompanionPersonality,
  suggestPersonalityTuning,
  type Companion,
  type PersonalityTuneDiff,
} from '@/lib/api/companions';
import {
  listTenets,
  createTenet,
  updateTenet,
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
// Flame Effect Component
// ============================================================================

interface FlameParticle {
  id: number;
  x: number;
  size: number;
  delay: number;
  color: string;
}

// Softer, more elegant flame colors
const flameColors = ['#ff8c42', '#ffa54f', '#ffbd59', '#ffcc80', '#ffab40'];

// Calculate flame intensity based on slider value
function getFlameIntensity(value: number): number {
  if (value < 90) return 0;
  if (value < 95) return 0.15;  // glow only
  if (value < 100) return 0.4;  // sparse embers
  return 1;                      // full (but still subtle)
}

function FlameEffect({ intensity }: { intensity: number }) {
  const [particles, setParticles] = useState<FlameParticle[]>([]);

  useEffect(() => {
    // Only spawn particles at intensity >= 0.4 (95%+)
    if (intensity >= 0.4) {
      const spawnInterval = intensity < 0.6 ? 150 : 100;
      const maxParticles = Math.floor(intensity * 12);

      const interval = setInterval(() => {
        setParticles((prev) => [
          ...prev.slice(-maxParticles),
          {
            id: Date.now() + Math.random(),
            x: 75 + Math.random() * 20, // Right side where high values are
            size: 3 + Math.random() * (intensity * 4), // Smaller particles
            delay: Math.random() * 0.1,
            color: flameColors[Math.floor(Math.random() * flameColors.length)],
          },
        ]);
      }, spawnInterval);
      return () => clearInterval(interval);
    } else {
      setParticles([]);
    }
  }, [intensity]);

  if (intensity === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {/* Warm glow layer for lower intensities (90-94%) */}
      {intensity > 0 && intensity < 0.4 && (
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 90% 50%, rgba(255,140,66,0.12) 0%, transparent 60%)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: intensity * 4 }}
          transition={{ duration: 0.3 }}
        />
      )}

      {/* Particle flames */}
      <AnimatePresence>
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${p.x}%`,
              bottom: '50%',
              width: p.size,
              height: p.size,
              background: `radial-gradient(circle, ${p.color}90 0%, transparent 70%)`,
              boxShadow: `0 0 ${p.size}px ${p.color}30`,
            }}
            initial={{ y: 0, opacity: 0.7, scale: 1 }}
            animate={{
              y: [-3, -25 - Math.random() * 15],
              opacity: [0.7, 0.5, 0],
              scale: [1, 1.1, 0.4],
              x: (Math.random() - 0.5) * 10,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.6 + Math.random() * 0.2,
              delay: p.delay,
              ease: 'easeOut',
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

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

  // Inline save indicator
  const [ruleSaveMessage, setRuleSaveMessage] = useState<string | null>(null);
  const showRuleSaveIndicator = (message: string) => {
    setRuleSaveMessage(message);
    setTimeout(() => setRuleSaveMessage(null), 2000);
  };

  // Conversational tuning state
  const [tuneInput, setTuneInput] = useState('');
  const [tuneDiff, setTuneDiff] = useState<PersonalityTuneDiff | null>(null);
  const [isTuning, setIsTuning] = useState(false);
  const [isApplyingTune, setIsApplyingTune] = useState(false);
  const [tuneError, setTuneError] = useState<string | null>(null);
  const [tuneSuccess, setTuneSuccess] = useState<string | null>(null);

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
      showRuleSaveIndicator('Rule saved');
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
      showRuleSaveIndicator('Rule saved');
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
      showRuleSaveIndicator('Priority updated');
    } catch (error) {
      console.error('Failed to update tenet priority:', error);
    }
  };

  const handleDeleteTenet = async (tenetId: string) => {
    if (!companion) return;

    try {
      await deleteTenet(companion.id, tenetId);
      setTenets((prev) => prev.filter((t) => t.id !== tenetId));
      showRuleSaveIndicator('Rule removed');
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

  // ==========================================================================
  // Conversational Tuning Handlers
  // ==========================================================================

  const handleSuggestTune = async () => {
    if (!companion || tuneInput.trim().length < 3) return;
    setIsTuning(true);
    setTuneError(null);
    setTuneSuccess(null);
    setTuneDiff(null);
    try {
      const diff = await suggestPersonalityTuning(companion.id, tuneInput.trim());
      setTuneDiff(diff);
    } catch (error) {
      console.error('Failed to suggest tuning:', error);
      setTuneError(
        error instanceof Error ? error.message : 'Could not generate suggestions. Try again.',
      );
    } finally {
      setIsTuning(false);
    }
  };

  const handleApplyTune = async () => {
    if (!companion || !tuneDiff) return;
    setIsApplyingTune(true);
    setTuneError(null);
    try {
      // 1. Trait updates: merge into current traits and PATCH once.
      if (tuneDiff.traitUpdates.length > 0) {
        const nextTraits: Record<string, number> = { ...traits };
        for (const upd of tuneDiff.traitUpdates) {
          nextTraits[upd.trait] = upd.toValue;
        }
        const normalized: Record<string, number> = {};
        for (const [key, value] of Object.entries(nextTraits)) {
          normalized[key] = value / 100;
        }
        await updateCompanionPersonality(companion.id, normalized);
        setTraits(nextTraits as Record<TraitKey, number>);
      }

      // 2. Tenet removes.
      for (const rem of tuneDiff.tenetsToRemove) {
        try {
          await deleteTenet(companion.id, rem.id);
        } catch (e) {
          console.warn('Failed to remove tenet', rem.id, e);
        }
      }

      // 3. Tenet modifies.
      for (const mod of tuneDiff.tenetsToModify) {
        try {
          await updateTenet(companion.id, mod.id, {
            ...(mod.newRule ? { rule: mod.newRule } : {}),
            ...(mod.newPriority ? { priority: mod.newPriority as TenetPriority } : {}),
            ...(mod.newCategory ? { category: mod.newCategory as TenetCategory } : {}),
          });
        } catch (e) {
          console.warn('Failed to modify tenet', mod.id, e);
        }
      }

      // 4. Tenet adds (best-effort; skip silently if over limits).
      for (const add of tuneDiff.tenetsToAdd) {
        try {
          await createTenet(companion.id, {
            category: add.category as TenetCategory,
            priority: add.priority as TenetPriority,
            rule: add.rule,
            isNegation: add.isNegation,
          });
        } catch (e) {
          console.warn('Failed to add tenet', add.rule, e);
        }
      }

      // 5. Reload tenets from server for fresh IDs + state.
      const refreshed = await listTenets(companion.id);
      setTenets(refreshed.tenets);

      setTuneDiff(null);
      setTuneInput('');
      setTuneSuccess('Changes applied');
      setTimeout(() => setTuneSuccess(null), 2500);
    } catch (error) {
      console.error('Failed to apply tune:', error);
      setTuneError(
        error instanceof Error ? error.message : 'Could not apply changes. Try again.',
      );
    } finally {
      setIsApplyingTune(false);
    }
  };

  const handleDiscardTune = () => {
    setTuneDiff(null);
    setTuneError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl p-0 bg-transparent border-none shadow-none overflow-visible"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Personality Settings</DialogTitle>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative bg-gradient-to-b from-background to-muted/30 rounded-3xl overflow-hidden shadow-2xl max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-border/50">
                <h2 className="text-lg font-semibold text-foreground">
                  Personality Settings
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Customize your companion&apos;s personality traits and behavioral rules.
                </p>
              </div>

              <Tabs defaultValue="tune" className="flex-1 flex flex-col min-h-0">
                <div className="px-6 pt-4">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="tune">
                      <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                      Tune
                    </TabsTrigger>
                    <TabsTrigger value="traits">Traits</TabsTrigger>
                    <TabsTrigger value="rules">Rules</TabsTrigger>
                  </TabsList>
                </div>

                {/* Tune Tab */}
                <TabsContent value="tune" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-medium">Describe how you&apos;d like them to change</h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Write naturally — e.g. &quot;be more playful and less formal, and never lecture me about my choices.&quot; We&apos;ll propose specific trait and rule changes for you to review before applying.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <textarea
                      value={tuneInput}
                      onChange={(e) => setTuneInput(e.target.value)}
                      placeholder="Be more playful, a bit more direct, and never give unsolicited advice."
                      rows={3}
                      disabled={isTuning || isApplyingTune}
                      className="w-full resize-none rounded-md bg-background border border-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleSuggestTune();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {tuneInput.length > 0 ? `${tuneInput.length} / 1000` : 'Tip: ⌘/Ctrl + Enter to submit'}
                      </span>
                      <Button
                        onClick={handleSuggestTune}
                        disabled={isTuning || isApplyingTune || tuneInput.trim().length < 3}
                        size="sm"
                      >
                        {isTuning ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            Thinking...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                            Suggest changes
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {tuneError && (
                    <Card className="bg-red-500/10 border-red-500/30">
                      <CardContent className="p-3 text-sm text-red-300">{tuneError}</CardContent>
                    </Card>
                  )}

                  {tuneSuccess && !tuneDiff && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-1.5 text-xs text-emerald-400"
                    >
                      <Check className="h-3 w-3" />
                      <span>{tuneSuccess}</span>
                    </motion.div>
                  )}

                  {tuneDiff && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      {/* Summary */}
                      <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="p-4 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-primary uppercase tracking-wide">
                            <Sparkles className="h-3 w-3" />
                            Proposed change
                          </div>
                          <p className="text-sm leading-relaxed">{tuneDiff.summary}</p>
                        </CardContent>
                      </Card>

                      {/* Trait updates */}
                      {tuneDiff.traitUpdates.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Trait adjustments ({tuneDiff.traitUpdates.length})
                          </h4>
                          <div className="space-y-1.5">
                            {tuneDiff.traitUpdates.map((upd) => (
                              <Card key={upd.trait} className="bg-muted/30">
                                <CardContent className="p-3 space-y-1">
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium capitalize">{upd.trait}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {upd.fromValue}%
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                    <span
                                      className={cn(
                                        'font-mono text-xs font-semibold',
                                        upd.toValue > upd.fromValue
                                          ? 'text-emerald-400'
                                          : 'text-amber-400',
                                      )}
                                    >
                                      {upd.toValue}%
                                    </span>
                                  </div>
                                  {upd.reasoning && (
                                    <p className="text-xs text-muted-foreground">{upd.reasoning}</p>
                                  )}
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tenets to add */}
                      {tuneDiff.tenetsToAdd.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-emerald-400 uppercase tracking-wide">
                            New rules ({tuneDiff.tenetsToAdd.length})
                          </h4>
                          {tuneDiff.tenetsToAdd.map((add, i) => (
                            <Card key={i} className="bg-emerald-500/5 border-emerald-500/20">
                              <CardContent className="p-3 space-y-1">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    className={cn(
                                      'text-[10px]',
                                      getCategoryStyle(add.category as TenetCategory),
                                    )}
                                  >
                                    {TENET_CATEGORY_META[add.category as TenetCategory]?.label ?? add.category}
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px]">
                                    {add.priority}
                                  </Badge>
                                  {add.isNegation && (
                                    <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">
                                      NEVER
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm">{add.rule}</p>
                                {add.reasoning && (
                                  <p className="text-xs text-muted-foreground">{add.reasoning}</p>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}

                      {/* Tenets to modify */}
                      {tuneDiff.tenetsToModify.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-amber-400 uppercase tracking-wide">
                            Modified rules ({tuneDiff.tenetsToModify.length})
                          </h4>
                          {tuneDiff.tenetsToModify.map((mod) => {
                            const existing = tenets.find((t) => t.id === mod.id);
                            return (
                              <Card key={mod.id} className="bg-amber-500/5 border-amber-500/20">
                                <CardContent className="p-3 space-y-1">
                                  {existing && (
                                    <p className="text-xs text-muted-foreground line-through">
                                      {existing.rule}
                                    </p>
                                  )}
                                  {mod.newRule && <p className="text-sm">{mod.newRule}</p>}
                                  <div className="flex items-center gap-2">
                                    {mod.newPriority && (
                                      <Badge variant="outline" className="text-[10px]">
                                        → {mod.newPriority}
                                      </Badge>
                                    )}
                                    {mod.newCategory && (
                                      <Badge variant="outline" className="text-[10px]">
                                        → {mod.newCategory}
                                      </Badge>
                                    )}
                                  </div>
                                  {mod.reasoning && (
                                    <p className="text-xs text-muted-foreground">{mod.reasoning}</p>
                                  )}
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}

                      {/* Tenets to remove */}
                      {tuneDiff.tenetsToRemove.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-red-400 uppercase tracking-wide">
                            Removed rules ({tuneDiff.tenetsToRemove.length})
                          </h4>
                          {tuneDiff.tenetsToRemove.map((rem) => {
                            const existing = tenets.find((t) => t.id === rem.id);
                            return (
                              <Card key={rem.id} className="bg-red-500/5 border-red-500/20">
                                <CardContent className="p-3 space-y-1">
                                  {existing && (
                                    <p className="text-sm line-through text-muted-foreground">
                                      {existing.rule}
                                    </p>
                                  )}
                                  {rem.reasoning && (
                                    <p className="text-xs text-muted-foreground">{rem.reasoning}</p>
                                  )}
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}

                      {/* Empty diff (model returned nothing actionable) */}
                      {tuneDiff.traitUpdates.length === 0 &&
                        tuneDiff.tenetsToAdd.length === 0 &&
                        tuneDiff.tenetsToModify.length === 0 &&
                        tuneDiff.tenetsToRemove.length === 0 && (
                          <Card className="bg-muted/30">
                            <CardContent className="p-3 text-sm text-muted-foreground">
                              No changes suggested — try rephrasing your request with more specifics.
                            </CardContent>
                          </Card>
                        )}

                      {/* Apply / discard */}
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDiscardTune}
                          disabled={isApplyingTune}
                          className="flex-1"
                        >
                          Discard
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleApplyTune}
                          disabled={
                            isApplyingTune ||
                            (tuneDiff.traitUpdates.length === 0 &&
                              tuneDiff.tenetsToAdd.length === 0 &&
                              tuneDiff.tenetsToModify.length === 0 &&
                              tuneDiff.tenetsToRemove.length === 0)
                          }
                          className="flex-1"
                        >
                          {isApplyingTune ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              Applying...
                            </>
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1.5" />
                              Apply changes
                            </>
                          )}
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </TabsContent>

                {/* Traits Tab */}
                <TabsContent value="traits" className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                  {PERSONALITY_SLIDERS.map((slider) => {
                    const value = traits[slider.key];
                    const intensity = getFlameIntensity(value);

                    return (
                      <div key={slider.key} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label className="text-sm font-medium">{slider.label}</Label>
                          <span
                            className={cn(
                              'text-sm font-mono transition-colors duration-200',
                              value >= 90 && value < 100 && 'text-orange-300/80',
                              value === 100 && 'text-orange-400'
                            )}
                          >
                            {value}%
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-20 text-right">
                            {slider.low}
                          </span>
                          <div
                            className={cn(
                              'relative flex-1 transition-shadow duration-500',
                              value === 100 && 'shadow-[0_0_15px_rgba(255,140,66,0.15)]'
                            )}
                          >
                            <Slider
                              value={[value]}
                              onValueChange={handleSliderChange(slider.key)}
                              max={100}
                              step={1}
                              className={cn(
                                'flex-1',
                                value >= 95 && '[&_[data-state=active]]:bg-orange-500/70',
                                value === 100 && '[&_[role=slider]]:bg-orange-500 [&_[role=slider]]:border-orange-400'
                              )}
                            />
                            <FlameEffect intensity={intensity} />
                          </div>
                          <span className="text-xs text-muted-foreground w-20">
                            {slider.high}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </TabsContent>

                {/* Rules Tab */}
                <TabsContent value="rules" className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Inline save indicator */}
            <AnimatePresence>
              {ruleSaveMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-1.5 text-xs text-emerald-400"
                >
                  <Check className="h-3 w-3" />
                  <span>{ruleSaveMessage}</span>
                </motion.div>
              )}
            </AnimatePresence>

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

              {/* Footer */}
              <div className="px-6 py-4 border-t border-border/50 flex justify-end gap-3">
                <Button variant="outline" onClick={onClose} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSaveTraits} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

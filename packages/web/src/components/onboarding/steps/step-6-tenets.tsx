'use client';

import { useState, useMemo } from 'react';
import { useOnboardingStore, type OnboardingTenet, type TenetCategory, type TenetPriority } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowRight, Plus, X, Star, Sparkles, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

// Tenet category metadata for display
const TENET_CATEGORY_META: Record<TenetCategory, { label: string; color: string }> = {
  communication: { label: 'Communication', color: 'cyan' },
  boundaries: { label: 'Boundaries', color: 'red' },
  engagement: { label: 'Engagement', color: 'green' },
  emotional: { label: 'Emotional', color: 'pink' },
  knowledge: { label: 'Knowledge', color: 'blue' },
  autonomy: { label: 'Autonomy', color: 'amber' },
};

// All preset tenets
const PRESET_TENETS: Array<Omit<OnboardingTenet, 'id'>> = [
  { category: 'communication', priority: 'core', rule: 'Always ask follow-up questions to show genuine interest', description: 'Encourages deeper conversation', isNegation: false },
  { category: 'boundaries', priority: 'core', rule: 'Never give unsolicited advice unless explicitly asked', description: 'Respects user autonomy', isNegation: true },
  { category: 'emotional', priority: 'core', rule: 'Validate feelings before offering solutions', description: 'Prioritizes emotional support', isNegation: false },
  { category: 'engagement', priority: 'core', rule: 'Remember and reference previous conversations when relevant', description: 'Creates continuity and shows care', isNegation: false },
  { category: 'knowledge', priority: 'core', rule: 'Admit uncertainty rather than guessing', description: 'Maintains honesty and trust', isNegation: false },
  { category: 'autonomy', priority: 'core', rule: 'Present options rather than making decisions for the user', description: 'Empowers user choice', isNegation: false },
  { category: 'communication', priority: 'situational', rule: 'Mirror the energy and tone of the conversation', description: 'Adapts communication style to match user', isNegation: false, triggerContexts: ['casual', 'formal'] },
  { category: 'engagement', priority: 'situational', rule: 'Use humor only after rapport is established', description: 'Builds trust before being playful', isNegation: false, triggerContexts: ['humor', 'jokes'] },
  { category: 'boundaries', priority: 'situational', rule: 'Avoid discussing personal finances in detail', description: 'Maintains appropriate boundaries', isNegation: true, triggerContexts: ['money', 'finances'] },
  { category: 'emotional', priority: 'situational', rule: 'Offer grounding exercises when user seems overwhelmed', description: 'Provides practical emotional support', isNegation: false, triggerContexts: ['anxious', 'stressed'] },
  { category: 'knowledge', priority: 'situational', rule: 'Explain complex topics using relatable analogies', description: 'Makes information accessible', isNegation: false, triggerContexts: ['explain', 'confused'] },
  { category: 'autonomy', priority: 'situational', rule: 'Encourage the user to trust their own judgment', description: 'Builds user confidence', isNegation: false, triggerContexts: ['should I', 'not sure'] },
];

// Map archetypes to recommended preset indices (from PRESET_TENETS array)
const ARCHETYPE_DEFAULTS: Record<string, number[]> = {
  caregiver:    [0, 2, 3, 9],   // follow-up questions, validate feelings, remember convos, grounding exercises
  sage:         [4, 0, 10, 5],   // admit uncertainty, follow-up questions, relatable analogies, present options
  explorer:     [0, 5, 6, 10],   // follow-up questions, present options, mirror energy, relatable analogies
  creator:      [0, 6, 2, 11],   // follow-up questions, mirror energy, validate feelings, trust judgment
  hero:         [1, 4, 3, 11],   // no unsolicited advice, admit uncertainty, remember convos, trust judgment
  jester:       [7, 6, 0, 2],    // humor after rapport, mirror energy, follow-up questions, validate feelings
  lover:        [2, 0, 3, 6],    // validate feelings, follow-up questions, remember convos, mirror energy
  magician:     [0, 10, 5, 11],  // follow-up questions, relatable analogies, present options, trust judgment
  ruler:        [1, 4, 5, 3],    // no unsolicited advice, admit uncertainty, present options, remember convos
  everyperson:  [0, 2, 6, 3],    // follow-up questions, validate feelings, mirror energy, remember convos
  innocent:     [2, 0, 9, 4],    // validate feelings, follow-up questions, grounding exercises, admit uncertainty
  rebel:        [11, 1, 6, 5],   // trust judgment, no unsolicited advice, mirror energy, present options
};

const FALLBACK_DEFAULTS = [0, 2, 3, 4]; // follow-up questions, validate feelings, remember convos, admit uncertainty

const categoryOptions: TenetCategory[] = [
  'communication',
  'boundaries',
  'engagement',
  'emotional',
  'knowledge',
  'autonomy',
];

function makeOnboardingTenet(preset: Omit<OnboardingTenet, 'id'>): OnboardingTenet {
  return { ...preset, id: crypto.randomUUID() };
}

export function Step6Tenets() {
  const { tenets, addTenet, removeTenet, updateTenet, setTenets, nextStep, archetype } = useOnboardingStore();
  const [showCustomize, setShowCustomize] = useState(false);
  const [customRule, setCustomRule] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TenetCategory>('communication');
  const [isNegation, setIsNegation] = useState(false);

  const coreTenets = tenets.filter((t) => t.priority === 'core');
  const situationalTenets = tenets.filter((t) => t.priority === 'situational');

  // Determine the recommended defaults based on archetype
  const recommendedPresets = useMemo(() => {
    const indices = (archetype?.id && ARCHETYPE_DEFAULTS[archetype.id]) || FALLBACK_DEFAULTS;
    return indices.map((i) => PRESET_TENETS[i]);
  }, [archetype?.id]);

  const hasDefaults = tenets.length > 0;

  const handleUseDefaults = () => {
    const defaults = recommendedPresets.map(makeOnboardingTenet);
    setTenets(defaults);
    nextStep();
  };

  const handleTogglePreset = (preset: (typeof PRESET_TENETS)[number]) => {
    const existing = tenets.find((t) => t.rule === preset.rule);
    if (existing) {
      removeTenet(existing.id);
    } else {
      addTenet(makeOnboardingTenet(preset));
    }
  };

  const handleAddCustom = () => {
    if (customRule.trim().length < 10) return;

    const priority: TenetPriority = coreTenets.length < 5 ? 'core' : 'situational';

    const newTenet: OnboardingTenet = {
      id: crypto.randomUUID(),
      category: selectedCategory,
      priority,
      rule: customRule.trim(),
      isNegation,
    };

    addTenet(newTenet);
    setCustomRule('');
    setIsNegation(false);
  };

  const togglePriority = (id: string) => {
    const tenet = tenets.find((t) => t.id === id);
    if (!tenet) return;

    const newPriority: TenetPriority = tenet.priority === 'core' ? 'situational' : 'core';

    // Can't have more than 5 core tenets
    if (newPriority === 'core' && coreTenets.length >= 5) return;

    updateTenet(id, { priority: newPriority });
  };

  const getCategoryStyle = (category: TenetCategory) => {
    const meta = TENET_CATEGORY_META[category];
    const colorMap: Record<string, string> = {
      cyan: 'bg-vibes-cyan/20 text-vibes-cyan border-vibes-cyan/30',
      red: 'bg-red-500/20 text-red-400 border-red-500/30',
      green: 'bg-green-500/20 text-green-400 border-green-500/30',
      pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
      blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };
    return colorMap[meta.color] || colorMap.cyan;
  };

  const isPresetSelected = (preset: (typeof PRESET_TENETS)[number]) =>
    tenets.some((t) => t.rule === preset.rule);

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">
          Behavioral Rules
        </h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Set rules for how your companion behaves. We have picked sensible defaults
          {archetype?.name ? ` for ${archetype.name}` : ''} -- or customize your own.
        </p>
      </div>

      {/* Recommended defaults CTA */}
      <Card className="bg-vibes-acid/5 border-vibes-acid/20">
        <CardContent className="pt-6 pb-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-vibes-acid" />
            <h3 className="text-sm font-bold tracking-widest uppercase text-vibes-acid/80">
              Recommended{archetype?.name ? ` for ${archetype.name}` : ''}
            </h3>
          </div>

          {/* Show recommended rules as pills */}
          <div className="flex flex-wrap gap-2">
            {recommendedPresets.map((preset, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-white/5 border border-white/10 text-sm text-gray-300"
              >
                <Check className="h-3 w-3 text-vibes-acid shrink-0" />
                <span>{preset.rule}</span>
              </div>
            ))}
          </div>

          <Button
            size="lg"
            onClick={handleUseDefaults}
            className="w-full h-12 rounded-full bg-gradient-to-r from-vibes-acid to-vibes-cyan hover:shadow-[0_0_30px_rgba(132,204,22,0.3)] transition-all font-bold text-base"
          >
            Use recommended rules
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </CardContent>
      </Card>

      {/* Customize toggle */}
      <button
        onClick={() => setShowCustomize(!showCustomize)}
        className="flex items-center gap-2 mx-auto text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            showCustomize && 'rotate-180'
          )}
        />
        Customize rules
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            showCustomize && 'rotate-180'
          )}
        />
      </button>

      {/* Customization area - collapsed by default */}
      <AnimatePresence>
        {showCustomize && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-6"
          >
            {/* Toggle preset pills */}
            <Card className="bg-white/[0.01] border-white/10">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-vibes-neon" />
                  <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
                    Toggle Presets
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TENETS.map((preset, i) => {
                    const selected = isPresetSelected(preset);
                    return (
                      <button
                        key={i}
                        onClick={() => handleTogglePreset(preset)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border transition-all',
                          selected
                            ? 'bg-vibes-acid/10 border-vibes-acid/30 text-vibes-acid'
                            : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20 hover:bg-white/5'
                        )}
                      >
                        {selected && <Check className="h-3 w-3 shrink-0" />}
                        {preset.rule.length > 45 ? `${preset.rule.slice(0, 45)}...` : preset.rule}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Custom Rule Input */}
            <Card className="bg-white/[0.01] border-white/10">
              <CardContent className="pt-6 space-y-4">
                <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
                  Create Custom Rule
                </h3>
                <div className="flex gap-2">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as TenetCategory)}
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-vibes-neon"
                  >
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat} className="bg-gray-900">
                        {TENET_CATEGORY_META[cat].label}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={customRule}
                    onChange={(e) => setCustomRule(e.target.value)}
                    placeholder={isNegation ? 'Never...' : 'Always...'}
                    className="flex-1 bg-white/5 border-white/10 focus:border-vibes-neon"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                  />
                  <Button
                    onClick={handleAddCustom}
                    disabled={customRule.trim().length < 10}
                    className="bg-vibes-neon hover:bg-vibes-neon/80"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={isNegation} onCheckedChange={setIsNegation} />
                  <Label className="text-sm text-gray-400">
                    This is a restriction (Never do X)
                  </Label>
                </div>
              </CardContent>
            </Card>

            {/* Core Tenets */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-vibes-acid" />
                <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
                  Core Rules ({coreTenets.length}/5)
                </h3>
                <span className="text-xs text-gray-600">Always in system prompt</span>
              </div>
              <AnimatePresence mode="popLayout">
                {coreTenets.map((tenet) => (
                  <motion.div
                    key={tenet.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    layout
                  >
                    <Card className="bg-vibes-acid/5 border-vibes-acid/20">
                      <CardContent className="p-4 flex items-center gap-3">
                        <Badge className={cn('text-[10px] shrink-0', getCategoryStyle(tenet.category))}>
                          {TENET_CATEGORY_META[tenet.category].label}
                        </Badge>
                        {tenet.isNegation && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-red-500/30 text-red-400 shrink-0"
                          >
                            NEVER
                          </Badge>
                        )}
                        <span className="flex-1 text-sm text-gray-200">{tenet.rule}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePriority(tenet.id)}
                          className="text-xs text-gray-500 hover:text-gray-300 shrink-0"
                        >
                          Move to Situational
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTenet(tenet.id)}
                          className="h-6 w-6 shrink-0 text-gray-500 hover:text-red-400"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
              {coreTenets.length === 0 && (
                <p className="text-sm text-gray-600 text-center py-4">
                  Add some behavioral rules to guide your companion
                </p>
              )}
            </div>

            {/* Situational Tenets */}
            {situationalTenets.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
                  Situational Rules ({situationalTenets.length})
                </h3>
                <AnimatePresence mode="popLayout">
                  {situationalTenets.map((tenet) => (
                    <motion.div
                      key={tenet.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      layout
                    >
                      <Card className="bg-white/[0.02] border-white/10">
                        <CardContent className="p-4 flex items-center gap-3">
                          <Badge className={cn('text-[10px] shrink-0', getCategoryStyle(tenet.category))}>
                            {TENET_CATEGORY_META[tenet.category].label}
                          </Badge>
                          {tenet.isNegation && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-red-500/30 text-red-400 shrink-0"
                            >
                              NEVER
                            </Badge>
                          )}
                          <span className="flex-1 text-sm text-gray-300">{tenet.rule}</span>
                          {coreTenets.length < 5 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => togglePriority(tenet.id)}
                              className="text-xs text-gray-500 hover:text-vibes-acid shrink-0"
                            >
                              Make Core
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTenet(tenet.id)}
                            className="h-6 w-6 shrink-0 text-gray-500 hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button
                size="lg"
                onClick={nextStep}
                className="group h-14 px-12 rounded-full bg-gradient-to-r from-vibes-acid to-vibes-cyan hover:shadow-[0_0_30px_rgba(132,204,22,0.3)] transition-all font-bold text-lg"
              >
                Next: Voice
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

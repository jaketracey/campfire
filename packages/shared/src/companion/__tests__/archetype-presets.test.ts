import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARCHETYPE_PRESETS,
  getAllArchetypePresets,
  getArchetypePreset,
  ARCHETYPE_KEYS,
  type ArchetypePreset,
} from '../archetype-presets.js';

const EXPECTED_ARCHETYPES = [
  'caregiver', 'sage', 'explorer', 'creator', 'hero', 'jester',
  'lover', 'magician', 'ruler', 'everyperson', 'innocent', 'rebel',
];

const SLIDER_KEYS = [
  'warmth', 'energy', 'humor', 'formality', 'assertiveness',
  'openness', 'empathy', 'spontaneity', 'optimism', 'directness',
];

describe('archetype-presets', () => {
  it('defines all 12 archetypes', () => {
    expect(ARCHETYPE_KEYS).toHaveLength(12);
    for (const key of EXPECTED_ARCHETYPES) {
      expect(ARCHETYPE_PRESETS).toHaveProperty(key);
    }
  });

  it('getAllArchetypePresets returns 12 items', () => {
    expect(getAllArchetypePresets()).toHaveLength(12);
  });

  it('getArchetypePreset returns preset for valid key', () => {
    const preset = getArchetypePreset('sage');
    expect(preset).toBeDefined();
    expect(preset!.archetype).toBe('sage');
  });

  it('getArchetypePreset returns undefined for invalid key', () => {
    expect(getArchetypePreset('nonexistent')).toBeUndefined();
  });

  describe.each(EXPECTED_ARCHETYPES)('preset: %s', (archetype) => {
    let preset: ArchetypePreset;

    beforeAll(() => {
      preset = ARCHETYPE_PRESETS[archetype];
    });

    it('has correct archetype key', () => {
      expect(preset.archetype).toBe(archetype);
    });

    it('has non-empty displayName, tagline, and description', () => {
      expect(preset.displayName.length).toBeGreaterThan(0);
      expect(preset.tagline.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(20);
    });

    it('has all 10 personality sliders in range 0-100', () => {
      for (const key of SLIDER_KEYS) {
        const val = (preset.personalitySliders as Record<string, number>)[key];
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });

    it('has valid communication style', () => {
      expect(['concise', 'moderate', 'detailed']).toContain(preset.communicationStyle.messageLength);
      expect(['none', 'minimal', 'moderate', 'frequent']).toContain(preset.communicationStyle.emojiUsage);
      expect(['simple', 'moderate', 'sophisticated']).toContain(preset.communicationStyle.vocabularyLevel);
      expect(['rare', 'occasional', 'frequent']).toContain(preset.communicationStyle.questionFrequency);
    });

    it('has voice defaults for both genders', () => {
      expect(preset.defaultVoices.feminine.voiceId).toBeTruthy();
      expect(preset.defaultVoices.feminine.voiceName).toBeTruthy();
      expect(preset.defaultVoices.masculine.voiceId).toBeTruthy();
      expect(preset.defaultVoices.masculine.voiceName).toBeTruthy();
    });

    it('has appearance defaults for both genders', () => {
      expect(preset.defaultAppearances.feminine.gender).toBe('female');
      expect(preset.defaultAppearances.feminine.ethnicity).toBeTruthy();
      expect(preset.defaultAppearances.feminine.bodyType).toBeTruthy();
      expect(preset.defaultAppearances.masculine.gender).toBe('male');
      expect(preset.defaultAppearances.masculine.ethnicity).toBeTruthy();
      expect(preset.defaultAppearances.masculine.bodyType).toBeTruthy();
    });

    it('has 3-5 core tenets', () => {
      expect(preset.coreTenets.length).toBeGreaterThanOrEqual(3);
      expect(preset.coreTenets.length).toBeLessThanOrEqual(5);
      for (const tenet of preset.coreTenets) {
        expect(tenet.length).toBeGreaterThan(10);
      }
    });

    it('has all 4 first message variants', () => {
      expect(preset.firstMessages.default).toBeTruthy();
      expect(preset.firstMessages.returning).toBeTruthy();
      expect(preset.firstMessages.lateNight).toBeTruthy();
      expect(preset.firstMessages.morning).toBeTruthy();
    });

    it('has at least 4 trait keywords', () => {
      expect(preset.traitKeywords.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('each archetype has unique displayName and tagline', () => {
    const presets = getAllArchetypePresets();
    const displayNames = presets.map(p => p.displayName);
    const taglines = presets.map(p => p.tagline);
    expect(new Set(displayNames).size).toBe(12);
    expect(new Set(taglines).size).toBe(12);
  });
});

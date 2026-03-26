import { describe, it, expect } from 'vitest';
import {
  VIBE_PRESETS,
  getVibePreset,
  pronounsToGenderKey,
  getPresetVoice,
  getPresetAppearance,
} from '../vibe-presets';

describe('vibe-presets', () => {
  describe('VIBE_PRESETS', () => {
    it('has exactly 3 presets', () => {
      expect(VIBE_PRESETS).toHaveLength(3);
    });

    it('each preset has unique id', () => {
      const ids = VIBE_PRESETS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each preset has required fields', () => {
      for (const preset of VIBE_PRESETS) {
        expect(preset.id).toBeTruthy();
        expect(preset.name).toBeTruthy();
        expect(preset.tagline).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.gradient).toBeTruthy();
        expect(preset.archetype).toBeTruthy();
        expect(preset.personalityTraits).toBeDefined();
        expect(preset.defaultVoices.feminine).toBeTruthy();
        expect(preset.defaultVoices.masculine).toBeTruthy();
        expect(preset.defaultAppearance.feminine).toBeDefined();
        expect(preset.defaultAppearance.masculine).toBeDefined();
        expect(preset.firstMessages.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('personality traits are within 0-100 range', () => {
      for (const preset of VIBE_PRESETS) {
        for (const [key, value] of Object.entries(preset.personalityTraits)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  describe('getVibePreset', () => {
    it('returns a preset by ID', () => {
      const preset = getVibePreset('warm-caring');
      expect(preset).toBeDefined();
      expect(preset!.name).toBe('Warm & Caring');
    });

    it('returns undefined for unknown ID', () => {
      expect(getVibePreset('nonexistent')).toBeUndefined();
    });
  });

  describe('pronounsToGenderKey', () => {
    it('maps she/her to feminine', () => {
      expect(pronounsToGenderKey('she/her')).toBe('feminine');
    });

    it('maps he/him to masculine', () => {
      expect(pronounsToGenderKey('he/him')).toBe('masculine');
    });

    it('maps they/them to neutral', () => {
      expect(pronounsToGenderKey('they/them')).toBe('neutral');
    });

    it('defaults to feminine for unknown input', () => {
      expect(pronounsToGenderKey('anything')).toBe('feminine');
    });
  });

  describe('getPresetVoice', () => {
    const preset = VIBE_PRESETS[0];

    it('returns feminine voice for she/her', () => {
      expect(getPresetVoice(preset, 'she/her')).toBe(preset.defaultVoices.feminine);
    });

    it('returns masculine voice for he/him', () => {
      expect(getPresetVoice(preset, 'he/him')).toBe(preset.defaultVoices.masculine);
    });

    it('returns neutral voice for they/them', () => {
      expect(getPresetVoice(preset, 'they/them')).toBe(preset.defaultVoices.neutral);
    });
  });

  describe('getPresetAppearance', () => {
    const preset = VIBE_PRESETS[0];

    it('returns feminine appearance for she/her', () => {
      const appearance = getPresetAppearance(preset, 'she/her');
      expect(appearance.gender).toBe('female');
    });

    it('returns masculine appearance for he/him', () => {
      const appearance = getPresetAppearance(preset, 'he/him');
      expect(appearance.gender).toBe('male');
    });

    it('returns feminine appearance for they/them (default)', () => {
      const appearance = getPresetAppearance(preset, 'they/them');
      expect(appearance.gender).toBe('female');
    });
  });
});

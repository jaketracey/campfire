import { get } from './client';
import type { VoiceOption } from '@/stores/onboarding-store';

interface VoiceListResponse {
  success: boolean;
  data: {
    voices: Array<{
      id: string;
      name: string;
      description: string;
      gender: 'feminine' | 'masculine' | 'neutral';
      accent: string;
      age: string;
      useCase: string;
      category: string;
      previewUrl: string | null;
    }>;
  };
}

export async function fetchVoices(): Promise<VoiceOption[]> {
  const res = await get<VoiceListResponse>('/voice/list');
  return res.data.voices.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    sampleUrl: '',
    gender: v.gender,
    previewUrl: v.previewUrl,
    accent: v.accent,
    age: v.age,
    category: v.category,
  }));
}

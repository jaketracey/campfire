import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repoMock } = vi.hoisted(() => {
  const repoMock = {
    getSettings: vi.fn(async () => ({ default_version: '1.0.0' })),
    getEffectiveTemplate: vi.fn(),
  };
  return { repoMock };
});

vi.mock('../../repositories/index.js', () => ({
  getPromptTemplatesRepository: () => repoMock,
}));

import { renderPromptFromDb } from '../prompt-runtime.js';

describe('renderPromptFromDb', () => {
  beforeEach(() => {
    repoMock.getSettings.mockClear();
    repoMock.getEffectiveTemplate.mockReset();
  });

  it('renders an optional prompt with an empty template as an empty string', async () => {
    repoMock.getEffectiveTemplate.mockResolvedValue({
      template: '',
      template_source: 'global',
      is_required: false,
      variables: [],
    });

    await expect(
      renderPromptFromDb({
        key: 'orchestrator.image_negative_prompt_fal_default',
        version: '1.0.0',
        variables: {},
      })
    ).resolves.toEqual({ version: '1.0.0', rendered: '' });
  });

  it('throws when a prompt template is missing (optional)', async () => {
    repoMock.getEffectiveTemplate.mockResolvedValue({
      template: null,
      template_source: 'missing',
      is_required: false,
      variables: [],
    });

    await expect(
      renderPromptFromDb({
        key: 'orchestrator.video_negative_prompt_animatediff_default',
        version: '1.0.0',
        variables: {},
      })
    ).rejects.toThrow(/Missing prompt template/);
  });

  it('throws when required variables are missing', async () => {
    repoMock.getEffectiveTemplate.mockResolvedValue({
      template: 'Hello {name}',
      template_source: 'global',
      is_required: true,
      variables: ['name'],
    });

    await expect(
      renderPromptFromDb({
        key: 'gateway.chat_system_prompt',
        version: '1.0.0',
        variables: {},
      })
    ).rejects.toThrow(/requires variable/);
  });
});

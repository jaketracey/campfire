import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCompanion } from '../companions';

vi.mock('../client', () => ({
  post: vi.fn(),
}));

import { post } from '../client';

const mockPost = post as unknown as ReturnType<typeof vi.fn>;

describe('Companions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('activateCompanion', () => {
    it('posts to companion activation endpoint', async () => {
      const companion = {
        id: 'companion-1',
        name: 'Nova',
        description: null,
        personality: '{}',
        voiceId: null,
        avatarUrl: null,
        isPublic: false,
        isActive: true,
        createdAt: new Date().toISOString(),
        ownerId: 'user-1',
        status: 'active',
      };

      mockPost.mockResolvedValue(companion);

      const result = await activateCompanion('companion-1');

      expect(mockPost).toHaveBeenCalledWith('/companions/companion-1/activate');
      expect(result).toEqual(companion);
    });
  });
});

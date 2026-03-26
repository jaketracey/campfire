import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompanionCard } from '@/components/explore/companion-card';
import type { FeaturedCompanion } from '@/data/featured-companions';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

const mockCreateCompanion = vi.fn();
const mockCreateSession = vi.fn();

vi.mock('@/lib/api', () => ({
  createCompanion: (...args: unknown[]) => mockCreateCompanion(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCompanion: FeaturedCompanion = {
  id: 'preset-test',
  name: 'TestBot',
  tagline: 'A test companion',
  archetype: 'sage',
  archetypeLabel: 'The Sage',
  traits: ['Smart', 'Calm', 'Wise'],
  category: 'intellectual',
  gradient: 'from-blue-500 to-cyan-600',
  avatarPlaceholder: '/images/companions/presets/test.webp',
  personality: {
    warmth: 50,
    energy: 50,
    playfulness: 50,
    formality: 50,
    assertiveness: 50,
    curiosity: 50,
    empathy: 50,
    spontaneity: 50,
    optimism: 50,
    directness: 50,
  },
  voiceId: 'adam',
  appearance: {
    gender: 'male',
    ethnicity: 'caucasian',
    bodyType: 'athletic',
    hairColor: 'brown',
  },
  firstMessage: 'Hello, I am TestBot.',
  backstory: 'A test companion for testing purposes.',
};

describe('CompanionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isInitialized: true,
      isLoading: false,
      user: null,
    });
  });

  it('renders companion name, tagline, archetype, and traits', () => {
    render(<CompanionCard companion={mockCompanion} index={0} />);

    expect(screen.getByText('TestBot')).toBeInTheDocument();
    expect(screen.getByText('A test companion')).toBeInTheDocument();
    expect(screen.getByText('The Sage')).toBeInTheDocument();
    expect(screen.getByText('Smart')).toBeInTheDocument();
    expect(screen.getByText('Calm')).toBeInTheDocument();
    expect(screen.getByText('Wise')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to signup on click', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isInitialized: true,
      isLoading: false,
      user: null,
    });

    render(<CompanionCard companion={mockCompanion} index={0} />);

    const chatButton = screen.getByTestId('chat-now-preset-test');
    fireEvent.click(chatButton);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('/signup?')
    );
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('returnTo=%2Fexplore')
    );
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('presetId=preset-test')
    );
  });

  it('creates companion and session for authenticated users on click', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });

    mockCreateCompanion.mockResolvedValue({ id: 'companion-123' });
    mockCreateSession.mockResolvedValue({ id: 'session-456' });

    render(<CompanionCard companion={mockCompanion} index={0} />);

    const chatButton = screen.getByTestId('chat-now-preset-test');
    fireEvent.click(chatButton);

    await waitFor(() => {
      expect(mockCreateCompanion).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'TestBot',
          description: 'A test companion',
          personality: 'sage',
        })
      );
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith({
        companionId: 'companion-123',
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/chat/session-456');
    });
  });

  it('shows loading state while creating session', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInitialized: true,
      isLoading: false,
      user: { id: 'user-1' },
    });

    // Create a promise that we can control
    let resolveCompanion: (value: unknown) => void;
    mockCreateCompanion.mockReturnValue(
      new Promise((resolve) => {
        resolveCompanion = resolve;
      })
    );

    render(<CompanionCard companion={mockCompanion} index={0} />);

    const chatButton = screen.getByTestId('chat-now-preset-test');
    fireEvent.click(chatButton);

    await waitFor(() => {
      expect(screen.getByText('Creating...')).toBeInTheDocument();
    });

    // Resolve the promise to clean up
    resolveCompanion!({ id: 'companion-123' });
    mockCreateSession.mockResolvedValue({ id: 'session-456' });
  });
});

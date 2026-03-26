import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickMeetFlow } from '../index';
import { VIBE_PRESETS } from '../vibe-presets';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, whileHover, whileTap, variants, custom, ...rest } = props as Record<string, unknown>;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, whileHover, whileTap, variants, custom, ...rest } = props as Record<string, unknown>;
      return <button {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock the onboarding store
const mockSetQuickStartActive = vi.fn();
const mockSetQuickStartStep = vi.fn();
vi.mock('@/stores/onboarding-store', () => ({
  useOnboardingStore: () => ({
    setQuickStartActive: mockSetQuickStartActive,
    setQuickStartStep: mockSetQuickStartStep,
  }),
}));

// Mock analytics
vi.mock('@/lib/analytics/meta-pixel', () => ({
  trackOnboardingStep: vi.fn(),
  trackOnboardingComplete: vi.fn(),
  trackCompanionCreated: vi.fn(),
  trackStartOnboarding: vi.fn(),
}));

// Mock the API
vi.mock('@/lib/api', () => ({
  createCompanion: vi.fn().mockResolvedValue({ id: 'comp-123', name: 'Luna' }),
  activateCompanion: vi.fn().mockResolvedValue({}),
  createSession: vi.fn().mockResolvedValue({ id: 'sess-456' }),
}));

vi.mock('@/lib/api/companions', () => ({
  generateRandomIdentity: vi.fn().mockResolvedValue({
    name: 'Luna',
    pronouns: 'she/her',
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('QuickMeetFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the vibe selection step by default', () => {
    render(<QuickMeetFlow onDesignOwn={vi.fn()} />);
    expect(screen.getByTestId('step-vibe-select')).toBeInTheDocument();
  });

  it('transitions to name step after selecting a vibe', async () => {
    const user = userEvent.setup();

    render(<QuickMeetFlow onDesignOwn={vi.fn()} />);

    await user.click(screen.getByTestId('vibe-card-warm-caring'));

    await waitFor(() => {
      expect(screen.getByTestId('step-name-input')).toBeInTheDocument();
    });

    expect(mockSetQuickStartActive).toHaveBeenCalledWith(true);
    expect(mockSetQuickStartStep).toHaveBeenCalledWith(0);
  });

  it('calls onDesignOwn when the design-own link is clicked', async () => {
    const user = userEvent.setup();
    const onDesignOwn = vi.fn();

    render(<QuickMeetFlow onDesignOwn={onDesignOwn} />);

    await user.click(screen.getByTestId('design-own-link'));
    expect(onDesignOwn).toHaveBeenCalledTimes(1);
  });

  it('transitions to the creating step after entering a name and clicking continue', async () => {
    const user = userEvent.setup();

    render(<QuickMeetFlow onDesignOwn={vi.fn()} />);

    // Select a vibe
    await user.click(screen.getByTestId('vibe-card-witty-playful'));

    await waitFor(() => {
      expect(screen.getByTestId('step-name-input')).toBeInTheDocument();
    });

    // Type a name
    const input = screen.getByTestId('name-input');
    await user.type(input, 'Aria');

    // Click continue
    await waitFor(() => {
      expect(screen.getByTestId('continue-btn')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('continue-btn'));

    // Should now show the creating step
    await waitFor(() => {
      expect(screen.getByTestId('step-first-chat')).toBeInTheDocument();
    });
  });
});

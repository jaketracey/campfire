import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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

// Mock the WelcomeTransition
vi.mock('@/components/auth/welcome-transition', () => ({
  WelcomeTransition: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock QuickMeetFlow
vi.mock('@/components/onboarding/quick-meet', () => ({
  QuickMeetFlow: () => <div data-testid="quick-meet-flow">QuickMeet</div>,
}));

// Mock step components
vi.mock('@/components/onboarding/steps/step-1-welcome', () => ({
  Step1Welcome: () => <div data-testid="step-1-welcome">Welcome</div>,
}));
vi.mock('@/components/onboarding/steps/step-2-identity', () => ({
  Step2Identity: () => <div data-testid="step-2-identity">Identity</div>,
}));
vi.mock('@/components/onboarding/steps/step-3-visuals', () => ({
  Step3Visuals: () => <div data-testid="step-3-visuals">Visuals</div>,
}));
vi.mock('@/components/onboarding/steps/step-4-archetype', () => ({
  Step4Archetype: () => <div data-testid="step-4-archetype">Archetype</div>,
}));
vi.mock('@/components/onboarding/steps/step-7-voice', () => ({
  Step7Voice: () => <div data-testid="step-7-voice">Voice</div>,
}));
vi.mock('@/components/onboarding/steps/step-9-review', () => ({
  Step9Review: () => <div data-testid="step-9-review">Review</div>,
}));

// Track which searchParams are returned
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/onboard',
  useSearchParams: () => mockSearchParams,
}));

// Mock onboarding store - use a mutable ref so tests can change the return value
let mockStoreState = {
  currentStep: 1,
  setStep: vi.fn(),
  reset: vi.fn(),
  quickStartActive: false,
  quickStartStep: 0,
  companionId: null as string | null,
  sessionId: null as string | null,
};

vi.mock('@/stores/onboarding-store', () => {
  const mockFn = vi.fn(() => mockStoreState);
  // Also put getState on the function for direct access patterns
  (mockFn as unknown as Record<string, unknown>).getState = () => mockStoreState;
  return { useOnboardingStore: mockFn };
});

// Import after mocks are set up
import OnboardingPage from '../page';

describe('OnboardingPage routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockStoreState = {
      currentStep: 1,
      setStep: vi.fn(),
      reset: vi.fn(),
      quickStartActive: false,
      quickStartStep: 0,
      companionId: null,
      sessionId: null,
    };
  });

  it('renders quick-meet flow by default (no step param)', () => {
    render(<OnboardingPage />);
    expect(screen.getByTestId('quick-meet-flow')).toBeInTheDocument();
  });

  it('renders wizard flow when step param is present', () => {
    mockSearchParams = new URLSearchParams('step=2');
    mockStoreState.currentStep = 2;

    render(<OnboardingPage />);
    expect(screen.getByTestId('step-2-identity')).toBeInTheDocument();
  });

  it('renders wizard flow when mode=wizard param is present', () => {
    mockSearchParams = new URLSearchParams('mode=wizard');

    render(<OnboardingPage />);
    expect(screen.getByTestId('step-1-welcome')).toBeInTheDocument();
  });
});

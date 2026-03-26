import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepNameInput } from '../step-name-input';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, whileHover, whileTap, variants, custom, ...rest } = props as Record<string, unknown>;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock the API
vi.mock('@/lib/api/companions', () => ({
  generateRandomIdentity: vi.fn().mockResolvedValue({
    name: 'Luna',
    pronouns: 'she/her',
    backstory: 'A dreamer',
    archetype: 'sage',
    secondaryArchetype: null,
    personality: {
      warmth: 70, energy: 50, playfulness: 50, formality: 40,
      assertiveness: 50, curiosity: 80, empathy: 60, spontaneity: 50,
      optimism: 60, directness: 50,
    },
    appearance: { gender: 'female', ethnicity: 'mixed', bodyType: 'slim', hairColor: 'black', breastSize: 'M' },
    visualStyle: 'realistic',
    voiceGender: 'feminine',
    occupation: null,
    distinctiveFeatures: [],
    dressStyle: null,
    vibe: null,
    latencyMs: 100,
  }),
}));

describe('StepNameInput', () => {
  const defaultProps = {
    name: '',
    pronouns: 'she/her' as const,
    onNameChange: vi.fn(),
    onPronounsChange: vi.fn(),
    onContinue: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the name input', () => {
    render(<StepNameInput {...defaultProps} />);
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
  });

  it('renders pronoun toggle buttons', () => {
    render(<StepNameInput {...defaultProps} />);
    expect(screen.getByTestId('pronoun-she-her')).toBeInTheDocument();
    expect(screen.getByTestId('pronoun-he-him')).toBeInTheDocument();
    expect(screen.getByTestId('pronoun-they-them')).toBeInTheDocument();
  });

  it('calls onNameChange when typing', async () => {
    const user = userEvent.setup();
    const onNameChange = vi.fn();

    render(<StepNameInput {...defaultProps} onNameChange={onNameChange} />);

    const input = screen.getByTestId('name-input');
    await user.type(input, 'A');
    expect(onNameChange).toHaveBeenCalledWith('A');
  });

  it('calls onPronounsChange when clicking a pronoun', async () => {
    const user = userEvent.setup();
    const onPronounsChange = vi.fn();

    render(<StepNameInput {...defaultProps} onPronounsChange={onPronounsChange} />);

    await user.click(screen.getByTestId('pronoun-he-him'));
    expect(onPronounsChange).toHaveBeenCalledWith('he/him');
  });

  it('shows continue button only when name is valid (2+ chars)', () => {
    const { rerender } = render(<StepNameInput {...defaultProps} name="" />);
    expect(screen.queryByTestId('continue-btn')).not.toBeInTheDocument();

    rerender(<StepNameInput {...defaultProps} name="Al" />);
    expect(screen.getByTestId('continue-btn')).toBeInTheDocument();
  });

  it('shows companion name in the CTA', () => {
    render(<StepNameInput {...defaultProps} name="Luna" />);
    expect(screen.getByTestId('continue-btn')).toHaveTextContent('Luna');
  });

  it('calls onContinue when clicking the CTA', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    render(<StepNameInput {...defaultProps} name="Luna" onContinue={onContinue} />);

    await user.click(screen.getByTestId('continue-btn'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('generates a name when clicking Surprise me', async () => {
    const user = userEvent.setup();
    const onNameChange = vi.fn();
    const onPronounsChange = vi.fn();

    render(
      <StepNameInput
        {...defaultProps}
        onNameChange={onNameChange}
        onPronounsChange={onPronounsChange}
      />,
    );

    await user.click(screen.getByTestId('surprise-me-btn'));

    await waitFor(() => {
      expect(onNameChange).toHaveBeenCalledWith('Luna');
    });
    expect(onPronounsChange).toHaveBeenCalledWith('she/her');
  });
});

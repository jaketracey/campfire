import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepVibeSelect } from '../step-vibe-select';
import { VIBE_PRESETS } from '../vibe-presets';

// Mock framer-motion to avoid animation issues in tests
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

describe('StepVibeSelect', () => {
  it('renders all three vibe cards', () => {
    const onSelect = vi.fn();
    const onDesignOwn = vi.fn();

    render(<StepVibeSelect onSelect={onSelect} onDesignOwn={onDesignOwn} />);

    for (const preset of VIBE_PRESETS) {
      expect(screen.getByTestId(`vibe-card-${preset.id}`)).toBeInTheDocument();
      expect(screen.getByText(preset.name)).toBeInTheDocument();
    }
  });

  it('renders the "design my own" link', () => {
    render(<StepVibeSelect onSelect={vi.fn()} onDesignOwn={vi.fn()} />);

    expect(screen.getByTestId('design-own-link')).toBeInTheDocument();
  });

  it('calls onSelect with the correct preset when a card is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<StepVibeSelect onSelect={onSelect} onDesignOwn={vi.fn()} />);

    await user.click(screen.getByTestId('vibe-card-warm-caring'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(VIBE_PRESETS[0]);
  });

  it('calls onDesignOwn when the link is clicked', async () => {
    const user = userEvent.setup();
    const onDesignOwn = vi.fn();

    render(<StepVibeSelect onSelect={vi.fn()} onDesignOwn={onDesignOwn} />);

    await user.click(screen.getByTestId('design-own-link'));
    expect(onDesignOwn).toHaveBeenCalledTimes(1);
  });

  it('shows the heading text', () => {
    render(<StepVibeSelect onSelect={vi.fn()} onDesignOwn={vi.fn()} />);

    expect(screen.getByText('Who do you want to meet?')).toBeInTheDocument();
  });
});

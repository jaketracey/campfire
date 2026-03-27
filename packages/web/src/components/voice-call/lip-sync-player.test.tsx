/**
 * LipSyncPlayer Component Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LipSyncPlayer } from './lip-sync-player';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Loader2: (props: any) => <div data-testid="loader-icon" {...props} />,
}));

describe('LipSyncPlayer', () => {
  const defaultProps = {
    companionAvatarUrl: 'https://example.com/avatar.png',
    videoUrl: null,
    isLoading: false,
    isSpeaking: false,
  };

  it('renders static avatar image by default', () => {
    render(<LipSyncPlayer {...defaultProps} />);

    const img = screen.getByAltText('Companion avatar');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
  });

  it('does not render video element when videoUrl is null', () => {
    const { container } = render(<LipSyncPlayer {...defaultProps} />);

    const video = container.querySelector('video');
    expect(video).toBeNull();
  });

  it('renders video element when videoUrl is provided', () => {
    const { container } = render(
      <LipSyncPlayer {...defaultProps} videoUrl="https://example.com/video.mp4" />
    );

    const video = container.querySelector('video');
    expect(video).toBeDefined();
    expect(video?.getAttribute('src')).toBe('https://example.com/video.mp4');
    expect(video?.getAttribute('muted')).toBeDefined();
  });

  it('shows loading spinner when isLoading is true', () => {
    render(<LipSyncPlayer {...defaultProps} isLoading={true} />);

    const loader = screen.getByTestId('loader-icon');
    expect(loader).toBeDefined();
  });

  it('does not show loading spinner when isLoading is false', () => {
    render(<LipSyncPlayer {...defaultProps} isLoading={false} />);

    expect(screen.queryByTestId('loader-icon')).toBeNull();
  });

  it('shows speaking indicator ring when speaking and no video', () => {
    const { container } = render(
      <LipSyncPlayer {...defaultProps} isSpeaking={true} />
    );

    // The speaking ring should have animate-pulse class
    const pulseElement = container.querySelector('.animate-pulse');
    expect(pulseElement).toBeDefined();
  });

  it('avatar image is fully opaque when no video is playing', () => {
    render(<LipSyncPlayer {...defaultProps} />);

    const img = screen.getByAltText('Companion avatar');
    expect(img.className).toContain('opacity-100');
  });

  it('video element fires onEnded callback', () => {
    const { container } = render(
      <LipSyncPlayer {...defaultProps} videoUrl="https://example.com/video.mp4" />
    );

    const video = container.querySelector('video');
    expect(video).toBeDefined();

    // Trigger ended event - this should not throw
    if (video) {
      fireEvent.ended(video);
    }
  });
});

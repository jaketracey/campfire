import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoCallButton } from '../video-call-button';
import { VideoCallControls } from '../video-call-controls';
import { VideoCallOverlay } from '../video-call-overlay';
import { CompanionVideoFeed } from '../companion-video-feed';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...domProps } = props;
      void initial; void animate; void exit; void transition; void whileHover; void whileTap;
      return <div {...domProps}>{children}</div>;
    },
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...domProps } = props;
      void initial; void animate; void exit; void transition; void whileHover; void whileTap;
      return <button {...domProps}>{children}</button>;
    },
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, transition, ...domProps } = props;
      void initial; void animate; void exit; void transition;
      return <span {...domProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock radix tooltip
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TooltipProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock radix dropdown
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <>{children}</>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe('VideoCallButton', () => {
  it('renders with correct aria label', () => {
    render(<VideoCallButton onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start video call' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<VideoCallButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start video call' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<VideoCallButton onClick={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Start video call' })).toBeDisabled();
  });
});

describe('VideoCallControls', () => {
  const defaultProps = {
    status: 'active' as const,
    isMicMuted: false,
    isCameraEnabled: false,
    onToggleMic: vi.fn(),
    onToggleCamera: vi.fn(),
    onEndCall: vi.fn(),
  };

  it('renders all control buttons', () => {
    render(<VideoCallControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable camera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End video call' })).toBeInTheDocument();
  });

  it('calls onToggleMic when mic button is clicked', () => {
    render(<VideoCallControls {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(defaultProps.onToggleMic).toHaveBeenCalledTimes(1);
  });

  it('calls onEndCall when end button is clicked', () => {
    render(<VideoCallControls {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'End video call' }));
    expect(defaultProps.onEndCall).toHaveBeenCalledTimes(1);
  });

  it('shows muted state when mic is muted', () => {
    render(<VideoCallControls {...defaultProps} isMicMuted={true} />);
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeInTheDocument();
  });

  it('shows camera enabled state', () => {
    render(<VideoCallControls {...defaultProps} isCameraEnabled={true} />);
    expect(screen.getByRole('button', { name: 'Disable camera' })).toBeInTheDocument();
  });

  it('displays token balance when provided', () => {
    render(<VideoCallControls {...defaultProps} tokenBalance={500} />);
    expect(screen.getByText('500 tokens')).toBeInTheDocument();
  });
});

describe('VideoCallOverlay', () => {
  it('shows connecting state with companion name', () => {
    render(
      <VideoCallOverlay
        status="connecting"
        companionName="Luna"
        error={null}
        duration={0}
        callSummary={null}
      />,
    );
    expect(screen.getByText('Connecting to Luna...')).toBeInTheDocument();
  });

  it('shows reconnecting warning', () => {
    render(
      <VideoCallOverlay
        status="reconnecting"
        companionName="Luna"
        error={null}
        duration={30}
        callSummary={null}
      />,
    );
    expect(screen.getByText('Poor connection - reconnecting...')).toBeInTheDocument();
  });

  it('shows call ended summary', () => {
    render(
      <VideoCallOverlay
        status="ended"
        companionName="Luna"
        error={null}
        duration={0}
        callSummary={{ duration: 125, tokensUsed: 42 }}
      />,
    );
    expect(screen.getByText('Call Ended')).toBeInTheDocument();
    expect(screen.getByText('02:05')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows token low warning when balance is low', () => {
    render(
      <VideoCallOverlay
        status="active"
        companionName="Luna"
        error={null}
        duration={60}
        callSummary={null}
        tokenBalance={50}
        tokenWarningThreshold={100}
      />,
    );
    expect(screen.getByText('Low tokens: 50')).toBeInTheDocument();
  });

  it('shows duration timer when active', () => {
    render(
      <VideoCallOverlay
        status="active"
        companionName="Luna"
        error={null}
        duration={90}
        callSummary={null}
      />,
    );
    expect(screen.getByText('01:30')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(
      <VideoCallOverlay
        status="active"
        companionName="Luna"
        error="Connection failed"
        duration={0}
        callSummary={null}
      />,
    );
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });
});

describe('CompanionVideoFeed', () => {
  it('shows fallback avatar when no video track', () => {
    render(
      <CompanionVideoFeed
        videoTrack={null}
        companionName="Luna"
        avatarUrl="https://example.com/avatar.jpg"
      />,
    );
    expect(screen.getByAltText('Luna')).toBeInTheDocument();
  });

  it('shows initials fallback when no avatar URL', () => {
    render(
      <CompanionVideoFeed
        videoTrack={null}
        companionName="Luna"
      />,
    );
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getByText('Luna')).toBeInTheDocument();
  });
});

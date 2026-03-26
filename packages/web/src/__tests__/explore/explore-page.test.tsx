import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExplorePage from '@/app/explore/page';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...domProps } = props;
      return <button {...domProps}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock useAuth
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

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isInitialized: true,
    isLoading: false,
    user: null,
  }),
}));

// Mock API calls
vi.mock('@/lib/api', () => ({
  createCompanion: vi.fn(),
  createSession: vi.fn(),
}));

describe('ExplorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the hero section with title and subtitle', () => {
    render(<ExplorePage />);

    expect(screen.getByText('Meet Someone New')).toBeInTheDocument();
    expect(
      screen.getByText('Browse companions ready to chat. No setup required.')
    ).toBeInTheDocument();
  });

  it('renders all category filter pills', () => {
    render(<ExplorePage />);

    expect(screen.getByTestId('filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('filter-caring')).toBeInTheDocument();
    expect(screen.getByTestId('filter-playful')).toBeInTheDocument();
    expect(screen.getByTestId('filter-intellectual')).toBeInTheDocument();
    expect(screen.getByTestId('filter-creative')).toBeInTheDocument();
    expect(screen.getByTestId('filter-mysterious')).toBeInTheDocument();
    expect(screen.getByTestId('filter-bold')).toBeInTheDocument();
  });

  it('renders companion cards in a grid', () => {
    render(<ExplorePage />);

    const grid = screen.getByTestId('companion-grid');
    expect(grid).toBeInTheDocument();

    // Should render all 12 featured companions
    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.getByText('Kai')).toBeInTheDocument();
    expect(screen.getByText('Mira')).toBeInTheDocument();
    expect(screen.getByText('Atlas')).toBeInTheDocument();
  });

  it('filters companions by category when a filter pill is clicked', () => {
    render(<ExplorePage />);

    // Click "Caring" filter
    fireEvent.click(screen.getByTestId('filter-caring'));

    // Luna and Iris should be visible (caring category)
    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.getByText('Iris')).toBeInTheDocument();

    // Kai (intellectual) should not be visible
    expect(screen.queryByText('Kai')).not.toBeInTheDocument();
  });

  it('filters companions by search query', () => {
    render(<ExplorePage />);

    const searchInput = screen.getByTestId('explore-search');
    fireEvent.change(searchInput, { target: { value: 'Luna' } });

    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.queryByText('Kai')).not.toBeInTheDocument();
  });

  it('shows empty state when no companions match', () => {
    render(<ExplorePage />);

    const searchInput = screen.getByTestId('explore-search');
    fireEvent.change(searchInput, { target: { value: 'zzzznonexistent' } });

    expect(
      screen.getByText('No companions match your search. Try a different filter.')
    ).toBeInTheDocument();
  });

  it('renders the search input', () => {
    render(<ExplorePage />);

    const searchInput = screen.getByTestId('explore-search');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute(
      'placeholder',
      'Search by name or trait...'
    );
  });
});

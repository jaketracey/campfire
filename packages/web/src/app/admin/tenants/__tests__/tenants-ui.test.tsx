import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AdminTenantsPage from '../page';
import TenantDetailPage from '../[tenantId]/page';

const mockPush = vi.fn();
const mockParams = { tenantId: 'tenant-1' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => mockParams,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

vi.mock('@/lib/api/tenants', () => ({
  listTenants: vi.fn(),
  getTenant: vi.fn(),
  updateTenant: vi.fn(),
  addTenantDomain: vi.fn(),
  updateTenantDomain: vi.fn(),
  verifyTenantDomain: vi.fn(),
  deleteTenantDomain: vi.fn(),
}));

import * as tenantsApi from '@/lib/api/tenants';

describe('/admin/tenants UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tenant list', async () => {
    vi.mocked(tenantsApi.listTenants).mockResolvedValueOnce({
      success: true,
      data: {
        tenants: [
          {
            id: 'tenant-1',
            ownerUserId: 'owner-1',
            slug: 'creator-one',
            name: 'Creator One',
            status: 'active',
            brandConfig: {},
            primaryDomain: 'creator.example.com',
            domainCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        limit: 50,
        offset: 0,
      },
    } as any);

    render(<AdminTenantsPage />);

    await waitFor(() => expect(tenantsApi.listTenants).toHaveBeenCalled());
    expect(screen.getByText('Creator One')).toBeInTheDocument();
    expect(screen.getByText('Primary:')).toBeInTheDocument();
  });

  it('adds a domain on tenant detail page', async () => {
    vi.mocked(tenantsApi.getTenant).mockResolvedValueOnce({
      success: true,
      data: {
        tenant: {
          id: 'tenant-1',
          ownerUserId: 'owner-1',
          slug: 'creator-one',
          name: 'Creator One',
          status: 'active',
          brandConfig: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        domains: [
          {
            id: 'domain-1',
            tenantId: 'tenant-1',
            domain: 'creator.example.com',
            isPrimary: true,
            verificationToken: null,
            verifiedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    } as any);

    vi.mocked(tenantsApi.addTenantDomain).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'domain-2',
        tenantId: 'tenant-1',
        domain: 'new.example.com',
        isPrimary: false,
        verificationToken: 'token',
        verifiedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as any);

    const user = userEvent.setup();
    render(<TenantDetailPage />);

    await waitFor(() => expect(tenantsApi.getTenant).toHaveBeenCalledWith('tenant-1'));

    const input = screen.getByPlaceholderText('example.com');
    await user.type(input, 'new.example.com');
    await user.click(screen.getByRole('button', { name: 'Add Domain' }));

    await waitFor(() => expect(tenantsApi.addTenantDomain).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ domain: 'new.example.com' })));
    expect(await screen.findByText('new.example.com')).toBeInTheDocument();
  });
});


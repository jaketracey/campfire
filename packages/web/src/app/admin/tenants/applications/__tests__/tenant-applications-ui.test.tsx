import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AdminTenantApplicationsPage from '../page';
import AdminTenantApplicationDetailPage from '../[applicationId]/page';

const mockPush = vi.fn();
const mockParams = { applicationId: 'app-1' };

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

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock('@/lib/api/tenant-applications', () => ({
  listTenantApplications: vi.fn(),
  getTenantApplication: vi.fn(),
  approveTenantApplication: vi.fn(),
  rejectTenantApplication: vi.fn(),
}));

import * as tenantApplicationsApi from '@/lib/api/tenant-applications';

describe('/admin/tenants/applications UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the applications list and navigates to detail', async () => {
    vi.mocked(tenantApplicationsApi.listTenantApplications).mockResolvedValueOnce({
      success: true,
      data: {
        applications: [
          {
            id: 'app-1',
            status: 'submitted',
            applicantName: 'Jane',
            applicantEmail: 'jane@example.com',
            applicantUserId: null,
            desiredTenantName: 'Jane Brand',
            desiredSlug: 'jane-brand',
            desiredPrimaryDomain: 'jane.example.com',
            brandConfig: {},
            message: null,
            reviewedByUserId: null,
            reviewedAt: null,
            decisionReason: null,
            approvedTenantId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        limit: 50,
        offset: 0,
      },
    } as any);

    const user = userEvent.setup();
    render(<AdminTenantApplicationsPage />);

    await waitFor(() => expect(tenantApplicationsApi.listTenantApplications).toHaveBeenCalled());
    expect(screen.getByText('Jane Brand')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Jane Brand/i });
    expect(within(row).getByText('Submitted')).toBeInTheDocument();

    await user.click(row);
    expect(mockPush).toHaveBeenCalledWith('/admin/tenants/applications/app-1');
  });

  it('approves an application and navigates to created tenant', async () => {
    vi.mocked(tenantApplicationsApi.getTenantApplication).mockResolvedValueOnce({
      success: true,
      data: {
        application: {
          id: 'app-1',
          status: 'submitted',
          applicantName: 'Jane',
          applicantEmail: 'jane@example.com',
          applicantUserId: 'c4f4a1e4-7b31-4c28-9f7a-27e377e8253c',
          desiredTenantName: 'Jane Brand',
          desiredSlug: 'jane-brand',
          desiredPrimaryDomain: 'jane.example.com',
          brandConfig: { name: 'Jane Brand' },
          message: 'hello',
          reviewedByUserId: null,
          reviewedAt: null,
          decisionReason: null,
          approvedTenantId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    } as any);

    vi.mocked(tenantApplicationsApi.approveTenantApplication).mockResolvedValueOnce({
      success: true,
      data: {
        tenant: { id: 'tenant-1' },
        domain: null,
      },
    } as any);

    const user = userEvent.setup();
    render(<AdminTenantApplicationDetailPage />);

    await waitFor(() => expect(tenantApplicationsApi.getTenantApplication).toHaveBeenCalledWith('app-1'));

    await waitFor(() => expect(screen.getByLabelText('Owner user ID')).toHaveValue('c4f4a1e4-7b31-4c28-9f7a-27e377e8253c'));
    await user.click(screen.getByRole('button', { name: 'Approve & create tenant' }));

    await waitFor(() => expect(tenantApplicationsApi.approveTenantApplication).toHaveBeenCalled());
    expect(tenantApplicationsApi.approveTenantApplication).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({
        ownerUserId: 'c4f4a1e4-7b31-4c28-9f7a-27e377e8253c',
      })
    );
    expect(mockPush).toHaveBeenCalledWith('/admin/tenants/tenant-1');
  });
});

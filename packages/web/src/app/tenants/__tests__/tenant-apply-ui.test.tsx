import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TenantApplicationPage from '../apply/page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock('@/lib/api/tenant-applications', () => ({
  submitTenantApplication: vi.fn(),
}));

import * as tenantApplicationsApi from '@/lib/api/tenant-applications';

describe('/tenants/apply UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits an application and shows success state', async () => {
    vi.mocked(tenantApplicationsApi.submitTenantApplication).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'app-1',
        status: 'submitted',
        createdAt: new Date().toISOString(),
      },
    } as any);

    const user = userEvent.setup();
    render(<TenantApplicationPage />);

    await user.type(screen.getByLabelText('Name'), 'Jane Creator');
    await user.type(screen.getByLabelText('Email'), 'jane@example.com');
    await user.type(screen.getByLabelText('Tenant name'), 'Jane Brand');
    await user.type(screen.getByLabelText('Desired slug'), 'Jane Brand!!');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await waitFor(() => expect(tenantApplicationsApi.submitTenantApplication).toHaveBeenCalled());
    expect(tenantApplicationsApi.submitTenantApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredSlug: 'jane-brand',
        applicantEmail: 'jane@example.com',
        desiredTenantName: 'Jane Brand',
      })
    );

    expect(await screen.findByText('Application received')).toBeInTheDocument();
    expect(screen.getByText('app-1')).toBeInTheDocument();
  });
});


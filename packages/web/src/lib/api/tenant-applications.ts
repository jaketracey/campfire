import { get, post } from './client';

export type TenantApplicationStatus = 'submitted' | 'approved' | 'rejected';

export type TenantApplicationBrandConfig = {
  name?: string;
  shortName?: string;
  supportEmail?: string;
  legalEmail?: string;
  primaryHsl?: string;
  primaryForegroundHsl?: string;
  logoUrl?: string;
};

export type TenantApplication = {
  id: string;
  status: TenantApplicationStatus;
  applicantName: string;
  applicantEmail: string;
  applicantUserId: string | null;
  desiredTenantName: string;
  desiredSlug: string;
  desiredPrimaryDomain: string | null;
  brandConfig: TenantApplicationBrandConfig;
  message: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  approvedTenantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function submitTenantApplication(input: {
  applicantName: string;
  applicantEmail: string;
  desiredTenantName: string;
  desiredSlug: string;
  desiredPrimaryDomain?: string;
  brandConfig?: TenantApplicationBrandConfig;
  message?: string;
}): Promise<{ success: true; data: { id: string; status: TenantApplicationStatus; createdAt: string } }> {
  return post('/public/tenant-applications', input);
}

export async function listTenantApplications(params?: {
  status?: TenantApplicationStatus;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ success: true; data: { applications: TenantApplication[]; limit: number; offset: number } }> {
  return get('/admin/tenants/applications', params);
}

export async function getTenantApplication(applicationId: string): Promise<{ success: true; data: { application: TenantApplication } }> {
  return get(`/admin/tenants/applications/${applicationId}`);
}

export async function approveTenantApplication(applicationId: string, input: {
  ownerUserId: string;
  slug?: string;
  name?: string;
  primaryDomain?: string;
  markDomainVerified?: boolean;
  brandConfig?: TenantApplicationBrandConfig;
  decisionReason?: string;
}): Promise<{ success: true; data: { tenant: { id: string }; domain: { id: string; domain: string } | null } }> {
  return post(`/admin/tenants/applications/${applicationId}/approve`, input);
}

export async function rejectTenantApplication(applicationId: string, input: { decisionReason?: string }): Promise<{ success: true }> {
  return post(`/admin/tenants/applications/${applicationId}/reject`, input);
}


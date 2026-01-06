import { del, get, patch, post } from './client';

export type TenantStatus = 'active' | 'suspended';

export type TenantBrandConfig = {
  name?: string;
  shortName?: string;
  supportEmail?: string;
  legalEmail?: string;
  primaryHsl?: string;
  primaryForegroundHsl?: string;
  logoUrl?: string;
};

export type AdminTenantListItem = {
  id: string;
  ownerUserId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  brandConfig: TenantBrandConfig;
  primaryDomain: string | null;
  domainCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminTenantDomain = {
  id: string;
  tenantId: string;
  domain: string;
  isPrimary: boolean;
  verificationToken: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTenant = {
  id: string;
  ownerUserId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  brandConfig: TenantBrandConfig;
  createdAt: string;
  updatedAt: string;
};

export async function listTenants(params?: { search?: string; limit?: number; offset?: number }): Promise<{
  success: true;
  data: { tenants: AdminTenantListItem[]; limit: number; offset: number };
}> {
  return get('/admin/tenants', params);
}

export async function createTenant(input: {
  ownerUserId: string;
  slug: string;
  name: string;
  status?: TenantStatus;
  brandConfig?: TenantBrandConfig;
}): Promise<{ success: true; data: AdminTenant }> {
  return post('/admin/tenants', input);
}

export async function getTenant(tenantId: string): Promise<{
  success: true;
  data: { tenant: AdminTenant; domains: AdminTenantDomain[] };
}> {
  return get(`/admin/tenants/${tenantId}`);
}

export async function updateTenant(
  tenantId: string,
  input: Partial<Pick<AdminTenant, 'slug' | 'name' | 'status'>> & { brandConfig?: TenantBrandConfig }
): Promise<{ success: true; data: AdminTenant }> {
  return patch(`/admin/tenants/${tenantId}`, input);
}

export async function addTenantDomain(
  tenantId: string,
  input: { domain: string; isPrimary?: boolean }
): Promise<{ success: true; data: AdminTenantDomain }> {
  return post(`/admin/tenants/${tenantId}/domains`, input);
}

export async function updateTenantDomain(
  tenantId: string,
  domainId: string,
  input: { isPrimary?: boolean }
): Promise<{ success: true; data: AdminTenantDomain }> {
  return patch(`/admin/tenants/${tenantId}/domains/${domainId}`, input);
}

export async function verifyTenantDomain(
  tenantId: string,
  domainId: string
): Promise<{ success: true; data: AdminTenantDomain }> {
  return post(`/admin/tenants/${tenantId}/domains/${domainId}/verify`);
}

export async function deleteTenantDomain(tenantId: string, domainId: string): Promise<void> {
  await del(`/admin/tenants/${tenantId}/domains/${domainId}`);
}


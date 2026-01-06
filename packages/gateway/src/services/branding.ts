import { getTenantsRepository, type Tenant } from '../repositories/index.js';
import { getRequestHost, getRequestProtocol } from '../utils/host.js';

export interface BrandConfig {
  name: string;
  shortName: string;
  supportEmail?: string;
  legalEmail?: string;
  primaryHsl?: string;
  primaryForegroundHsl?: string;
  logoUrl?: string;
}

export interface BrandResolution {
  host: string;
  baseUrl: string;
  tenant: { id: string; slug: string; ownerUserId: string } | null;
  brand: BrandConfig;
}

const DEFAULT_BRAND: BrandConfig = {
  name: 'Ignite',
  shortName: 'Ignite',
  supportEmail: 'support@ignite.cam',
  legalEmail: 'legal@ignite.cam',
  primaryHsl: '24.6 95% 53.1%',
  primaryForegroundHsl: '60 9.1% 97.8%',
  logoUrl: 'https://ignite.cam/favicon/favicon-96x96.png',
};

function tenantToBrand(tenant: Tenant): BrandConfig {
  const cfg = (tenant.brand_config ?? {}) as Partial<BrandConfig>;
  return {
    ...DEFAULT_BRAND,
    ...cfg,
    name: cfg.name ?? tenant.name,
    shortName: cfg.shortName ?? tenant.name,
  };
}

export class BrandingService {
  private tenants = getTenantsRepository();

  async resolveFromHeaders(headers: Record<string, unknown>): Promise<BrandResolution> {
    const host = getRequestHost(headers);
    const protocol = getRequestProtocol(headers);
    const baseUrl = host ? `${protocol}://${host}` : 'https://ignite.cam';

    if (!host) {
      return {
        host: '',
        baseUrl,
        tenant: null,
        brand: DEFAULT_BRAND,
      };
    }

    const tenant = await this.tenants.findTenantByDomain(host);
    if (!tenant) {
      return {
        host,
        baseUrl,
        tenant: null,
        brand: DEFAULT_BRAND,
      };
    }

    return {
      host,
      baseUrl,
      tenant: { id: tenant.id, slug: tenant.slug, ownerUserId: tenant.owner_user_id },
      brand: tenantToBrand(tenant),
    };
  }
}

let brandingService: BrandingService | null = null;
export function getBrandingService(): BrandingService {
  brandingService ??= new BrandingService();
  return brandingService;
}

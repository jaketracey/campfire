import 'server-only';

import { headers } from 'next/headers';
import { serverEnv } from '../../env/server';

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

const DEFAULT_BRAND: BrandResolution = {
  host: '',
  baseUrl: serverEnv.NEXT_PUBLIC_APP_URL,
  tenant: null,
  brand: {
    name: 'Ignite',
    shortName: 'Ignite',
    supportEmail: 'support@ignite.cam',
    legalEmail: 'legal@ignite.cam',
    primaryHsl: '24.6 95% 53.1%',
    primaryForegroundHsl: '60 9.1% 97.8%',
    logoUrl: 'https://ignite.cam/favicon/favicon-96x96.png',
  },
};

async function getRequestHostAndProto(): Promise<{ host: string | null; proto: string | null }> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto');
  return { host, proto };
}

export async function fetchBrandForRequest(): Promise<BrandResolution> {
  const { host, proto } = await getRequestHostAndProto();
  const gatewayUrl = serverEnv.GATEWAY_URL;

  try {
    const res = await fetch(`${gatewayUrl}/api/v1/public/brand`, {
      headers: {
        ...(host ? { 'x-forwarded-host': host } : {}),
        ...(proto ? { 'x-forwarded-proto': proto } : {}),
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) return DEFAULT_BRAND;
    const json = await res.json() as { success: boolean; data?: BrandResolution };
    if (!json.success || !json.data) return DEFAULT_BRAND;
    return json.data;
  } catch {
    return DEFAULT_BRAND;
  }
}

import 'server-only';

import { headers } from 'next/headers';
import { serverEnv } from '../env/server';

export async function getRequestBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.includes('localhost') ? 'http' : 'https');
  if (!host) return serverEnv.NEXT_PUBLIC_APP_URL;
  return `${proto}://${host}`;
}

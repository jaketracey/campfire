export function normalizeHost(rawHost: string): string {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) return '';

  // Strip port if present (e.g., example.com:3000)
  const withoutPort = trimmed.includes(':') ? trimmed.split(':')[0]! : trimmed;
  return withoutPort;
}

export function getRequestHost(headers: Record<string, unknown>): string {
  const xfHost = headers['x-forwarded-host'];
  if (typeof xfHost === 'string' && xfHost.trim()) return normalizeHost(xfHost);

  const host = headers['host'];
  if (typeof host === 'string' && host.trim()) return normalizeHost(host);

  return '';
}

export function getRequestProtocol(headers: Record<string, unknown>): 'http' | 'https' {
  const xfProto = headers['x-forwarded-proto'];
  if (typeof xfProto === 'string') {
    const normalized = xfProto.trim().toLowerCase();
    if (normalized === 'http' || normalized === 'https') return normalized;
  }
  return 'https';
}


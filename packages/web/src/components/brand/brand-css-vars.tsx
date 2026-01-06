import 'server-only';

import type { ReactElement } from 'react';
import { fetchBrandForRequest } from '@/lib/brand/server';

export async function BrandCssVars(): Promise<ReactElement> {
  const resolved = await fetchBrandForRequest();

  const css = [
    ':root{',
    resolved.brand.primaryHsl ? `--primary:${resolved.brand.primaryHsl};` : '',
    resolved.brand.primaryForegroundHsl ? `--primary-foreground:${resolved.brand.primaryForegroundHsl};` : '',
    '}',
  ].join('');

  return <style id="brand-css-vars">{css}</style>;
}

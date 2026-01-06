import { MetadataRoute } from 'next';
import { serverEnv } from '@/env/server';

// Gateway URL for fetching published pages
const GATEWAY_URL = serverEnv.GATEWAY_URL;
const BASE_URL = serverEnv.NEXT_PUBLIC_APP_URL;

interface SitemapEntry {
  slug: string;
  updatedAt: string;
}

async function fetchPublishedPages(): Promise<SitemapEntry[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/public/sitemap`, {
      next: { revalidate: 3600 }, // Revalidate every hour
    });

    if (!res.ok) {
      console.error('Failed to fetch sitemap data:', res.status);
      return [];
    }

    const json = await res.json();
    return json.data?.pages ?? [];
  } catch (error) {
    console.error('Error fetching sitemap data:', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fetch all published SEO pages
  const pages = await fetchPublishedPages();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date('2026-01-01'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: new Date('2026-01-01'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Dynamic companion pages
  const companionPages: MetadataRoute.Sitemap = pages.map((page) => ({
    url: `${BASE_URL}/c/${page.slug}`,
    lastModified: new Date(page.updatedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...companionPages];
}

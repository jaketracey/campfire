import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CompanionProfile } from '@/components/seo/companion-profile';
import { serverEnv } from '@/env/server';
import { getRequestBaseUrl } from '@/lib/request-base-url';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Gateway URL for server-side fetching
const GATEWAY_URL = serverEnv.GATEWAY_URL;

interface SeoPageData {
  id: string;
  slug: string;
  title: string;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
  contentHtml: string;
  contentJson: {
    headline?: string;
    tagline?: string;
    personalitySummary?: string;
    keyTraits?: string[];
    conversationStarters?: string[];
  };
  publishedAt: string | null;
  updatedAt: string;
  companion: {
    id: string;
    name: string;
    avatarUrl: string | null;
    spec: {
      identity: {
        name: string;
        pronouns: string;
        address_style: string;
      };
      personality: {
        archetype: string;
        traits: Record<string, number>;
      };
    };
  } | null;
}

async function fetchSeoPage(slug: string): Promise<SeoPageData | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/public/companions/${slug}`, {
      next: { revalidate: 60 }, // ISR: revalidate every 60 seconds
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    return json.data;
  } catch (error) {
    console.error('Failed to fetch SEO page:', error);
    return null;
  }
}

// Generate dynamic metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchSeoPage(slug);

  if (!page) {
    return {
      title: 'Companion Not Found',
    };
  }

  const baseUrl = await getRequestBaseUrl();

  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    openGraph: {
      title: page.ogTitle || page.title,
      description: page.ogDescription || page.metaDescription || undefined,
      images: page.ogImageUrl ? [{ url: page.ogImageUrl }] : undefined,
      url: `${baseUrl}/c/${slug}`,
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: page.ogTitle || page.title,
      description: page.ogDescription || page.metaDescription || undefined,
      images: page.ogImageUrl ? [page.ogImageUrl] : undefined,
    },
    alternates: {
      canonical: `${baseUrl}/c/${slug}`,
    },
  };
}

// Server component - fetches data at request time with ISR
export default async function CompanionProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const page = await fetchSeoPage(slug);

  if (!page) {
    notFound();
  }

  return <CompanionProfile page={page} />;
}

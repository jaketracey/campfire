import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { CompanionSharePage } from '@/components/companion/companion-share-page';
import { siteConfig } from '@/lib/constants';

interface Props {
  params: Promise<{ companionId: string }>;
}

interface PublicCompanion {
  id: string;
  name: string;
  spec: {
    identity?: { name?: string; pronouns?: string };
    personality?: {
      archetype?: string;
      secondary_archetype?: string;
      traits?: Record<string, number>;
    };
    visual_style?: {
      style_type?: string;
      appearance?: {
        ethnicity?: string;
        bodyType?: string;
        hairColor?: string;
      };
    };
  };
  avatarUrl: string | null;
  createdAt: string;
}

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

const getPublicCompanion = unstable_cache(
  async (companionId: string): Promise<PublicCompanion | null> => {
    try {
      const res = await fetch(
        `${GATEWAY_URL}/api/v1/companions/public/${companionId}`
      );

      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },
  ['public-companion'],
  { revalidate: 60, tags: ['companion'] }
);

// Return a placeholder for build validation - actual pages are generated on-demand
export async function generateStaticParams() {
  return [{ companionId: 'placeholder' }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { companionId } = await params;
  const companion = await getPublicCompanion(companionId);

  if (!companion) {
    return { title: 'Companion Not Found' };
  }

  const archetype = companion.spec?.personality?.archetype || 'companion';
  const title = `${companion.name} - AI Companion on Campfire`;
  const description = `Meet ${companion.name}, a ${archetype} AI companion. Create your own personalized AI companion on Campfire.`;
  const imageUrl = companion.avatarUrl || `${siteConfig.url}/og-companion-default.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'profile',
      url: `${siteConfig.url}/c/${companionId}`,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function CompanionPage({ params }: Props) {
  const { companionId } = await params;
  const companion = await getPublicCompanion(companionId);

  if (!companion) {
    notFound();
  }

  return <CompanionSharePage companion={companion} />;
}

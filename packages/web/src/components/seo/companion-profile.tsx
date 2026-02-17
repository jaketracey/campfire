import DOMPurify from 'isomorphic-dompurify';
import Image from 'next/image';
import Link from 'next/link';
import { Flame, MessageCircle, Sparkles, Heart } from 'lucide-react';

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

interface CompanionProfileProps {
  page: SeoPageData;
}

export function CompanionProfile({ page }: CompanionProfileProps) {
  const { contentJson, companion } = page;
  const avatarUrl = companion?.avatarUrl || page.ogImageUrl;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <Flame className="h-7 w-7 text-campfire-500 group-hover:scale-110 transition-transform" />
            <span className="font-bold font-display text-lg text-white">Ignite</span>
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 bg-campfire-500 hover:bg-campfire-600 text-white rounded-lg font-medium text-sm transition-colors"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          {/* Avatar */}
          {avatarUrl && (
            <div className="relative w-32 h-32 md:w-40 md:h-40 mx-auto mb-8">
              <Image
                src={avatarUrl}
                alt={companion?.name || 'Companion'}
                fill
                className="rounded-full object-cover ring-4 ring-campfire-500/20"
                priority
              />
            </div>
          )}

          {/* Headline */}
          <h1 className="text-4xl md:text-5xl font-bold font-display text-white mb-4">
            {contentJson.headline || `Meet ${companion?.name || 'Your Companion'}`}
          </h1>

          {/* Tagline */}
          <p className="text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto">
            {contentJson.tagline || page.metaDescription}
          </p>

          {/* CTA */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center px-8 py-4 bg-campfire-500 hover:bg-campfire-600 text-white rounded-xl font-semibold text-lg transition-colors"
            >
              <MessageCircle className="h-5 w-5 mr-2" />
              Start Chatting
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-8 py-4 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-lg transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* About Section */}
      {contentJson.personalitySummary && (
        <section className="py-16 bg-white/[0.02]">
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-6">
              <Heart className="h-6 w-6 text-campfire-500" />
              <h2 className="text-2xl font-bold text-white">
                About {companion?.name || 'This Companion'}
              </h2>
            </div>
            <p className="text-lg text-gray-300 leading-relaxed">
              {contentJson.personalitySummary}
            </p>
          </div>
        </section>
      )}

      {/* Traits Section */}
      {contentJson.keyTraits && contentJson.keyTraits.length > 0 && (
        <section className="py-16">
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-8">
              <Sparkles className="h-6 w-6 text-campfire-500" />
              <h2 className="text-2xl font-bold text-white">Personality</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              {contentJson.keyTraits.map((trait, i) => (
                <span
                  key={i}
                  className="px-4 py-2 bg-campfire-500/10 text-campfire-400 rounded-full text-sm font-medium border border-campfire-500/20"
                >
                  {trait}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Conversation Starters */}
      {contentJson.conversationStarters && contentJson.conversationStarters.length > 0 && (
        <section className="py-16 bg-white/[0.02]">
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-8">
              <MessageCircle className="h-6 w-6 text-campfire-500" />
              <h2 className="text-2xl font-bold text-white">Start a Conversation</h2>
            </div>
            <div className="grid gap-4">
              {contentJson.conversationStarters.map((starter, i) => (
                <div
                  key={i}
                  className="p-4 bg-white/5 rounded-xl border border-white/5"
                >
                  <p className="text-gray-300 italic">&ldquo;{starter}&rdquo;</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Custom Content */}
      {page.contentHtml && (
        <section className="py-16">
          <div className="max-w-4xl mx-auto px-4">
            <div
              className="prose prose-invert prose-lg max-w-none prose-headings:font-display prose-a:text-campfire-400"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.contentHtml) }}
            />
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="py-24 bg-gradient-to-b from-transparent to-campfire-500/5">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white mb-4">
            Ready to connect with {companion?.name || 'your companion'}?
          </h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            Join thousands of others who have found meaningful connections through Ignite.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center px-8 py-4 bg-campfire-500 hover:bg-campfire-600 text-white rounded-xl font-semibold text-lg transition-colors"
          >
            <Flame className="h-5 w-5 mr-2" />
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-campfire-500" />
            <span className="text-gray-400 text-sm">Ignite - Your AI Companion</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

import Link from 'next/link';
import { CompanionBackground } from '@/components/onboarding/companion-background';
import { AnimatedFlame } from '@/components/ui/animated-flame';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#050505]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:ring-2 focus:ring-ring">
        Skip to main content
      </a>

      {/* Animated background */}
      <CompanionBackground />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-6">
        <Link href="/" className="hover:opacity-80 transition-opacity" aria-label="Campfire home">
          <AnimatedFlame size="md" />
        </Link>
      </header>

      {/* Main content */}
      <main id="main-content" className="relative z-10 flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

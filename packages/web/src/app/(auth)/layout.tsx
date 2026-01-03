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
      {/* Animated background */}
      <CompanionBackground />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-6">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <AnimatedFlame size="md" />
        </Link>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

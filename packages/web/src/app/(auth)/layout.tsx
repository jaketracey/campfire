import { Flame } from 'lucide-react';
import Link from 'next/link';
import { CompanionBackground } from '@/components/onboarding/companion-background';

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
        <Link href="/" className="flex items-center gap-2">
          <Flame className="h-8 w-8 text-campfire-500" />
          <span className="text-xl font-bold text-white">Campfire</span>
        </Link>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

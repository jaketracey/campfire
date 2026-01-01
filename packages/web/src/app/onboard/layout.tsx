import { Flame } from 'lucide-react';
import Link from 'next/link';
import { CompanionBackground } from '@/components/onboarding/companion-background';

export default function OnboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col relative">
      <CompanionBackground />
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-6">
        <Link href="/" className="flex items-center gap-2">
          <Flame className="h-8 w-8 text-campfire-500" />
          <span className="text-xl font-bold">Campfire</span>
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center pb-12 w-full z-10">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}


import Link from 'next/link';
import { OnboardingLogo } from '@/components/onboarding/onboarding-logo';
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
        <OnboardingLogo />
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center pb-12 w-full z-10">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}

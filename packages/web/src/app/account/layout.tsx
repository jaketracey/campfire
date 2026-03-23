import Link from 'next/link';
import { CompanionBackground } from '@/components/onboarding/companion-background';
import { DashboardHeaderNav } from '@/components/layout/dashboard-header-nav';
import { AnimatedFlame } from '@/components/ui/animated-flame';
import { FloatingHelpButton } from '@/components/support/floating-help-button';

export default function AccountLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen flex flex-col relative">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:ring-2 focus:ring-ring">
                Skip to main content
            </a>

            <CompanionBackground />

            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-6 bg-black/20 backdrop-blur-lg border-b border-white/5">
                <Link href="/" className="hover:opacity-80 transition-opacity" aria-label="Campfire home">
                    <AnimatedFlame size="md" />
                </Link>
                <DashboardHeaderNav />
            </header>

            <main id="main-content" className="flex-1 pt-24 z-10">
                {children}
            </main>

            <FloatingHelpButton />
        </div>
    );
}

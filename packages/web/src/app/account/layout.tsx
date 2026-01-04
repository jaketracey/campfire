import Link from 'next/link';
import { CompanionBackground } from '@/components/onboarding/companion-background';
import { DashboardHeaderNav } from '@/components/layout/dashboard-header-nav';
import { AnimatedFlame } from '@/components/ui/animated-flame';

export default function AccountLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen flex flex-col relative">
            <CompanionBackground />

            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-6 bg-black/20 backdrop-blur-lg border-b border-white/5">
                <Link href="/" className="hover:opacity-80 transition-opacity">
                    <AnimatedFlame size="md" />
                </Link>
                <DashboardHeaderNav />
            </header>

            <main className="flex-1 pt-24 z-10">
                {children}
            </main>
        </div>
    );
}

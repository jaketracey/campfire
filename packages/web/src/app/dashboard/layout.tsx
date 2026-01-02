import { Flame } from 'lucide-react';
import Link from 'next/link';
import { CompanionBackground } from '@/components/onboarding/companion-background';
import { DashboardHeaderNav } from '@/components/layout/dashboard-header-nav';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen flex flex-col relative">
            <CompanionBackground />

            {/* Campfire Header */}
            <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-6 bg-black/20 backdrop-blur-lg border-b border-white/5">
                <Link href="/" className="flex items-center gap-2 group">
                    <Flame className="h-8 w-8 text-campfire-500 group-hover:scale-110 transition-transform" />
                    <span className="text-xl font-bold font-display tracking-tight text-white">Campfire</span>
                </Link>
                <DashboardHeaderNav />
            </header>

            <main className="flex-1 pt-24 z-10">
                {children}
            </main>
        </div>
    );
}

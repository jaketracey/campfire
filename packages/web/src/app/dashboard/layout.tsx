import { Flame, User } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { CompanionBackground } from '@/components/onboarding/companion-background';

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
                <Link
                    href={'/account' as Route}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] hover:border-white/20 transition-all group"
                >
                    <User className="h-5 w-5 text-gray-400 group-hover:text-white transition-colors" />
                    <span className="text-sm font-medium text-gray-400 group-hover:text-white transition-colors">Account</span>
                </Link>
            </header>

            <main className="flex-1 pt-24 z-10">
                {children}
            </main>
        </div>
    );
}

import Link from 'next/link';

export function AppFooter() {
    return (
        <footer className="relative z-10 bg-transparent py-6 px-4">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/30">
                <p>&copy; 2025 Noice Pty Ltd</p>
                <nav className="flex items-center gap-4">
                    <Link
                        href="/privacy"
                        className="hover:text-white/60 transition-colors"
                    >
                        Privacy Policy
                    </Link>
                    <Link
                        href="/terms"
                        className="hover:text-white/60 transition-colors"
                    >
                        Terms of Service
                    </Link>
                    <a
                        href="mailto:support@ignite.cam"
                        className="hover:text-white/60 transition-colors"
                    >
                        Support
                    </a>
                </nav>
            </div>
        </footer>
    );
}

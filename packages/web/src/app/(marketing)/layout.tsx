'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Flame, Menu, X, Twitter, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/marketing/theme-toggle';

const navigation: Array<{ name: string; href: Route }> = [
  { name: 'Features', href: '/#features' as Route },
  { name: 'Pricing', href: '/pricing' as Route },
  { name: 'FAQ', href: '/faq' as Route },
];

function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <header className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
      isHome
        ? "bg-transparent border-none"
        : "bg-background/80 backdrop-blur-lg border-b border-border"
    )}>
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Flame className="h-8 w-8 text-primary" />
            <span className="font-display text-xl font-bold">Campfire</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-6">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex md:items-center md:gap-4">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link href="/onboard">Get Started</Link>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border py-4">
            <div className="space-y-1">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className="block px-3 py-2 text-base font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              ))}
              <div className="pt-4 space-y-2 px-3">
                <Button variant="outline" className="w-full" asChild>
                  <Link href="/login">Log in</Link>
                </Button>
                <Button className="w-full" asChild>
                  <Link href="/onboard">Get Started</Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}

function Footer() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  return (
    <footer className="border-t border-border bg-muted/50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <Flame className="h-8 w-8 text-primary" />
              <span className="font-display text-xl font-bold">Campfire</span>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground max-w-xs">
              Your voice-first AI companion. Design, talk, and build a relationship that grows with you.
            </p>
            <div className="mt-6 flex gap-4">
              <a href="https://twitter.com/campfireai" className="text-muted-foreground hover:text-foreground">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="https://github.com/campfire" className="text-muted-foreground hover:text-foreground">
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-sm font-semibold">Product</h3>
            <ul className="mt-4 space-y-3">
              <li><Link href={'/#features' as Route} className="text-sm text-muted-foreground hover:text-foreground">Features</Link></li>
              <li><Link href={'/pricing' as Route} className="text-sm text-muted-foreground hover:text-foreground">Pricing</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-sm font-semibold">Resources</h3>
            <ul className="mt-4 space-y-3">
              <li><Link href={'/faq' as Route} className="text-sm text-muted-foreground hover:text-foreground">FAQ</Link></li>
              <li><Link href={'/contact' as Route} className="text-sm text-muted-foreground hover:text-foreground">Contact</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-sm font-semibold">Legal</h3>
            <ul className="mt-4 space-y-3">
              <li><Link href={'/privacy' as Route} className="text-sm text-muted-foreground hover:text-foreground">Privacy</Link></li>
              <li><Link href={'/terms' as Route} className="text-sm text-muted-foreground hover:text-foreground">Terms</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Campfire. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={cn("flex-1", !isHome && "pt-16")}>{children}</main>
      <Footer />
    </div>
  );
}

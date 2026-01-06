import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, Store, Sparkles, ShieldCheck, Globe, BarChart3, DollarSign, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Become a Tenant',
  description: 'White-label Campfire for your audience and earn from token spend and interactions.',
};

const benefits = [
  {
    title: 'Your brand, your domain',
    description: 'Custom domain, logo, colors, and support/legals so your companion experience feels native.',
    icon: Globe,
  },
  {
    title: 'Revenue from engagement',
    description: 'Participate in revenue from token spend and paid interactions with your companion.',
    icon: DollarSign,
  },
  {
    title: 'Trust & safety controls',
    description: 'Centralized policy controls, audit trails, and operational tooling to keep experiences safe.',
    icon: ShieldCheck,
  },
  {
    title: 'Built-in growth + analytics',
    description: 'Track engagement and performance with analytics and operational dashboards.',
    icon: BarChart3,
  },
  {
    title: 'Fast launch',
    description: 'Go live quickly without building infrastructure, payments, or inference routing from scratch.',
    icon: Sparkles,
  },
  {
    title: 'Brand overrides',
    description: 'Fine-tune copy and visual identity with optional brand configuration overrides.',
    icon: Palette,
  },
];

export default function TenantsMarketingPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-10">
      <div className="flex flex-col gap-6">
        <div className="inline-flex items-center gap-2 text-campfire-500">
          <Store className="h-5 w-5" />
          <span className="text-sm font-medium">Tenants</span>
        </div>
        <div className="space-y-3">
          <h1 className="text-4xl md:text-5xl font-bold font-display text-white">
            White-label your companion experience
          </h1>
          <p className="text-gray-300 text-lg max-w-2xl">
            Launch your own branded companion on Campfire—custom domain and brand, with revenue tied to token spend and interactions.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={'/tenants/apply' as Route}>
            <Button className="bg-campfire-500 hover:bg-campfire-600">
              Apply to become a tenant
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
          <Link href={'/dashboard' as Route}>
            <Button variant="outline" className="border-white/10 hover:bg-white/10">
              See the product
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {benefits.map((b) => {
          const Icon = b.icon;
          return (
            <Card key={b.title} className="bg-white/[0.02] border-white/5">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Icon className="h-5 w-5 text-campfire-500" />
                  {b.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-gray-400 text-sm">
                {b.description}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-white">How it works</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3 text-sm text-gray-400">
          <div>
            <div className="text-white font-medium mb-1">1) Apply</div>
            Tell us about your brand and the companion you want to launch.
          </div>
          <div>
            <div className="text-white font-medium mb-1">2) Review</div>
            An admin reviews your application and configures your tenant + domain.
          </div>
          <div>
            <div className="text-white font-medium mb-1">3) Launch</div>
            Go live with your branded experience and start earning from engagement.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


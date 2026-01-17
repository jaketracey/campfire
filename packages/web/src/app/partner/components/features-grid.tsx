import {
  Globe,
  ShieldCheck,
  BarChart3,
  Palette,
  CreditCard,
  Headphones,
  Bot,
  Lock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    title: 'Custom Domain',
    description: 'Your own domain with SSL. yoursite.com, not ours.',
    icon: Globe,
  },
  {
    title: 'Full Branding',
    description: 'Logo, colors, fonts, messaging—all yours.',
    icon: Palette,
  },
  {
    title: 'Built-in Payments',
    description: 'Stripe integration handled. You just earn.',
    icon: CreditCard,
  },
  {
    title: 'AI Infrastructure',
    description: 'State-of-the-art models. No API costs for you.',
    icon: Bot,
  },
  {
    title: 'Analytics Dashboard',
    description: 'Track users, revenue, and engagement in real-time.',
    icon: BarChart3,
  },
  {
    title: 'Trust & Safety',
    description: 'Content moderation and age verification built-in.',
    icon: ShieldCheck,
  },
  {
    title: 'Priority Support',
    description: 'Dedicated partner success team to help you grow.',
    icon: Headphones,
  },
  {
    title: 'Data Privacy',
    description: 'GDPR compliant. Your users\' data stays private.',
    icon: Lock,
  },
];

export function FeaturesGrid() {
  return (
    <section className="py-16 px-4 bg-white/[0.01]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white mb-4">
            Everything You Need, Nothing You Don&apos;t
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            We handle the hard stuff so you can focus on building your audience.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="bg-white/[0.02] border-white/5">
                <CardContent className="pt-6">
                  <Icon className="h-6 w-6 text-campfire-500 mb-3" />
                  <h3 className="text-white font-medium mb-1">{feature.title}</h3>
                  <p className="text-sm text-gray-500">{feature.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

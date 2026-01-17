import { DollarSign, Zap, Palette, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const valueProps = [
  {
    title: '40-60% Revenue Share',
    description: 'Keep the majority of what your users spend. Higher tiers for top performers.',
    icon: DollarSign,
    highlight: true,
  },
  {
    title: 'Launch in 24 Hours',
    description: 'We handle infrastructure, payments, and AI. You focus on bringing users.',
    icon: Zap,
  },
  {
    title: 'Your Brand, Your Rules',
    description: 'Custom domain, logo, colors, and messaging. Your audience never sees Campfire.',
    icon: Palette,
  },
  {
    title: 'Proven Market Demand',
    description: 'AI companion market growing 35% YoY. Tap into a $4B+ opportunity.',
    icon: TrendingUp,
  },
];

export function ValueProps() {
  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white mb-4">
            Why Partners Choose Us
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Everything you need to run a profitable AI companion business without the technical headaches.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {valueProps.map((prop) => {
            const Icon = prop.icon;
            return (
              <Card
                key={prop.title}
                className={`bg-white/[0.02] border-white/5 ${
                  prop.highlight ? 'ring-1 ring-campfire-500/30' : ''
                }`}
              >
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${prop.highlight ? 'bg-campfire-500/20' : 'bg-white/5'}`}>
                      <Icon className={`h-5 w-5 ${prop.highlight ? 'text-campfire-500' : 'text-gray-400'}`} />
                    </div>
                    {prop.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-gray-400">
                  {prop.description}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

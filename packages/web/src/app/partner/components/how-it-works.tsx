import { FileText, Palette, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
  {
    number: '1',
    title: 'Apply',
    description: 'Fill out a quick application. Tell us about your brand and audience.',
    icon: FileText,
    time: '5 min',
  },
  {
    number: '2',
    title: 'Customize',
    description: 'We set up your domain, branding, and configure your platform.',
    icon: Palette,
    time: '24 hrs',
  },
  {
    number: '3',
    title: 'Launch & Earn',
    description: 'Start driving traffic and earning from day one. We handle the rest.',
    icon: Rocket,
    time: 'Ongoing',
  },
];

export function HowItWorks() {
  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white mb-4">
            How It Works
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            From application to earning in 3 simple steps.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <Card key={step.number} className="bg-white/[0.02] border-white/5 relative">
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 w-6 h-px bg-white/10" />
                )}
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-campfire-500/20 text-campfire-500 font-bold text-xl">
                      {step.number}
                    </div>
                    <div>
                      <CardTitle className="text-white">{step.title}</CardTitle>
                      <div className="text-xs text-gray-500">{step.time}</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="text-gray-400">
                  <Icon className="h-5 w-5 text-gray-500 mb-2" />
                  {step.description}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

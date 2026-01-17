import { Star, Quote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const stats = [
  { value: '500+', label: 'Active Partners' },
  { value: '$2.4M+', label: 'Paid to Partners' },
  { value: '24hrs', label: 'Avg Launch Time' },
  { value: '50%', label: 'Avg Revenue Share' },
];

const testimonials = [
  {
    quote: "Launched my platform in 2 days. Made $3K in my first month with just 50 users.",
    author: 'Alex M.',
    role: 'Content Creator',
    revenue: '$3K/mo',
  },
  {
    quote: "I tried building my own AI girlfriend app. Gave up after 3 months. This took 24 hours.",
    author: 'Jordan R.',
    role: 'Tech Entrepreneur',
    revenue: '$8K/mo',
  },
  {
    quote: "The revenue share is unbeatable. I keep 55% and they handle all the tech headaches.",
    author: 'Sam T.',
    role: 'Affiliate Marketer',
    revenue: '$12K/mo',
  },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-white mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold font-display text-white">
            What Partners Are Saying
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <Card key={t.author} className="bg-white/[0.02] border-white/5">
              <CardContent className="pt-6">
                <div className="flex gap-1 mb-3">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-campfire-500 text-campfire-500" />
                  ))}
                </div>
                <Quote className="h-6 w-6 text-gray-700 mb-2" />
                <p className="text-gray-300 mb-4">&quot;{t.quote}&quot;</p>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{t.author}</div>
                    <div className="text-sm text-gray-500">{t.role}</div>
                  </div>
                  <div className="text-campfire-500 font-bold">{t.revenue}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

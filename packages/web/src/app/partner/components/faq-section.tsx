'use client';

import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const faqs = [
  {
    question: 'How much can I realistically earn?',
    answer: 'Earnings vary based on your audience size and engagement. Partners with 100 active users typically earn $1,000-2,500/month. Top performers with 500+ users earn $10K+/month. Our revenue share ranges from 40-60% based on performance.',
  },
  {
    question: 'Do I need technical skills?',
    answer: 'None. We handle all the tech—infrastructure, AI, payments, and hosting. You focus on what you\'re good at: building and engaging your audience.',
  },
  {
    question: 'How long does it take to launch?',
    answer: 'Most partners go live within 24 hours. You apply, we review (usually same day), then we set up your domain and branding. You can start driving traffic immediately.',
  },
  {
    question: 'What\'s the catch? Why is this free?',
    answer: 'No catch. We make money when you make money. We take a percentage of revenue, so it\'s in our interest to help you succeed. No upfront costs, no monthly fees.',
  },
  {
    question: 'Can I use my own domain?',
    answer: 'Yes. You can use any custom domain you own. We provide SSL certificates and handle all the technical setup. Your users will never see the Campfire brand.',
  },
  {
    question: 'How do I get paid?',
    answer: 'We pay via PayPal or bank transfer on a monthly basis. Minimum payout threshold is $50. You can track all earnings in real-time through your partner dashboard.',
  },
  {
    question: 'What kind of support do I get?',
    answer: 'All partners get access to our partner success team via email and Slack. We provide marketing resources, optimization tips, and help troubleshoot any issues.',
  },
  {
    question: 'Is this legal?',
    answer: 'Yes. We operate legally with proper age verification, content moderation, and compliance measures. We\'re incorporated in the US and follow all applicable regulations.',
  },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full py-4 text-left"
      >
        <span className="text-white font-medium pr-4">{question}</span>
        <ChevronDown
          className={`h-5 w-5 text-gray-500 shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="pb-4 text-gray-400 text-sm">
          {answer}
        </div>
      )}
    </div>
  );
}

export function FAQSection() {
  return (
    <section className="py-16 px-4 bg-white/[0.01]">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 text-campfire-500 mb-4">
            <HelpCircle className="h-5 w-5" />
            <span className="text-sm font-medium">FAQ</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white mb-4">
            Questions? We&apos;ve Got Answers.
          </h2>
        </div>

        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="pt-6">
            {faqs.map((faq) => (
              <FAQItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

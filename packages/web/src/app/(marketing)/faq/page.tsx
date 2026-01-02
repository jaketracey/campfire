'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const faqs = [
  {
    question: 'What is Campfire?',
    answer:
      'Campfire is a platform for creating voice-first AI companions. Design a companion with the personality, voice, and appearance you want, then talk naturally and build a relationship that grows over time.',
  },
  {
    question: 'How does the billing work?',
    answer:
      'We offer a free tier for getting started and paid tiers for more features. You are billed monthly or yearly based on your selected plan. You can cancel anytime.',
  },
  {
    question: 'Can I cancel my subscription?',
    answer:
      'Yes, you can cancel your subscription at any time. Your access will continue until the end of your current billing period.',
  },
  {
    question: 'What happens to my data if I delete my account?',
    answer:
      'We take data privacy seriously. If you delete your account, all your data, including conversations and memories, will be permanently deleted from our systems.',
  },
  {
    question: 'How does voice chat work?',
    answer:
      'Voice chat uses real-time speech recognition and synthesis to let you have natural conversations with your companion. Just tap to talk and your companion will respond in their unique voice.',
  },
  {
    question: 'Can I customize my companion\'s appearance?',
    answer:
      'Yes! You can customize your companion\'s appearance, personality traits, voice, and more during the onboarding process. Plus subscribers can access additional customization options.',
  },
  {
    question: 'Is my data private?',
    answer:
      'Absolutely. Your conversations and data are encrypted and private. We never share your personal information or conversation history with third parties.',
  },
  {
    question: 'Do you offer refunds?',
    answer:
      'We offer a 7-day money-back guarantee for new subscribers. If you\'re not satisfied, contact us within 7 days of your first payment for a full refund.',
  },
];

function FAQItem({ question, answer, isOpen, onToggle }: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full py-4 flex items-center justify-between text-left"
      >
        <span className="font-medium">{question}</span>
        <ChevronDown
          className={cn(
            'h-5 w-5 text-muted-foreground transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="pb-4"
        >
          <p className="text-muted-foreground">{answer}</p>
        </motion.div>
      )}
    </div>
  );
}

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-3xl sm:text-4xl font-display font-bold">
            Frequently Asked Questions
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything you need to know about Campfire and how it works.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto"
        >
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? null : index)}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}

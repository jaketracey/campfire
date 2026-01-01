'use client';

import { motion } from 'framer-motion';
import { SectionHeader } from '@/components/layout/section-header';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const faqs = [
  {
    question: 'What is Campfire?',
    answer:
      'Campfire is a comprehensive platform for building voice-first, multimodal AI companions. It provides the infrastructure, tools, and components you need to create, deploy, and scale intelligent agents.',
  },
  {
    question: 'How does the billing work?',
    answer:
      'We offer a free tier for getting started and paid tiers for scaling up. You are billed monthly or yearly based on your selected plan. Enterprise plans offer custom billing arrangements.',
  },
  {
    question: 'Can I cancel my subscription?',
    answer:
      'Yes, you can cancel your subscription at any time. Your access will continue until the end of your current billing period.',
  },
  {
    question: 'What happens to my data if I delete my account?',
    answer:
      'We take data privacy seriously. If you delete your account, all your data, including memories, knowledge graphs, and vault notes, will be permanently deleted from our systems in accordance with our data retention policy.',
  },
  {
    question: 'Do you offer technical support?',
    answer:
      'Yes! All plans include access to our documentation and community forums. Pro and Enterprise plans include priority support with faster response times.',
  },
  {
    question: 'Can I self-host Campfire?',
    answer:
      'Currently, Campfire is available as a managed service. However, we are exploring self-hosted options for Enterprise customers. Please contact sales for more information.',
  },
];

export default function FAQPage() {
  return (
    <div className="container mx-auto py-24 md:py-32">
      <SectionHeader
        title="Frequently Asked Questions"
        description="Everything you need to know about Campfire and how it works."
        className="mb-16"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="max-w-3xl mx-auto"
      >
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="text-left">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </motion.div>
    </div>
  );
}

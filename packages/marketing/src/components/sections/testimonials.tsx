'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Quote } from 'lucide-react';
import { testimonials } from '@/lib/constants';
import { trackEvent } from '@/lib/analytics';

export function Testimonials() {
  return (
    <section className="section-padding bg-surface">
      <div className="container-marketing">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto"
        >
          <h2 className="text-display-sm sm:text-display-md font-display text-text-primary">
            Real connections, real people
          </h2>
          <p className="mt-4 text-lg text-text-secondary">
            Hear from people who have found something special with their companions.
          </p>
        </motion.div>

        {/* Testimonials grid */}
        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.author}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              onViewportEnter={() => trackEvent.testimonialView(testimonial.author)}
              className="relative rounded-2xl border border-border bg-surface-secondary p-6"
            >
              {/* Quote icon */}
              <Quote className="h-8 w-8 text-brand-500/20" />

              {/* Quote text */}
              <blockquote className="mt-4 text-text-primary text-lg">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>

              {/* Author */}
              <div className="mt-6 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-surface-tertiary" />
                <div>
                  <div className="font-medium text-text-primary">
                    {testimonial.author}
                  </div>
                  <div className="text-sm text-text-secondary">
                    {testimonial.role}, {testimonial.company}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Stats section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-20"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '50K+', label: 'Companions Created' },
              { value: '2M+', label: 'Conversations' },
              { value: '4.9', label: 'App Store Rating' },
              { value: '24/7', label: 'Always Available' },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl font-display font-bold text-text-primary">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-text-tertiary">{stat.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

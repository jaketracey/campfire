import posthog from 'posthog-js';

// Marketing event tracking with mkt.* prefix
export const trackEvent = {
  // Page interactions
  pageView: (page: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.page_view', { page, ...properties });
  },

  // CTA interactions
  ctaClick: (cta: string, location: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.cta_click', { cta, location, ...properties });
  },

  // Pricing interactions
  pricingView: (properties?: Record<string, unknown>) => {
    posthog.capture('mkt.pricing_view', properties);
  },

  pricingPlanSelect: (plan: string, billingCycle: 'monthly' | 'yearly', properties?: Record<string, unknown>) => {
    posthog.capture('mkt.pricing_plan_select', { plan, billingCycle, ...properties });
  },

  // Checkout flow
  checkoutStart: (plan: string, price: number, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.checkout_start', { plan, price, ...properties });
  },

  checkoutComplete: (plan: string, price: number, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.checkout_complete', { plan, price, ...properties });
  },

  checkoutError: (error: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.checkout_error', { error, ...properties });
  },

  // Form interactions
  formStart: (formName: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.form_start', { formName, ...properties });
  },

  formSubmit: (formName: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.form_submit', { formName, ...properties });
  },

  formError: (formName: string, error: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.form_error', { formName, error, ...properties });
  },

  // Newsletter
  newsletterSubscribe: (location: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.newsletter_subscribe', { location, ...properties });
  },

  // Demo interactions
  demoInteraction: (action: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.demo_interaction', { action, ...properties });
  },

  // FAQ interactions
  faqExpand: (question: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.faq_expand', { question, ...properties });
  },

  faqSearch: (query: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.faq_search', { query, ...properties });
  },

  // Social links
  socialClick: (platform: string, location: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.social_click', { platform, location, ...properties });
  },

  // Feature interest
  featureClick: (feature: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.feature_click', { feature, ...properties });
  },

  // Testimonials
  testimonialView: (author: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.testimonial_view', { author, ...properties });
  },

  // Changelog
  changelogView: (version: string, properties?: Record<string, unknown>) => {
    posthog.capture('mkt.changelog_view', { version, ...properties });
  },

  // General custom event
  custom: (event: string, properties?: Record<string, unknown>) => {
    posthog.capture(`mkt.${event}`, properties);
  },
};

// Identify user
export const identifyUser = (userId: string, properties?: Record<string, unknown>) => {
  posthog.identify(userId, properties);
};

// Reset user
export const resetUser = () => {
  posthog.reset();
};

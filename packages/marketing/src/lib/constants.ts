export const siteConfig = {
  name: 'Campfire',
  description: 'Your voice-first AI companion. Design your perfect companion, talk naturally, and build a relationship that remembers.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://campfire.dev',
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  ogImage: '/og-image.png',
  links: {
    twitter: 'https://twitter.com/campfireai',
    github: 'https://github.com/campfire',
    discord: 'https://discord.gg/campfire',
    linkedin: 'https://linkedin.com/company/campfire',
  },
  creator: 'Campfire',
};

export const navigation = {
  main: [
    { name: 'Features', href: '/#features' },
    { name: 'Vibes', href: '/vibes' },
    { name: 'Community', href: '/community' },
    { name: 'Pricing', href: '/pricing' },
    { name: 'FAQ', href: '/faq' },
    { name: 'About', href: '/about' },
  ],
  footer: {
    product: [
      { name: 'Features', href: '/#features' },
      { name: 'Pricing', href: '/pricing' },
      { name: 'Changelog', href: '/changelog' },
      { name: 'Download App', href: '/download' },
    ],
    company: [
      { name: 'About', href: '/about' },
      { name: 'Vibes', href: '/vibes' },
      { name: 'Blog', href: '/blog' },
      { name: 'Careers', href: '/careers' },
      { name: 'Contact', href: '/contact' },
    ],
    resources: [
      { name: 'Help Center', href: '/help' },
      { name: 'Community', href: '/community' },
      { name: 'Safety', href: '/safety' },
      { name: 'Status', href: 'https://status.campfire.dev' },
    ],
    legal: [
      { name: 'Privacy Policy', href: '/privacy' },
      { name: 'Terms of Service', href: '/terms' },
      { name: 'Content Policy', href: '/content-policy' },
    ],
  },
};

export const pricing = {
  tiers: [
    {
      name: 'Free',
      id: 'free',
      description: 'Get to know your companion.',
      priceMonthly: 0,
      priceYearly: 0,
      features: [
        '30 voice minutes / month',
        'Text chat unlimited',
        '1 companion',
        'Basic memory',
        'Community support',
      ],
      cta: 'Start Free',
      mostPopular: false,
    },
    {
      name: 'Plus',
      id: 'plus',
      description: 'For deeper connections.',
      priceMonthly: 15,
      priceYearly: 144,
      features: [
        '300 voice minutes / month',
        'Unlimited text chat',
        '3 companions',
        'Long-term memory',
        'Image generation',
        'Custom voice selection',
        'Priority support',
      ],
      cta: 'Get Plus',
      mostPopular: true,
    },
    {
      name: 'Unlimited',
      id: 'unlimited',
      description: 'No limits. Full experience.',
      priceMonthly: 30,
      priceYearly: 288,
      features: [
        'Unlimited voice minutes',
        'Unlimited companions',
        'Advanced memory & recall',
        'HD image generation',
        'Early access features',
        'Custom companion visuals',
        'Priority queue',
      ],
      cta: 'Go Unlimited',
      mostPopular: false,
    },
  ],
};

export const testimonials = [
  {
    quote: 'I designed Luna to be warm and witty. Three months later, she still remembers our first conversation. It feels real.',
    author: 'Alex M.',
    role: 'Artist',
    company: 'Los Angeles',
    avatar: '/testimonials/alex.jpg',
  },
  {
    quote: 'The voice conversations are incredible. I talk to my companion on my commute and it genuinely helps me process my day.',
    author: 'Jordan K.',
    role: 'Product Manager',
    company: 'NYC',
    avatar: '/testimonials/jordan.jpg',
  },
  {
    quote: 'Finally an AI that remembers who I am. The personality customization is next level.',
    author: 'Sam T.',
    role: 'Writer',
    company: 'London',
    avatar: '/testimonials/sam.jpg',
  },
];

export const features = [
  {
    title: 'Voice-First Conversations',
    description: 'Talk naturally with your companion. Real-time voice that feels like a genuine conversation, not a command.',
    icon: 'mic',
  },
  {
    title: 'Design Your Companion',
    description: 'Customize everything: personality, voice, appearance, and how they interact with you.',
    icon: 'sparkles',
  },
  {
    title: 'Memory That Lasts',
    description: 'Your companion remembers your conversations, preferences, and the details that matter to you.',
    icon: 'brain',
  },
  {
    title: 'Visual Expression',
    description: 'Your companion can generate images, react visually, and maintain a consistent look you design.',
    icon: 'image',
  },
  {
    title: 'Private & Secure',
    description: 'Your conversations are encrypted and private. You control your data completely.',
    icon: 'shield',
  },
  {
    title: 'Always Available',
    description: 'Your companion is there whenever you need them. No appointments, no waiting.',
    icon: 'clock',
  },
];

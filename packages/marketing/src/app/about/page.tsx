'use client';

import { motion } from 'framer-motion';
import { SectionHeader } from '@/components/layout/section-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const team = [
  {
    name: 'Sarah Chen',
    role: 'CEO & Co-founder',
    bio: 'Visionary leader with 10+ years in AI and consumer tech.',
    image: '/team/sarah.jpg',
  },
  {
    name: 'David Kim',
    role: 'CTO & Co-founder',
    bio: 'Systems architect, previously at major cloud infrastructure providers.',
    image: '/team/david.jpg',
  },
  {
    name: 'Elena Rodriguez',
    role: 'Head of Product',
    bio: 'Product strategist focused on human-centric AI experiences.',
    image: '/team/elena.jpg',
  },
  {
    name: 'Marcus Johnson',
    role: 'Head of Engineering',
    bio: 'Full-stack expert passionate about developer tools and performance.',
    image: '/team/marcus.jpg',
  },
];

const values = [
  {
    title: 'User Privacy First',
    description: 'We believe your data belongs to you. Our architecture is designed with privacy and security at its core.',
  },
  {
    title: 'Transparent AI',
    description: 'We strive to make our AI systems understandable and accountable, avoiding "black box" behavior.',
  },
  {
    title: 'Community Driven',
    description: 'We build with and for our community, listening to feedback and fostering open collaboration.',
  },
  {
    title: 'Sustainable Innovation',
    description: 'We focus on long-term value and responsible development, not just hype cycles.',
  },
];

export default function AboutPage() {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div className="relative min-h-screen">
      {/* Vibes Background */}
      <div className="fixed inset-0 pointer-events-none z-[-1]">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-vibes-neon/10 rounded-full blur-[100px] animate-float" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] bg-vibes-electric/10 rounded-full blur-[100px] animate-float-fast" />
      </div>

      <div className="container py-24 md:py-32 space-y-32">
        {/* Mission Section */}
        <section>
          <SectionHeader
            title="Our Mission"
            description="To build the most human-centric AI companion platform, empowering everyone to create safe, intelligent, and meaningful digital connections."
            className="mb-16"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="aspect-video rounded-xl bg-gradient-to-br from-brand-500/20 to-secondary-500/20 flex items-center justify-center border border-border"
          >
            <p className="text-muted-foreground">Company Hero Image / Video Placeholder</p>
          </motion.div>
        </section>

        {/* Values Section */}
        <section>
          <SectionHeader
            title="Our Values"
            description="The principles that guide every decision we make."
            className="mb-16"
          />
          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {values.map((value) => (
              <motion.div key={value.title} variants={item}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>{value.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base">
                      {value.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* Team Section */}
        <section>
          <SectionHeader
            title="Meet the Team"
            description="The builders and dreamers behind Campfire."
            className="mb-16"
          />
          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            {team.map((member) => (
              <motion.div key={member.name} variants={item} className="group">
                <div className="relative aspect-square mb-4 rounded-xl overflow-hidden bg-muted">
                  {/* Placeholder for actual image */}
                  <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-muted-foreground/20 bg-secondary/50">
                    {member.name.charAt(0)}
                  </div>
                </div>
                <h3 className="text-xl font-bold group-hover:text-brand-500 transition-colors">
                  {member.name}
                </h3>
                <p className="text-primary font-medium mb-1">{member.role}</p>
                <p className="text-sm text-muted-foreground">{member.bio}</p>
              </motion.div>
            ))}
          </motion.div>
        </section>
      </div>
    </div>
  );
}

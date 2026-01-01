import { SectionHeader } from '@/components/layout/section-header';

export default function PrivacyPage() {
  return (
    <div className="container py-24 md:py-32 max-w-4xl mx-auto">
      <SectionHeader
        title="Privacy Policy"
        description="Last updated: January 1, 2026"
        className="mb-12"
        align="left"
      />
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p>
          At Campfire, we take your privacy seriously. This Privacy Policy describes how we collect, use, and share your personal information.
        </p>

        <h3>1. Information We Collect</h3>
        <p>
          We collect information you provide directly to us, such as when you create an account, design a companion, or communicate with us. This may include your name, email address, payment information, and the content of your interactions with your AI companions.
        </p>

        <h3>2. How We Use Your Information</h3>
        <p>
          We use your information to provide, maintain, and improve our services. Specifically, we use your interactions to personalize your companion's responses and memory. We do not sell your personal data to third parties.
        </p>

        <h3>3. Data Retention and Deletion</h3>
        <p>
          We retain your data for as long as your account is active. You can request deletion of your account and all associated data at any time through your account settings.
        </p>

        <h3>4. Contact Us</h3>
        <p>
          If you have any questions about this Privacy Policy, please contact us at privacy@campfire.dev.
        </p>
      </div>
    </div>
  );
}

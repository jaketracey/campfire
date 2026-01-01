import { SectionHeader } from '@/components/layout/section-header';

export default function TermsPage() {
  return (
    <div className="container py-24 md:py-32 max-w-4xl mx-auto">
      <SectionHeader
        title="Terms of Service"
        description="Last updated: January 1, 2026"
        className="mb-12"
        align="left"
      />
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p>
          Please read these Terms of Service carefully before using Campfire.
        </p>

        <h3>1. Acceptance of Terms</h3>
        <p>
          By accessing or using our services, you agree to be bound by these Terms. If you do not agree to these Terms, you may not use our services.
        </p>

        <h3>2. User Accounts</h3>
        <p>
          You are responsible for safeguarding the password that you use to access the service and for any activities or actions under your password.
        </p>

        <h3>3. Acceptable Use</h3>
        <p>
          You agree not to misuse our services. You must comply with our Acceptable Use Policy, which prohibits illegal, harmful, or abusive behavior.
        </p>

        <h3>4. Termination</h3>
        <p>
          We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.
        </p>

        <h3>5. Limitation of Liability</h3>
        <p>
          In no event shall Campfire, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages.
        </p>
      </div>
    </div>
  );
}

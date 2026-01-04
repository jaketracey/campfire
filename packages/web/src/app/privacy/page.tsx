import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy - Ignite',
  description: 'Privacy Policy for Ignite AI Companion',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Back to Ignite
        </Link>

        <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Effective Date: January 4, 2025</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground">
              Noice Pty Ltd (ABN to be registered) (&quot;Noice,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates
              Ignite (accessible at ignite.cam), an AI companion service. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your personal information
              in accordance with the Australian Privacy Act 1988 (Cth) and the Australian
              Privacy Principles (APPs).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
            <p className="text-muted-foreground mb-3">We collect the following categories of personal information:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li><strong>Account Information:</strong> Email address, name, and authentication credentials</li>
              <li><strong>Conversation Data:</strong> Messages exchanged with your AI companion, stored to provide continuity and personalization</li>
              <li><strong>Usage Data:</strong> Device information, IP addresses, browser type, and interaction patterns</li>
              <li><strong>Payment Information:</strong> Processed securely by third-party payment processors (we do not store full payment details)</li>
              <li><strong>Generated Content:</strong> AI-generated images and other media created through the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
            <p className="text-muted-foreground mb-3">We use your personal information to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide, maintain, and personalize our AI companion service</li>
              <li>Process transactions and manage your subscription</li>
              <li>Improve our service, develop new features, and train AI models</li>
              <li>Communicate with you about your account, updates, and promotional offers (with consent)</li>
              <li>Ensure security, prevent fraud, and enforce our terms</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">4. Data Storage, Security, and Retention</h2>
            <p className="text-muted-foreground mb-3">
              Your data is encrypted in transit (TLS 1.3) and at rest (AES-256). We implement
              industry-standard security measures including:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Secure cloud infrastructure with access controls</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Employee access restrictions and training</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              We retain your data for as long as your account is active or as needed to provide
              services. Upon account deletion, we will delete or anonymize your personal information
              within 30 days, except where retention is required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">5. Disclosure of Information</h2>
            <p className="text-muted-foreground mb-3">We may share your information with:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li><strong>Service Providers:</strong> Third parties who assist in operating our service (cloud hosting, payment processing, analytics), bound by confidentiality obligations</li>
              <li><strong>AI Model Providers:</strong> Conversation data may be processed by AI service providers to generate responses</li>
              <li><strong>Legal Requirements:</strong> When required by law, court order, or to protect our rights</li>
              <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              <strong>We do not sell your personal information to third parties.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">6. International Data Transfers</h2>
            <p className="text-muted-foreground">
              Your data may be transferred to and processed in countries outside Australia,
              including the United States, where our service providers operate. We ensure
              appropriate safeguards are in place to protect your information in accordance
              with this Privacy Policy and applicable laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">7. Your Rights</h2>
            <p className="text-muted-foreground mb-3">Under Australian privacy law, you have the right to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li><strong>Access:</strong> Request access to your personal information</li>
              <li><strong>Correction:</strong> Request correction of inaccurate information</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data</li>
              <li><strong>Data Portability:</strong> Export your conversation history</li>
              <li><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
              <li><strong>Complaint:</strong> Lodge a complaint with the Office of the Australian Information Commissioner (OAIC)</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              To exercise these rights, contact us at{' '}
              <a href="mailto:privacy@ignite.cam" className="text-primary hover:underline">privacy@ignite.cam</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">8. Cookies and Tracking</h2>
            <p className="text-muted-foreground">
              We use essential cookies to maintain your session and preferences. We may use
              analytics cookies (with consent where required) to understand service usage.
              You can manage cookie preferences through your browser settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">9. Age Restrictions</h2>
            <p className="text-muted-foreground">
              Ignite is intended for users 18 years of age or older. We do not knowingly
              collect personal information from individuals under 18. If we become aware
              that we have collected data from someone under 18, we will delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">10. Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. Material changes will be
              notified via email or prominent notice on our website. Continued use of the
              Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">11. Contact Us</h2>
            <p className="text-muted-foreground">
              For privacy inquiries or to exercise your rights, contact our Privacy Officer:
            </p>
            <div className="text-muted-foreground mt-3">
              <p>Noice Pty Ltd</p>
              <p>Email: <a href="mailto:privacy@ignite.cam" className="text-primary hover:underline">privacy@ignite.cam</a></p>
            </div>
            <p className="text-muted-foreground mt-3">
              If you are not satisfied with our response, you may lodge a complaint with the
              Office of the Australian Information Commissioner (OAIC) at{' '}
              <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.oaic.gov.au</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

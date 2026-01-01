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
          At Campfire (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), we take your privacy seriously. This Privacy Policy describes how we collect, use, disclose, and protect your personal information when you use our AI companion service (&quot;Service&quot;).
        </p>

        <h2>1. Information We Collect</h2>

        <h3>1.1 Information You Provide</h3>
        <p>We collect information you provide directly to us, including:</p>
        <ul>
          <li><strong>Account Information:</strong> Email address, password, and display name when you create an account</li>
          <li><strong>Payment Information:</strong> Billing address and payment details processed through our payment providers (we do not store full credit card numbers)</li>
          <li><strong>Companion Configuration:</strong> Preferences, personality settings, and customizations you create for your AI companions</li>
          <li><strong>Conversation Content:</strong> Messages, voice recordings, and other content from your interactions with AI companions</li>
          <li><strong>Support Communications:</strong> Information you provide when contacting customer support</li>
        </ul>

        <h3>1.2 Information Collected Automatically</h3>
        <p>When you use our Service, we automatically collect:</p>
        <ul>
          <li><strong>Device Information:</strong> Device type, operating system, browser type, and unique device identifiers</li>
          <li><strong>Usage Data:</strong> Features used, session duration, interaction patterns, and performance metrics</li>
          <li><strong>Log Data:</strong> IP address, access times, pages viewed, and referring URLs</li>
          <li><strong>Cookies and Similar Technologies:</strong> We use cookies, local storage, and similar technologies to operate and improve the Service</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service</li>
          <li>Personalize your AI companion&apos;s responses and memory</li>
          <li>Process payments and manage your subscription</li>
          <li>Send transactional emails (account verification, password resets, billing)</li>
          <li>Respond to your requests and provide customer support</li>
          <li>Detect, prevent, and address fraud, abuse, and security issues</li>
          <li>Comply with legal obligations</li>
          <li>Improve our AI models and develop new features (using anonymized and aggregated data)</li>
        </ul>

        <h2>3. AI Training and Model Improvement</h2>
        <p>
          <strong>We may use anonymized and aggregated conversation data to improve our AI models.</strong> This data is stripped of personally identifiable information before use. You may opt out of having your data used for model improvement in your account settings.
        </p>
        <p>
          We do not use your personal conversations to train models in a way that would expose your private information to other users.
        </p>

        <h2>4. Information Sharing and Disclosure</h2>
        <p>We do not sell your personal information. We may share your information in the following circumstances:</p>
        <ul>
          <li><strong>Service Providers:</strong> With third-party vendors who assist us in operating the Service (hosting, payment processing, analytics, customer support)</li>
          <li><strong>Legal Requirements:</strong> When required by law, subpoena, or legal process</li>
          <li><strong>Safety and Security:</strong> To protect the rights, property, or safety of Campfire, our users, or the public</li>
          <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
          <li><strong>With Your Consent:</strong> When you explicitly authorize us to share information</li>
        </ul>

        <h2>5. Data Retention</h2>
        <p>
          We retain your personal information for as long as your account is active or as needed to provide the Service. Conversation data is retained to maintain your companion&apos;s memory and personalization. We may retain certain information as required by law or for legitimate business purposes.
        </p>
        <p>
          Upon account deletion, we will delete or anonymize your personal information within 30 days, except where retention is required by law.
        </p>

        <h2>6. Data Security</h2>
        <p>
          We implement industry-standard security measures to protect your information, including encryption in transit and at rest, access controls, and regular security audits. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
        </p>

        <h2>7. Your Rights and Choices</h2>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of your personal information</li>
          <li><strong>Correction:</strong> Request correction of inaccurate information</li>
          <li><strong>Deletion:</strong> Request deletion of your personal information</li>
          <li><strong>Portability:</strong> Request a portable copy of your data</li>
          <li><strong>Opt-Out:</strong> Opt out of certain data uses (marketing emails, AI training)</li>
          <li><strong>Restriction:</strong> Request restriction of processing in certain circumstances</li>
        </ul>
        <p>
          To exercise these rights, please contact us at privacy@campfire.dev or use the controls in your account settings.
        </p>

        <h2>8. Children&apos;s Privacy</h2>
        <p>
          <strong>The Service is not intended for users under 18 years of age.</strong> We do not knowingly collect personal information from children. If we learn that we have collected information from a child under 18, we will delete that information promptly.
        </p>

        <h2>9. International Data Transfers</h2>
        <p>
          Your information may be transferred to and processed in countries other than your country of residence. These countries may have data protection laws that differ from your jurisdiction. By using the Service, you consent to the transfer of your information to the United States and other countries where we operate.
        </p>

        <h2>10. Third-Party Services</h2>
        <p>
          The Service may contain links to third-party websites or integrate with third-party services. We are not responsible for the privacy practices of these third parties. We encourage you to review their privacy policies.
        </p>

        <h2>11. California Privacy Rights (CCPA)</h2>
        <p>
          California residents have additional rights under the California Consumer Privacy Act (CCPA), including the right to know what personal information we collect, the right to delete personal information, and the right to opt out of the sale of personal information. We do not sell personal information as defined by the CCPA.
        </p>

        <h2>12. European Privacy Rights (GDPR)</h2>
        <p>
          If you are located in the European Economic Area (EEA), you have additional rights under the General Data Protection Regulation (GDPR). Our legal basis for processing your information includes consent, contract performance, and legitimate interests. You may contact our Data Protection Officer at dpo@campfire.dev.
        </p>

        <h2>13. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the &quot;Last updated&quot; date. Your continued use of the Service after changes constitutes acceptance of the updated policy.
        </p>

        <h2>14. Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy or our privacy practices, please contact us at:
        </p>
        <ul>
          <li>Email: privacy@campfire.dev</li>
          <li>Data Protection Officer: dpo@campfire.dev</li>
        </ul>
      </div>
    </div>
  );
}

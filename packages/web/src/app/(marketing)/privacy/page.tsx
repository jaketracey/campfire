export const metadata = {
  title: 'Privacy Policy | Campfire',
  description: 'Learn how Campfire collects, uses, and protects your personal information.',
};

export default function PrivacyPage() {
  return (
    <div className="py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto prose prose-neutral dark:prose-invert prose-headings:scroll-mt-24">
          <h1>Privacy Policy</h1>
          <p className="lead text-gray-400">Last updated: January 2, 2026</p>
          <p className="lead text-gray-400">Effective date: January 2, 2026</p>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 my-6">
            <p className="text-amber-400 text-sm m-0">
              <strong>Important:</strong> Campfire uses AI technology to provide companion experiences.
              Your conversations may be processed by third-party AI providers. Please read this policy
              carefully to understand how your data is handled.
            </p>
          </div>

          <h2 id="introduction">1. Introduction</h2>
          <p>
            Campfire (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy.
            This Privacy Policy explains how we collect, use, disclose, and safeguard your information
            when you use our AI companion platform and related services (the &quot;Service&quot;).
          </p>
          <p>
            By using Campfire, you consent to the data practices described in this policy. If you do not
            agree with our policies, please do not use our Service.
          </p>

          <h2 id="information-collected">2. Information We Collect</h2>

          <h3>2.1 Information You Provide</h3>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Category</th>
                <th>Data Types</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Account Information</strong></td>
                <td>Email address, display name, profile picture</td>
                <td>Account creation and identification</td>
              </tr>
              <tr>
                <td><strong>Authentication</strong></td>
                <td>Password (hashed), MFA settings, OAuth connections</td>
                <td>Secure access to your account</td>
              </tr>
              <tr>
                <td><strong>Profile Data</strong></td>
                <td>Bio, timezone, locale, preferences</td>
                <td>Personalization</td>
              </tr>
              <tr>
                <td><strong>Companion Settings</strong></td>
                <td>Companion configurations, personality settings, appearance choices</td>
                <td>Customizing your AI companion</td>
              </tr>
              <tr>
                <td><strong>Conversation Content</strong></td>
                <td>Text messages, voice transcriptions, uploaded images</td>
                <td>Providing the companion experience</td>
              </tr>
              <tr>
                <td><strong>Payment Information</strong></td>
                <td>Billing details (processed by Stripe)</td>
                <td>Subscription management</td>
              </tr>
            </tbody>
          </table>

          <h3>2.2 Information Collected Automatically</h3>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Category</th>
                <th>Data Types</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Device Information</strong></td>
                <td>IP address, browser type, operating system, device identifiers</td>
                <td>Security, fraud prevention, service optimization</td>
              </tr>
              <tr>
                <td><strong>Usage Data</strong></td>
                <td>Session duration, feature usage, interaction patterns</td>
                <td>Service improvement and analytics</td>
              </tr>
              <tr>
                <td><strong>Log Data</strong></td>
                <td>Access times, pages viewed, errors encountered</td>
                <td>Troubleshooting and security monitoring</td>
              </tr>
            </tbody>
          </table>

          <h3>2.3 Sensitive Information</h3>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 my-4">
            <p className="text-red-400 text-sm m-0">
              <strong>Voice Data:</strong> If you use voice chat, your voice is recorded and processed
              for speech-to-text conversion. Voice recordings are stored temporarily and may be used to
              improve our services.
            </p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 my-4">
            <p className="text-red-400 text-sm m-0">
              <strong>Memories &amp; Personal Information:</strong> Our AI companions may extract and store
              personal facts, preferences, and emotional context from your conversations to provide a
              personalized experience. You can control this in your privacy settings.
            </p>
          </div>

          <h2 id="how-we-use">3. How We Use Your Information</h2>
          <p>We use your information for the following purposes:</p>
          <ul>
            <li><strong>Service Delivery:</strong> To provide, maintain, and improve our AI companion platform</li>
            <li><strong>Personalization:</strong> To customize your companion experience and remember context</li>
            <li><strong>Communication:</strong> To send service updates, security alerts, and support messages</li>
            <li><strong>Safety:</strong> To detect and prevent fraud, abuse, and security threats</li>
            <li><strong>Analytics:</strong> To understand usage patterns and improve our services</li>
            <li><strong>Legal Compliance:</strong> To comply with applicable laws and regulations</li>
          </ul>

          <h3>3.1 Legal Basis for Processing (GDPR)</h3>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Processing Activity</th>
                <th>Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account management</td>
                <td>Contract performance</td>
              </tr>
              <tr>
                <td>AI conversation processing</td>
                <td>Contract performance + Consent</td>
              </tr>
              <tr>
                <td>Memory extraction</td>
                <td>Consent (can be withdrawn)</td>
              </tr>
              <tr>
                <td>Analytics and improvement</td>
                <td>Legitimate interest</td>
              </tr>
              <tr>
                <td>Marketing communications</td>
                <td>Consent</td>
              </tr>
              <tr>
                <td>Security monitoring</td>
                <td>Legitimate interest</td>
              </tr>
            </tbody>
          </table>

          <h2 id="data-sharing">4. How We Share Your Information</h2>

          <h3>4.1 Third-Party Service Providers</h3>
          <p>
            We share your information with third-party providers who assist in delivering our services:
          </p>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Provider Category</th>
                <th>Purpose</th>
                <th>Data Shared</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>AI Model Providers</strong><br/>(Anthropic, OpenAI, AWS Bedrock)</td>
                <td>Processing AI conversations</td>
                <td>Conversation content, system prompts</td>
              </tr>
              <tr>
                <td><strong>Speech Services</strong><br/>(Deepgram, ElevenLabs)</td>
                <td>Voice-to-text and text-to-voice</td>
                <td>Voice audio, text content</td>
              </tr>
              <tr>
                <td><strong>Image Generation</strong><br/>(FAL AI, Replicate)</td>
                <td>Creating companion images</td>
                <td>Text prompts, image parameters</td>
              </tr>
              <tr>
                <td><strong>Payment Processing</strong><br/>(Stripe)</td>
                <td>Subscription billing</td>
                <td>Payment details (PCI compliant)</td>
              </tr>
              <tr>
                <td><strong>Cloud Infrastructure</strong><br/>(AWS)</td>
                <td>Hosting and storage</td>
                <td>All service data</td>
              </tr>
              <tr>
                <td><strong>Email Services</strong><br/>(AWS SES)</td>
                <td>Transactional emails</td>
                <td>Email address, email content</td>
              </tr>
            </tbody>
          </table>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 my-4">
            <p className="text-blue-400 text-sm m-0">
              <strong>AI Training Disclosure:</strong> Your conversations may be used by our AI providers
              to improve their models unless you opt out. We recommend reviewing the privacy policies of
              our AI providers (Anthropic, OpenAI) for details on their data practices.
            </p>
          </div>

          <h3>4.2 Other Disclosures</h3>
          <p>We may also disclose your information:</p>
          <ul>
            <li><strong>Legal Requirements:</strong> When required by law, court order, or government request</li>
            <li><strong>Safety:</strong> To protect the safety, rights, or property of Campfire, our users, or others</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
            <li><strong>With Your Consent:</strong> For any other purpose with your explicit consent</li>
          </ul>

          <h3>4.3 We Do Not Sell Your Personal Information</h3>
          <p>
            Campfire does not sell your personal information to third parties for monetary consideration.
            California residents have the right to opt out of the &quot;sale&quot; of personal information
            as defined under CCPA. To exercise this right, please contact us at privacy@campfire.dev.
          </p>

          <h2 id="data-retention">5. Data Retention</h2>
          <p>We retain your information for the following periods:</p>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Data Type</th>
                <th>Retention Period</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account information</td>
                <td>Until account deletion + 30 days</td>
              </tr>
              <tr>
                <td>Conversation history</td>
                <td>Configurable (session to indefinite)</td>
              </tr>
              <tr>
                <td>Long-term memories</td>
                <td>Based on your memory consent settings (default: 90 days)</td>
              </tr>
              <tr>
                <td>Voice recordings</td>
                <td>Session duration only (not permanently stored)</td>
              </tr>
              <tr>
                <td>Payment records</td>
                <td>7 years (legal requirement)</td>
              </tr>
              <tr>
                <td>Security logs</td>
                <td>90 days</td>
              </tr>
            </tbody>
          </table>

          <h2 id="data-security">6. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your personal
            information, including:
          </p>
          <ul>
            <li><strong>Encryption in Transit:</strong> All data transmitted using TLS/HTTPS</li>
            <li><strong>Encryption at Rest:</strong> Database encryption using AES-256</li>
            <li><strong>Password Security:</strong> Passwords hashed using bcrypt</li>
            <li><strong>Access Controls:</strong> Role-based access with audit logging</li>
            <li><strong>Infrastructure Security:</strong> AWS security best practices, firewalls, monitoring</li>
          </ul>
          <p>
            While we strive to protect your information, no method of transmission over the Internet
            or electronic storage is 100% secure. We cannot guarantee absolute security.
          </p>

          <h2 id="your-rights">7. Your Privacy Rights</h2>

          <h3>7.1 Rights for All Users</h3>
          <ul>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Correction:</strong> Update or correct inaccurate information</li>
            <li><strong>Deletion:</strong> Request deletion of your personal data</li>
            <li><strong>Export:</strong> Download your data in a portable format</li>
            <li><strong>Withdraw Consent:</strong> Opt out of optional data processing</li>
          </ul>

          <h3>7.2 Additional Rights for EEA/UK Residents (GDPR)</h3>
          <ul>
            <li><strong>Object:</strong> Object to processing based on legitimate interest</li>
            <li><strong>Restriction:</strong> Request restriction of processing</li>
            <li><strong>Automated Decisions:</strong> Rights regarding automated decision-making</li>
            <li><strong>Lodge Complaint:</strong> File a complaint with your supervisory authority</li>
          </ul>

          <h3>7.3 Additional Rights for California Residents (CCPA)</h3>
          <ul>
            <li><strong>Know:</strong> Request disclosure of data collected and shared</li>
            <li><strong>Delete:</strong> Request deletion of personal information</li>
            <li><strong>Opt-Out:</strong> Opt out of sale of personal information</li>
            <li><strong>Non-Discrimination:</strong> Equal service regardless of privacy choices</li>
          </ul>

          <h3>7.4 How to Exercise Your Rights</h3>
          <p>To exercise any of these rights:</p>
          <ul>
            <li><strong>Account Settings:</strong> Many options available in your account settings</li>
            <li><strong>Email:</strong> Contact privacy@campfire.dev</li>
            <li><strong>Response Time:</strong> We respond to requests within 30 days (45 for CCPA)</li>
          </ul>

          <h2 id="memory-controls">8. AI Memory and Personalization</h2>
          <p>
            Campfire&apos;s AI companions can remember information from your conversations to provide
            a more personalized experience. You have control over this feature:
          </p>
          <ul>
            <li><strong>Memory Toggle:</strong> Enable or disable long-term memory storage</li>
            <li><strong>Memory Types:</strong> Choose which types of information can be remembered
              (facts, preferences, emotional context, relationships)</li>
            <li><strong>Retention Period:</strong> Set how long memories are kept (session only,
              7 days, 30 days, 90 days, 1 year, or indefinite)</li>
            <li><strong>Knowledge Graph:</strong> Control relationship mapping between entities</li>
            <li><strong>Memory Notifications:</strong> Optionally receive alerts when memories are stored</li>
          </ul>
          <p>
            Access these controls in <strong>Account Settings &gt; Privacy</strong>.
          </p>

          <h2 id="cookies">9. Cookies and Tracking</h2>
          <p>We use the following types of cookies:</p>
          <table className="text-sm">
            <thead>
              <tr>
                <th>Type</th>
                <th>Purpose</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Essential</strong></td>
                <td>Authentication, security, basic functionality</td>
                <td>Session / 30 days</td>
              </tr>
              <tr>
                <td><strong>Functional</strong></td>
                <td>Preferences, settings</td>
                <td>1 year</td>
              </tr>
              <tr>
                <td><strong>Analytics</strong></td>
                <td>Usage statistics, performance</td>
                <td>90 days</td>
              </tr>
              <tr>
                <td><strong>Affiliate</strong></td>
                <td>Referral tracking</td>
                <td>30 days</td>
              </tr>
            </tbody>
          </table>
          <p>
            You can manage cookie preferences through your browser settings. Disabling certain
            cookies may affect service functionality.
          </p>

          <h2 id="international">10. International Data Transfers</h2>
          <p>
            Campfire is based in the United States. If you access our Service from outside the US,
            your information will be transferred to, stored, and processed in the US and other
            countries where our service providers operate.
          </p>
          <p>
            For EEA/UK users, we rely on Standard Contractual Clauses (SCCs) and other appropriate
            safeguards for international transfers.
          </p>

          <h2 id="children">11. Children&apos;s Privacy</h2>
          <p>
            Campfire is not intended for users under 18 years of age. We do not knowingly collect
            personal information from children. If you believe we have collected information from
            a child, please contact us immediately at privacy@campfire.dev.
          </p>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 my-4">
            <p className="text-red-400 text-sm m-0">
              <strong>Age Requirement:</strong> You must be at least 18 years old to use Campfire.
              By using our Service, you represent that you meet this age requirement.
            </p>
          </div>

          <h2 id="changes">12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by:
          </p>
          <ul>
            <li>Posting the updated policy on this page with a new &quot;Last updated&quot; date</li>
            <li>Sending an email notification for significant changes</li>
            <li>Displaying a prominent notice in the Service</li>
          </ul>
          <p>
            Your continued use of the Service after changes become effective constitutes acceptance
            of the revised policy.
          </p>

          <h2 id="contact">13. Contact Us</h2>
          <p>For privacy-related questions, concerns, or requests:</p>
          <ul>
            <li><strong>Email:</strong> privacy@campfire.dev</li>
            <li><strong>Mail:</strong> Campfire Privacy Team, [Address]</li>
          </ul>
          <p>
            For EU/UK users, you may also contact your local data protection authority if you
            have concerns about our data practices.
          </p>

          <hr className="my-8" />

          <h2 id="summary">Quick Reference: Data We Collect</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 not-prose">
            <div className="bg-gray-800 rounded-lg p-4">
              <h4 className="text-green-400 font-semibold mb-2">You Provide</h4>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>Email &amp; account details</li>
                <li>Profile information</li>
                <li>Companion preferences</li>
                <li>Conversation messages</li>
                <li>Voice (during calls)</li>
                <li>Payment info (via Stripe)</li>
              </ul>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <h4 className="text-blue-400 font-semibold mb-2">Collected Automatically</h4>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>IP address</li>
                <li>Device information</li>
                <li>Usage analytics</li>
                <li>Session data</li>
                <li>Error logs</li>
              </ul>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <h4 className="text-purple-400 font-semibold mb-2">AI-Generated</h4>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>Long-term memories</li>
                <li>Personality insights</li>
                <li>Conversation summaries</li>
                <li>Knowledge graph</li>
              </ul>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <h4 className="text-orange-400 font-semibold mb-2">Shared With</h4>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>AI providers (Anthropic, OpenAI)</li>
                <li>Speech services (Deepgram, ElevenLabs)</li>
                <li>Payment processor (Stripe)</li>
                <li>Cloud hosting (AWS)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h1>Privacy Policy</h1>
          <p className="lead">
            Last updated: January 2026
          </p>

          <h2>Introduction</h2>
          <p>
            At Campfire, we take your privacy seriously. This Privacy Policy explains how we collect,
            use, disclose, and safeguard your information when you use our service.
          </p>

          <h2>Information We Collect</h2>
          <p>We collect information that you provide directly to us, including:</p>
          <ul>
            <li>Account information (email, name)</li>
            <li>Companion customization preferences</li>
            <li>Conversation history and memories</li>
            <li>Voice recordings during voice chat sessions</li>
          </ul>

          <h2>How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide and maintain our service</li>
            <li>Personalize your companion experience</li>
            <li>Process transactions</li>
            <li>Send service-related communications</li>
          </ul>

          <h2>Data Security</h2>
          <p>
            We implement appropriate security measures to protect your personal information.
            All conversations are encrypted in transit and at rest.
          </p>

          <h2>Your Rights</h2>
          <p>
            You have the right to access, update, or delete your personal information at any time.
            You can do this through your account settings or by contacting us.
          </p>

          <h2>Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us at privacy@campfire.dev.
          </p>
        </div>
      </div>
    </div>
  );
}

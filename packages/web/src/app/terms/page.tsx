import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchBrandForRequest } from '@/lib/brand/server';

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await fetchBrandForRequest();
  return {
    title: `Terms of Service - ${brand.name}`,
    description: `Terms of Service for ${brand.name} AI Companion`,
  };
}

export default async function TermsPage() {
  const { brand, baseUrl } = await fetchBrandForRequest();
  const legalEmail = brand.legalEmail || 'legal@ignite.cam';
  const domain = baseUrl.replace(/^https?:\/\//, '');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Back to {brand.name}
        </Link>

        <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Effective Date: January 4, 2025</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-4">1. Agreement to Terms</h2>
            <p className="text-muted-foreground">
              These Terms of Service (&quot;Terms&quot;) constitute a legally binding agreement between you
              and Noice Pty Ltd (ABN to be registered) (&quot;Noice,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) governing
              your access to and use of {brand.name} (accessible at {domain}) and all related services
              (collectively, the &quot;Service&quot;). By accessing or using the Service, you agree to be
              bound by these Terms. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
            <p className="text-muted-foreground">
              {brand.name} is an AI companion service that uses artificial intelligence to generate
              conversational responses, images, and other content. The Service is provided for
              entertainment and companionship purposes. AI-generated content is created algorithmically
              and does not represent the views or opinions of Noice Pty Ltd.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">3. Eligibility and Age Restriction</h2>
            <p className="text-muted-foreground">
              <strong>You must be at least 18 years of age to use this Service.</strong> By using
              the Service, you represent and warrant that you are at least 18 years old and have
              the legal capacity to enter into these Terms. We reserve the right to verify your
              age and terminate accounts that violate this requirement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">4. User Accounts</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>You must provide accurate, current, and complete registration information</li>
              <li>You are solely responsible for maintaining the confidentiality of your account credentials</li>
              <li>You may not share, transfer, or sell your account to any other person</li>
              <li>You are responsible for all activities that occur under your account</li>
              <li>You must notify us immediately of any unauthorized use of your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">5. Acceptable Use Policy</h2>
            <p className="text-muted-foreground mb-3">You agree NOT to use the Service to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Violate any applicable laws, regulations, or third-party rights</li>
              <li>Generate, request, or distribute content depicting minors in any context</li>
              <li>Harass, threaten, defame, or abuse any person</li>
              <li>Generate content promoting violence, hatred, or discrimination</li>
              <li>Attempt to circumvent content filters, safety measures, or access controls</li>
              <li>Use automated systems, bots, or scrapers without express permission</li>
              <li>Interfere with or disrupt the Service or its infrastructure</li>
              <li>Reverse engineer, decompile, or attempt to extract source code</li>
              <li>Use the Service for any commercial purpose without authorization</li>
              <li>Impersonate any person or entity or misrepresent your affiliation</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              Violation of this policy may result in immediate termination of your account
              without refund and may be reported to law enforcement where appropriate.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">6. AI-Generated Content</h2>
            <p className="text-muted-foreground mb-3">You acknowledge and agree that:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>All content generated by the AI is created algorithmically and may contain errors, inaccuracies, or inappropriate material</li>
              <li>AI responses do not constitute professional advice (medical, legal, financial, or otherwise)</li>
              <li>We do not guarantee the accuracy, reliability, or appropriateness of AI-generated content</li>
              <li>You use AI-generated content at your own risk</li>
              <li>We may modify, filter, or refuse to generate certain content at our discretion</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">7. Subscription, Payments, and Refunds</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Access to certain features requires a paid subscription</li>
              <li>Subscriptions automatically renew unless cancelled before the renewal date</li>
              <li>You authorize us to charge your payment method for recurring fees</li>
              <li>Prices may change with 30 days&apos; notice; continued use constitutes acceptance</li>
              <li>Refunds are provided in accordance with Australian Consumer Law where applicable</li>
              <li>No refunds are provided for partial subscription periods upon cancellation</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">8. Intellectual Property</h2>
            <p className="text-muted-foreground mb-3">
              <strong>Our Rights:</strong> The Service, including all software, designs, text, graphics,
              and other content (excluding User Content), is owned by Noice Pty Ltd and protected
              by copyright, trademark, and other intellectual property laws.
            </p>
            <p className="text-muted-foreground">
              <strong>User Content:</strong> You retain ownership of content you input into the Service.
              By using the Service, you grant us a worldwide, non-exclusive, royalty-free license to
              use, reproduce, modify, and process your content solely to provide and improve the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">9. Privacy</h2>
            <p className="text-muted-foreground">
              Your use of the Service is subject to our{' '}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>,
              which describes how we collect, use, and protect your personal information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">10. Termination</h2>
            <p className="text-muted-foreground">
              We may suspend or terminate your access to the Service immediately, without prior
              notice or liability, for any reason, including breach of these Terms. Upon termination,
              your right to use the Service ceases immediately. You may terminate your account at
              any time by contacting us. Provisions that by their nature should survive termination
              shall survive (including ownership, disclaimers, indemnification, and limitations of liability).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">11. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE IS PROVIDED &quot;AS IS&quot;
              AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR
              STATUTORY, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT
              THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES
              OR OTHER HARMFUL COMPONENTS.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">12. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL NOICE PTY LTD,
              ITS DIRECTORS, OFFICERS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT
              LIMITED TO DAMAGES FOR LOSS OF PROFITS, GOODWILL, USE, DATA, OR OTHER INTANGIBLE LOSSES,
              ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE
              POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID
              US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
            </p>
            <p className="text-muted-foreground mt-3">
              Nothing in these Terms excludes or limits liability that cannot be excluded or limited
              under applicable law, including liability under the Australian Consumer Law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">13. Indemnification</h2>
            <p className="text-muted-foreground">
              You agree to indemnify, defend, and hold harmless Noice Pty Ltd and its officers,
              directors, employees, and agents from and against any claims, liabilities, damages,
              losses, and expenses (including reasonable legal fees) arising out of or in any way
              connected with your access to or use of the Service, your violation of these Terms,
              or your violation of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">14. Governing Law and Dispute Resolution</h2>
            <p className="text-muted-foreground">
              These Terms are governed by the laws of New South Wales, Australia. Any disputes
              arising from these Terms or the Service shall be resolved in the courts of New South
              Wales, Australia, and you consent to the exclusive jurisdiction of those courts.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">15. Changes to Terms</h2>
            <p className="text-muted-foreground">
              We reserve the right to modify these Terms at any time. Material changes will be
              notified via email or prominent notice on our website at least 30 days before
              taking effect. Your continued use of the Service after changes become effective
              constitutes acceptance of the modified Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">16. Severability</h2>
            <p className="text-muted-foreground">
              If any provision of these Terms is found to be unenforceable or invalid, that
              provision shall be limited or eliminated to the minimum extent necessary, and
              the remaining provisions shall remain in full force and effect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">17. Entire Agreement</h2>
            <p className="text-muted-foreground">
              These Terms, together with the Privacy Policy, constitute the entire agreement
              between you and Noice Pty Ltd regarding the Service and supersede all prior
              agreements and understandings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">18. Contact</h2>
            <p className="text-muted-foreground">
              For questions about these Terms, please contact us:
            </p>
            <div className="text-muted-foreground mt-3">
              <p>Noice Pty Ltd</p>
              <p>Email: <a href={`mailto:${legalEmail}`} className="text-primary hover:underline">{legalEmail}</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

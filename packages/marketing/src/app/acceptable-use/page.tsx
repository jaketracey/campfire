import { SectionHeader } from '@/components/layout/section-header';

export default function AcceptableUsePage() {
  return (
    <div className="container py-24 md:py-32 max-w-4xl mx-auto">
      <SectionHeader
        title="Acceptable Use Policy"
        description="Last updated: January 1, 2026"
        className="mb-12"
        align="left"
      />
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p>
          Campfire is designed to be a safe and positive platform. This Acceptable Use Policy outlines the types of content and behavior that are prohibited.
        </p>

        <h3>1. Prohibited Content</h3>
        <ul>
          <li>Illegal content or content that promotes illegal activities.</li>
          <li>Content that depicts child sexual abuse or exploitation.</li>
          <li>Content that promotes non-consensual sexual content.</li>
          <li>Content that promotes self-harm or suicide.</li>
          <li>Content that incites violence or hatred against individuals or groups.</li>
        </ul>

        <h3>2. Prohibited Activities</h3>
        <ul>
          <li>Using the service to harass, abuse, or harm others.</li>
          <li>Attempting to bypass our security measures or safety filters.</li>
          <li>Using the service for fraudulent purposes or to spread malware.</li>
          <li>Automated scraping or bulk data extraction without permission.</li>
        </ul>

        <h3>3. Enforcement</h3>
        <p>
          We reserve the right to investigate and take appropriate action against anyone who violates this policy, including removing content, suspending accounts, and reporting to law enforcement authorities.
        </p>
      </div>
    </div>
  );
}

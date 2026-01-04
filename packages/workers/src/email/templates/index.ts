import mjml2html from 'mjml';
import { createHmac } from 'crypto';

// Template context types
export interface BaseTemplateContext {
  recipientEmail: string;
  recipientName?: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  year: number;
}

export interface PasswordResetContext extends BaseTemplateContext {
  resetUrl: string;
  expiresIn: string;
}

export interface EmailVerificationContext extends BaseTemplateContext {
  verifyUrl: string;
}

export interface WelcomeContext extends BaseTemplateContext {
  companionName?: string;
}

export interface NotificationContext extends BaseTemplateContext {
  title: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
}

export interface NewsletterContext extends BaseTemplateContext {
  headline: string;
  sections: Array<{
    title: string;
    content: string;
    imageUrl?: string;
    linkUrl?: string;
    linkText?: string;
  }>;
}

export interface AffiliateWelcomeContext extends BaseTemplateContext {
  affiliateName: string;
  affiliateCode: string;
  temporaryPassword: string;
  loginUrl: string;
  commissionStandard: string;
  commissionPremium: string;
}

export interface InviteContext extends BaseTemplateContext {
  inviteUrl: string;
  message?: string;
  invitedByName?: string;
}

/** Generate signed unsubscribe URL */
export function generateUnsubscribeUrl(
  identifier: string,
  emailType: string,
  baseUrl: string
): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || 'dev-secret';
  const payload = `${identifier}:${emailType}:${Date.now()}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return `${baseUrl}/email/unsubscribe?token=${token}`;
}

/** Generate signed preferences URL */
export function generatePreferencesUrl(identifier: string, baseUrl: string): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || 'dev-secret';
  const payload = `${identifier}:preferences:${Date.now()}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return `${baseUrl}/email/preferences?token=${token}`;
}

/** Verify unsubscribe token and extract data */
export function verifyUnsubscribeToken(token: string): {
  valid: boolean;
  identifier?: string;
  emailType?: string;
  expired?: boolean;
} {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return { valid: false };

    const [identifier, emailType, timestamp, signature] = parts;

    // Verify signature
    const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || 'dev-secret';
    const payload = `${identifier}:${emailType}:${timestamp}`;
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

    if (signature !== expectedSignature) {
      return { valid: false };
    }

    // Check if token is expired (7 days)
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
      return { valid: false, identifier, emailType, expired: true };
    }

    return { valid: true, identifier, emailType };
  } catch {
    return { valid: false };
  }
}

// Base template wrapper
const baseTemplate = (content: string, context: BaseTemplateContext) => `
<mjml>
  <mj-head>
    <mj-title>Ignite</mj-title>
    <mj-attributes>
      <mj-all font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" />
      <mj-text font-size="16px" line-height="1.6" color="#333333" />
      <mj-button background-color="#FF6B35" color="#ffffff" border-radius="8px" font-size="16px" />
    </mj-attributes>
    <mj-style>
      .footer-link { color: #666666 !important; text-decoration: underline; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f4f4f4">
    <!-- Header -->
    <mj-section background-color="#ffffff" padding="20px 30px">
      <mj-column>
        <mj-image
          src="https://ignite.cam/favicon/favicon-96x96.png"
          alt="Ignite"
          width="48px"
          align="left"
          href="https://ignite.cam"
        />
      </mj-column>
    </mj-section>

    <!-- Main Content -->
    <mj-section background-color="#ffffff" padding="40px 30px">
      <mj-column>
        ${content}
      </mj-column>
    </mj-section>

    <!-- Footer -->
    <mj-section background-color="#f4f4f4" padding="20px 30px">
      <mj-column>
        <mj-text font-size="12px" color="#666666" align="center">
          Ignite - Your AI companion
        </mj-text>
        <mj-text font-size="12px" color="#666666" align="center">
          <a href="${context.preferencesUrl}" class="footer-link">Email preferences</a> |
          <a href="${context.unsubscribeUrl}" class="footer-link">Unsubscribe</a>
        </mj-text>
        <mj-text font-size="11px" color="#999999" align="center">
          &copy; ${context.year} Ignite. All rights reserved.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

// Template definitions
export const templates = {
  passwordReset: (ctx: PasswordResetContext) =>
    baseTemplate(
      `
    <mj-text font-size="24px" font-weight="bold" padding-bottom="20px">
      Reset your password
    </mj-text>
    <mj-text>
      Hi${ctx.recipientName ? ` ${ctx.recipientName}` : ''},
    </mj-text>
    <mj-text>
      We received a request to reset your password. Click the button below to create a new password. This link will expire in ${ctx.expiresIn}.
    </mj-text>
    <mj-button href="${ctx.resetUrl}" padding="30px 0">
      Reset Password
    </mj-button>
    <mj-text font-size="14px" color="#666666">
      If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
    </mj-text>
    <mj-text font-size="12px" color="#999999" padding-top="20px">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <a href="${ctx.resetUrl}" style="color: #FF6B35; word-break: break-all;">${ctx.resetUrl}</a>
    </mj-text>
  `,
      ctx
    ),

  emailVerification: (ctx: EmailVerificationContext) =>
    baseTemplate(
      `
    <mj-text font-size="24px" font-weight="bold" padding-bottom="20px">
      Verify your email address
    </mj-text>
    <mj-text>
      Hi${ctx.recipientName ? ` ${ctx.recipientName}` : ''},
    </mj-text>
    <mj-text>
      Thank you for signing up for Ignite! Please verify your email address by clicking the button below.
    </mj-text>
    <mj-button href="${ctx.verifyUrl}" padding="30px 0">
      Verify Email
    </mj-button>
    <mj-text font-size="14px" color="#666666">
      If you didn't create an Ignite account, you can safely ignore this email.
    </mj-text>
  `,
      ctx
    ),

  welcome: (ctx: WelcomeContext) =>
    baseTemplate(
      `
    <mj-text font-size="24px" font-weight="bold" padding-bottom="20px">
      Welcome to Ignite!
    </mj-text>
    <mj-text>
      Hi${ctx.recipientName ? ` ${ctx.recipientName}` : ''},
    </mj-text>
    <mj-text>
      We're thrilled to have you join the Ignite community. Your AI companion${ctx.companionName ? `, ${ctx.companionName},` : ''} is ready and waiting to chat with you.
    </mj-text>
    <mj-text font-weight="bold" padding-top="20px">
      Here's what you can do:
    </mj-text>
    <mj-text>
      &#x2022; Have natural voice conversations<br/>
      &#x2022; Build lasting memories together<br/>
      &#x2022; Explore your personal knowledge graph<br/>
      &#x2022; Sync everything to your personal vault
    </mj-text>
    <mj-button href="https://ignite.cam/chat" padding="30px 0">
      Start Chatting
    </mj-button>
  `,
      ctx
    ),

  notification: (ctx: NotificationContext) =>
    baseTemplate(
      `
    <mj-text font-size="24px" font-weight="bold" padding-bottom="20px">
      ${ctx.title}
    </mj-text>
    <mj-text>
      ${ctx.body}
    </mj-text>
    ${
      ctx.actionUrl
        ? `
    <mj-button href="${ctx.actionUrl}" padding="30px 0">
      ${ctx.actionText || 'View Details'}
    </mj-button>
    `
        : ''
    }
  `,
      ctx
    ),

  newsletter: (ctx: NewsletterContext) =>
    baseTemplate(
      `
    <mj-text font-size="28px" font-weight="bold" padding-bottom="10px">
      ${ctx.headline}
    </mj-text>
    ${ctx.sections
      .map(
        (section) => `
      <mj-divider border-color="#eeeeee" padding="20px 0" />
      ${
        section.imageUrl
          ? `
        <mj-image src="${section.imageUrl}" width="100%" padding-bottom="15px" />
      `
          : ''
      }
      <mj-text font-size="20px" font-weight="bold">
        ${section.title}
      </mj-text>
      <mj-text>
        ${section.content}
      </mj-text>
      ${
        section.linkUrl
          ? `
        <mj-button href="${section.linkUrl}" padding="20px 0">
          ${section.linkText || 'Learn More'}
        </mj-button>
      `
          : ''
      }
    `
      )
      .join('')}
  `,
      ctx
    ),

  affiliateWelcome: (ctx: AffiliateWelcomeContext) =>
    baseTemplate(
      `
    <mj-text font-size="24px" font-weight="bold" padding-bottom="20px">
      Welcome to the Ignite Affiliate Program!
    </mj-text>
    <mj-text>
      Hi ${ctx.affiliateName},
    </mj-text>
    <mj-text>
      You've been added as an affiliate partner for Ignite. We're excited to have you on board!
    </mj-text>
    <mj-text font-weight="bold" padding-top="20px">
      Your Account Details:
    </mj-text>
    <mj-text>
      <strong>Email:</strong> ${ctx.recipientEmail}<br/>
      <strong>Temporary Password:</strong> ${ctx.temporaryPassword}<br/>
      <strong>Your Affiliate Code:</strong> ${ctx.affiliateCode}
    </mj-text>
    <mj-text font-weight="bold" padding-top="20px">
      Commission Rates:
    </mj-text>
    <mj-text>
      &#x2022; Standard Plan: ${ctx.commissionStandard} per conversion<br/>
      &#x2022; Premium Plan: ${ctx.commissionPremium} per conversion
    </mj-text>
    <mj-button href="${ctx.loginUrl}" padding="30px 0">
      Access Affiliate Portal
    </mj-button>
    <mj-text font-size="14px" color="#666666">
      Please log in and change your password immediately. You can share your affiliate link to start earning commissions.
    </mj-text>
    <mj-text padding-top="20px">
      Your affiliate link:<br/>
      <a href="https://ignite.cam/ref/${ctx.affiliateCode}" style="color: #FF6B35; word-break: break-all;">https://ignite.cam/ref/${ctx.affiliateCode}</a>
    </mj-text>
  `,
      ctx
    ),

  invite: (ctx: InviteContext) =>
    baseTemplate(
      `
    <mj-text font-size="24px" font-weight="bold" padding-bottom="20px">
      You're invited to Ignite!
    </mj-text>
    <mj-text>
      Hi${ctx.recipientName ? ` ${ctx.recipientName}` : ''},
    </mj-text>
    <mj-text>
      ${ctx.invitedByName ? `${ctx.invitedByName} has invited you to join` : "You've been invited to join"} Ignite, where you can create your own AI companion for meaningful conversations.
    </mj-text>
    ${
      ctx.message
        ? `
    <mj-text font-style="italic" color="#666666" padding="20px 0">
      "${ctx.message}"
    </mj-text>
    `
        : ''
    }
    <mj-button href="${ctx.inviteUrl}" padding="30px 0">
      Accept Invitation
    </mj-button>
    <mj-text font-size="14px" color="#666666">
      This invitation link will expire in 7 days. Click the button above to create your account and get started.
    </mj-text>
    <mj-text font-size="12px" color="#999999" padding-top="20px">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <a href="${ctx.inviteUrl}" style="color: #FF6B35; word-break: break-all;">${ctx.inviteUrl}</a>
    </mj-text>
  `,
      ctx
    ),
};

export type TemplateType = keyof typeof templates;

// Type helper for getting context type from template name
type TemplateContextMap = {
  passwordReset: PasswordResetContext;
  emailVerification: EmailVerificationContext;
  welcome: WelcomeContext;
  notification: NotificationContext;
  newsletter: NewsletterContext;
  affiliateWelcome: AffiliateWelcomeContext;
  invite: InviteContext;
};

/** Compile MJML to HTML */
export function compileTemplate<T extends TemplateType>(
  templateName: T,
  context: TemplateContextMap[T]
): { html: string; text: string; errors: string[] } {
  const templateFn = templates[templateName] as (ctx: TemplateContextMap[T]) => string;
  const mjml = templateFn(context);

  const result = mjml2html(mjml, {
    validationLevel: 'soft',
    minify: true,
  });

  // Generate plain text version
  const text = generatePlainText(result.html);

  return {
    html: result.html,
    text,
    errors: result.errors?.map((e) => e.formattedMessage) || [],
  };
}

/** Simple HTML to plain text conversion */
function generatePlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/** Get default subject for template */
export function getDefaultSubject(templateName: string): string {
  const subjects: Record<string, string> = {
    passwordReset: 'Reset your Ignite password',
    emailVerification: 'Verify your Ignite email',
    welcome: 'Welcome to Ignite!',
    notification: 'Notification from Ignite',
    newsletter: 'Ignite Newsletter',
    affiliateWelcome: 'Welcome to the Ignite Affiliate Program',
    invite: "You're invited to Ignite!",
  };
  return subjects[templateName] || 'Message from Ignite';
}

/**
 * Affiliates Service
 * Handles affiliate management, authentication, click tracking, and conversions.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import {
  getAffiliatesRepository,
  type AffiliateListFilters,
  type ClickListFilters,
  type ConversionListFilters,
} from '../repositories/affiliates.js';
import { logger } from '../observability/logger.js';
import type {
  Affiliate,
  AffiliateClick,
  AffiliateConversion,
  AffiliateSession,
  AffiliateWithStats,
  AffiliateConversionWithDetails,
  PendingPayoutSummary,
  PayoutInfo,
  PlanTier,
  ConversionStatus,
  AffiliateStatus,
} from '../db/types.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { enqueueEmailJob } from '../utils/queue.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const PayoutInfoSchema = z.object({
  type: z.enum(['paypal', 'bank', 'other']),
  paypalEmail: z.string().email().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const CreateAffiliateSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  code: z.string().min(3).max(50).regex(/^[A-Za-z0-9_-]+$/).optional(),
  commissionStandard: z.number().int().min(0).default(500), // $5 in cents
  commissionPremium: z.number().int().min(0).default(2500), // $25 in cents
  payoutInfo: PayoutInfoSchema.optional(),
  notes: z.string().optional(),
});

export const UpdateAffiliateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  code: z.string().min(3).max(50).regex(/^[A-Za-z0-9_-]+$/).optional(),
  commissionStandard: z.number().int().min(0).optional(),
  commissionPremium: z.number().int().min(0).optional(),
  status: z.enum(['active', 'suspended', 'inactive']).optional(),
  payoutInfo: PayoutInfoSchema.optional(),
  notes: z.string().optional(),
});

export const UpdatePayoutInfoSchema = PayoutInfoSchema;

export const UpdateConversionStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'paid', 'rejected']),
  rejectionReason: z.string().optional(),
});

export const AffiliateLoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// ============================================================================
// Types
// ============================================================================

export type CreateAffiliateInput = z.infer<typeof CreateAffiliateSchema>;
export type UpdateAffiliateInput = z.infer<typeof UpdateAffiliateSchema>;
export type UpdatePayoutInfoInput = z.infer<typeof UpdatePayoutInfoSchema>;
export type UpdateConversionStatusInput = z.infer<typeof UpdateConversionStatusSchema>;
export type AffiliateLoginInput = z.infer<typeof AffiliateLoginSchema>;

export interface AffiliateAuthResult {
  affiliate: Omit<Affiliate, 'password_hash'>;
  session: AffiliateSession;
  token: string;
  expiresAt: Date;
}

export interface AffiliateAuthError {
  code: 'INVALID_CREDENTIALS' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_INACTIVE' | 'SESSION_EXPIRED' | 'TOKEN_INVALID' | 'EMAIL_EXISTS';
  message: string;
}

export interface TrackClickInput {
  code: string;
  ipAddress?: string;
  userAgent?: string;
  referrerUrl?: string;
  landingPage?: string;
}

export interface AffiliateStats {
  totalClicks: number;
  totalConversions: number;
  pendingConversions: number;
  approvedConversions: number;
  paidConversions: number;
  totalEarned: number;
  pendingEarnings: number;
  totalPaid: number;
  clicksThisMonth: number;
  conversionsThisMonth: number;
}

// ============================================================================
// Service
// ============================================================================

export class AffiliatesService {
  private affiliates = getAffiliatesRepository();

  // Session duration: 30 days for affiliates
  private readonly SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Authenticate an affiliate
   */
  async login(
    input: AffiliateLoginInput,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    tx?: TransactionContext
  ): Promise<AffiliateAuthResult> {
    const validated = AffiliateLoginSchema.parse(input);

    const affiliate = await this.affiliates.findByEmail(validated.email, tx);
    if (!affiliate) {
      throw this.createAuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Check status
    if (affiliate.status === 'suspended') {
      throw this.createAuthError('ACCOUNT_SUSPENDED', 'Your account has been suspended');
    }
    if (affiliate.status === 'inactive') {
      throw this.createAuthError('ACCOUNT_INACTIVE', 'Your account is inactive');
    }

    // Verify password
    const isValid = await verifyPassword(validated.password, affiliate.password_hash);
    if (!isValid) {
      throw this.createAuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Update last login
    await this.affiliates.updateLastLogin(affiliate.id, tx);

    // Create session
    const { session, token } = await this.createSession(affiliate.id, deviceInfo, tx);

    logger.info({ affiliateId: affiliate.id }, 'Affiliate logged in');

    return {
      affiliate: this.sanitizeAffiliate(affiliate),
      session,
      token,
      expiresAt: session.expires_at,
    };
  }

  /**
   * Logout an affiliate (revoke session)
   */
  async logout(tokenHash: string, tx?: TransactionContext): Promise<void> {
    const session = await this.affiliates.findSessionByTokenHash(tokenHash, tx);
    if (session) {
      await this.affiliates.revokeSession(session.id, tx);
      logger.debug({ affiliateId: session.affiliate_id }, 'Affiliate logged out');
    }
  }

  /**
   * Validate a session token
   */
  async validateToken(tokenHash: string, tx?: TransactionContext): Promise<{ affiliate: Affiliate; session: AffiliateSession } | null> {
    const session = await this.affiliates.findSessionByTokenHash(tokenHash, tx);
    if (!session) {
      return null;
    }

    const affiliate = await this.affiliates.findById(session.affiliate_id, tx);
    if (!affiliate || affiliate.status !== 'active') {
      return null;
    }

    return { affiliate, session };
  }

  /**
   * Create a new session
   */
  private async createSession(
    affiliateId: string,
    deviceInfo?: { ipAddress?: string; userAgent?: string },
    tx?: TransactionContext
  ): Promise<{ session: AffiliateSession; token: string }> {
    // Generate a random token
    const token = this.generateToken();
    const tokenHash = this.hashToken(token);

    const expiresAt = new Date(Date.now() + this.SESSION_DURATION_MS);

    const session = await this.affiliates.createSession({
      affiliate_id: affiliateId,
      token_hash: tokenHash,
      ip_address: deviceInfo?.ipAddress,
      user_agent: deviceInfo?.userAgent,
      expires_at: expiresAt,
    }, tx);

    return { session, token };
  }

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    return createHash('sha256')
      .update(crypto.randomUUID() + Date.now().toString())
      .digest('hex');
  }

  /**
   * Hash a token for storage
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // ===========================================================================
  // Affiliate Portal (for affiliates themselves)
  // ===========================================================================

  /**
   * Get affiliate's own profile
   */
  async getProfile(affiliateId: string, tx?: TransactionContext): Promise<Omit<Affiliate, 'password_hash'>> {
    const affiliate = await this.affiliates.findById(affiliateId, tx);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }
    return this.sanitizeAffiliate(affiliate);
  }

  /**
   * Update payout info
   */
  async updatePayoutInfo(
    affiliateId: string,
    input: UpdatePayoutInfoInput,
    tx?: TransactionContext
  ): Promise<Omit<Affiliate, 'password_hash'>> {
    const validated = UpdatePayoutInfoSchema.parse(input);
    const affiliate = await this.affiliates.update(affiliateId, {
      payout_info: validated as PayoutInfo,
    }, tx);
    return this.sanitizeAffiliate(affiliate);
  }

  /**
   * Get affiliate stats
   */
  async getStats(affiliateId: string, tx?: TransactionContext): Promise<AffiliateStats> {
    return this.affiliates.getAffiliateStats(affiliateId, tx);
  }

  /**
   * Get affiliate's conversions
   */
  async getConversions(
    affiliateId: string,
    filters?: Omit<ConversionListFilters, 'affiliateId'>,
    tx?: TransactionContext
  ): Promise<PaginatedResult<AffiliateConversionWithDetails>> {
    return this.affiliates.listConversions({ ...filters, affiliateId }, tx);
  }

  /**
   * Get affiliate's clicks
   */
  async getClicks(
    affiliateId: string,
    filters?: Omit<ClickListFilters, 'affiliateId'>,
    tx?: TransactionContext
  ): Promise<PaginatedResult<AffiliateClick>> {
    return this.affiliates.listClicks({ ...filters, affiliateId }, tx);
  }

  // ===========================================================================
  // Tracking
  // ===========================================================================

  /**
   * Record a click from an affiliate link
   */
  async recordClick(
    input: TrackClickInput,
    tx?: TransactionContext
  ): Promise<{ affiliate: Affiliate; click: AffiliateClick } | null> {
    const affiliate = await this.affiliates.findByCode(input.code, tx);
    if (!affiliate) {
      logger.debug({ code: input.code }, 'Invalid affiliate code');
      return null;
    }

    // Hash IP for privacy
    const ipHash = input.ipAddress
      ? createHash('sha256').update(input.ipAddress).digest('hex').slice(0, 16)
      : null;

    const click = await this.affiliates.createClick({
      affiliate_id: affiliate.id,
      ip_hash: ipHash,
      user_agent: input.userAgent?.slice(0, 500),
      referrer_url: input.referrerUrl?.slice(0, 2000),
      landing_page: input.landingPage?.slice(0, 2000),
    }, tx);

    logger.debug({ affiliateId: affiliate.id, clickId: click.id }, 'Affiliate click recorded');

    return { affiliate, click };
  }

  /**
   * Create a conversion (called when user completes first payment)
   */
  async createConversion(
    userId: string,
    affiliateId: string,
    clickId: string | null,
    planTier: PlanTier,
    flowguardTransactionId?: string,
    tx?: TransactionContext
  ): Promise<AffiliateConversion> {
    const affiliate = await this.affiliates.findById(affiliateId, tx);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    // Get commission amount based on tier
    const commissionAmount = planTier === 'premium'
      ? affiliate.commission_premium
      : affiliate.commission_standard;

    const conversion = await this.affiliates.createConversion({
      affiliate_id: affiliateId,
      user_id: userId,
      click_id: clickId,
      plan_tier: planTier,
      commission_amount: commissionAmount,
      status: 'pending',
      flowguard_transaction_id: flowguardTransactionId,
    }, tx);

    logger.info(
      { affiliateId, userId, conversionId: conversion.id, amount: commissionAmount },
      'Affiliate conversion created'
    );

    return conversion;
  }

  // ===========================================================================
  // Admin Operations
  // ===========================================================================

  /**
   * Create a new affiliate (admin only)
   */
  async createAffiliate(input: CreateAffiliateInput, tx?: TransactionContext): Promise<Omit<Affiliate, 'password_hash'>> {
    const validated = CreateAffiliateSchema.parse(input);

    // Check if email already exists
    const existing = await this.affiliates.findByEmail(validated.email, tx);
    if (existing) {
      throw this.createAuthError('EMAIL_EXISTS', 'An affiliate with this email already exists');
    }

    // Store the plaintext password for the welcome email before hashing
    const temporaryPassword = validated.password;

    // Hash the password
    const passwordHash = await hashPassword(validated.password);

    const affiliate = await this.affiliates.create({
      name: validated.name,
      email: validated.email,
      code: validated.code,
      password_hash: passwordHash,
      commission_standard: validated.commissionStandard,
      commission_premium: validated.commissionPremium,
      payout_info: validated.payoutInfo as PayoutInfo,
      notes: validated.notes,
    }, tx);

    logger.info({ affiliateId: affiliate.id, code: affiliate.code }, 'Affiliate created by admin');

    // Send welcome email with login credentials
    try {
      await this.sendWelcomeEmail(affiliate, temporaryPassword);
    } catch (emailError) {
      // Don't fail affiliate creation if email fails
      logger.error({ affiliateId: affiliate.id, error: emailError }, 'Failed to send affiliate welcome email');
    }

    return this.sanitizeAffiliate(affiliate);
  }

  /**
   * Send welcome email to new affiliate
   */
  private async sendWelcomeEmail(affiliate: Affiliate, temporaryPassword: string): Promise<void> {
    const { nanoid } = await import('nanoid');
    const baseUrl = process.env.WEB_URL || 'https://ignite.cam';
    const loginUrl = `${baseUrl}/affiliate/login`;

    // Format commission amounts as currency
    const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

    const jobId = await enqueueEmailJob({
      type: 'transactional',
      templateName: 'affiliateWelcome',
      recipientEmail: affiliate.email,
      recipientName: affiliate.name,
      context: {
        affiliateName: affiliate.name,
        affiliateCode: affiliate.code,
        temporaryPassword,
        loginUrl,
        commissionStandard: formatCurrency(affiliate.commission_standard),
        commissionPremium: formatCurrency(affiliate.commission_premium),
      },
      metadata: {
        traceId: nanoid(),
      },
      priority: 'high',
    });

    if (jobId) {
      logger.info({ affiliateId: affiliate.id, jobId }, 'Affiliate welcome email queued');
    }
  }

  /**
   * Update an affiliate (admin only)
   */
  async updateAffiliate(
    id: string,
    input: UpdateAffiliateInput,
    tx?: TransactionContext
  ): Promise<Omit<Affiliate, 'password_hash'>> {
    const validated = UpdateAffiliateSchema.parse(input);

    const updateData: Record<string, unknown> = {};

    if (validated.name !== undefined) updateData.name = validated.name;
    if (validated.email !== undefined) updateData.email = validated.email;
    if (validated.code !== undefined) updateData.code = validated.code;
    if (validated.commissionStandard !== undefined) updateData.commission_standard = validated.commissionStandard;
    if (validated.commissionPremium !== undefined) updateData.commission_premium = validated.commissionPremium;
    if (validated.status !== undefined) updateData.status = validated.status;
    if (validated.payoutInfo !== undefined) updateData.payout_info = validated.payoutInfo;
    if (validated.notes !== undefined) updateData.notes = validated.notes;

    // Hash password if being changed
    if (validated.password) {
      updateData.password_hash = await hashPassword(validated.password);
    }

    const affiliate = await this.affiliates.update(id, updateData, tx);

    logger.info({ affiliateId: id }, 'Affiliate updated by admin');

    return this.sanitizeAffiliate(affiliate);
  }

  /**
   * Deactivate an affiliate (admin only)
   */
  async deactivateAffiliate(id: string, tx?: TransactionContext): Promise<Omit<Affiliate, 'password_hash'>> {
    const affiliate = await this.affiliates.update(id, { status: 'inactive' as AffiliateStatus }, tx);

    // Revoke all sessions
    await this.affiliates.revokeAllSessions(id, tx);

    logger.info({ affiliateId: id }, 'Affiliate deactivated by admin');

    return this.sanitizeAffiliate(affiliate);
  }

  /**
   * List all affiliates (admin only)
   */
  async listAffiliates(
    filters?: AffiliateListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<AffiliateWithStats>> {
    return this.affiliates.list(filters, tx);
  }

  /**
   * Get a single affiliate (admin only)
   */
  async getAffiliate(id: string, tx?: TransactionContext): Promise<Omit<Affiliate, 'password_hash'> | null> {
    const affiliate = await this.affiliates.findById(id, tx);
    return affiliate ? this.sanitizeAffiliate(affiliate) : null;
  }

  /**
   * Get affiliate's conversions (admin only)
   */
  async getAffiliateConversions(
    affiliateId: string,
    filters?: Omit<ConversionListFilters, 'affiliateId'>,
    tx?: TransactionContext
  ): Promise<PaginatedResult<AffiliateConversionWithDetails>> {
    return this.affiliates.listConversions({ ...filters, affiliateId }, tx);
  }

  /**
   * Update conversion status (admin only)
   */
  async updateConversionStatus(
    id: string,
    input: UpdateConversionStatusInput,
    tx?: TransactionContext
  ): Promise<AffiliateConversion> {
    const validated = UpdateConversionStatusSchema.parse(input);

    const conversion = await this.affiliates.updateConversion(id, {
      status: validated.status as ConversionStatus,
      rejection_reason: validated.rejectionReason,
    }, tx);

    logger.info({ conversionId: id, status: validated.status }, 'Conversion status updated by admin');

    return conversion;
  }

  /**
   * Mark conversion as paid (admin only)
   */
  async markConversionPaid(id: string, tx?: TransactionContext): Promise<AffiliateConversion> {
    const conversion = await this.affiliates.updateConversion(id, {
      status: 'paid' as ConversionStatus,
      paid_at: new Date(),
    }, tx);

    logger.info({ conversionId: id }, 'Conversion marked as paid by admin');

    return conversion;
  }

  /**
   * Get pending payouts summary (admin only)
   */
  async getPendingPayouts(tx?: TransactionContext): Promise<PendingPayoutSummary[]> {
    return this.affiliates.getPendingPayoutsSummary(tx);
  }

  /**
   * List all conversions (admin only)
   */
  async listConversions(
    filters?: ConversionListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<AffiliateConversionWithDetails>> {
    return this.affiliates.listConversions(filters, tx);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private sanitizeAffiliate(affiliate: Affiliate): Omit<Affiliate, 'password_hash'> {
    const { password_hash: _, ...sanitized } = affiliate;
    return sanitized;
  }

  private createAuthError(code: AffiliateAuthError['code'], message: string): AffiliateAuthError & Error {
    const error = new Error(message) as AffiliateAuthError & Error;
    error.code = code;
    return error;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let affiliatesService: AffiliatesService | null = null;

export function getAffiliatesService(): AffiliatesService {
  if (!affiliatesService) {
    affiliatesService = new AffiliatesService();
  }
  return affiliatesService;
}

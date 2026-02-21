/**
 * Affiliates Repository
 * Data access for affiliates, affiliate_clicks, affiliate_conversions, and affiliate_sessions tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type {
  Affiliate,
  AffiliateInsert,
  AffiliateUpdate,
  AffiliateStatus,
  AffiliateClick,
  AffiliateClickInsert,
  AffiliateConversion,
  AffiliateConversionInsert,
  AffiliateConversionUpdate,
  ConversionStatus,
  AffiliateSession,
  AffiliateSessionInsert,
  AffiliateWithStats,
  AffiliateConversionWithDetails,
  PendingPayoutSummary,
  PayoutInfo,
  PlanTier,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult, DateRangeFilter } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

// ============================================================================
// Filter Types
// ============================================================================

export interface AffiliateListFilters extends PaginationOptions {
  status?: AffiliateStatus | AffiliateStatus[];
  search?: string; // Search in name, email, code
}

export interface ClickListFilters extends PaginationOptions {
  affiliateId?: string;
  dateRange?: DateRangeFilter;
}

export interface ConversionListFilters extends PaginationOptions {
  affiliateId?: string;
  userId?: string;
  status?: ConversionStatus | ConversionStatus[];
  planTier?: PlanTier;
  dateRange?: DateRangeFilter;
}

// ============================================================================
// Repository
// ============================================================================

export class AffiliatesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Affiliates
  // ===========================================================================

  async findById(id: string, tx?: TransactionContext): Promise<Affiliate | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, email, email_normalized, code, password_hash,
        commission_standard, commission_premium, status,
        payout_info, notes,
        total_clicks, total_conversions, total_earned, total_paid,
        last_login_at, created_at, updated_at
      FROM affiliates
      WHERE id = ${id}
    `;

    return result[0] ? this.mapAffiliate(result[0]) : null;
  }

  async findByEmail(email: string, tx?: TransactionContext): Promise<Affiliate | null> {
    const db = this.getSql(tx);
    const normalizedEmail = email.toLowerCase().trim();
    const result = await db`
      SELECT
        id, name, email, email_normalized, code, password_hash,
        commission_standard, commission_premium, status,
        payout_info, notes,
        total_clicks, total_conversions, total_earned, total_paid,
        last_login_at, created_at, updated_at
      FROM affiliates
      WHERE email_normalized = ${normalizedEmail}
    `;

    return result[0] ? this.mapAffiliate(result[0]) : null;
  }

  async findByCode(code: string, tx?: TransactionContext): Promise<Affiliate | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, email, email_normalized, code, password_hash,
        commission_standard, commission_premium, status,
        payout_info, notes,
        total_clicks, total_conversions, total_earned, total_paid,
        last_login_at, created_at, updated_at
      FROM affiliates
      WHERE UPPER(code) = UPPER(${code})
        AND status = 'active'
    `;

    return result[0] ? this.mapAffiliate(result[0]) : null;
  }

  async create(data: AffiliateInsert, tx?: TransactionContext): Promise<Affiliate> {
    const db = this.getSql(tx);

    try {
      // Generate code if not provided
      let code = data.code;
      if (!code) {
        const codeResult = await db`SELECT generate_affiliate_code() as code`;
        code = codeResult[0]?.code as string;
      }

      const result = await db`
        INSERT INTO affiliates (
          name, email, code, password_hash,
          commission_standard, commission_premium, status,
          payout_info, notes
        ) VALUES (
          ${data.name},
          ${data.email},
          ${code},
          ${data.password_hash},
          ${data.commission_standard ?? 500},
          ${data.commission_premium ?? 2500},
          ${data.status ?? 'active'},
          ${db.json((data.payout_info ?? { type: 'paypal' }) as unknown as postgres.JSONValue)},
          ${data.notes ?? null}
        )
        RETURNING
          id, name, email, email_normalized, code, password_hash,
          commission_standard, commission_premium, status,
          payout_info, notes,
          total_clicks, total_conversions, total_earned, total_paid,
          last_login_at, created_at, updated_at
      `;

      const affiliate = this.mapAffiliate(result[0]!);
      logger.info({ affiliateId: affiliate.id, code: affiliate.code }, 'Affiliate created');
      return affiliate;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('Affiliate', 'email', data.email);
      }
      throw wrapDatabaseError(error, 'affiliates.create');
    }
  }

  async update(id: string, data: AffiliateUpdate, tx?: TransactionContext): Promise<Affiliate> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE affiliates
      SET
        name = COALESCE(${data.name ?? null}, name),
        email = COALESCE(${data.email ?? null}, email),
        code = COALESCE(${data.code ?? null}, code),
        password_hash = COALESCE(${data.password_hash ?? null}, password_hash),
        commission_standard = COALESCE(${data.commission_standard ?? null}, commission_standard),
        commission_premium = COALESCE(${data.commission_premium ?? null}, commission_premium),
        status = COALESCE(${data.status ?? null}, status),
        payout_info = COALESCE(${data.payout_info ? db.json(data.payout_info as unknown as postgres.JSONValue) : null}, payout_info),
        notes = COALESCE(${data.notes ?? null}, notes)
      WHERE id = ${id}
      RETURNING
        id, name, email, email_normalized, code, password_hash,
        commission_standard, commission_premium, status,
        payout_info, notes,
        total_clicks, total_conversions, total_earned, total_paid,
        last_login_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Affiliate', id);
    }

    logger.debug({ affiliateId: id }, 'Affiliate updated');
    return this.mapAffiliate(result[0]);
  }

  async updateLastLogin(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      UPDATE affiliates
      SET last_login_at = NOW()
      WHERE id = ${id}
    `;
  }

  async list(filters: AffiliateListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<AffiliateWithStats>> {
    const db = this.getSql(tx);
    const { limit = 20, offset = 0, status, search } = filters;

    // Build conditions
    const conditions: string[] = [];
    const params: (string | string[] | number)[] = [];

    if (status) {
      if (Array.isArray(status)) {
        conditions.push(`status = ANY($${params.length + 1})`);
        params.push(status);
      } else {
        conditions.push(`status = $${params.length + 1}`);
        params.push(status);
      }
    }

    if (search) {
      conditions.push(`(
        name ILIKE $${params.length + 1}
        OR email ILIKE $${params.length + 1}
        OR code ILIKE $${params.length + 1}
      )`);
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await db.unsafe(
      `SELECT COUNT(*) as count FROM affiliates ${whereClause}`,
      params
    );
    const total = parseInt(countResult[0]?.count as string, 10) || 0;

    // Get affiliates with pending earnings
    const result = await db.unsafe(
      `
      SELECT
        a.id, a.name, a.email, a.email_normalized, a.code, a.password_hash,
        a.commission_standard, a.commission_premium, a.status,
        a.payout_info, a.notes,
        a.total_clicks, a.total_conversions, a.total_earned, a.total_paid,
        a.last_login_at, a.created_at, a.updated_at,
        COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.commission_amount ELSE 0 END), 0)::INTEGER as pending_earnings,
        COALESCE(COUNT(CASE WHEN c.status = 'pending' THEN 1 END), 0)::INTEGER as pending_conversions
      FROM affiliates a
      LEFT JOIN affiliate_conversions c ON a.id = c.affiliate_id
      ${whereClause}
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit + 1, offset]
    );

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map((row) => this.mapAffiliateWithStats(row));

    return { data, hasMore, total };
  }

  // ===========================================================================
  // Clicks
  // ===========================================================================

  async createClick(data: AffiliateClickInsert, tx?: TransactionContext): Promise<AffiliateClick> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO affiliate_clicks (
        affiliate_id, ip_hash, user_agent, referrer_url, landing_page
      ) VALUES (
        ${data.affiliate_id},
        ${data.ip_hash ?? null},
        ${data.user_agent ?? null},
        ${data.referrer_url ?? null},
        ${data.landing_page ?? null}
      )
      RETURNING id, affiliate_id, ip_hash, user_agent, referrer_url, landing_page, created_at
    `;

    logger.debug({ affiliateId: data.affiliate_id, clickId: result[0]!.id }, 'Affiliate click recorded');
    return this.mapClick(result[0]!);
  }

  async findClickById(id: string, tx?: TransactionContext): Promise<AffiliateClick | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT id, affiliate_id, ip_hash, user_agent, referrer_url, landing_page, created_at
      FROM affiliate_clicks
      WHERE id = ${id}
    `;
    return result[0] ? this.mapClick(result[0]) : null;
  }

  async listClicks(filters: ClickListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<AffiliateClick>> {
    const db = this.getSql(tx);
    const { affiliateId, dateRange, limit = 50, offset = 0 } = filters;

    let result;
    if (affiliateId && dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT id, affiliate_id, ip_hash, user_agent, referrer_url, landing_page, created_at
        FROM affiliate_clicks
        WHERE affiliate_id = ${affiliateId}
          AND created_at >= ${dateRange.from}
          AND created_at <= ${dateRange.to}
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (affiliateId) {
      result = await db`
        SELECT id, affiliate_id, ip_hash, user_agent, referrer_url, landing_page, created_at
        FROM affiliate_clicks
        WHERE affiliate_id = ${affiliateId}
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else {
      result = await db`
        SELECT id, affiliate_id, ip_hash, user_agent, referrer_url, landing_page, created_at
        FROM affiliate_clicks
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    }

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map((row) => this.mapClick(row));

    return { data, hasMore };
  }

  // ===========================================================================
  // Conversions
  // ===========================================================================

  async createConversion(data: AffiliateConversionInsert, tx?: TransactionContext): Promise<AffiliateConversion> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO affiliate_conversions (
        affiliate_id, user_id, click_id, plan_tier, commission_amount, status, stripe_transaction_id
      ) VALUES (
        ${data.affiliate_id},
        ${data.user_id ?? null},
        ${data.click_id ?? null},
        ${data.plan_tier},
        ${data.commission_amount},
        ${data.status ?? 'pending'},
        ${data.stripe_transaction_id ?? null}
      )
      RETURNING
        id, affiliate_id, user_id, click_id, plan_tier, commission_amount,
        status, rejection_reason, paid_at, stripe_transaction_id, created_at, updated_at
    `;

    logger.info(
      { affiliateId: data.affiliate_id, conversionId: result[0]!.id, amount: data.commission_amount },
      'Affiliate conversion created'
    );
    return this.mapConversion(result[0]!);
  }

  async findConversionById(id: string, tx?: TransactionContext): Promise<AffiliateConversion | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, affiliate_id, user_id, click_id, plan_tier, commission_amount,
        status, rejection_reason, paid_at, stripe_transaction_id, created_at, updated_at
      FROM affiliate_conversions
      WHERE id = ${id}
    `;
    return result[0] ? this.mapConversion(result[0]) : null;
  }

  async findConversionByUserId(userId: string, tx?: TransactionContext): Promise<AffiliateConversion | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, affiliate_id, user_id, click_id, plan_tier, commission_amount,
        status, rejection_reason, paid_at, stripe_transaction_id, created_at, updated_at
      FROM affiliate_conversions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return result[0] ? this.mapConversion(result[0]) : null;
  }

  async updateConversion(id: string, data: AffiliateConversionUpdate, tx?: TransactionContext): Promise<AffiliateConversion> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE affiliate_conversions
      SET
        status = COALESCE(${data.status ?? null}, status),
        rejection_reason = COALESCE(${data.rejection_reason ?? null}, rejection_reason),
        paid_at = COALESCE(${data.paid_at ?? null}, paid_at)
      WHERE id = ${id}
      RETURNING
        id, affiliate_id, user_id, click_id, plan_tier, commission_amount,
        status, rejection_reason, paid_at, stripe_transaction_id, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('AffiliateConversion', id);
    }

    logger.info({ conversionId: id, status: data.status }, 'Affiliate conversion updated');
    return this.mapConversion(result[0]);
  }

  async listConversions(
    filters: ConversionListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<AffiliateConversionWithDetails>> {
    const db = this.getSql(tx);
    const { affiliateId, userId, status, planTier, dateRange, limit = 50, offset = 0 } = filters;

    // Build dynamic query
    const conditions: string[] = [];
    const params: (string | string[] | number | Date)[] = [];

    if (affiliateId) {
      conditions.push(`c.affiliate_id = $${params.length + 1}`);
      params.push(affiliateId);
    }

    if (userId) {
      conditions.push(`c.user_id = $${params.length + 1}`);
      params.push(userId);
    }

    if (status) {
      if (Array.isArray(status)) {
        conditions.push(`c.status = ANY($${params.length + 1})`);
        params.push(status);
      } else {
        conditions.push(`c.status = $${params.length + 1}`);
        params.push(status);
      }
    }

    if (planTier) {
      conditions.push(`c.plan_tier = $${params.length + 1}`);
      params.push(planTier);
    }

    if (dateRange?.from && dateRange?.to) {
      conditions.push(`c.created_at >= $${params.length + 1} AND c.created_at <= $${params.length + 2}`);
      params.push(dateRange.from, dateRange.to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.unsafe(
      `
      SELECT
        c.id, c.affiliate_id, c.user_id, c.click_id, c.plan_tier, c.commission_amount,
        c.status, c.rejection_reason, c.paid_at, c.stripe_transaction_id, c.created_at, c.updated_at,
        a.name as affiliate_name, a.code as affiliate_code,
        u.email as user_email
      FROM affiliate_conversions c
      JOIN affiliates a ON c.affiliate_id = a.id
      LEFT JOIN users u ON c.user_id = u.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit + 1, offset]
    );

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map((row) => this.mapConversionWithDetails(row));

    return { data, hasMore };
  }

  async getPendingPayoutsSummary(tx?: TransactionContext): Promise<PendingPayoutSummary[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        a.id as affiliate_id,
        a.name as affiliate_name,
        a.code as affiliate_code,
        a.email as affiliate_email,
        a.payout_info,
        COALESCE(SUM(c.commission_amount), 0)::INTEGER as pending_amount,
        COUNT(c.id)::INTEGER as pending_count
      FROM affiliates a
      JOIN affiliate_conversions c ON a.id = c.affiliate_id AND c.status = 'approved'
      GROUP BY a.id, a.name, a.code, a.email, a.payout_info
      HAVING COUNT(c.id) > 0
      ORDER BY pending_amount DESC
    `;

    // For each affiliate, also get their pending conversions
    const summaries: PendingPayoutSummary[] = [];
    for (const row of result) {
      const conversions = await db`
        SELECT
          id, affiliate_id, user_id, click_id, plan_tier, commission_amount,
          status, rejection_reason, paid_at, stripe_transaction_id, created_at, updated_at
        FROM affiliate_conversions
        WHERE affiliate_id = ${row.affiliate_id}
          AND status = 'approved'
        ORDER BY created_at DESC
      `;

      summaries.push({
        affiliate_id: row.affiliate_id as string,
        affiliate_name: row.affiliate_name as string,
        affiliate_code: row.affiliate_code as string,
        affiliate_email: row.affiliate_email as string,
        payout_info: row.payout_info as PayoutInfo,
        pending_amount: row.pending_amount as number,
        pending_count: row.pending_count as number,
        conversions: conversions.map((c) => this.mapConversion(c)),
      });
    }

    return summaries;
  }

  // ===========================================================================
  // Sessions
  // ===========================================================================

  async createSession(data: AffiliateSessionInsert, tx?: TransactionContext): Promise<AffiliateSession> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO affiliate_sessions (
        affiliate_id, token_hash, ip_address, user_agent, expires_at
      ) VALUES (
        ${data.affiliate_id},
        ${data.token_hash},
        ${data.ip_address ?? null},
        ${data.user_agent ?? null},
        ${data.expires_at}
      )
      RETURNING id, affiliate_id, token_hash, ip_address, user_agent, expires_at, revoked_at, created_at
    `;

    return this.mapSession(result[0]!);
  }

  async findSessionByTokenHash(tokenHash: string, tx?: TransactionContext): Promise<AffiliateSession | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT id, affiliate_id, token_hash, ip_address, user_agent, expires_at, revoked_at, created_at
      FROM affiliate_sessions
      WHERE token_hash = ${tokenHash}
        AND revoked_at IS NULL
        AND expires_at > NOW()
    `;
    return result[0] ? this.mapSession(result[0]) : null;
  }

  async revokeSession(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      UPDATE affiliate_sessions
      SET revoked_at = NOW()
      WHERE id = ${id}
    `;
  }

  async revokeAllSessions(affiliateId: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE affiliate_sessions
      SET revoked_at = NOW()
      WHERE affiliate_id = ${affiliateId}
        AND revoked_at IS NULL
    `;
    return result.count;
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  async getAffiliateStats(affiliateId: string, tx?: TransactionContext): Promise<{
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
  }> {
    const db = this.getSql(tx);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [stats, monthlyClicks, monthlyConversions] = await Promise.all([
      db`
        SELECT
          total_clicks, total_conversions, total_earned, total_paid,
          (SELECT COALESCE(SUM(commission_amount), 0) FROM affiliate_conversions WHERE affiliate_id = ${affiliateId} AND status = 'pending') as pending_earnings,
          (SELECT COUNT(*) FROM affiliate_conversions WHERE affiliate_id = ${affiliateId} AND status = 'pending') as pending_conversions,
          (SELECT COUNT(*) FROM affiliate_conversions WHERE affiliate_id = ${affiliateId} AND status = 'approved') as approved_conversions,
          (SELECT COUNT(*) FROM affiliate_conversions WHERE affiliate_id = ${affiliateId} AND status = 'paid') as paid_conversions
        FROM affiliates
        WHERE id = ${affiliateId}
      `,
      db`
        SELECT COUNT(*) as count
        FROM affiliate_clicks
        WHERE affiliate_id = ${affiliateId}
          AND created_at >= ${startOfMonth}
      `,
      db`
        SELECT COUNT(*) as count
        FROM affiliate_conversions
        WHERE affiliate_id = ${affiliateId}
          AND created_at >= ${startOfMonth}
      `,
    ]);

    const row = stats[0];
    return {
      totalClicks: (row?.total_clicks as number) || 0,
      totalConversions: (row?.total_conversions as number) || 0,
      pendingConversions: parseInt(row?.pending_conversions as string, 10) || 0,
      approvedConversions: parseInt(row?.approved_conversions as string, 10) || 0,
      paidConversions: parseInt(row?.paid_conversions as string, 10) || 0,
      totalEarned: (row?.total_earned as number) || 0,
      pendingEarnings: parseInt(row?.pending_earnings as string, 10) || 0,
      totalPaid: (row?.total_paid as number) || 0,
      clicksThisMonth: parseInt(monthlyClicks[0]?.count as string, 10) || 0,
      conversionsThisMonth: parseInt(monthlyConversions[0]?.count as string, 10) || 0,
    };
  }

  // ===========================================================================
  // Mapping Functions
  // ===========================================================================

  private mapAffiliate(row: Record<string, unknown>): Affiliate {
    return {
      id: row.id as string,
      name: row.name as string,
      email: row.email as string,
      email_normalized: row.email_normalized as string,
      code: row.code as string,
      password_hash: row.password_hash as string,
      commission_standard: row.commission_standard as number,
      commission_premium: row.commission_premium as number,
      status: row.status as AffiliateStatus,
      payout_info: row.payout_info as PayoutInfo,
      notes: row.notes as string | null,
      total_clicks: row.total_clicks as number,
      total_conversions: row.total_conversions as number,
      total_earned: row.total_earned as number,
      total_paid: row.total_paid as number,
      last_login_at: row.last_login_at ? new Date(row.last_login_at as string) : null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapAffiliateWithStats(row: Record<string, unknown>): AffiliateWithStats {
    return {
      ...this.mapAffiliate(row),
      pending_earnings: row.pending_earnings as number,
      pending_conversions: row.pending_conversions as number,
    };
  }

  private mapClick(row: Record<string, unknown>): AffiliateClick {
    return {
      id: row.id as string,
      affiliate_id: row.affiliate_id as string,
      ip_hash: row.ip_hash as string | null,
      user_agent: row.user_agent as string | null,
      referrer_url: row.referrer_url as string | null,
      landing_page: row.landing_page as string | null,
      created_at: new Date(row.created_at as string),
    };
  }

  private mapConversion(row: Record<string, unknown>): AffiliateConversion {
    return {
      id: row.id as string,
      affiliate_id: row.affiliate_id as string,
      user_id: row.user_id as string | null,
      click_id: row.click_id as string | null,
      plan_tier: row.plan_tier as PlanTier,
      commission_amount: row.commission_amount as number,
      status: row.status as ConversionStatus,
      rejection_reason: row.rejection_reason as string | null,
      paid_at: row.paid_at ? new Date(row.paid_at as string) : null,
      stripe_transaction_id: row.stripe_transaction_id as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapConversionWithDetails(row: Record<string, unknown>): AffiliateConversionWithDetails {
    return {
      ...this.mapConversion(row),
      affiliate_name: row.affiliate_name as string,
      affiliate_code: row.affiliate_code as string,
      user_email: row.user_email as string | null,
    };
  }

  private mapSession(row: Record<string, unknown>): AffiliateSession {
    return {
      id: row.id as string,
      affiliate_id: row.affiliate_id as string,
      token_hash: row.token_hash as string,
      ip_address: row.ip_address as string | null,
      user_agent: row.user_agent as string | null,
      expires_at: new Date(row.expires_at as string),
      revoked_at: row.revoked_at ? new Date(row.revoked_at as string) : null,
      created_at: new Date(row.created_at as string),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let affiliatesRepository: AffiliatesRepository | null = null;

export function getAffiliatesRepository(): AffiliatesRepository {
  if (!affiliatesRepository) {
    affiliatesRepository = new AffiliatesRepository();
  }
  return affiliatesRepository;
}

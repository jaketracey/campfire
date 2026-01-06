/**
 * Tenants Repository
 * Data access for tenants and tenant_domains tables
 */

import type postgres from 'postgres';
import { sql } from '../db/pool.js';
import type { UUID, JSONObject, Timestamp } from '../db/types.js';
import type { TransactionContext } from './types.js';
import { wrapDatabaseError } from './errors.js';

export type TenantStatus = 'active' | 'suspended';

export interface Tenant {
  id: UUID;
  owner_user_id: UUID;
  slug: string;
  name: string;
  status: TenantStatus;
  brand_config: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TenantDomain {
  id: UUID;
  tenant_id: UUID;
  domain: string;
  is_primary: boolean;
  verification_token: string | null;
  verified_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export class TenantsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  async findTenantByDomain(domain: string, tx?: TransactionContext): Promise<Tenant | null> {
    const db = this.getSql(tx);
    const normalized = domain.trim().toLowerCase();
    try {
      const result = await db`
        SELECT
          t.id, t.owner_user_id, t.slug, t.name, t.status,
          t.brand_config, t.created_at, t.updated_at
        FROM tenant_domains d
        INNER JOIN tenants t ON t.id = d.tenant_id
        WHERE d.domain = ${normalized}
          AND t.status = 'active'
          AND (d.verified_at IS NOT NULL OR d.domain LIKE '%.localhost')
        LIMIT 1
      `;

      return result[0] ? this.mapTenant(result[0]) : null;
    } catch (error) {
      throw wrapDatabaseError(error, 'tenants.findTenantByDomain');
    }
  }

  private mapTenant(row: postgres.Row): Tenant {
    return {
      id: row['id'] as UUID,
      owner_user_id: row['owner_user_id'] as UUID,
      slug: row['slug'] as string,
      name: row['name'] as string,
      status: row['status'] as TenantStatus,
      brand_config: (row['brand_config'] ?? {}) as JSONObject,
      created_at: row['created_at'] as Timestamp,
      updated_at: row['updated_at'] as Timestamp,
    };
  }
}

let tenantsRepository: TenantsRepository | null = null;
export function getTenantsRepository(): TenantsRepository {
  tenantsRepository ??= new TenantsRepository();
  return tenantsRepository;
}


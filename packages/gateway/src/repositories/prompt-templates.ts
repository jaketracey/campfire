/**
 * Prompt Templates Repository
 * Data access for versioned prompt templates and definitions.
 */

import { sql } from '../db/pool.js';
import type { UUID } from '../db/types.js';
import type { TransactionContext } from './types.js';

export type PromptAdminArea = 'routing' | 'image_routing' | 'video_routing' | 'other';

export interface PromptSettings {
  default_version: string;
}

export interface PromptDefinition {
  key: string;
  display_name: string;
  description: string;
  admin_area: PromptAdminArea;
  is_required: boolean;
  allowed_variables: string[];
  created_at: Date;
  updated_at: Date;
}

export interface EffectivePromptTemplate extends PromptDefinition {
  version: string;
  companion_id: UUID | null;
  template: string | null;
  template_source: 'companion' | 'global' | 'missing';
  variables: string[];
}

export class PromptTemplatesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  async getSettings(tx?: TransactionContext): Promise<PromptSettings> {
    const db = this.getSql(tx);
    const rows = await db<PromptSettings[]>`
      SELECT default_version
      FROM prompt_settings
      WHERE id = 1
    `;
    return rows[0] ?? { default_version: '1.0.0' };
  }

  async setDefaultVersion(defaultVersion: string, tx?: TransactionContext): Promise<PromptSettings> {
    const db = this.getSql(tx);
    const rows = await db<PromptSettings[]>`
      UPDATE prompt_settings
      SET default_version = ${defaultVersion}
      WHERE id = 1
      RETURNING default_version
    `;
    return rows[0]!;
  }

  async listDefinitions(
    filters: { adminArea?: PromptAdminArea } = {},
    tx?: TransactionContext
  ): Promise<PromptDefinition[]> {
    const db = this.getSql(tx);
    const rows = await db<PromptDefinition[]>`
      SELECT
        key,
        display_name,
        description,
        admin_area,
        is_required,
        allowed_variables,
        created_at,
        updated_at
      FROM prompt_definitions
      WHERE ${filters.adminArea ? db`admin_area = ${filters.adminArea}` : db`TRUE`}
      ORDER BY admin_area, key
    `;
    return rows;
  }

  async listVersions(
    filters: { adminArea?: PromptAdminArea } = {},
    tx?: TransactionContext
  ): Promise<string[]> {
    const db = this.getSql(tx);
    const rows = await db<{ version: string }[]>`
      SELECT DISTINCT pt.version
      FROM prompt_templates pt
      JOIN prompt_definitions pd ON pd.key = pt.prompt_key
      WHERE pt.companion_id IS NULL
        AND ${filters.adminArea ? db`pd.admin_area = ${filters.adminArea}` : db`TRUE`}
      ORDER BY pt.version DESC
    `;
    return rows.map(r => r.version);
  }

  async listEffectiveTemplates(
    input: { version: string; adminArea?: PromptAdminArea; companionId?: UUID | null },
    tx?: TransactionContext
  ): Promise<EffectivePromptTemplate[]> {
    const db = this.getSql(tx);
    const companionId = input.companionId ?? null;

    const rows = await db<EffectivePromptTemplate[]>`
      SELECT
        d.key,
        d.display_name,
        d.description,
        d.admin_area,
        d.is_required,
        d.allowed_variables,
        d.created_at,
        d.updated_at,
        ${input.version}::text AS version,
        ${companionId}::uuid AS companion_id,
        COALESCE(ot.template, gt.template) AS template,
        CASE
          WHEN ot.template IS NOT NULL THEN 'companion'
          WHEN gt.template IS NOT NULL THEN 'global'
          ELSE 'missing'
        END AS template_source,
        COALESCE(ot.variables, gt.variables, '{}'::text[]) AS variables
      FROM prompt_definitions d
      LEFT JOIN prompt_templates ot
        ON ot.prompt_key = d.key
       AND ot.version = ${input.version}
       AND ot.companion_id = ${companionId}
      LEFT JOIN prompt_templates gt
        ON gt.prompt_key = d.key
       AND gt.version = ${input.version}
       AND gt.companion_id IS NULL
      WHERE ${input.adminArea ? db`d.admin_area = ${input.adminArea}` : db`TRUE`}
      ORDER BY d.admin_area, d.key
    `;
    return rows;
  }

  async getEffectiveTemplate(
    input: { key: string; version: string; companionId?: UUID | null },
    tx?: TransactionContext
  ): Promise<EffectivePromptTemplate | null> {
    const db = this.getSql(tx);
    const companionId = input.companionId ?? null;

    const rows = await db<EffectivePromptTemplate[]>`
      SELECT
        d.key,
        d.display_name,
        d.description,
        d.admin_area,
        d.is_required,
        d.allowed_variables,
        d.created_at,
        d.updated_at,
        ${input.version}::text AS version,
        ${companionId}::uuid AS companion_id,
        COALESCE(ot.template, gt.template) AS template,
        CASE
          WHEN ot.template IS NOT NULL THEN 'companion'
          WHEN gt.template IS NOT NULL THEN 'global'
          ELSE 'missing'
        END AS template_source,
        COALESCE(ot.variables, gt.variables, '{}'::text[]) AS variables
      FROM prompt_definitions d
      LEFT JOIN prompt_templates ot
        ON ot.prompt_key = d.key
       AND ot.version = ${input.version}
       AND ot.companion_id = ${companionId}
      LEFT JOIN prompt_templates gt
        ON gt.prompt_key = d.key
       AND gt.version = ${input.version}
       AND gt.companion_id IS NULL
      WHERE d.key = ${input.key}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  async upsertTemplate(
    input: {
      promptKey: string;
      version: string;
      companionId?: UUID | null;
      template: string;
      variables: string[];
    },
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    const companionId = input.companionId ?? null;

    await db`
      INSERT INTO prompt_templates (prompt_key, version, companion_id, template, variables)
      VALUES (${input.promptKey}, ${input.version}, ${companionId}, ${input.template}, ${input.variables})
      ON CONFLICT (prompt_key, version, companion_id) DO UPDATE SET
        template = EXCLUDED.template,
        variables = EXCLUDED.variables,
        updated_at = NOW()
    `;
  }

  async cloneVersion(
    input: { fromVersion: string; toVersion: string },
    tx?: TransactionContext
  ): Promise<{ copied: number }> {
    const db = this.getSql(tx);
    const rows = await db<{ copied: number }[]>`
      WITH copied AS (
        INSERT INTO prompt_templates (prompt_key, version, companion_id, template, variables)
        SELECT prompt_key, ${input.toVersion}, companion_id, template, variables
        FROM prompt_templates
        WHERE version = ${input.fromVersion}
          AND companion_id IS NULL
        ON CONFLICT (prompt_key, version, companion_id) DO NOTHING
        RETURNING 1
      )
      SELECT COUNT(*)::int AS copied FROM copied
    `;
    return { copied: rows[0]?.copied ?? 0 };
  }
}

let _repo: PromptTemplatesRepository | null = null;

export function getPromptTemplatesRepository(): PromptTemplatesRepository {
  if (!_repo) _repo = new PromptTemplatesRepository();
  return _repo;
}

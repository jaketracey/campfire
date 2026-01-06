/**
 * Prompt Runtime (Workers)
 *
 * Fetches and renders DB-backed prompt templates using python-style `.format()`
 * placeholders: `{var}` with escaped braces `{{` / `}}`.
 */

import type postgres from 'postgres';

type SqlClient = postgres.Sql<any>;

function renderPythonFormat(template: string, values: Record<string, string | number>): string {
  let out = '';

  for (let i = 0; i < template.length; i++) {
    const ch = template[i];

    if (ch === '{') {
      const next = template[i + 1];
      if (next === '{') {
        out += '{';
        i += 1;
        continue;
      }

      const close = template.indexOf('}', i + 1);
      if (close === -1) {
        throw new Error('Unclosed "{" in template (use "{{" for a literal "{").');
      }

      const name = template.slice(i + 1, close).trim();
      if (!name) throw new Error('Empty "{}" placeholder is not allowed.');
      if (!(name in values)) throw new Error(`Missing value for template variable: ${name}`);

      out += String(values[name]);
      i = close;
      continue;
    }

    if (ch === '}') {
      const next = template[i + 1];
      if (next === '}') {
        out += '}';
        i += 1;
        continue;
      }
      throw new Error('Unescaped "}" in template (use "}}" for a literal "}").');
    }

    out += ch;
  }

  return out;
}

const TEMPLATE_CACHE_TTL_MS = 5_000;
const VERSION_CACHE_TTL_MS = 5_000;

let cachedDefaultVersion: { value: string; fetchedAtMs: number } | null = null;
const templateCache = new Map<string, { template: string; fetchedAtMs: number }>();

async function getDefaultVersion(sql: SqlClient): Promise<string> {
  const now = Date.now();
  if (cachedDefaultVersion && now - cachedDefaultVersion.fetchedAtMs < VERSION_CACHE_TTL_MS) {
    return cachedDefaultVersion.value;
  }

  const rows = await sql<{ default_version: string }[]>`
    SELECT default_version
    FROM prompt_settings
    WHERE id = 1
  `;
  const value = rows[0]?.default_version;
  if (!value) {
    throw new Error('Missing prompt_settings default_version (prompt templates not configured)');
  }
  cachedDefaultVersion = { value, fetchedAtMs: now };
  return value;
}

export async function renderPromptFromDb(sql: SqlClient, input: {
  key: string;
  variables: Record<string, string | number>;
  version?: string;
  companionId?: string | null;
}): Promise<{ version: string; rendered: string }> {
  const now = Date.now();
  const version = input.version ?? await getDefaultVersion(sql);
  const companionId = input.companionId ?? null;

  const cacheKey = `${version}:${companionId ?? 'global'}:${input.key}`;
  const cached = templateCache.get(cacheKey);
  if (cached && now - cached.fetchedAtMs < TEMPLATE_CACHE_TTL_MS) {
    return { version, rendered: renderPythonFormat(cached.template, input.variables) };
  }

  const rows = await sql<{ template: string | null; is_required: boolean; template_source: string }[]>`
    SELECT
      COALESCE(ot.template, gt.template) AS template,
      pd.is_required AS is_required,
      CASE
        WHEN ot.template IS NOT NULL THEN 'companion'
        WHEN gt.template IS NOT NULL THEN 'global'
        ELSE 'missing'
      END AS template_source
    FROM prompt_definitions pd
    LEFT JOIN prompt_templates ot
      ON ot.prompt_key = pd.key
     AND ot.version = ${version}
     AND ot.companion_id = ${companionId}::uuid
    LEFT JOIN prompt_templates gt
      ON gt.prompt_key = pd.key
     AND gt.version = ${version}
     AND gt.companion_id IS NULL
    WHERE pd.key = ${input.key}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) throw new Error(`Unknown prompt key: ${input.key}`);
  if (row.template == null || row.template_source === 'missing') {
    if (row.is_required) {
      throw new Error(`Missing required prompt template: ${input.key} (version ${version})`);
    }
    throw new Error(`Missing prompt template: ${input.key} (version ${version})`);
  }

  templateCache.set(cacheKey, { template: row.template, fetchedAtMs: now });
  return { version, rendered: renderPythonFormat(row.template, input.variables) };
}

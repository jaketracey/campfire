/**
 * Prompt Runtime Service
 *
 * Lightweight runtime access + rendering for DB-backed prompt templates.
 * Uses python-style `.format()` placeholders: `{var}` with `{{` / `}}` escapes.
 */

import type { UUID } from '../db/types.js';
import { getPromptTemplatesRepository } from '../repositories/index.js';
import { extractFormatVariables } from './prompt-templates.js';

function renderPythonFormat(
  template: string,
  values: Record<string, string | number>
): string {
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
      if (!name) {
        throw new Error('Empty "{}" placeholder is not allowed.');
      }
      if (!(name in values)) {
        throw new Error(`Missing value for template variable: ${name}`);
      }
      const value = values[name];
      out += String(value);
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

type PromptCacheEntry = {
  template: string;
  variables: string[];
  isRequired: boolean;
  fetchedAtMs: number;
};

const TEMPLATE_CACHE_TTL_MS = 5_000;
const VERSION_CACHE_TTL_MS = 5_000;

let cachedDefaultVersion: { value: string; fetchedAtMs: number } | null = null;
const templateCache = new Map<string, PromptCacheEntry>();

export async function renderPromptFromDb(input: {
  key: string;
  variables: Record<string, string | number>;
  version?: string;
  companionId?: UUID | null;
}): Promise<{ version: string; rendered: string }> {
  const repo = getPromptTemplatesRepository();

  const now = Date.now();
  let version = input.version;
  if (!version) {
    if (cachedDefaultVersion && now - cachedDefaultVersion.fetchedAtMs < VERSION_CACHE_TTL_MS) {
      version = cachedDefaultVersion.value;
    } else {
      const settings = await repo.getSettings();
      cachedDefaultVersion = { value: settings.default_version, fetchedAtMs: now };
      version = settings.default_version;
    }
  }

  const cacheKey = `${version}:${input.companionId ?? 'global'}:${input.key}`;
  let cached = templateCache.get(cacheKey);
  if (!cached || now - cached.fetchedAtMs > TEMPLATE_CACHE_TTL_MS) {
    const effective = await repo.getEffectiveTemplate({
      key: input.key,
      version,
      companionId: input.companionId ?? null,
    });
    if (!effective) {
      throw new Error(`Unknown prompt key: ${input.key}`);
    }
    if (effective.template == null || effective.template_source === 'missing') {
      if (effective.is_required) {
        throw new Error(`Missing required prompt template: ${input.key} (version ${version})`);
      }
      throw new Error(`Missing prompt template: ${input.key} (version ${version})`);
    }

    cached = {
      template: effective.template,
      variables: effective.variables ?? [],
      isRequired: effective.is_required,
      fetchedAtMs: now,
    };
    templateCache.set(cacheKey, cached);
  }

  // Validate/normalize variable usage (catch missing vars before render).
  const needed = extractFormatVariables(cached.template);
  for (const varName of needed) {
    if (!(varName in input.variables)) {
      throw new Error(`Prompt "${input.key}" requires variable "{${varName}}" but it was not provided`);
    }
  }

  const rendered = renderPythonFormat(cached.template, input.variables);
  return { version, rendered };
}

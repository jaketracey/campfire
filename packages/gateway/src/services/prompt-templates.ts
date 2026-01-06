/**
 * Prompt Templates Service
 * Business logic for editable, versioned prompt templates with validation.
 */

import type { UUID } from '../db/types.js';
import {
  getPromptTemplatesRepository,
  type PromptAdminArea,
  type EffectivePromptTemplate,
} from '../repositories/index.js';

export class PromptTemplateValidationError extends Error {
  override name = 'PromptTemplateValidationError';
}

function isValidVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Extract python `.format()` placeholders from a template.
 *
 * Rules:
 * - `{{` and `}}` are treated as escaped literal braces
 * - Only simple `{var_name}` placeholders are allowed (no format specs)
 * - Any unescaped `{`/`}` is rejected
 */
export function extractFormatVariables(template: string): string[] {
  const variables = new Set<string>();

  for (let i = 0; i < template.length; i++) {
    const ch = template[i];

    if (ch === '{') {
      const next = template[i + 1];
      if (next === '{') {
        i += 1;
        continue;
      }

      const close = template.indexOf('}', i + 1);
      if (close === -1) {
        throw new PromptTemplateValidationError('Unclosed "{" in template (use "{{" for a literal "{").');
      }

      const inside = template.slice(i + 1, close).trim();
      if (!inside) {
        throw new PromptTemplateValidationError('Empty "{}" placeholder is not allowed.');
      }
      if (!isValidVarName(inside)) {
        throw new PromptTemplateValidationError(
          `Invalid placeholder "{${inside}}". Only simple variable names like "{companion_name}" are allowed.`
        );
      }

      variables.add(inside);
      i = close;
      continue;
    }

    if (ch === '}') {
      const next = template[i + 1];
      if (next === '}') {
        i += 1;
        continue;
      }
      throw new PromptTemplateValidationError('Unescaped "}" in template (use "}}" for a literal "}").');
    }
  }

  return Array.from(variables).sort();
}

export type PromptValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export class PromptTemplatesService {
  private repo = getPromptTemplatesRepository();

  async listVersions(adminArea?: PromptAdminArea): Promise<string[]> {
    return this.repo.listVersions({ adminArea });
  }

  async getDefaultVersion(): Promise<string> {
    const settings = await this.repo.getSettings();
    return settings.default_version;
  }

  async setDefaultVersion(defaultVersion: string): Promise<{ defaultVersion: string }> {
    const updated = await this.repo.setDefaultVersion(defaultVersion);
    return { defaultVersion: updated.default_version };
  }

  async listPrompts(input: {
    adminArea?: PromptAdminArea;
    version?: string;
    companionId?: UUID | null;
  }): Promise<{ version: string; prompts: EffectivePromptTemplate[] }> {
    const version = input.version ?? (await this.getDefaultVersion());
    const prompts = await this.repo.listEffectiveTemplates({
      version,
      adminArea: input.adminArea,
      companionId: input.companionId ?? null,
    });
    return { version, prompts };
  }

  async updatePrompt(input: {
    key: string;
    template: string;
    version?: string;
    companionId?: UUID | null;
  }): Promise<{ version: string; prompt: EffectivePromptTemplate }> {
    const version = input.version ?? (await this.getDefaultVersion());
    const trimmed = input.template?.trim() ?? '';

    const definitions = await this.repo.listDefinitions();
    const def = definitions.find((d) => d.key === input.key);
    if (!def) {
      throw new PromptTemplateValidationError(`Unknown prompt key: ${input.key}`);
    }

    if (!trimmed && def.is_required) {
      throw new PromptTemplateValidationError('Template cannot be empty for a required prompt.');
    }

    if (!trimmed && !def.is_required) {
      await this.repo.upsertTemplate({
        promptKey: input.key,
        version,
        companionId: input.companionId ?? null,
        template: '',
        variables: [],
      });

      const { prompts } = await this.listPrompts({
        version,
        companionId: input.companionId ?? null,
      });
      const effective = prompts.find((p) => p.key === input.key);
      if (!effective) {
        throw new Error(`Failed to load updated prompt: ${input.key}`);
      }
      return { version, prompt: effective };
    }

    const usedVariables = extractFormatVariables(trimmed);
    const allowed = new Set(def.allowed_variables ?? []);
    const unknown = usedVariables.filter((v) => !allowed.has(v));
    if (unknown.length > 0) {
      throw new PromptTemplateValidationError(
        `Template uses unknown variables for "${input.key}": ${unknown.join(', ')}`
      );
    }

    await this.repo.upsertTemplate({
      promptKey: input.key,
      version,
      companionId: input.companionId ?? null,
      template: trimmed,
      variables: usedVariables,
    });

    const { prompts } = await this.listPrompts({
      version,
      companionId: input.companionId ?? null,
    });
    const effective = prompts.find((p) => p.key === input.key);
    if (!effective) {
      throw new Error(`Failed to load updated prompt: ${input.key}`);
    }
    return { version, prompt: effective };
  }

  async createVersion(input: { fromVersion: string; toVersion: string }): Promise<{ copied: number }> {
    const to = input.toVersion.trim();
    if (!to) throw new PromptTemplateValidationError('toVersion is required.');

    const { copied } = await this.repo.cloneVersion({ fromVersion: input.fromVersion, toVersion: to });
    return { copied };
  }

  async validate(input: {
    adminArea?: PromptAdminArea;
    version?: string;
    companionId?: UUID | null;
  }): Promise<{ version: string; result: PromptValidationResult }> {
    const version = input.version ?? (await this.getDefaultVersion());
    const { prompts } = await this.listPrompts({
      adminArea: input.adminArea,
      version,
      companionId: input.companionId ?? null,
    });

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const p of prompts) {
      if (p.is_required && (!p.template || p.template_source === 'missing')) {
        errors.push(`Missing required prompt "${p.key}" for version "${version}"`);
        continue;
      }
      if (!p.template) continue;

      try {
        // Ensure template is syntactically valid and stored variables match extraction.
        const extracted = extractFormatVariables(p.template);
        const stored = new Set(p.variables ?? []);
        const mismatch = extracted.filter((v) => !stored.has(v)).concat(
          Array.from(stored).filter((v) => !extracted.includes(v))
        );
        if (mismatch.length > 0) {
          warnings.push(`Prompt "${p.key}" variables metadata is out of date (re-save to fix).`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Prompt "${p.key}" is invalid: ${msg}`);
      }
    }

    return {
      version,
      result: { valid: errors.length === 0, errors, warnings },
    };
  }
}

let _service: PromptTemplatesService | null = null;
export function getPromptTemplatesService(): PromptTemplatesService {
  if (!_service) _service = new PromptTemplatesService();
  return _service;
}

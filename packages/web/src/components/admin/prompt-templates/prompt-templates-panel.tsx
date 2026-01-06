'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createPromptVersion,
  listPromptTemplates,
  listPromptVersions,
  setDefaultPromptVersion,
  updatePromptTemplate,
  validatePromptTemplates,
  type EffectivePromptTemplate,
  type PromptAdminArea,
  type PromptValidationResult,
} from '@/lib/api/prompt-templates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function PromptTemplatesPanel(props: {
  adminArea: PromptAdminArea;
  title: string;
}) {
  const { adminArea, title } = props;
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const [versions, setVersions] = useState<string[]>([]);
  const [defaultVersion, setDefaultVersionState] = useState<string>('');
  const [version, setVersion] = useState<string>('');

  const [prompts, setPrompts] = useState<EffectivePromptTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [templateDraft, setTemplateDraft] = useState<string>('');

  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<PromptValidationResult | null>(null);

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.key === selectedKey) ?? null,
    [prompts, selectedKey]
  );

  const filteredPrompts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) => {
      return (
        p.key.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });
  }, [prompts, search]);

  const missingRequired = useMemo(() => {
    return prompts.filter((p) => p.is_required && (!p.template || p.template_source === 'missing'));
  }, [prompts]);

  const load = useCallback(async (opts?: { version?: string }) => {
    setError(null);
    setIsLoading(true);
    try {
      const v = await listPromptVersions({ adminArea });
      setVersions(v.versions);
      setDefaultVersionState(v.defaultVersion);

      const nextVersion = opts?.version ?? version ?? v.defaultVersion ?? v.versions[0] ?? '';
      setVersion(nextVersion);

      const list = await listPromptTemplates({ adminArea, version: nextVersion });
      setPrompts(list.prompts);

      if (!selectedKey || !list.prompts.some((p) => p.key === selectedKey)) {
        const first = list.prompts[0]?.key ?? '';
        setSelectedKey(first);
        const firstPrompt = list.prompts.find((p) => p.key === first) ?? null;
        setTemplateDraft(firstPrompt?.template ?? '');
      } else {
        const current = list.prompts.find((p) => p.key === selectedKey) ?? null;
        setTemplateDraft(current?.template ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [adminArea, selectedKey, version]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminArea]);

  useEffect(() => {
    if (!selectedPrompt) return;
    setTemplateDraft(selectedPrompt.template ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const onSelectPrompt = (key: string) => {
    setSelectedKey(key);
    setValidation(null);
    setError(null);
  };

  const onSave = async () => {
    if (!selectedPrompt) return;
    setError(null);
    setIsSaving(true);
    try {
      const trimmed = templateDraft.trim();
      if (!trimmed && selectedPrompt.is_required) throw new Error('Template cannot be empty for a required prompt.');
      const updated = await updatePromptTemplate(selectedPrompt.key, { template: trimmed, version });
      setPrompts((prev) => prev.map((p) => (p.key === updated.prompt.key ? updated.prompt : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const onValidate = async () => {
    setError(null);
    setIsValidating(true);
    try {
      const res = await validatePromptTemplates({ adminArea, version });
      setValidation(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsValidating(false);
    }
  };

  const onCloneVersion = async () => {
    setError(null);
    const toVersion = window.prompt('Clone to new version:', `${version}-copy`);
    if (!toVersion) return;
    try {
      await createPromptVersion({ fromVersion: version, toVersion });
      await load({ version: toVersion });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSetDefault = async () => {
    setError(null);
    try {
      const res = await setDefaultPromptVersion({ defaultVersion: version });
      setDefaultVersionState(res.defaultVersion);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="truncate">{title}</CardTitle>
          <div className="mt-1 text-sm text-muted-foreground">
            Templates are python-style: {'{var}'} (use {'{{'} and {'}}'} for literal braces).
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => load()} disabled={isLoading}>
            Refresh
          </Button>
          <Button variant="outline" onClick={onValidate} disabled={isLoading || isValidating}>
            {isValidating ? 'Validating…' : 'Validate'}
          </Button>
          <Button variant="outline" onClick={onCloneVersion} disabled={isLoading || !version}>
            Clone Version
          </Button>
          <Button onClick={onSetDefault} disabled={isLoading || !version || version === defaultVersion}>
            Set Default
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {missingRequired.length > 0 && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <div className="font-medium text-destructive">Missing required prompts</div>
            <div className="mt-1 text-muted-foreground">
              Runtime will error until these are set for version <span className="font-mono">{version}</span>.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {missingRequired.slice(0, 10).map((p) => (
                <Badge key={p.key} variant="destructive" className="font-mono">
                  {p.key}
                </Badge>
              ))}
              {missingRequired.length > 10 && (
                <Badge variant="secondary">+{missingRequired.length - 10} more</Badge>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {validation && (
          <div
            className={cn(
              'mb-4 rounded-md border p-3 text-sm',
              validation.valid ? 'border-emerald-200 bg-emerald-50/50' : 'border-destructive/30 bg-destructive/5'
            )}
          >
            <div className={cn('font-medium', validation.valid ? 'text-emerald-700' : 'text-destructive')}>
              {validation.valid ? 'All prompts valid' : 'Prompt validation failed'}
            </div>
            {validation.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {validation.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {validation.errors.length > 8 && <li>+{validation.errors.length - 8} more…</li>}
              </ul>
            )}
            {validation.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                {validation.warnings.slice(0, 6).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <Label>Version</Label>
            <div className="mt-1 flex items-center gap-2">
              <Select
                value={version}
                onValueChange={(v) => {
                  setValidation(null);
                  setVersion(v);
                  void load({ version: v });
                }}
                disabled={isLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}{v === defaultVersion ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>Search</Label>
            <Input
              className="mt-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by key/name/description…"
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="max-h-[520px] overflow-auto rounded-md border">
              {isLoading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading prompts…</div>
              ) : filteredPrompts.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No prompts found.</div>
              ) : (
                <div className="divide-y">
                  {filteredPrompts.map((p) => {
                    const isMissing = !p.template || p.template_source === 'missing';
                    return (
                      <button
                        key={p.key}
                        className={cn(
                          'w-full px-3 py-2 text-left text-sm hover:bg-muted',
                          selectedKey === p.key && 'bg-muted'
                        )}
                        onClick={() => onSelectPrompt(p.key)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono">{p.key}</span>
                          <div className="flex items-center gap-2">
                            {p.is_required && <Badge variant="secondary">required</Badge>}
                            {isMissing && p.is_required && <Badge variant="destructive">missing</Badge>}
                            {!isMissing && <Badge variant="outline">{p.template_source}</Badge>}
                          </div>
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {p.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-3">
            {!selectedPrompt ? (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                Select a prompt to edit.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {selectedPrompt.key}
                  </Badge>
                  {selectedPrompt.is_required && <Badge variant="secondary">required</Badge>}
                  <Badge variant="outline">{selectedPrompt.template_source}</Badge>
                  {version === defaultVersion && (
                    <Badge variant="destructive">editing default</Badge>
                  )}
                </div>

                <div className="text-sm text-muted-foreground">{selectedPrompt.description}</div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Allowed Variables</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedPrompt.allowed_variables.length === 0 ? (
                        <span className="text-sm text-muted-foreground">None</span>
                      ) : (
                        selectedPrompt.allowed_variables.map((v) => (
                          <Badge key={v} variant="secondary" className="font-mono">
                            {v}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <Label>Detected Variables</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedPrompt.variables.length === 0 ? (
                        <span className="text-sm text-muted-foreground">None</span>
                      ) : (
                        selectedPrompt.variables.map((v) => (
                          <Badge key={v} variant="outline" className="font-mono">
                            {v}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <Label>Template</Label>
                  <Textarea
                    className="mt-2 min-h-[260px] font-mono text-xs"
                    value={templateDraft}
                    onChange={(e) => setTemplateDraft(e.target.value)}
                    placeholder="Enter prompt template…"
                    disabled={isLoading || isSaving}
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setTemplateDraft(selectedPrompt.template ?? '')}
                    disabled={isLoading || isSaving}
                  >
                    Reset
                  </Button>
                  <Button onClick={onSave} disabled={isLoading || isSaving}>
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { submitTenantApplication, type TenantApplicationBrandConfig } from '@/lib/api/tenant-applications';
import { trackEvent, trackCustomEvent } from '@/lib/analytics/meta-pixel';
import { usePartnerAffiliate } from '@/hooks/use-partner-affiliate';

function normalizeSlugInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
}

export default function TenantApplicationPage() {
  const { toast } = useToast();
  const { affiliateCode } = usePartnerAffiliate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasTrackedStart, setHasTrackedStart] = useState(false);

  // Track application start on page load
  useEffect(() => {
    if (!hasTrackedStart) {
      trackCustomEvent('PartnerApplicationStart', { affiliate_code: affiliateCode || undefined });
      setHasTrackedStart(true);
    }
  }, [hasTrackedStart, affiliateCode]);

  const [applicantName, setApplicantName] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [desiredTenantName, setDesiredTenantName] = useState('');
  const [desiredSlugRaw, setDesiredSlugRaw] = useState('');
  const [desiredPrimaryDomain, setDesiredPrimaryDomain] = useState('');
  const [message, setMessage] = useState('');

  const [includeBrand, setIncludeBrand] = useState(false);
  const [brand, setBrand] = useState<TenantApplicationBrandConfig>({
    name: '',
    shortName: '',
    supportEmail: '',
    legalEmail: '',
    primaryHsl: '',
    primaryForegroundHsl: '',
    logoUrl: '',
  });

  const desiredSlug = useMemo(() => normalizeSlugInput(desiredSlugRaw), [desiredSlugRaw]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const brandConfig = includeBrand
        ? (Object.fromEntries(
          Object.entries(brand).filter(([, v]) => (v ?? '').toString().trim() !== '')
        ) as TenantApplicationBrandConfig)
        : undefined;

      // Include affiliate code in message if present
      let finalMessage = message.trim() || '';
      if (affiliateCode) {
        finalMessage = finalMessage
          ? `${finalMessage}\n\n[Referred by: ${affiliateCode}]`
          : `[Referred by: ${affiliateCode}]`;
      }

      const res = await submitTenantApplication({
        applicantName,
        applicantEmail,
        desiredTenantName,
        desiredSlug,
        desiredPrimaryDomain: desiredPrimaryDomain.trim() ? desiredPrimaryDomain : undefined,
        brandConfig,
        message: finalMessage || undefined,
      });

      setSubmittedId(res.data.id);

      // Track successful application
      trackEvent('CompleteRegistration', {
        content_name: 'tenant_application',
        status: 'submitted',
      });

      toast({
        title: 'Application submitted',
        description: 'We\'ll review it and follow up via email.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit application';
      setError(msg);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white">Application received</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-400">
            <p>Thanks — we\'ll review your application and reach out soon.</p>
            <div>
              <div className="text-xs text-gray-500">Application ID</div>
              <div className="font-mono text-white">{submittedId}</div>
            </div>
            <div className="flex gap-2">
              <Link href={'/tenants' as Route}>
                <Button variant="outline" className="border-white/10 hover:bg-white/10">
                  Back to overview
                </Button>
              </Link>
              <Link href={'/dashboard' as Route}>
                <Button className="bg-campfire-500 hover:bg-campfire-600">Go to dashboard</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      <div className="flex items-center gap-4">
        <Link href={'/tenants' as Route}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Tenant application</h1>
          <p className="text-gray-400 text-sm">Tell us what you want to launch and we\'ll follow up.</p>
        </div>
      </div>

      <form onSubmit={submit}>
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader>
            <CardTitle className="text-white">Your details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="applicantName">Name</Label>
                <Input
                  id="applicantName"
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  placeholder="Your name"
                  className="bg-white/5 border-white/10"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="applicantEmail">Email</Label>
                <Input
                  id="applicantEmail"
                  value={applicantEmail}
                  onChange={(e) => setApplicantEmail(e.target.value)}
                  placeholder="you@brand.com"
                  type="email"
                  className="bg-white/5 border-white/10"
                  required
                />
              </div>
            </div>

            <div className="pt-2 border-t border-white/5">
              <h3 className="text-white font-medium mb-3">Tenant request</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="desiredTenantName">Tenant name</Label>
                  <Input
                    id="desiredTenantName"
                    value={desiredTenantName}
                    onChange={(e) => setDesiredTenantName(e.target.value)}
                    placeholder="Brand / Creator name"
                    className="bg-white/5 border-white/10"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="desiredSlug">Desired slug</Label>
                  <Input
                    id="desiredSlug"
                    value={desiredSlugRaw}
                    onChange={(e) => setDesiredSlugRaw(e.target.value)}
                    placeholder="e.g., creator-name"
                    className="bg-white/5 border-white/10 font-mono"
                    required
                  />
                  <p className="text-xs text-gray-500">
                    We\'ll normalize to <span className="font-mono text-gray-300">/{desiredSlug || '...'}</span>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="desiredPrimaryDomain">Primary domain (optional)</Label>
                  <Input
                    id="desiredPrimaryDomain"
                    value={desiredPrimaryDomain}
                    onChange={(e) => setDesiredPrimaryDomain(e.target.value)}
                    placeholder="example.com"
                    className="bg-white/5 border-white/10 font-mono"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="message">Message (optional)</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us about your audience, goals, and any requirements…"
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium">Include brand overrides</div>
                  <div className="text-xs text-gray-500">Optional: help us match your brand on day one.</div>
                </div>
                <Switch checked={includeBrand} onCheckedChange={setIncludeBrand} />
              </div>

              {includeBrand && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="brandName">Brand name</Label>
                    <Input
                      id="brandName"
                      value={brand.name ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brandShortName">Short name</Label>
                    <Input
                      id="brandShortName"
                      value={brand.shortName ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, shortName: e.target.value }))}
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supportEmail">Support email</Label>
                    <Input
                      id="supportEmail"
                      value={brand.supportEmail ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, supportEmail: e.target.value }))}
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="legalEmail">Legal email</Label>
                    <Input
                      id="legalEmail"
                      value={brand.legalEmail ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, legalEmail: e.target.value }))}
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryHsl">Primary HSL</Label>
                    <Input
                      id="primaryHsl"
                      value={brand.primaryHsl ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, primaryHsl: e.target.value }))}
                      placeholder="24.6 95% 53.1%"
                      className="bg-white/5 border-white/10 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryForegroundHsl">Primary foreground HSL</Label>
                    <Input
                      id="primaryForegroundHsl"
                      value={brand.primaryForegroundHsl ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, primaryForegroundHsl: e.target.value }))}
                      placeholder="60 9.1% 97.8%"
                      className="bg-white/5 border-white/10 font-mono"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="logoUrl">Logo URL</Label>
                    <Input
                      id="logoUrl"
                      value={brand.logoUrl ?? ''}
                      onChange={(e) => setBrand((b) => ({ ...b, logoUrl: e.target.value }))}
                      placeholder="https://..."
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" className="bg-campfire-500 hover:bg-campfire-600" disabled={isSubmitting}>
                <Send className="h-4 w-4 mr-2" />
                {isSubmitting ? 'Submitting…' : 'Submit application'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

